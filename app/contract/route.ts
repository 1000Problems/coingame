// GET /contract — who we are (GAME-INTEGRATION-V2 §3). Root-level server
// route returning JSON; the host reads display.name for the lobby tile.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    contract: 2,
    display: {
      name: "1K Daily",
      blurb: "Pick 3–10 coins · split a grand · fastest bag wins",
    },
    allowsPrivate: true,
    bots: { v: 1, affordances: "/bot" }, // Bot Play v1 (BOT-PLAY-V1.md §1)
  });
}
