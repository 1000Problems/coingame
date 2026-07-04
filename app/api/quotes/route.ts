// GET /api/quotes?eventRef= — pool quotes for the PICK screen (pre-lock, so
// the room poll's 403 doesn't apply). Session required; no pick data returned.
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "@/lib/token";
import { getEvent, poolFor } from "@/lib/events";
import { poolQuotes } from "@/lib/room";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "no session" }, { status: 401 });
  const eventRef = req.nextUrl.searchParams.get("eventRef") ?? "";
  const event = await getEvent(eventRef);
  if (!event) return NextResponse.json({ error: "unknown event" }, { status: 404 });
  const pool = await poolFor(eventRef);
  const { quotes } = await poolQuotes(pool.map((p) => p.symbol), event);
  return NextResponse.json({ quotes, locksAt: event.locks_at });
}
