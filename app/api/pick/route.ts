// POST /api/pick — draft upsert (private, editable). JSON on purpose: botcity
// swarm bots drive this with nothing but a launch-token session.
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "@/lib/token";
import { getEvent, phaseOf, poolFor } from "@/lib/events";
import { saveDraft, validateAllocations } from "@/lib/picks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "no session" }, { status: 401 });

  let body: { eventRef?: string; allocations?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const eventRef = typeof body.eventRef === "string" ? body.eventRef : "";
  const event = eventRef ? await getEvent(eventRef) : null;
  if (!event) return NextResponse.json({ error: "unknown event" }, { status: 404 });
  if (phaseOf(event) !== "open") return NextResponse.json({ error: "event is not open" }, { status: 409 });

  const pool = await poolFor(eventRef);
  const check = validateAllocations(body.allocations, new Set(pool.map((p) => p.symbol)));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 422 });

  const saved = await saveDraft(session.roomId, eventRef, session.playerId, check.allocations);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 409 });
  return NextResponse.json({ ok: true, status: "draft" });
}
