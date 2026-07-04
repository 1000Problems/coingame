// GET /bot — Bot Play v1 affordances (BOT-PLAY-V1.md §3). Auth: Bearer
// launch token (stateless) or the session cookie. 401 {"error":"bad token"}
// is the only auth error shape. The player upsert keeps FK integrity and
// presence for bearer callers who never walk the /?t= cookie path.
import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest, type Session } from "@/lib/token";
import { upsertFromLaunch } from "@/lib/players";
import { botAffordances } from "@/lib/bot";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "bad token" }, { status: 401 });
  await upsertPlayer(session);
  return NextResponse.json(await botAffordances(session));
}

async function upsertPlayer(session: Session): Promise<void> {
  await upsertFromLaunch({
    playerId: session.playerId,
    displayName: session.displayName,
    avatar: session.avatar || undefined,
    returnUrl: session.returnUrl,
    roomId: session.roomId,
  });
}
