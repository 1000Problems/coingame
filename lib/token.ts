// Launch-token verification (GAME-INTEGRATION-V2 §1) and our own session
// cookie. One key does both: ROOMS_SIGNING_KEY.
//
// SECURITY: HS256 pinned. We never read the token's own `alg` header —
// that defeats alg-confusion / alg:none attacks. No JWKS, no ES256.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type LaunchClaims = {
  playerId: string;
  displayName: string;
  avatar?: string;
  returnUrl: string;
  roomId: string;
  eventRef?: string;
  iat?: number;
  exp?: number;
};

export function verifyLaunch(token: string | null | undefined, key = process.env.ROOMS_SIGNING_KEY): LaunchClaims | null {
  if (!token || !key) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const expected = createHmac("sha256", key).update(`${h}.${p}`).digest();
  let got: Buffer;
  try {
    got = Buffer.from(s, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  let claims: LaunchClaims;
  try {
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const now = Date.now() / 1000;
  if (typeof claims.exp === "number" && now > claims.exp + 60) return null; // 60s skew
  if (typeof claims.playerId !== "string" || typeof claims.displayName !== "string") return null;
  if (typeof claims.roomId !== "string" || typeof claims.returnUrl !== "string") return null;
  return claims;
}

// ---- our session -----------------------------------------------------------

export type Session = {
  playerId: string;
  roomId: string;
  displayName: string;
  avatar: string;
  returnUrl: string;
  exp: number; // unix seconds
};

const COOKIE = "stockgame_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function mintSessionValue(claims: LaunchClaims, key = process.env.ROOMS_SIGNING_KEY): string | null {
  if (!key) return null;
  const session: Session = {
    playerId: claims.playerId,
    roomId: claims.roomId,
    displayName: claims.displayName,
    avatar: claims.avatar ?? "",
    returnUrl: claims.returnUrl,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
  };
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export function readSessionValue(value: string | undefined, key = process.env.ROOMS_SIGNING_KEY): Session | null {
  if (!value || !key) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = sign(body, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    if (typeof s.exp !== "number" || Date.now() / 1000 > s.exp) return null;
    if (typeof s.playerId !== "string" || typeof s.roomId !== "string") return null;
    return s;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = SESSION_TTL_S;

/** Read the current session from the request cookies (server components / routes). */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSessionValue(jar.get(COOKIE)?.value);
}
