// Event engine. Invariant: the next 2 calendar days ALWAYS have events —
// ensureEvents() is idempotent and runs lazily on every /events read and after
// every adjudication. Phase is COMPUTED from the clock, never stored (only
// closed_at is stored); the midnight lock needs no scheduler.

import { sql } from "@/lib/db";
import {
  endsAt, labelFor, locksAt, nextDays, prevDay, settlesAt, shortLabelFor, todayET,
} from "@/lib/calendar";
import { endPrice, startPrice } from "@/lib/prices";
import { feedMode, priceAtInstant } from "@/lib/feed";

export type Phase = "open" | "locked" | "adjudicating" | "closed";

export type EventRow = {
  ref: string;
  event_date: string;   // YYYY-MM-DD
  locks_at: string;     // ISO
  settles_at: string;   // ISO
  trophy_label: string;
  closed_at: string | null;
};

export function refFor(eventDate: string): string {
  return `d-${eventDate}`;
}

export function phaseOf(e: Pick<EventRow, "locks_at" | "settles_at" | "closed_at">, now = new Date()): Phase {
  if (e.closed_at) return "closed";
  if (now >= new Date(e.settles_at)) return "adjudicating";
  if (now >= new Date(e.locks_at)) return "locked";
  return "open";
}

function normalizeDate(v: unknown): string {
  // neon returns date columns as 'YYYY-MM-DD' strings or Date objects depending
  // on config; normalize defensively.
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function rowToEvent(r: Record<string, unknown>): EventRow {
  return {
    ref: String(r.ref),
    event_date: normalizeDate(r.event_date),
    locks_at: new Date(String(r.locks_at)).toISOString(),
    settles_at: new Date(String(r.settles_at)).toISOString(),
    trophy_label: String(r.trophy_label),
    closed_at: r.closed_at ? new Date(String(r.closed_at)).toISOString() : null,
  };
}

/**
 * Idempotent: create events for the next `n` calendar days (after today ET) if
 * missing, snapshotting the active coin pool with ref_price (yesterday's mark,
 * the 24h display reference). Race-safe via `on conflict do nothing`.
 */
export async function ensureEvents(n = 2): Promise<void> {
  const days = nextDays(todayET(), n);
  for (const d of days) {
    const ref = refFor(d);
    const inserted = await sql`
      insert into coingame_event (ref, event_date, locks_at, settles_at, trophy_label)
      values (${ref}, ${d}, ${locksAt(d).toISOString()}, ${settlesAt(d).toISOString()},
              ${"Daily Champ · " + shortLabelFor(d)})
      on conflict (ref) do nothing
      returning ref`;
    if (inserted.length > 0) {
      // Snapshot the pool. ref_price: tape mode only — in kraken mode it stays
      // null (display reference, consumed by no UI; grep-verified TASK-14b).
      const coins = await sql`select symbol from coingame_coin where active order by symbol`;
      const prev = prevDay(d);
      for (const c of coins) {
        const symbol = String(c.symbol);
        const refPrice = feedMode() === "tape" ? endPrice(symbol, prev) : null;
        await sql`
          insert into coingame_event_pool (event_ref, symbol, ref_price)
          values (${ref}, ${symbol}, ${refPrice})
          on conflict (event_ref, symbol) do nothing`;
      }
    }
  }
}

export async function getEvent(ref: string): Promise<EventRow | null> {
  const rows = await sql`select * from coingame_event where ref = ${ref}`;
  return rows.length ? rowToEvent(rows[0]) : null;
}

/** Window for GET /events: last 7 closed + everything not closed. */
export async function eventsWindow(): Promise<EventRow[]> {
  const rows = await sql`
    (select * from coingame_event where closed_at is not null order by event_date desc limit 7)
    union all
    (select * from coingame_event where closed_at is null)
    order by event_date asc`;
  return rows.map(rowToEvent);
}

/** Contract §3 shape for one event. */
export function toWireEvent(e: EventRow, now = new Date()) {
  return {
    ref: e.ref,
    label: `Coin Picks · ${labelFor(e.event_date)}`,
    group: "1K Daily",
    phase: phaseOf(e, now),
    expectedLockAt: e.locks_at,
  };
}

/** Events currently open for picking, soonest first. */
export async function openEvents(now = new Date()): Promise<EventRow[]> {
  const all = await eventsWindow();
  return all.filter((e) => phaseOf(e, now) === "open");
}

/**
 * Settle 00:00 ET start prices at (or after) the gun — lazy-first, write-once
 * (TASK-coingame-13/14b). Called from hot reads; adjudication is the backstop.
 * Kraken mode reads the OHLC candle that opened at the gun — the exact same
 * number no matter when this runs. A symbol Kraken can't answer for right now
 * is OMITTED from the map (no write, retried on the next read); callers treat
 * missing keys as "no data yet". Tape mode keeps the old always-known behavior.
 */
export async function ensureStartPrices(
  ref: string, eventDate: string, now = new Date(),
): Promise<Record<string, number>> {
  const rows = await sql`
    select symbol, start_price from coingame_event_pool where event_ref = ${ref}`;
  const started = now >= locksAt(eventDate);
  const kraken = feedMode() === "kraken";
  const map: Record<string, number> = {};
  for (const r of rows) {
    const symbol = String(r.symbol);
    if (r.start_price != null) { map[symbol] = Number(r.start_price); continue; }
    if (!started) {
      if (!kraken) map[symbol] = startPrice(symbol, eventDate); // pre-gun tape preview
      continue;
    }
    const p = kraken
      ? await priceAtInstant(symbol, locksAt(eventDate))
      : startPrice(symbol, eventDate);
    if (p == null) continue; // unrecoverable right now — retry on next read
    await sql`
      update coingame_event_pool set start_price = ${p}
      where event_ref = ${ref} and symbol = ${symbol} and start_price is null`;
    map[symbol] = p;
  }
  return map;
}

/**
 * Settle 16:00 ET end prices — identical pattern to ensureStartPrices
 * (TASK-coingame-14b). Lazily fills end_price write-once from the finish-line
 * candle as soon as anything reads the event past 16:00; keeps the invariant
 * that the last live poll equals the adjudicated board (post-16:00 quotes are
 * served FROM these settled values). Adjudication requires completeness.
 */
export async function ensureEndPrices(
  ref: string, eventDate: string, now = new Date(),
): Promise<Record<string, number>> {
  const rows = await sql`
    select symbol, end_price from coingame_event_pool where event_ref = ${ref}`;
  const ended = now >= endsAt(eventDate);
  const kraken = feedMode() === "kraken";
  const map: Record<string, number> = {};
  for (const r of rows) {
    const symbol = String(r.symbol);
    if (r.end_price != null) { map[symbol] = Number(r.end_price); continue; }
    if (!ended) continue;
    const p = kraken
      ? await priceAtInstant(symbol, endsAt(eventDate))
      : endPrice(symbol, eventDate);
    if (p == null) continue; // retry on next read
    await sql`
      update coingame_event_pool set end_price = ${p}
      where event_ref = ${ref} and symbol = ${symbol} and end_price is null`;
    map[symbol] = p;
  }
  return map;
}

export async function poolFor(ref: string): Promise<{ symbol: string; ref_price: number | null; color: string }[]> {
  // color joins from the master pool row — the pool snapshot stays price-only.
  const rows = await sql`
    select p.symbol, p.ref_price, c.color
    from coingame_event_pool p
    left join coingame_coin c on c.symbol = p.symbol
    where p.event_ref = ${ref} order by p.symbol`;
  return rows.map((r) => ({
    symbol: String(r.symbol),
    ref_price: r.ref_price == null ? null : Number(r.ref_price),
    color: r.color ? String(r.color) : "#8b909c",
  }));
}
