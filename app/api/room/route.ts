// GET /api/room?eventRef=&after= — the single ~15s poll driving the event
// room: phase, quotes, live standings, chat tail, roster. LOCK-GATED: 403
// unless the caller has a locked pick for this event (closed events are
// spectator-visible). Everything scoped (room_id, event_ref).
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "@/lib/token";
import { getEvent, phaseOf, poolFor } from "@/lib/events";
import { hasLockedPick, lockedRoster } from "@/lib/picks";
import { chatTail, finalBoard, liveStandings, quotesForPool } from "@/lib/room";
import { settleDueEventsInBackground } from "@/lib/adjudicate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "no session" }, { status: 401 });

  const eventRef = req.nextUrl.searchParams.get("eventRef") ?? "";
  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const event = await getEvent(eventRef);
  if (!event) return NextResponse.json({ error: "unknown event" }, { status: 404 });

  settleDueEventsInBackground();

  const now = new Date();
  const phase = phaseOf(event, now);
  const locked = await hasLockedPick(session.roomId, eventRef, session.playerId);

  if (!locked && phase !== "closed") {
    return NextResponse.json({ error: "lock your picks to enter the room" }, { status: 403 });
  }

  const pool = await poolFor(eventRef);
  const symbols = pool.map((p) => p.symbol);

  if (phase === "closed") {
    const board = await finalBoard(session.roomId, eventRef);
    const chat = locked ? await chatTail(session.roomId, eventRef, after) : [];
    return NextResponse.json({
      phase, closed: true, standings: board, chat,
      nextCursor: chat.length ? chat[chat.length - 1].createdAt : after ?? null,
      roster: board.map((b) => ({ playerId: b.playerId, displayName: b.displayName })),
      quotes: [],
      me: { playerId: session.playerId, locked },
    });
  }

  const [standings, chat, roster] = await Promise.all([
    liveStandings(session.roomId, event, now),
    chatTail(session.roomId, eventRef, after),
    lockedRoster(session.roomId, eventRef),
  ]);

  return NextResponse.json({
    phase,
    closed: false,
    eventDate: event.event_date,
    locksAt: event.locks_at,
    quotes: quotesForPool(symbols, event.event_date, now),
    standings,
    roster: roster.map((m) => ({ playerId: m.playerId, displayName: m.displayName, allocations: m.allocations })),
    chat,
    nextCursor: chat.length ? chat[chat.length - 1].createdAt : after ?? null,
    me: { playerId: session.playerId, locked },
  });
}
