// POST /api/lock — the irreversible commitment. Admits the player to the
// event room and emits the `picked` spine event. No code path un-locks.
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "@/lib/token";
import { getEvent, phaseOf } from "@/lib/events";
import { lockPick } from "@/lib/picks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "no session" }, { status: 401 });

  let body: { eventRef?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const eventRef = typeof body.eventRef === "string" ? body.eventRef : "";
  const event = eventRef ? await getEvent(eventRef) : null;
  if (!event) return NextResponse.json({ error: "unknown event" }, { status: 404 });
  if (phaseOf(event) !== "open") return NextResponse.json({ error: "event is not open" }, { status: 409 });

  const res = await lockPick(session.roomId, eventRef, session.playerId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ ok: true, status: "locked", room: `/e/${encodeURIComponent(eventRef)}` });
}
