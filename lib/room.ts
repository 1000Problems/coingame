// Event-room reads: live standings (computed on the fly, never stored before
// adjudication), chat, quotes. Everything scoped (room_id, event_ref) — one
// event's room can never leak another's data.

import { sql } from "@/lib/db";
import { dateET, minuteOfDayET } from "@/lib/calendar";
import { ensureStartPrices, type EventRow } from "@/lib/events";
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
 * `startPrices` (TASK-coingame-13) is the settled snapshot from
 * coingame_event_pool; the tape is only the fallback.
 */
export function liveValueCents(
  allocations: Allocation[], eventDate: string, now = new Date(),
  startPrices?: Record<string, number>,
): number {
  const nowDate = dateET(now);
  if (nowDate < eventDate) return START_CENTS; // pre-game: hasn't started yet
  const minute = minuteOfDayET(now);
  // After 16:00 (or on a later day) the tape is pinned to the settled end price.
  const priceMinute = nowDate === eventDate ? Math.min(minute, 960) : 960;
  let cents = 0;
  for (const a of allocations) {
    const start = startPrices?.[a.symbol] ?? startPrice(a.symbol, eventDate);
    const q = quoteAt(a.symbol, eventDate, priceMinute);
    cents += Math.round(a.units * 10000 * (q / start));
  }
  return cents;
}

export async function liveStandings(
  roomId: string, event: EventRow, now = new Date(),
  startPrices?: Record<string, number>,
): Promise<StandingRow[]> {
  const starts = startPrices ?? await ensureStartPrices(event.ref, event.event_date, now);
  const roster = await lockedRoster(roomId, event.ref);
  const rows = roster.map((m) => ({
    playerId: m.playerId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    lockedAt: m.lockedAt,
    allocations: m.allocations,
    valueCents: liveValueCents(m.allocations, event.event_date, now, starts),
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

export function quotesForPool(
  symbols: string[], eventDate: string, now = new Date(),
  startPrices?: Record<string, number>,
) {
  const nowDate = dateET(now);
  const minute = minuteOfDayET(now);
  // Quote the event day's tape once it arrives (pinned to the 16:00 settle
  // after the ride); before the event day, the live 24/7 tape of today.
  const qDate = nowDate >= eventDate ? eventDate : nowDate;
  const qMinute = nowDate > eventDate ? 960 : nowDate === eventDate ? Math.min(minute, 960) : minute;
  const started = nowDate >= eventDate; // the gun has fired
  return symbols.map((s) => {
    const price = quoteAt(s, qDate, qMinute);
    const start = started ? startPrices?.[s] ?? startPrice(s, eventDate) : null;
    return {
      symbol: s,
      price,
      pct: pctChange(s, qDate, qMinute), // 24h ticker (crypto convention)
      startPrice: start,
      // ± since the 00:00 snapshot — the number that reconciles with bag ±.
      pctFromStart: start == null ? null : Math.round(((price - start) / start) * 10000) / 100,
    };
  });
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
