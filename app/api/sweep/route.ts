// GET /api/sweep — the daily zero-traffic sweeper, pinged by a Cowork
// scheduled task (no Vercel cron). Duties: settle due events, keep the
// 2-future-events invariant, flush the outbox, drop dead drafts.
//
// Deliberately unauthenticated: every operation here is idempotent and
// claim-guarded, and it's the exact same work any /events read triggers
// lazily — hammering this endpoint is no worse than polling /events.
import { NextResponse } from "next/server";
import { ensureEvents } from "@/lib/events";
import { cleanupDeadDrafts, settleDueEvents } from "@/lib/adjudicate";
import { flushOutbox } from "@/lib/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const settled = await settleDueEvents();
  await ensureEvents(2);
  const flush = await flushOutbox(100);
  await cleanupDeadDrafts();
  return NextResponse.json({ ok: true, settled, ...flush });
}
