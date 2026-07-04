// Event-room reads: live standings (computed on the fly, never stored before
// adjudication), chat, quotes. Everything scoped (room_id, event_ref) — one
// event's room can never leak another's data.

import { sql } from "@/lib/db";
import { dateET, minuteOfDayET } from "@/lib/calendar";
import { ensureEndPrices, ensureStartPrices, type EventRow } from "@/lib/events";
import { cachedLiveQuotes, feedMode } from "@/lib/feed";
import { pctChange, quoteAt, startPrice } from "@/lib/prices";
import { lockedRoster, type Allocation } from "@/lib/picks";
import { enqueueSpine, flushOutbox } from "@/lib/outbox";

const START_CENTS = 100000; // $1,000.00

export type StandingRow = {
  playerId: string;
  displayName: string;
  avatarUrl: string | null; // host-rendered (contract §2) — embed, never draw
  valueCents: number;
  pct: number; // vs $1,000, 2dp
  placement: number;
  allocations: Allocation[];
  lockedAt: string | null; // tiebreak is public: equal bags → earlier lock wins
};

/**
 * Live portfolio value in cents. The ride is live from minute 0 of event_date
 * (lock = start gun); flat $1,000 only in the pre-game room before midnight.
 * `startPrices` is the settled 00:00 snapshot (TASK-coingame-13).
 * `quotePrices` (TASK-coingame-14a) is the current real-feed price map —
 * when provided it replaces the tape entirely; a coin missing either number
 * contributes its flat notional (degraded, never NaN, never tape-mixed-with-real).
 */
export function liveValueCents(
  allocations: Allocation[], eventDate: string, now = new Date(),
  startPrices?: Record<string, number>,
  quotePrices?: Record<string, number>,
): number {
  const nowDate = dateET(now);
  if (nowDate < eventDate) return START_CENTS; // pre-game: hasn't started yet
  const minute = minuteOfDayET(now);
  // After 16:00 (or on a later day) the tape is pinned to the settled end price.
  const priceMinute = nowDate === eventDate ? Math.min(minute, 960) : 960;
  let cents = 0;
  for (const a of allocations) {
    const start = startPrices?.[a.symbol] ?? (quotePrices ? undefined : startPrice(a.symbol, eventDate));
    const q = quotePrices ? quotePrices[a.symbol] : quoteAt(a.symbol, eventDate, priceMinute);
    cents += start && q
      ? Math.round(a.units * 10000 * (q / start))
      : a.units * 10000; // no data yet: this leg rides flat
  }
  return cents;
}

export async function liveStandings(
  roomId: string, event: EventRow, now = new Date(),
  startPrices?: Record<string, number>,
  quotePrices?: Record<string, number>,
): Promise<StandingRow[]> {
  const starts = startPrices ?? await ensureStartPrices(event.ref, event.event_date, now);
  const roster = await lockedRoster(roomId, event.ref);
  const rows = roster.map((m) => ({
    playerId: m.playerId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    lockedAt: m.lockedAt,
    allocations: m.allocations,
    valueCents: liveValueCents(m.allocations, event.event_date, now, starts, quotePrices),
  }));
  // value desc, earlier lock, then playerId — fully deterministic (ISO strings
  // truncate to ms; concurrent bot locks can collide).
  rows.sort((a, b) =>
    b.valueCents - a.valueCents ||
    a.lockedAt.localeCompare(b.lockedAt) ||
    a.playerId.localeCompare(b.playerId));
  return rows.map((r, i) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    valueCents: r.valueCents,
    pct: Math.round(((r.valueCents - START_CENTS) / START_CENTS) * 10000) / 100,
    placement: i + 1,
    allocations: r.allocations,
    lockedAt: r.lockedAt,
  }));
}

export type PoolQuote = {
  symbol: string;
  price: number;
  pct: number;
  startPrice: number | null;
  pctFromStart: number | null;
};

function pctVs(price: number, base: number): number {
  return Math.round(((price - base) / base) * 10000) / 100;
}

/**
 * Quotes for a pool + the raw price map standings should be computed from.
 * Kraken mode (TASK-coingame-14a/b): live cache during the ride and pre-game;
 * settled end_price once past 16:00 — the last poll IS the adjudicated board.
 * Symbols with no data yet are omitted (UI shows "—"). Tape mode: the
 * original deterministic logic, `prices` undefined so liveValueCents stays
 * on the tape.
 */
