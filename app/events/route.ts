// GET /events — the schedule (GAME-INTEGRATION-V2 §3). Instance-agnostic,
// unsigned, JSON. Runs ensureEvents(2) first so the host ALWAYS sees the next
// two calendar days open (including on the very first read after Connect), and
// opportunistically settles anything past its settle time.
import { NextResponse } from "next/server";
import { ensureEvents, eventsWindow, toWireEvent } from "@/lib/events";
import { settleDueEventsInBackground } from "@/lib/adjudicate";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureEvents(2);
    settleDueEventsInBackground();
    const now = new Date();
    const events = (await eventsWindow()).map((e) => toWireEvent(e, now));
    return NextResponse.json({ phase: "open", events });
  } catch {
    // Never surface HTML/errors on a contract surface; degrade to an empty
    // (but valid) schedule if the DB is unreachable.
    return NextResponse.json({ phase: "open", events: [] });
  }
}
