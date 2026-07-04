// Player + instance upserts from launch tokens. playerId is a one-way
// pseudonym — we never see an email or real account id (contract §1).

import { sql } from "@/lib/db";
import type { LaunchClaims } from "@/lib/token";

export async function upsertFromLaunch(claims: LaunchClaims): Promise<void> {
  let origin: string;
  try {
    origin = new URL(claims.returnUrl).origin;
  } catch {
    origin = claims.returnUrl;
  }
  await sql`
    insert into stockgame_instance (room_id, host_origin, return_url)
    values (${claims.roomId}, ${origin}, ${claims.returnUrl})
    on conflict (room_id) do update set return_url = excluded.return_url`;
  await sql`
    insert into stockgame_player (player_id, display_name, avatar_url, last_seen_at)
    values (${claims.playerId}, ${claims.displayName}, ${claims.avatar ?? null}, now())
    on conflict (player_id) do update
      set display_name = excluded.display_name,
          avatar_url = coalesce(excluded.avatar_url, stockgame_player.avatar_url),
          last_seen_at = now()`;
}

export async function hostOriginFor(roomId: string): Promise<string | null> {
  const rows = await sql`select host_origin from stockgame_instance where room_id = ${roomId}`;
  return rows.length ? String(rows[0].host_origin) : null;
}
