// Kraken-backed real market data (TASK-coingame-14a/b). Request-driven ONLY —
// no Vercel cron, no API key, public endpoints. Two capabilities:
//
//   cachedLiveQuotes(symbols)   — current prices via a ~20s DB cache; one
//                                 batched Ticker call per TTL window no matter
//                                 how many players poll. Zero players = zero calls.
//   priceAtInstant(symbol, at)  — the TRUE price at an exact past instant via
//                                 OHLC candles (open of the candle that opened
//                                 at `at`). Settlement can run at ANY time
//                                 after the moment and get identical numbers.
//
// PRICE_FEED=tape flips every caller back to the deterministic tape
// (lib/prices.ts) for dev/tests or as the emergency fallback. Settled prices
// live in coingame_event_pool either way, so flipping the flag can never
// corrupt an already-settled event.

import { sql } from "@/lib/db";

export function feedMode(): "kraken" | "tape" {
  return process.env.PRICE_FEED === "tape" ? "tape" : "kraken";
}

// ---- pair naming ------------------------------------------------------------
// Request names: XBTUSD for BTC (Kraken's legacy code), {SYMBOL}USD otherwise.
// Response keys echo the request EXCEPT four legacy pairs (verified live
// 2026-07-04 against /0/public/Ticker).

function requestPair(symbol: string): string {
  return symbol === "BTC" ? "XBTUSD" : `${symbol}USD`;
}

const RESULT_KEY: Record<string, string> = {
  BTC: "XXBTZUSD", ETH: "XETHZUSD", XRP: "XXRPZUSD", DOGE: "XDGUSD",
};

function resultKey(symbol: string): string {
  return RESULT_KEY[symbol] ?? `${symbol}USD`;
}

// ---- fetch helper -----------------------------------------------------------

const KRAKEN = "https://api.kraken.com/0/public";

async function kraken(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${KRAKEN}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { error?: string[]; result?: Record<string, unknown> };
    if (j.error?.length || !j.result) return null;
    return j.result;
  } catch {
    return null;
  }
}

// ---- live quotes (read-through cache, single-flight) --------------------------

const TTL_MS = 20000;      // serve cached quotes younger than this
const CLAIM_MS = 10000;    // a fetch claim older than this is stale (crashed)

export type LiveQuote = { price: number; pct: number };

type QuoteRow = { symbol: string; price: unknown; pct: unknown; fetched_at: unknown };

function rowsToMap(rows: QuoteRow[]): Record<string, LiveQuote> {
  const map: Record<string, LiveQuote> = {};
  for (const r of rows) {
    if (r.price == null) continue; // seed row never yet filled
    map[String(r.symbol)] = { price: Number(r.price), pct: Number(r.pct ?? 0) };
  }
  return map;
}

/**
 * Current prices for `symbols`. Reads coingame_quote; if the cache is stale,
 * exactly one caller (conditional-UPDATE claim on the first symbol's row)
 * refreshes it with one batched Ticker call. Upstream failure serves stale
 * rows — screens degrade to "last good price", never blank, never throw.
 */
export async function cachedLiveQuotes(symbols: string[]): Promise<Record<string, LiveQuote>> {
  try {
    return await cachedLiveQuotesInner(symbols);
  } catch {
    return {}; // e.g. coingame_quote not migrated yet — degrade, never 500
  }
}

async function cachedLiveQuotesInner(symbols: string[]): Promise<Record<string, LiveQuote>> {
  if (!symbols.length) return {};
  const sorted = [...symbols].sort();

  // Seed rows so the claim UPDATE always has a target (no-op after first call).
  for (const s of sorted) {
    await sql`insert into coingame_quote (symbol) values (${s}) on conflict (symbol) do nothing`;
  }

  const rows = (await sql`
    select symbol, price, pct, fetched_at from coingame_quote
    where symbol = any(${sorted})`) as QuoteRow[];

  const oldest = Math.min(
    ...rows.map((r) => new Date(String(r.fetched_at ?? 0)).getTime()),
    ...(rows.length < sorted.length ? [0] : []),
  );
  if (Date.now() - oldest < TTL_MS) return rowsToMap(rows);

  // Stale: try to claim the refresh (single-flight). Losers serve stale rows.
  const claimed = await sql`
    update coingame_quote set claim_at = now()
    where symbol = ${sorted[0]}
      and (claim_at is null or claim_at < now() - make_interval(secs => ${CLAIM_MS / 1000}))
    returning symbol`;
  if (!claimed.length) return rowsToMap(rows);

  const pairs = sorted.map(requestPair).join(",");
  const result = await kraken(`/Ticker?pair=${pairs}`);
  if (!result) {
    await sql`update coingame_quote set claim_at = null where symbol = ${sorted[0]}`;
    return rowsToMap(rows); // stale beats blank
  }

  const fresh: Record<string, LiveQuote> = {};
  for (const s of sorted) {
    const t = result[resultKey(s)] as { c?: string[]; o?: string } | undefined;
    const last = t?.c?.[0] ? Number(t.c[0]) : NaN;
    const open = t?.o ? Number(t.o) : NaN;
    if (!Number.isFinite(last) || last <= 0) continue; // missing pair: keep old row
    const pct = Number.isFinite(open) && open > 0
      ? Math.round(((last - open) / open) * 10000) / 100
      : 0;
    fresh[s] = { price: last, pct };
    await sql`
      update coingame_quote set price = ${last}, pct = ${pct}, fetched_at = now(), claim_at = null
      where symbol = ${s}`;
  }
  await sql`update coingame_quote set claim_at = null where symbol = ${sorted[0]}`;
  // Merge: fresh over stale, so a pair Kraken dropped still shows last-good.
  return { ...rowsToMap(rows), ...fresh };
}

// ---- price at an exact past instant (settlement) ------------------------------

// Interval ladder in minutes. 720 candles per interval → coverage windows.
// Our targets (00:00 / 16:00 ET) are hour-aligned in every DST regime, so all
// rungs land on candle boundaries. 60-min reaches ~30 days back — beyond any
// realistic settlement lag (the sweep fires daily).
const LADDER = [1, 5, 15, 60] as const;
const CANDLES = 720;

/**
 * TRUE price of `symbol` at past instant `at`: the OPEN of the OHLC candle
 * that opened exactly then (first trade at/after the instant). Deterministic
 * for a given instant no matter when it's called — the property that makes
 * "settle whenever the first read arrives" fair. Null if unrecoverable
 * (Kraken down or > ~30 days late); callers must treat null as "retry later".
 */
export async function priceAtInstant(symbol: string, at: Date): Promise<number | null> {
  const targetSec = Math.floor(at.getTime() / 1000);
  const ageMin = (Date.now() - at.getTime()) / 60000;
  if (ageMin < 0) return null; // future instants don't have candles

  for (const interval of LADDER) {
    if (ageMin > CANDLES * interval * 0.95) continue; // window can't reach back
    if (targetSec % (interval * 60) !== 0) continue;  // must be a candle boundary
    const result = await kraken(
      `/OHLC?pair=${requestPair(symbol)}&interval=${interval}&since=${targetSec - 1}`,
    );
    if (!result) return null; // network/API failure: retry later, don't ladder up
    const candles = result[resultKey(symbol)] as unknown[][] | undefined;
    const hit = candles?.find((c) => Number(c[0]) === targetSec);
    if (hit) {
      const open = Number(hit[1]);
      if (Number.isFinite(open) && open > 0) return open;
    }
    // Exact candle absent at this rung (no trades that minute) — coarser rung.
  }
  return null;
}
