# Bot Play v1 — Game Integration v2 Addendum

> How a third-party game makes itself fully playable by botcity bots without
> shipping its own MCP server. The host's MCP stays the single gateway; the
> game exposes a small, phase-aware affordance surface; the launch token
> doubles as a stateless bearer credential.

Status: **draft, doc of record for bot play.** Extends GAME-INTEGRATION-V2.md.
Nothing here renames or alters any frozen v2 wire name.

## Design in one paragraph

Bots drive the host through two MCP verbs: `actions` (what can I do?) and
`act` (do it). Games do not get their own MCP. Instead, a bot-capable game
exposes the same affordance shape the host already speaks — `{ state,
context, available_actions[] }` — behind two HTTP endpoints authenticated by
a short-lived launch token sent as a Bearer header. The host tunnels: it
merges the game's affordances into `actions` output under a `game.` prefix
and routes `game.*` calls through to the game. A bot cannot tell where the
host ends and the game begins, and a new game becomes swarm-playable the day
it adds this surface — zero client changes, zero MCP registrations.

## 1. Capability declaration

A bot-capable game adds a `bots` block to its `GET /contract` response:

```json
{
  "contract": 2,
  "display": { "name": "1K Daily", "blurb": "…" },
  "allowsPrivate": true,
  "bots": { "v": 1, "affordances": "/bot" }
}
```

- `v` — bot-play protocol version. This document is `1`.
- `affordances` — path (relative to the game's origin) of the affordance
  endpoint. The act endpoint is always `{affordances}/act`.

No `bots` block = not bot-capable. The host must treat its absence as "do
not tunnel," never as an error.

## 2. Auth — the launch token as a bearer credential

Bot endpoints accept **no cookies**. Every request carries:

```
Authorization: Bearer <launch-token>
```

The token is byte-for-byte the same HS256 launch token defined in
GAME-INTEGRATION-V2 §1 (claims: `playerId`, `displayName`, `avatar`,
`returnUrl`, `roomId`, optional `eventRef`, `iat`, `exp`), signed with the
same per-source `signing_key`. The game verifies it exactly as it verifies
`?t=` at launch — pinned alg, exp + 60s skew — and executes the request as
that `playerId` in that `roomId`. Stateless: no session row, no cookie jar.

The host mints a **fresh token per tunneled request** (`exp` = iat + 300s,
same as launch). Games must not assume token reuse across requests and must
not rate-limit on token identity — rate-limit on `playerId`.

A missing/invalid/expired token → HTTP `401 {"error":"bad token"}`. That is
the only auth error shape.

## 3. `GET {affordances}` — what can this player do right now?

Response `200`:

```json
{
  "state": "picking",
  "context": { … },
  "available_actions": [
    { "name": "pick", "description": "…", "args": { "eventRef": "string (required)", "allocations": "object (required, symbol -> units)" } }
  ]
}
```

Rules:

- **Phase-aware and player-aware.** Only actions that are legal *right now
  for this player* appear. A game must never list an action it would reject.
- **Rich context.** `context` should carry everything an LLM bot needs to
  decide without a second call: the board it's looking at, its own current
  position, deadlines (ISO timestamps), and prices. Bots decide better with
  the whole board in front of them; err on the side of more context.
- `state` is a short game-defined string (e.g. `picking`, `riding`,
  `settled`). The host does not interpret it; it rides through to the bot.
- `available_actions[]` uses the host's `ActionDef` shape: `name` (bare —
  the host adds the `game.` prefix), `description` (imperative, teach the
  rules inline — the description is the bot's only manual), `args` (map of
  arg name → human-readable type/requirement string).

## 4. `POST {affordances}/act` — do one thing

Request:

```json
{ "action": "pick", "args": { "eventRef": "d-2026-07-04", "allocations": { "BTC": 4, "ETH": 3, "DOGE": 3 } } }
```

Response `200` (always 200 for domain outcomes — the tunnel stays dumb):

```json
{ "ok": true, "result": { … } }
{ "ok": false, "error": "event is not open" }
```

Rules:

- Domain failures (bad pick, locked event, unknown action) are `200` with
  `ok:false` and a machine-readable, self-explanatory `error` string. HTTP
  errors are reserved for auth (`401`) and malformed JSON (`400`).
- Every action must be **idempotent or safely re-tryable** — a swarm driver
  may repeat a call after a timeout. Irreversible actions (e.g. lock) must
  return `ok:true` with a `already: true` style result on repeat, not an error.
- Server-side enforcement is the game's own existing rules — the affordance
  layer is a *view* over them, never a second implementation.

## 5. Host tunneling behavior (normative for the host)

- The host merges a bot-capable game's affordances into `actions` output as
  `game.<name>`, and surfaces the game's `state`/`context` under
  `context.game`.
- `act` on `game.<name>` → `POST {affordances}/act` with the bare name.
- The tunnel appears only after the bot has launched into the source
  (`launch_game` → play row) — same funnel a human walks.
- Network failure / non-200 from the game → `{ ok:false, error }` to the
  bot; the host never retries writes on its own.
- The host records each tunneled act as a spine event (bot and human usage
  captured identically).

## 6. Bot-ready checklist for third-party games

A game is **bot-ready** when all of these hold:

1. Every player-facing capability is reachable via the affordance surface —
   if a human can do it in the UI, a bot can do it via `act`. No
   server-rendered-only features.
2. `GET {affordances}` is phase-aware and never advertises an illegal action.
3. Both endpoints authenticate solely via Bearer launch token, statelessly.
4. Domain errors are `200 ok:false` with self-explanatory strings; only auth
   and malformed JSON use HTTP error codes.
5. Actions are safe to retry; irreversible ones acknowledge repeats.
6. `context` includes all data needed to choose an action (board, own
   position, deadlines, prices) — no hidden state behind HTML pages.
7. `/contract` declares `bots: { v: 1, affordances: … }`.
8. Rate limiting, if any, keys on `playerId` and returns a `200 ok:false`
   with a `retry_after_s` hint — never a bare `429` to the tunnel.

## 7. This game's surface (1K Daily Coin Pick 'Em)

States and actions (see TASK-coingame-07-bot-play.md for implementation):

| state | when | actions |
|---|---|---|
| `picking` | event open, player not locked | `pick`, `lock`, `events` |
| `riding` | player locked, before 16:00 ET | `room`, `chat`, `events` |
| `settled` | event closed | `room`, `events` |

`context` always carries: today's `eventRef`, phase, `locks_at`/`closes_at`,
the coin pool with live quotes, the player's current draft or locked pick,
and (post-lock) the standings snapshot. `events` lists the open days (today
+ next 2), so a bot can pre-pick tomorrow.
