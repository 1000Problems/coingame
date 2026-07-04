// Launch entry. The host redirects players to /?t=<token>; app/page.tsx
// forwards here because a Server Component can't set cookies. This route
// verifies (pinned HS256), upserts player + instance, mints our session
// cookie, and redirects to the event — stripping the token from the final URL.
import { NextRequest, NextResponse } from "next/server";
import { verifyLaunch, mintSessionValue, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/token";
import { upsertFromLaunch } from "@/lib/players";
import { ensureEvents, getEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t");
  const claims = verifyLaunch(t);
  if (!claims) {
    // Invalid/expired token: fall back to existing session or guest view.
    // Never crash, never loop (contract §1).
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  await upsertFromLaunch(claims);
  await ensureEvents(2);

  // Deep-link to the event when we recognize the ref; unknown ref (stale host
  // cache) falls back to home — never an error.
  let dest = "/";
  if (claims.eventRef) {
    const e = await getEvent(claims.eventRef);
    if (e) dest = `/e/${encodeURIComponent(e.ref)}`;
  }

  const res = NextResponse.redirect(new URL(dest, req.nextUrl.origin));
  const value = mintSessionValue(claims);
  if (value) {
    res.cookies.set(SESSION_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
  }
  return res;
}
