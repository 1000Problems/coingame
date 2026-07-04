// GET /api/room?eventRef=&after= — the single ~15s poll driving the event
// room: phase, quotes, live standings, chat tail, roster. LOCK-GATED: 403
// unless the caller has a locked pick for this event (closed events are
// spectator-visible). Everything scoped (room_id, event_ref). The payload is
// built by `roomView` (lib/room.ts) — the one seam shared with the bot
// `room` action (TASK-coingame-07-bot-play).
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "@/lib/token";
import { getEvent } from "@/lib/events";
import { roomView } from "@/lib/room";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "no session" }, { status: 401 });

  const eventRef = req.nextUrl.searchParams.get("eventRef") ?? "";
  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const event = await getEvent(eventRef);
  if (!event) return NextResponse.json({ error: "unknown event" }, { status: 404 });

  const view = await roomView(session.roomId, session.playerId, event, after);
  return NextResponse.json(view.body, { status: view.status });
}
