// Durable outbox for outbound pushes to the host (spine + close). Contract:
// raw-body hex HMAC-SHA256 in X-Rooms-Signature; idempotency is host-side
// (spine: per-event uuid `id`; close: (roomId, ref)). We sign EXACTLY the
// bytes we send.

import { createHmac, randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

type Kind = "spine" | "close";

export type SpineEvent = {
  id: string;        // uuid, idempotency key — generated once at enqueue
  playerId: string;
  ref: string;       // event ref
  ts: number;        // unix ms
  verb: "picked" | "pick_changed" | "chat_sent";
  data: Record<string, unknown>;
};

export async function enqueueSpine(
  roomId: string,
  ev: Omit<SpineEvent, "id"> & { id?: string },
): Promise<void> {
  const payload = { roomId, events: [{ id: ev.id ?? randomUUID(), ...ev }] };
  await sql`
    insert into coingame_outbox (kind, room_id, payload)
    values ('spine', ${roomId}, ${JSON.stringify(payload)}::jsonb)`;
}

export async function enqueueClose(roomId: string, payload: Record<string, unknown>): Promise<void> {
  await sql`
    insert into coingame_outbox (kind, room_id, payload)
    values ('close', ${roomId}, ${JSON.stringify(payload)}::jsonb)`;
}

function backoffSeconds(attempts: number): number {
  // 5s, 25s, ~2m, ~10m, ~52m, then capped at 1h. No max attempts for closes —
  // results must eventually land (host-pull recovery is deferred host-side).
  return Math.min(5 * Math.pow(5, attempts), 3600);
}

/**
 * Deliver due outbox rows. Fire-and-forget safe: failures reschedule with
 * backoff; a duplicate delivery is tolerated host-side (idempotent), but rows
 * are marked delivered on first 2xx so we don't re-send in normal operation.
 */
export async function flushOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const key = process.env.ROOMS_SIGNING_KEY;
  if (!key) return { sent: 0, failed: 0 };

  const due = await sql`
    select o.id, o.kind, o.room_id, o.payload, o.attempts, i.host_origin
    from coingame_outbox o
    join coingame_instance i on i.room_id = o.room_id
    where o.delivered_at is null and o.next_try_at <= now()
    order by o.created_at asc
    limit ${limit}`;

  let sent = 0, failed = 0;
  for (const row of due) {
    const body = JSON.stringify(row.payload); // exact bytes we sign and send
    const sig = createHmac("sha256", key).update(body).digest("hex");
    const path = row.kind === "close" ? "/api/rooms/close" : "/api/rooms/spine";
    const url = String(row.host_origin).replace(/\/+$/, "") + path;
    let ok = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-rooms-signature": sig },
        body,
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      sent++;
      await sql`update coingame_outbox set delivered_at = now() where id = ${row.id}`;
    } else {
      failed++;
      const wait = backoffSeconds(Number(row.attempts));
      await sql`
        update coingame_outbox
        set attempts = attempts + 1, next_try_at = now() + make_interval(secs => ${wait})
        where id = ${row.id}`;
    }
  }
  return { sent, failed };
}
