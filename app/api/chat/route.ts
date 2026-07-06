// POST /api/chat — locked players only; per (room_id, event_ref); every
// message goes up the spine as chat_sent. Chat stays open AFTER close
// (TASK-coingame-16): the room is a place, not a countdown — winners gloat,
// everyone else congratulates/commiserates. The `locked` gate is the only
// membership check; phase does not gate posting.
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "@/lib/token";
import { getEvent } from "@/lib/events";
import { hasLockedPick } from "@/lib/picks";
import { postChat } from "@/lib/room";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "no session" }, { status: 401 });

  let body: { eventRef?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const eventRef = typeof body.eventRef === "string" ? body.eventRef : "";
  const event = await getEvent(eventRef);
  if (!event) return NextResponse.json({ error: "unknown event" }, { status: 404 });

  const locked = await hasLockedPick(session.roomId, eventRef, session.playerId);
  if (!locked) return NextResponse.json({ error: "lock your picks to chat" }, { status: 403 });

  const res = await postChat(session.roomId, eventRef, session.playerId, String(body.body ?? ""));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
