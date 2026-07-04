# Game Integration v2 — the contract for third-party games

**Status: contract of record (finalized 2026-07-03).** Supersedes
`GAME-INTEGRATION.md` and `GAME-INTEGRATION-PRIVATE.md`. This is what a
third-party game implements to connect to PickCity. On the wire everything is
still named **Rooms** (`roomId`, `X-Rooms-*`, `/api/rooms/*`).

## What changed from v1

- **Series is dead.** A **Game** is `open` or `closed` and contains one or more
  **Events**, which the game may add at any time. `/series/{ref}` is gone.
- **`/state` is retired**, and with it the `X-Rooms-Timestamp` header. The host
  reads phases from `GET /events`.
- **The host renders the event landing page.** Players choose an event on a
  PickCity page; launch deep-links into the game via a new `eventRef` claim.
- **Avatars are host-rendered.** Games embed `<img>` tags pointing at the host;
  the token's dead `avatarToken` claim becomes `avatar` (a URL).
- **The Spine.** Games log player actions (facts only, never interpretations)
  to a new signed endpoint `POST /api/rooms/spine`.
- `/close` has exactly two payload shapes: `event-close` and `game-close`. The
  v1 single-event shape and `series-close` are retired.
- `/contract` gains `"contract": 2`.

## The model

```
Game  (open | closed)                     ← your whole offering, e.g. "World Cup 2026"
 └─ Event (open | locked | adjudicating | closed | cancelled)
                                          ← one playable thing, e.g. "R32: ESP vs POR"
```

- The game may **append events at any time** (round of 16 appears after round
  of 32 resolves). The host polls `/events`, diffs, and notifies room members.
- Event phases are **game signals, not clocks**: `open` (picks allowed) →
  `locked` (no more picks) → `adjudicating` (winners being calculated) →
  `closed` (board pushed). `cancelled` voids the event: hidden, no board, no
  trophy. `expectedLockAt` is advisory — countdown UI only. The game is the
  authority and must reject picks after lock regardless of what any UI shows.
- The game closes (`game-close`) after its last event resolves.

## The flow

1. A player opens your game from the lobby and lands on a **PickCity landing
   page** for that room: open events with countdowns and Play buttons, locked /
   adjudicating events waiting, closed events with their boards, roster with
   avatars, room chat. All host-rendered — you serve none of it.
2. Hitting Play on an event redirects the browser to
   `https://your-game/?t=<launch-token>` with `eventRef` in the token. Your
   game verifies `?t=`, establishes its own session, strips the token from the
   URL, and lands the player **directly on that event's pick screen**.
3. The player picks, then follows your persistent **"Return to PickCity"**
   link (the token's `returnUrl` — it points back at the landing page, so the
   loop through five matches feels seamless).
4. As players act, your game logs facts to `POST /api/rooms/spine`.
5. When an event resolves, push `event-close`; when the whole game resolves,
   push `game-close`. Pushes are the only way results reach PickCity.

## Your one credential: `ROOMS_SIGNING_KEY`

Shown per connected game on PickCity's `/developer` page. Store it as
`ROOMS_SIGNING_KEY` in your host's environment and **redeploy** — env vars
don't apply to existing deployments. Never expose it to the browser.

Three jobs:

1. verifies the inbound **launch token** (`?t=`),
2. signs your outbound **`/close`** pushes,
3. signs your outbound **`/spine`** pushes.

A missing key, a stray quote or trailing newline, or a deploy predating the env
var all produce the same symptom: players launch in as guests. Check this first.

> Key rotation (`kid` header, two active keys) is **deferred** — tokens may
> gain a `kid` header field later; ignore JWT header fields you don't use.

## 1. The launch token (`?t=`)

A JWT, **alg HS256**, signed with `ROOMS_SIGNING_KEY`. There is no JWKS, no
ES256, no public-key path — a game verifying against a JWKS never validates.
Claims (frozen names):

```json
{
  "playerId": "p_79c5f9d8dd4e0756",
  "displayName": "Angel",
  "avatar": "https://botcity.hadmoney.com/api/avatar/p_79c5f9d8dd4e0756.svg",
  "returnUrl": "https://botcity.hadmoney.com/play/928bfb98-…",
  "roomId": "928bfb98-ebb8-4215-a9a2-a8f4b5777308",
  "eventRef": "r32-m07",
  "iat": 1782271750,
  "exp": 1782272050
}
```

- `playerId` — a **stable one-way pseudonym** for this player in your game.
  Your account key. Same on every launch (and in every private instance of
  your game), different in every other game, never reversible to a real
  identity. You never receive an email or real account id.
- `displayName` — the only human-readable label. Show it.
- `avatar` — absolute URL of this player's host-rendered avatar. See Avatars.
- `returnUrl` — render a persistent **"Return to PickCity"** link here.
  Required; a game that doesn't send players home won't go live. Points at the
  room's landing page.
- `roomId` — this room instance's id. **Echo it unchanged** on every `/close`
  and `/spine` push.
