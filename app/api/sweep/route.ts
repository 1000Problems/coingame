// GET /api/sweep — the daily cron (vercel.json: 15 21 * * * UTC ≈ 16:15 ET
// during DST; ~1h early in winter, harmless — settle checks settles_at).
// Duties: settle due events, keep the 2-future-events invariant, flush the
// outbox, drop dead drafts. Zero-traffic days depend on this route.
//
// Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET> when the env
// var is set. We also accept x-cron-secret for manual runs.
import { NextRequest, NextResponse } from "next/server";
import { ensureEvents } from "@/lib/events";
import { cleanupDeadDrafts, settleDueEvents } from "@/lib/adjudicate";
import { flushOutbox } from "@/lib/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    const alt = req.headers.get("x-cron-secret") ?? "";
    if (auth !== `Bearer ${secret}` && alt !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const settled = await settleDueEvents();
  await ensureEvents(2);
  const flush = await flushOutbox(100);
  await cleanupDeadDrafts();
  return NextResponse.json({ ok: true, settled, ...flush });
}