export async function poolQuotes(
  symbols: string[], event: Pick<EventRow, "ref" | "event_date">, now = new Date(),
  startPrices?: Record<string, number>,
): Promise<{ quotes: PoolQuote[]; prices?: Record<string, number> }> {
  const eventDate = event.event_date;
  const nowDate = dateET(now);
  const minute = minuteOfDayET(now);
  const started = nowDate >= eventDate; // the gun has fired

  if (feedMode() === "tape") {
    const qDate = started ? eventDate : nowDate;
    const qMinute = nowDate > eventDate ? 960 : nowDate === eventDate ? Math.min(minute, 960) : minute;
    const quotes = symbols.map((s) => {
      const price = quoteAt(s, qDate, qMinute);
      const start = started ? startPrices?.[s] ?? startPrice(s, eventDate) : null;
      return {
        symbol: s,
        price,
        pct: pctChange(s, qDate, qMinute),
        startPrice: start,
        pctFromStart: start == null ? null : pctVs(price, start),
      };
    });
    return { quotes };
  }

  // ---- kraken ----
  const ended = nowDate > eventDate || (nowDate === eventDate && minute >= 960);
  const starts = started ? startPrices ?? {} : {};
  let prices: Record<string, number> = {};
  let dayPct: Record<string, number> = {};

  if (ended) {
    // Finish line passed: serve the settled candle prices, not the live tape.
    const ends = await ensureEndPrices(event.ref, eventDate, now);
    prices = ends;
    // Any end price still unrecoverable (Kraken down): fall back to last cache
    // for display so the room isn't blank; standings degrade the same way.
    const missing = symbols.filter((s) => prices[s] == null);
    if (missing.length) {
      const cache = await cachedLiveQuotes(missing);
      for (const s of missing) if (cache[s]) prices[s] = cache[s].price;
    }
  } else {
    const cache = await cachedLiveQuotes(symbols);
    for (const s of symbols) {
      if (cache[s]) { prices[s] = cache[s].price; dayPct[s] = cache[s].pct; }
    }
  }

  const quotes: PoolQuote[] = [];
  for (const s of symbols) {
    const price = prices[s];
    if (price == null) continue; // no data at all yet — UI shows "—"
    const start = starts[s] ?? null;
    const pctFromStart = start == null ? null : pctVs(price, start);
    quotes.push({
      symbol: s,
      price,
      pct: dayPct[s] ?? pctFromStart ?? 0,
      startPrice: start,
      pctFromStart,
    });
  }
  return { quotes, prices };
}

// ---- chat -------------------------------------------------------------------

export type ChatMsg = {
  id: string;
  playerId: string;
  displayName: string;
  body: string;
  createdAt: string;
};

export async function chatTail(roomId: string, eventRef: string, after?: string, limit = 50): Promise<ChatMsg[]> {
  const rows = after
    ? await sql`
        select c.id, c.player_id, c.body, c.created_at, pl.display_name
        from coingame_chat c join coingame_player pl on pl.player_id = c.player_id
        where c.room_id = ${roomId} and c.event_ref = ${eventRef} and c.created_at > ${after}
        order by c.created_at asc limit ${limit}`
    : await sql`
        select * from (
          select c.id, c.player_id, c.body, c.created_at, pl.display_name
          from coingame_chat c join coingame_player pl on pl.player_id = c.player_id
          where c.room_id = ${roomId} and c.event_ref = ${eventRef}
          order by c.created_at desc limit ${limit}
        ) t order by created_at asc`;
  return rows.map((r) => ({
    id: String(r.id),
    playerId: String(r.player_id),
    displayName: String(r.display_name),
    body: String(r.body),
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

export async function postChat(
  roomId: string, eventRef: string, playerId: string, body: string,
): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim().slice(0, 500);
  if (!text) return { ok: false, error: "empty message" };
  await sql`
    insert into coingame_chat (room_id, event_ref, player_id, body)
    values (${roomId}, ${eventRef}, ${playerId}, ${text})`;
  await enqueueSpine(roomId, {
    playerId,
    ref: eventRef,
    ts: Date.now(),
    verb: "chat_sent",
    data: { text },
  });
  void flushOutbox().catch(() => {});
  return { ok: true };
}

// ---- final board (closed events) ---------------------------------------------

export async function finalBoard(roomId: string, eventRef: string): Promise<StandingRow[]> {
  const rows = await sql`
    select b.player_id, b.final_cents, b.placement, pl.display_name, pl.avatar_url, p.allocations, p.locked_at
    from coingame_board b
    join coingame_player pl on pl.player_id = b.player_id
    left join coingame_pick p on p.room_id = b.room_id and p.event_ref = b.event_ref and p.player_id = b.player_id
    where b.room_id = ${roomId} and b.event_ref = ${eventRef}
    order by b.placement asc`;
  return rows.map((r) => ({
    playerId: String(r.player_id),
    displayName: String(r.display_name),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
    valueCents: Number(r.final_cents),
    pct: Math.round(((Number(r.final_cents) - START_CENTS) / START_CENTS) * 10000) / 100,
    placement: Number(r.placement),
    allocations: (r.allocations ?? []) as Allocation[],
    lockedAt: r.locked_at ? new Date(String(r.locked_at)).toISOString() : null,
  }));
}
