// Mint a valid launch token for local testing (mirrors botcity's minter).
// Usage:
//   ROOMS_SIGNING_KEY=devkey node scripts/mint-test-token.mjs [playerId] [roomId] [eventRef]
// Prints a URL to paste into the browser against `npm run dev`.

import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(new RegExp(`^${name}=(.+)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const key = env("ROOMS_SIGNING_KEY");
if (!key) {
  console.error("ROOMS_SIGNING_KEY not set (env or .env.local)");
  process.exit(1);
}

const [playerId = "p_test0000000001", roomId = "room-local-test", eventRef] = process.argv.slice(2);
const app = env("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";

const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const header = b64u({ alg: "HS256", typ: "JWT" });
const now = Math.floor(Date.now() / 1000);
const payload = b64u({
  playerId,
  displayName: playerId.startsWith("p_") ? `Tester ${playerId.slice(-4)}` : playerId,
  avatar: `http://localhost:3999/api/avatar/${playerId}.svg`,
  returnUrl: "http://localhost:3999/play/room-local-test",
  roomId,
  ...(eventRef ? { eventRef } : {}),
  iat: now,
  exp: now + 300,
});
const sig = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
const token = `${header}.${payload}.${sig}`;

console.log(`\n${app}/?t=${token}\n`);
