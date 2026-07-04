// Home. Three jobs:
//  1. `/?t=<token>` → forward to /api/launch (Server Components can't set
//     cookies; the route handler mints the session and strips the token).
//  2. Session → list open events for this player's room.
//  3. No session → guest explainer. Never crash, never loop.
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/token";
import { ensureEvents, eventsWindow, phaseOf } from "@/lib/events";
import { labelFor } from "@/lib/calendar";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  if (t) redirect(`/api/launch?t=${encodeURIComponent(t)}`);

  const session = await currentSession();
  if (!session) {
    return (
      <main className="wrap">
        <div className="topbar"><span className="brand">1K Daily</span></div>
        <div className="card">
          <h2>Pick 3 · split a grand · fastest bag wins</h2>
          <p className="muted">
            Every trading day: choose three stocks from the pool, split $1,000
            across them in $100 chips, and lock it in. Your picks ride the day
            from open to close — the room re-ranks live, the top bag takes the
            daily trophy.
          </p>
          <p className="muted">Launch this game from your PickCity room to play.</p>
        </div>
      </main>
    );
  }

  let events: Awaited<ReturnType<typeof eventsWindow>> = [];
  try {
    await ensureEvents(2);
    events = await eventsWindow();
  } catch {
    // DB down: show the shell rather than crash.
  }
  const now = new Date();
  const visible = events.slice().reverse(); // newest first

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="brand">1K Daily <small>hey {session.displayName}</small></span>
        <a className="returnlink" href={session.returnUrl}>← Return to PickCity</a>
      </div>
      <div className="eventlist">
        {visible.map((e) => {
          const phase = phaseOf(e, now);
          return (
            <Link key={e.ref} href={`/e/${encodeURIComponent(e.ref)}`}>
              <span>Stock Picks · {labelFor(e.trading_date)}</span>
              <span className={`pill ${phase}`}>{phase}</span>
            </Link>
          );
        })}
        {visible.length === 0 ? <p className="muted">No events yet — check back in a moment.</p> : null}
      </div>
    </main>
  );
}
