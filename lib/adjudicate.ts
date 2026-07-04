// Adjudication: settle prices, compute per-instance boards, enqueue signed
// event-close pushes, append the next event. Idempotent and claim-guarded.
//
// Mutex note: Postgres advisory locks don't survive Neon's per-query http
// sessions, so the claim is an atomic UPDATE on coingame_event.claim_at —
// only one invocation can flip a stale/null claim to now().
//
// NEVER pushes game-close. The game is perpetual (design decision of record).

import { sql } from "@/lib/db";
import { ensureEndPrices, ensureEvents, ensureStartPrices, type EventRow } from "@/lib/events";
import { enqueueClose, flushOutbox } from "@/lib/outbox";
import type { Allocation } from "@/lib/picks";

const CLAIM_STALE_MIN = 5;

export async function settleAndClose(ref: string): Promise<{ ran: boolean }> {
  // 1) Atomic claim — bail silently if another invocation holds a fresh claim
  //    or the event is already closed.
  const claimed = await sql`
    update coingame_event
    set claim_at = now()
    where ref = ${ref} and closed_at is null and settles_at <= now()
      and (claim_at is null or claim_at < now() - make_interval(mins => ${CLAIM_STALE_MIN}))
    returning ref, event_date, locks_at, settles_at, trophy_label, closed_at`;
  if (!claimed.length) return { ran: false };
  const e = claimed[0];
  const eventDate = e.event_date instanceof Date
    ? e.event_date.toISOString().slice(0, 10)
    : String(e.event_date).slice(0, 10);
  const trophyLabel = String(e.trophy_label);

  // 2) Settle prices into the pool snapshot — both write-once via the ensure
  //    functions (TASK-coingame-13/14b). ALL-OR-ABORT: winners are never
  //    called on partial data. If any pool symbol lacks a settled start or
  //    end (feed unreachable), release the claim and let the next trigger —
  //    a player poll or the daily sweep — retry. Candle-addressed prices
  //    make the retry produce identical numbers whenever it lands.
  const startMap = await ensureStartPrices(ref, eventDate);
  const endMap = await ensureEndPrices(ref, eventDate);
  const pool = await sql`select symbol from coingame_event_pool where event_ref = ${ref}`;
  const incomplete = pool.some((row) => {
    const s = String(row.symbol);
    return startMap[s] == null || endMap[s] == null;
  });
  if (incomplete) {
    await sql`update coingame_event set claim_at = null where ref = ${ref}`;
    return { ran: false };
  }

  // 3) Per instance with >= 1 LOCKED pick: compute board, insert write-once,
  //    enqueue one event-close with the WHOLE board.
  const instances = await sql`
    select distinct room_id from coingame_pick
    where event_ref = ${ref} and status = 'locked'`;

  for (const inst of instances) {
    const roomId = String(inst.room_id);

    const already = await sql`
      select 1 as x from coingame_board where room_id = ${roomId} and event_ref = ${ref} limit 1`;
    if (already.length) continue; // write-once: re-run is a no-op per instance

    const picks = await sql`
      select player_id, allocations, locked_at from coingame_pick
      where room_id = ${roomId} and event_ref = ${ref} and status = 'locked'`;

    const scored = picks.map((p) => {
      const allocations = p.allocations as Allocation[];
      let cents = 0;
      for (const a of allocations) {
        // Both maps are complete past the guard above (picks are validated
        // against the pool, so every symbol hits).
        const start = startMap[a.symbol];
        const end = endMap[a.symbol];
        cents += Math.round(a.units * 10000 * (end / start));
      }
      return {
        playerId: String(p.player_id),
        lockedAt: new Date(String(p.locked_at)).toISOString(),
        finalCents: cents,
      };
    });
    // Stable rank: value desc, earlier lock wins ties, playerId last — fully
    // deterministic even if two locks land in the same millisecond (ISO strings
    // truncate to ms). Exactly one placement 1, always.
    scored.sort((a, b) =>
      b.finalCents - a.finalCents ||
      a.lockedAt.localeCompare(b.lockedAt) ||
      a.playerId.localeCompare(b.playerId));

    const results: { playerId: string; points: number; placement: number }[] = [];
    for (let i = 0; i < scored.length; i++) {
      const s = scored[i];
      await sql`
        insert into coingame_board (room_id, event_ref, player_id, final_cents, placement)
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
  await sql`update coingame_event set closed_at = now() where ref = ${ref} and closed_at is null`;
  await ensureEvents(2);
  await flushOutbox();
  return { ran: true };
}

/** Fire adjudication for anything past settle. Called lazily from hot reads. */
export async function settleDueEvents(): Promise<number> {
  const due = await sql`
    select ref from coingame_event
    where closed_at is null and settles_at <= now()
    order by event_date asc`;
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
    delete from coingame_pick p
    using coingame_event e
    where p.event_ref = e.ref and p.status = 'draft'
      and e.closed_at is not null and e.closed_at < now() - interval '7 days'`;
}

export type { EventRow };
