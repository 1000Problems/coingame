# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in
this repository.

## What this is

**1K Daily Coin Pick 'Em** — a third-party game for the botcity/PickCity host, speaking
the **Game Integration v2** contract. Players pick exactly 3 coins from a curated pool,
split $1,000 in $100 chips across them, lock in irreversibly (that's the seat in the
event room), ride 00:00→16:00 ET, and the top bag wins the daily trophy. Every calendar
day is an event; the game is perpetual and never pushes `game-close`.

**History note:** this began as a stock-picking game (directory name `stockgame` is a
fossil). It pivoted to digital coins on 2026-07-04 because crypto exchange market data
is free for commercial use while equity display data is not. Docs of record:

- `DESIGN-COINGAME.md` — the design of record. Read before substantial work.
- `GAME-INTEGRATION-V2.md` — the wire contract with the host. Never restated, only implemented.
- `TASK-coingame-06-coin-pivot.md` — the pivot implementation spec.
- `DESIGN-STOCKGAME.md`, `TASK-stockgame-01..05` — superseded stock-era history. Don't build from them.

## Commands

```bash
npm run dev                        # dev server (localhost:3000)
npm run build                      # production build — THE only gate (typecheck included)
node db/migrate-additive.mjs       # SAFE: idempotent, coingame_* only, self-guarding
node db/seed.mjs                   # coin pool seed
node scripts/mint-test-token.mjs   # prints a launch URL for local testing
```

No test runner, no linter. `npm run build` must pass before shipping.

## Database — read the safety rules first

The Neon DB is **shared with ~90 other 1000Projects projects**. Non-negotiables:

- Every table/index is prefixed `coingame_`. Migrations may only ever touch `coingame_*`
  objects; both DB scripts grep their own SQL for the prefix and refuse otherwise.
- `db/schema.sql` is the **destructive** full rebuild (drops only `coingame_*`). For a
  live DB always use `db/migrate-additive.mjs`.
- **Two-places rule:** every schema change lands in *both* `db/schema.sql` *and* an
  idempotent statement in `db/migrate-additive.mjs`. Keep them in sync.
- Production should use a dedicated `coingame_app` Neon role scoped to these tables.

## Architecture

Next.js (App Router) + React on Vercel. No ORM, no auth provider. Runtime deps: `next`,
`react`, `@neondatabase/serverless`. Env: `DATABASE_URL`, `ROOMS_SIGNING_KEY` — that's
all. No Vercel cron: the daily sweeper (`GET /api/sweep`, unauthenticated, idempotent)
is pinged by a Cowork scheduled task; lazy-first settlement on reads does the real work.

- `lib/db.ts` — lazy tagged-template SQL client (botcity pattern); importing never throws at build time.
- `lib/prices.ts` — **deterministic fake 24/7 price tape.** Pure functions: same
  (symbol, date, minute) → same price on every invocation, no feed, no state. Daily
  marks anchor at 16:00 ET; a geometric bridge with end-pinned noise connects them.
  Adjudication never reads this at close time — it reads settled prices from
  `coingame_event_pool` (`start_price` at 00:00 ET, `end_price` at 16:00 ET).
- `lib/calendar.ts` — ET time helpers only. **No market calendar** — every calendar day
  is an event day. All game time is `America/New_York` via `Intl` (never hand-rolled offsets).
- `lib/events.ts` — event engine. Invariant: `ensureEvents(2)` keeps the next 2 calendar
  days open, idempotently, on every read. Phase (open|locked|adjudicating|closed) is
  **computed from clock + `closed_at`**, never stored.
- `lib/picks.ts` — draft/lock rules: exactly 3 coins, integer units 1..8 summing to 10,
  all in the event pool, hard-rejected after `locks_at`. Lock is irreversible.
- `lib/adjudicate.ts` — lazy-first settle + board computation behind an atomic claim;
  the Cowork-scheduled daily ping of `/api/sweep` is only the zero-traffic sweeper.
- `lib/outbox.ts` — durable outbox for `/spine` and `/close` pushes, HMAC over raw body bytes.
- `lib/token.ts` — HS256 launch-token verify (pinned alg, exp+60s skew) → session cookie.
- Contract endpoints: `GET /contract`, `GET /events`, `GET /?t=…`. Game pages: `/`,
  `/e/[ref]` (one route — phase + caller's lock status decide the screen). JSON APIs
  (`/api/pick`, `/api/lock`, `/api/room`, `/api/chat`) are deliberately JSON, not server
  actions, so botcity swarm bots can play headlessly.
- Avatars always come from `{host_origin}/api/avatar/{playerId}.svg` — zero local rendering (contract rule).

## Frozen vocabulary

Wire names must never be renamed: `roomId`, `t`, `ROOMS_SIGNING_KEY`,
`X-Rooms-Timestamp`, `X-Rooms-Signature`, `POST /api/rooms/close`, event refs
`d-YYYY-MM-DD`. Points on the wire = final portfolio value in cents.

## Conventions

- Path alias `@/*` maps to the repo root. TypeScript `strict` is on.
- All SQL lives in `lib/` modules; components and pages import typed functions, never raw SQL.
- Prices display with dynamic decimals (`lib/format.ts`) — memes trade at $0.00001842.
  Chip math is immune: units are $100 notional.
- When touching the price engine, preserve the invariant that the 16:00 live quote
  EQUALS the settled `end_price` — the last standings poll must match the adjudicated board.