- `eventRef` — optional. When present, deep-link straight to that event's pick
  screen. If you don't recognize the ref (stale host cache), fall back to your
  home screen — never error.
- `exp` — ~5 minutes out. A single-use launch ticket; exchange it for your own
  longer-lived session immediately.

**Verify it like this** (Node `crypto`; the payload is base64url, not
encrypted — the signature is what makes it trustworthy):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLaunch(token, key = process.env.ROOMS_SIGNING_KEY) {
  if (!token || !key) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  // Pin HS256 — never read the token's own `alg` (defeats alg-confusion / alg:none).
  const expected = createHmac("sha256", key).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, "base64url");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  const now = Date.now() / 1000;
  if (typeof claims.exp === "number" && now > claims.exp + 60) return null; // 60s skew
  if (typeof claims.playerId !== "string" || typeof claims.displayName !== "string") return null;
  return claims;
}
```

**On entry:** mint your own session (HS256 with the same key is fine), set an
httpOnly cookie, and **redirect to strip `?t=`** so the token doesn't linger in
history or referrers. If `?t=` is absent or invalid, fall back to the existing
session or guest view — never crash or loop.

## 2. Avatars — the host renders, you embed

**Never draw avatars yourself.** Any `playerId` you have ever seen can be shown
with a single tag:

```html
<img src="https://botcity.hadmoney.com/api/avatar/p_79c5f9d8dd4e0756.svg" width="40" alt="">
```

- `GET {host origin}/api/avatar/{playerId}.svg` — public, no auth. The origin
  is the launch `returnUrl`'s origin.
- SVG scales; size it with CSS/width. No size parameter.
- Unknown ids return a **default face with a 200** — the tag can never break,
  and the endpoint leaks no is-this-a-player signal.
- Short max-age + ETag: when a player restyles in the lobby, their face
  updates in your game within minutes, automatically.

Use them everywhere you show a player: leaderboards, pick screens, chat. This
is what makes a third-party game feel like the same place as the lobby.

## 3. Endpoints your game serves

**Real server routes returning JSON** with `content-type: application/json`,
at the **root** of your domain. If you built a SPA, its catch-all will serve
`index.html` for these paths and your game will never appear in the lobby —
add explicit server routes and verify with `curl` before you connect. The host
reads these with short timeouts and degrades gracefully.

**`GET /contract`** — who you are:

```json
{ "contract": 2,
  "display": { "name": "Goal Rush", "blurb": "Predict · banter · win the game" },
  "allowsPrivate": true }
```

`allowsPrivate` defaults to false; it is the only thing that makes PickCity
offer "Create private game" on your tile.

**`GET /events`** — the schedule. Instance-agnostic (shared by the public game
and every private instance). Unsigned — it's public data:

```json
{ "phase": "open",
  "events": [
    { "ref": "r32-m07", "label": "ESP vs POR", "group": "Round of 32",
      "phase": "closed", "expectedLockAt": "2026-06-28T16:00:00Z" },
    { "ref": "r16-m02", "label": "ESP vs FRA", "group": "Round of 16",
      "phase": "open", "expectedLockAt": "2026-07-05T19:00:00Z" }
  ] }
```

- Top-level `phase`: `open` | `closed` (the Game).
- Event `phase`: `open` | `locked` | `adjudicating` | `closed` | `cancelled`.
- `ref` is permanent once published — it keys `eventRef`, spine events, and
  `event-close`. Never rename a published ref.
- Append new events whenever you like; the host diffs and notifies players.
- The host re-reads on every landing-page render plus a background cadence, so
  brief staleness is possible — your game, not the host UI, is the authority
  on whether a pick is still allowed.

## 4. The Spine — log player actions

You report **facts, never interpretations**. "asb picked Verstappen to win" is
yours to log; "asb is a contrarian" is the host's to conclude. No aggregates,
no derived stats, no psychology — the host computes all of that from the raw
events (it holds every player's picks, so field distribution is its problem).

```
POST {host origin}/api/rooms/spine
Content-Type: application/json
X-Rooms-Signature: <hex HMAC-SHA256(ROOMS_SIGNING_KEY, rawRequestBody)>
```

```jsonc
{ "roomId": "928bfb98-…",
  "events": [
    { "id": "9f2c6b1e-…",              // your uuid — idempotency key
      "playerId": "p_79c5f9d8dd4e0756",
      "ref": "r32-m07",                 // event ref
      "ts": 1782271750123,              // unix ms, when it happened
      "verb": "picked",
      "data": { "selection": "Verstappen to win" } }
  ] }
