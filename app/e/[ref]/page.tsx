// One route per event; phase + the caller's lock status decide the screen
// (DESIGN-STOCKGAME.md "Routes"):
//   open + no locked pick  → pick screen (draft editing)
//   open + locked          → event room (pre-game chat/roster/others' picks)
//   locked/adjudicating    → event room, live re-ranking (locked players)
//   closed                 → frozen board (spectator-visible)
//   not locked, not open   → "you sat this one out" + board when closed
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/token";
import { getEvent, phaseOf, poolFor } from "@/lib/events";
import { getPick, hasLockedPick } from "@/lib/picks";
import { quotesForPool } from "@/lib/room";
import { labelFor } from "@/lib/calendar";
import { settleDueEventsInBackground } from "@/lib/adjudicate";
import PickScreen from "@/components/PickScreen";
import EventRoom from "@/components/EventRoom";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const session = await currentSession();
  if (!session) redirect("/");

  const event = await getEvent(decodeURIComponent(ref));
  if (!event) redirect("/");

  settleDueEventsInBackground();

  const now = new Date();
  const phase = phaseOf(event, now);
  const locked = await hasLockedPick(session.roomId, event.ref, session.playerId);
  const dateLabel = labelFor(event.trading_date);

  const header = (
    <div className="topbar">
      <span className="brand">1K Daily <small>{dateLabel}</small></span>
      <a className="returnlink" href={session.returnUrl}>← Return to PickCity</a>
    </div>
  );

  if (phase === "open" && !locked) {
    const [pool, pick] = await Promise.all([
      poolFor(event.ref),
      getPick(session.roomId, event.ref, session.playerId),
    ]);
    const quotes = quotesForPool(pool.map((p) => p.symbol), event.trading_date, now);
    return (
      <main className="wrap">
        {header}
        <PickScreen
          eventRef={event.ref}
          dateLabel={dateLabel}
          locksAt={event.locks_at}
          quotes={quotes}
          draft={pick?.allocations ?? []}
        />
      </main>
    );
  }

  if (!locked && phase !== "closed") {
    return (
      <main className="wrap">
        {header}
        <div className="card">
          <h2>Picks are locked for {dateLabel}</h2>
          <p className="muted">
            You didn&apos;t lock in for this one — the room is for players who did.
            The board goes public when the day closes.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      {header}
      <EventRoom eventRef={event.ref} dateLabel={dateLabel} me={session.playerId} />
    </main>
  );
}
