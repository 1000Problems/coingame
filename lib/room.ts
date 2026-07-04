// Event-room reads: live standings (computed on the fly, never stored before
// adjudication), chat, quotes. Everything scoped (room_id, event_ref) — one
// event's room can never leak another's data.

import { sql } from "@/lib/db";
import { dateET, minuteOfDayET } from "@/lib/calendar";
import type { EventRow } from "@/lib/events";
import { openPrice, pctChange, quoteAt } from "@/lib/prices";
import { lockedRoster, type Allocation } from "@/lib/picks";
import { enqueueSpine, flushOutbox } from "@/lib/outbox";

const START_CENTS = 100000; // $1,000.00
const OPEN_MIN = 570;

export type StandingRow = {
  playerId: string;
  displayName: string;
  avatarUrl: string | null; // host-rendered (contract §2) — embed, never draw
  valueCents: number;
  pct: number; // vs $1,000, 2dp
  placement: number;
  allocations: Allocation[];
};

/** Live portfolio value in cents. Flat $1,000 before the open on trading day. */
export function liveValueCents(
  allocations: Allocation[], tradingDate: string, now = new Date(),
): number {
  const nowDate = dateET(now);
  const minute = minuteOfDayET(now);
  const started = nowDate > tradingDate || (nowDate === tradingDate && minute >= OPEN_MIN);
  if (!started) return START_CENTS;
  // After the trading day ends we still price via quoteAt at close minute.
  const priceDate = tradingDate;
  const priceMinute = nowDate === tradingDate ? minute : 960;
  let cents = 0;
  for (const a of allocations) {
    const open = openPrice(a.symbol, tradingDate);
    const q = quoteAt(a.symbol, priceDate, priceMinute);
    cents += Math.round(a.units * 10000 * (q / open));
  }
  return cents;
}

export async function liveStandings(roomId: string, event: EventRow, now = new Date()): Promise<StandingRow[]> {
  const roster = await lockedRoster(roomId, event.ref);
  const rows = roster.map((m) => ({
    playerId: m.playerId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    lockedAt: m.lockedAt,
    allocations: m.allocations,
    valueCents: liveValueCents(m.allocations, event.trading_date, now),
  }));
  rows.sort((a, b) => b.valueCents - a.valueCents || a.lockedAt.localeCompare(b.lockedAt));
  return rows.map((r, i) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    valueCents: r.valueCents,
    pct: Math.round(((r.valueCents - START_CENTS) / START_CENTS) * 10000) / 100,
    placement: i + 1,
    allocations: r.allocations,
  }));
}

export function quotesForPool(symbols: string[], tradingDate: string, now = new Date()) {
  const nowDate = dateET(now);
  const minute = minuteOfDayET(now);
  // Quote "today's tape" if we're on/after the trading date; otherwise the
  // pre-event drift of the current civil date.
  const qDate = nowDate >= tradingDate ? tradingDate : nowDate;
  const qMinute = nowDate > tradingDate ? 960 : minute;
  return symbols.map((s) => ({
    symbol: s,
    price: quoteAt(s, qDate, qMinute),
    pct: pctChange(s, qDate, qMinute),
  }));
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
        from stockgame_chat c join stockgame_player pl on pl.player_id = c.player_id
        where c.room_id = ${roomId} and c.event_ref = ${eventRef} and c.created_at > ${after}
        order by c.created_at asc limit ${limit}`
    : await sql`
        select * from (
          select c.id, c.player_id, c.body, c.created_at, pl.display_name
          from stockgame_chat c join stockgame_player pl on pl.player_id = c.player_id
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
    insert into stockgame_chat (room_id, event_ref, player_id, body)
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
    select b.player_id, b.final_cents, b.placement, pl.display_name, pl.avatar_url, p.allocations
    from stockgame_board b
    join stockgame_player pl on pl.player_id = b.player_id
    left join stockgame_pick p on p.room_id = b.room_id and p.event_ref = b.event_ref and p.player_id = b.player_id
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
  }));
}
