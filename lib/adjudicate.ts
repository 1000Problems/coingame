// Adjudication: settle prices, compute per-instance boards, enqueue signed
// event-close pushes, append the next event. Idempotent and claim-guarded.
//
// Mutex note: Postgres advisory locks don't survive Neon's per-query http
// sessions, so the claim is an atomic UPDATE on stockgame_event.claim_at —
// only one invocation can flip a stale/null claim to now().
//
// NEVER pushes game-close. The game is perpetual (design decision of record).

import { sql } from "@/lib/db";
import { ensureEvents, type EventRow } from "@/lib/events";
import { closePrice, openPrice } from "@/lib/prices";
import { enqueueClose, flushOutbox } from "@/lib/outbox";
import type { Allocation } from "@/lib/picks";

const CLAIM_STALE_MIN = 5;

export async function settleAndClose(ref: string): Promise<{ ran: boolean }> {
  // 1) Atomic claim — bail silently if another invocation holds a fresh claim
  //    or the event is already closed.
  const claimed = await sql`
    update stockgame_event
    set claim_at = now()
    where ref = ${ref} and closed_at is null and settles_at <= now()
      and (claim_at is null or claim_at < now() - make_interval(mins => ${CLAIM_STALE_MIN}))
    returning ref, trading_date, locks_at, settles_at, trophy_label, closed_at`;
  if (!claimed.length) return { ran: false };
  const e = claimed[0];
  const tradingDate = e.trading_date instanceof Date
    ? e.trading_date.toISOString().slice(0, 10)
    : String(e.trading_date).slice(0, 10);
  const trophyLabel = String(e.trophy_label);

  // 2) Settle open/close prices into the pool snapshot (idempotent overwrite —
  //    the deterministic feed always returns the same numbers).
  const pool = await sql`select symbol from stockgame_event_pool where event_ref = ${ref}`;
  for (const row of pool) {
    const symbol = String(row.symbol);
    await sql`
      update stockgame_event_pool
      set open_price = ${openPrice(symbol, tradingDate)}, close_price = ${closePrice(symbol, tradingDate)}
      where event_ref = ${ref} and symbol = ${symbol}`;
  }

  // 3) Per instance with >= 1 LOCKED pick: compute board, insert write-once,
  //    enqueue one event-close with the WHOLE board.
  const instances = await sql`
    select distinct room_id from stockgame_pick
    where event_ref = ${ref} and status = 'locked'`;

  for (const inst of instances) {
    const roomId = String(inst.room_id);

    const already = await sql`
      select 1 as x from stockgame_board where room_id = ${roomId} and event_ref = ${ref} limit 1`;
    if (already.length) continue; // write-once: re-run is a no-op per instance

    const picks = await sql`
      select player_id, allocations, locked_at from stockgame_pick
      where room_id = ${roomId} and event_ref = ${ref} and status = 'locked'`;

    const scored = picks.map((p) => {
      const allocations = p.allocations as Allocation[];
      let cents = 0;
      for (const a of allocations) {
        const open = openPrice(a.symbol, tradingDate);
        const close = closePrice(a.symbol, tradingDate);
        cents += Math.round(a.units * 10000 * (close / open));
      }
      return {
        playerId: String(p.player_id),
        lockedAt: new Date(String(p.locked_at)).toISOString(),
        finalCents: cents,
      };
    });
    // Stable rank: value desc, earlier lock wins ties (exactly one placement 1).
    scored.sort((a, b) => b.finalCents - a.finalCents || a.lockedAt.localeCompare(b.lockedAt));

    const results: { playerId: string; points: number; placement: number }[] = [];
    for (let i = 0; i < scored.length; i++) {
      const s = scored[i];
      await sql`
        insert into stockgame_board (room_id, event_ref, player_id, final_cents, placement)
        values (${roomId}, ${ref}, ${s.playerId}, ${s.finalCents}, ${i + 1})
        on conflict (room_id, event_ref, player_id) do nothing`;
      results.push({ playerId: s.playerId, points: s.finalCents, placement: i + 1 });
    }

    await enqueueClose(roomId, {
      type: "event-close",
      roomId,
      ref,
      trophyLabel,
      results,
    });
  }

  // 4) Close the event, append the next day, flush pushes.
  await sql`update stockgame_event set closed_at = now() where ref = ${ref} and closed_at is null`;
  await ensureEvents(2);
  await flushOutbox();
  return { ran: true };
}

/** Fire adjudication for anything past settle. Called lazily from hot reads. */
export async function settleDueEvents(): Promise<number> {
  const due = await sql`
    select ref from stockgame_event
    where closed_at is null and settles_at <= now()
    order by trading_date asc`;
  let ran = 0;
  for (const r of due) {
    const res = await settleAndClose(String(r.ref));
    if (res.ran) ran++;
  }
  return ran;
}

/** Non-blocking variant for request paths. */
export function settleDueEventsInBackground(): void {
  void settleDueEvents().catch(() => {});
}

/** Sweeper hygiene: drop dead drafts for events closed > 7 days. */
export async function cleanupDeadDrafts(): Promise<void> {
  await sql`
    delete from stockgame_pick p
    using stockgame_event e
    where p.event_ref = e.ref and p.status = 'draft'
      and e.closed_at is not null and e.closed_at < now() - interval '7 days'`;
}

export type { EventRow };