```

- **Verbs** (host-owned catalog, will grow): `picked`, `pick_changed`,
  `chat_sent`. Unknown verbs are stored but ignored — never invent your own
  semantics for an existing verb.
- `data.selection` is the human-readable convention for pick verbs; add
  structured fields alongside if you have them.
- **Push promptly on action** (batching a few seconds is fine). Hard deadline:
  every pick for an event must be pushed **by that event's lock**. Prompt
  pushes are what light up "✓ picked" badges on the landing page.
- Idempotent by event `id` — retry freely after a network blip.

## 5. Results — `POST /api/rooms/close`

The only way results reach PickCity (it never polls for them). Same signing as
spine: hex HMAC-SHA256 of the **raw request body bytes** in
`X-Rooms-Signature`. PickCity trusts your ranking and does not recompute it.
Exactly two shapes:

```jsonc
// event-close — one per event PER INSTANCE. Stores the board, flips the event
// to closed, mints the per-event trophy to placement 1.
{ "type": "event-close", "roomId": "<id>", "ref": "r32-m07",
  "trophyLabel": "Matchday Champion",
  "results": [ { "playerId": "p_…", "points": 12, "placement": 1 } ] }

// game-close — one per instance, after your last event resolves. Flips the
// game to closed. `standing` (overall, cross-event) is optional but expected
// for anything with a champion; you own cross-event weighting.
{ "type": "game-close", "roomId": "<id>",
  "trophyLabel": "World Cup Oracle",
  "standing": [ { "playerId": "p_…", "points": 30, "placement": 1 } ] }
```

- `playerId`s are the launch-token pseudonyms; `roomId` echoed unchanged.
- Report the **whole board** — every participant, not just the winner.
- Idempotent by `(roomId, ref)` for events and `(roomId)` for game-close — a
  retry never double-grants, and a player who never came back is still
  credited.
- The host sanity-checks `game-close` standings against the event boards it
  holds, but your weighting wins.

> Host-pull result recovery (`GET /result`) is **deferred**: if your process
> dies before pushing, results are lost until you re-push. Keep close pushes
> durable (retry queue) on your side.

## 6. Private games

A private game is just **another `roomId`** played by an invited group over
the **same game** — same `/events` schedule, same real-world results. PickCity
creates it locally and never calls you at creation time; you learn it exists
the first time a member launches in. If you don't set `allowsPrivate`, the
feature is simply hidden — a fine default.

**Treat any unknown `roomId` as a fresh, isolated instance of yourself**
(idempotent — a repeat launch is a no-op):

- **Per `roomId`** (isolated): picks, boards, in-game chat.
- **Shared**: the event list, lock times, real-world results. Lock and resolve
  are properties of the event, so every instance locks and resolves in
  lockstep for free.
- Rosters build themselves from launch tokens. `playerId` is identical across
  instances of your game.
- **Fan out on resolution**: one `event-close` per event per instance (scoped
  to that instance's picks), one `game-close` per instance. Spine pushes are
  already scoped by `roomId`.
- The creator's custom trophy name ("Losers buy dinner at Denny's") is owned
  and minted by PickCity — you never store or echo it.

## Frozen names — never rename

`roomId` · `t` (query param) · `eventRef` · `ROOMS_SIGNING_KEY` ·
`X-Rooms-Signature` · `POST /api/rooms/close` · `POST /api/rooms/spine` ·
`GET /contract` · `GET /events` · `GET /api/avatar/{playerId}.svg`

Retired from v1: `GET /state`, `GET /series/{ref}`, `X-Rooms-Timestamp`,
`avatarToken`, the un-typed single-event close shape, `series-close`, `sref`.

## Verify before you connect

```bash
# Both must return content-type: application/json — NOT text/html or <!DOCTYPE html>.
curl -i https://your-game/contract
curl -i https://your-game/events
```

Only after both show `application/json` should you paste the URL on
`/developer` and click **Connect**. The tile name comes from `/contract`; a
bare URL shown as the name means the read failed.

## Pre-launch checklist

- [ ] `/contract` returns `application/json` with `contract: 2` and
      `display.name` (this is the one that blocks Go live).
- [ ] `/events` returns JSON with stable `ref`s and correct phases.
- [ ] `ROOMS_SIGNING_KEY` set in production, exact value from `/developer`,
      deployed after it was set.
- [ ] Launch token verified HS256 (not JWKS/ES256), `alg` pinned, `exp`
      checked; own session minted; `?t=` stripped after entry.
- [ ] `eventRef` deep-links to the event's pick screen; unknown ref falls back
      to home without erroring.
- [ ] "Return to PickCity" link rendered, pointing at `returnUrl`.
- [ ] Avatars shown via the host's `/api/avatar/{playerId}.svg` — no local
      avatar rendering.
- [ ] Spine events pushed promptly on action; all picks pushed by lock; signed
      over raw body; unique `id` per event.
- [ ] Picks rejected server-side after lock, regardless of UI state.
- [ ] `event-close` pushed per event per instance; `game-close` per instance
      at the end; raw-body signatures; token `playerId`s echoed.
- [ ] If `allowsPrivate: true`: unknown `roomId` auto-creates an isolated
      instance; picks/boards keyed by `roomId`; closes fan out per instance.

## Deferred (on record, not forgotten)

- **Host-pull result recovery** (`GET /result?roomId=&ref=`) — converts "game
  died before pushing" from lost-forever into delayed.
- **Key rotation** — `kid` in the JWT header, two active keys per game on
  `/developer`.
