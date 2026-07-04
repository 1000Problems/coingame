// POST /bot/act — Bot Play v1 dispatch (BOT-PLAY-V1.md §4). Body
// { action, args }. Domain outcomes are ALWAYS HTTP 200 with
// { ok, result?/error } — HTTP codes are reserved for auth (401) and
// malformed JSON (400). Idempotent by design: repeat locks acknowledge.
import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest, type Session } from "@/lib/token";
import { upsertFromLaunch } from "@/lib/players";
import { botAct } from "@/lib/bot";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "bad token" }, { status: 401 });

  let body: { action?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  await upsertPlayer(session);

  const action = typeof body.action === "string" ? body.action : "";
  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : undefined;

  return NextResponse.json(await botAct(session, action, args));
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
