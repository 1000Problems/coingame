// Pick domain: draft save (private, editable) and the irreversible lock.
// Rules decided in DESIGN-STOCKGAME.md:
//   - exactly 3 distinct pool symbols, integer units >= 1, sum = 10 ($1,000 in $100s)
//   - drafts are private; NO code path reveals them to other players
//   - lock is final: no edit, no unlock, ever
//   - after locks_at nothing is writable, drafts are dead (never scored)
// Lock-time guards live IN THE SQL (locks_at > now(), status='draft') so a
// stale UI can't slip a write through.

import { sql } from "@/lib/db";
import { enqueueSpine, flushOutbox } from "@/lib/outbox";

export type Allocation = { symbol: string; units: number };

export type PickRow = {
  allocations: Allocation[];
  status: "draft" | "locked";
  locked_at: string | null;
};

export function validateAllocations(raw: unknown, poolSymbols: Set<string>): { ok: true; allocations: Allocation[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "allocations must be an array" };
  if (raw.length !== 3) return { ok: false, error: "pick exactly 3 stocks" };
  const seen = new Set<string>();
  const out: Allocation[] = [];
  let total = 0;
  for (const a of raw as Array<Record<string, unknown>>) {
    const symbol = typeof a?.symbol === "string" ? a.symbol.toUpperCase() : "";
    const units = a?.units;
    if (!symbol || !poolSymbols.has(symbol)) return { ok: false, error: `symbol not in today's pool: ${symbol || "?"}` };
    if (seen.has(symbol)) return { ok: false, error: `duplicate symbol: ${symbol}` };
    if (typeof units !== "number" || !Number.isInteger(units) || units < 1) {
      return { ok: false, error: "units must be integers >= 1" };
    }
    seen.add(symbol);
    total += units;
    out.push({ symbol, units });
  }
  if (total !== 10) return { ok: false, error: `units must sum to 10 (got ${total})` };
  return { ok: true, allocations: out };
}

export async function getPick(roomId: string, eventRef: string, playerId: string): Promise<PickRow | null> {
  const rows = await sql`
    select allocations, status, locked_at from stockgame_pick
    where room_id = ${roomId} and event_ref = ${eventRef} and player_id = ${playerId}`;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    allocations: r.allocations as Allocation[],
    status: r.status === "locked" ? "locked" : "draft",
    locked_at: r.locked_at ? new Date(String(r.locked_at)).toISOString() : null,
  };
}

/** Upsert a draft. Fails (returns error) if locked or past locks_at — enforced in SQL. */
export async function saveDraft(
  roomId: string, eventRef: string, playerId: string, allocations: Allocation[],
): Promise<{ ok: boolean; error?: string }> {
  const rows = await sql`
    insert into stockgame_pick (room_id, event_ref, player_id, allocations, status, updated_at)
    select ${roomId}, ${eventRef}, ${playerId}, ${JSON.stringify(allocations)}::jsonb, 'draft', now()
    from stockgame_event e
    where e.ref = ${eventRef} and e.locks_at > now() and e.closed_at is null
    on conflict (room_id, event_ref, player_id) do update
      set allocations = excluded.allocations, updated_at = now()
      where stockgame_pick.status = 'draft'
        and (select locks_at from stockgame_event where ref = excluded.event_ref) > now()
    returning status`;
  if (!rows.length) {
    const existing = await getPick(roomId, eventRef, playerId);
    if (existing?.status === "locked") return { ok: false, error: "picks are locked — no changes" };
    return { ok: false, error: "event is no longer open" };
  }
  return { ok: true };
}

/** The irreversible lock. Emits the `picked` spine event on success. */
export async function lockPick(
  roomId: string, eventRef: string, playerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const rows = await sql`
    update stockgame_pick p
    set status = 'locked', locked_at = now(), updated_at = now()
    from stockgame_event e
    where p.room_id = ${roomId} and p.event_ref = ${eventRef} and p.player_id = ${playerId}
      and p.status = 'draft'
      and e.ref = p.event_ref and e.locks_at > now() and e.closed_at is null
    returning p.allocations`;
  if (!rows.length) {
    const existing = await getPick(roomId, eventRef, playerId);
    if (!existing) return { ok: false, error: "no draft to lock" };
    if (existing.status === "locked") return { ok: false, error: "already locked" };
    return { ok: false, error: "event is no longer open" };
  }
  const allocations = rows[0].allocations as Allocation[];
  const selection = allocations.map((a) => `${a.symbol} $${a.units * 100}`).join(" · ");
  await enqueueSpine(roomId, {
    playerId,
    ref: eventRef,
    ts: Date.now(),
    verb: "picked",
    data: { selection, allocations },
  });
  void flushOutbox().catch(() => {});
  return { ok: true };
}

/** Locked roster for an event in one instance (the room membership). */
export async function lockedRoster(roomId: string, eventRef: string) {
  const rows = await sql`
    select p.player_id, p.allocations, p.locked_at, pl.display_name, pl.avatar_url
    from stockgame_pick p
    join stockgame_player pl on pl.player_id = p.player_id
    where p.room_id = ${roomId} and p.event_ref = ${eventRef} and p.status = 'locked'
    order by p.locked_at asc`;
  return rows.map((r) => ({
    playerId: String(r.player_id),
    displayName: String(r.display_name),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
    allocations: r.allocations as Allocation[],
    lockedAt: new Date(String(r.locked_at)).toISOString(),
  }));
}

export async function hasLockedPick(roomId: string, eventRef: string, playerId: string): Promise<boolean> {
  const rows = await sql`
    select 1 as x from stockgame_pick
    where room_id = ${roomId} and event_ref = ${eventRef} and player_id = ${playerId} and status = 'locked'`;
  return rows.length > 0;
}
