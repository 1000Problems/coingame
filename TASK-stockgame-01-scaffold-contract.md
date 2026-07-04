# TASK: Scaffold stockgame host + contract surface

> Stand up the 1K Daily Stock Pick 'Em repo: DB bootstrap, core libs, and the three
> contract-facing routes (`/contract`, `/events`, launch entry) so botcity can connect
> and see two open events.

## Context

stockgame is a third-party game for the botcity/PickCity host, speaking the
**Game Integration v2** contract. Both `GAME-INTEGRATION-V2.md` (the wire contract)
and `DESIGN-STOCKGAME.md` (the design of record) are in this folder — **read both
fully before writing code**. This task is the foundation: after it, pasting the
deployed URL on botcity's `/developer` page must show the game's name (from
`/contract`) and two open events (from `/events`).

## Requirements

1. Next.js (App Router, TypeScript `strict`) scaffold in this folder. Runtime deps
   **only**: `next`, `react`, `react-dom`, `@neondatabase/serverless`. No ORM, no auth
   lib, no UI lib. `npm run build` is the only gate (no test runner/linter).
2. DB bootstrap: `db/schema.sql` (all tables from DESIGN-STOCKGAME.md "Tables" section,
   verbatim semantics) + `db/migrate-additive.mjs` (idempotent `CREATE TABLE IF NOT
   EXISTS` / `ALTER ... ADD COLUMN IF NOT EXISTS`, reads `DATABASE_URL` from env or
   `.env.local`). Both scripts must run a **prefix self-check before executing**: scan
   their own SQL for `create table|drop table|alter table` targets and abort loudly if
   any target doesn't start with `stockgame_`. The Neon DB is shared with ~90 projects.
3. Core libs in `lib/`:
   - `db.ts` — lazily-initialised tagged-template `sql` client over
     `@neondatabase/serverless` (copy the pattern from
     `~/1000Problems/botcity/lib/db.ts`; importing must never throw at build time).
   - `calendar.ts` — `America/New_York` helpers: `todayET()`, `isTradingDay(date)`
     (weekdays minus hardcoded 2026 US market holidays), `nextTradingDays(from, n)`.
   - `prices.ts` — deterministic fake feed: `price(symbol, date, minuteOfDay)` as a
     pure seeded geometric walk (seed = hash(symbol + date)); `openPrice(sym, date)` =
     price at 9:30, `closePrice(sym, date)` = price at 16:00. Same inputs → same
     output on every invocation, no DB state.
   - `token.ts` — `verifyLaunch(t)` exactly as specified in GAME-INTEGRATION-V2.md §1
     (pinned HS256, `timingSafeEqual`, 60s exp skew, never trust the token's `alg`);
     plus `mintSession(claims)` / `readSession()` — httpOnly cookie
     `stockgame_session`, HS256-signed JSON `{playerId, roomId, displayName, avatar,
     returnUrl, exp}` using `ROOMS_SIGNING_KEY`.
   - `events.ts` — `ensureEvents(2)` (idempotent insert for the next 2 trading days:
     `ref = 'd-YYYY-MM-DD'`, `locks_at` = midnight ET before trading_date, `settles_at`
     = 16:10 ET, trophy label like `Daily Champ · Jul 6`; snapshot the active
     `stockgame_ticker` pool with `prev_close` from `prices.ts` into
     `stockgame_event_pool`) and `phaseOf(event, now)` — computed, never stored:
     `closed_at ? 'closed' : now>=settles_at ? 'adjudicating' : now>=locks_at ?
     'locked' : 'open'`.
4. Contract routes (real server routes, `content-type: application/json`, at domain
   root — **not** swallowed by any catch-all):
   - `GET /contract` → `{ "contract": 2, "display": { "name": "1K Daily", "blurb":
     "Pick 3 · split a grand · fastest bag wins" }, "allowsPrivate": true }`
   - `GET /events` → calls `ensureEvents(2)` first, returns `{ "phase": "open",
     "events": [...] }` — last 7 closed events plus everything not closed, each
     `{ ref, label, group, phase, expectedLockAt }` per contract §3. Top-level phase
     is **always** `"open"` (perpetual game).
   - `GET /?t=...` (home route handler): verify token → upsert `stockgame_player` and
     `stockgame_instance` (store `host_origin` = origin of `returnUrl`) → mint session
     cookie → redirect to `/e/<eventRef>` stripping `?t=` (unknown/absent `eventRef` →
     `/`). Invalid/absent token → existing session or guest view; never crash, never
     redirect-loop.
5. Seed + pages: `db/seed.sql` with ~30 real-looking tickers in `stockgame_ticker`;
   minimal `/` home (session → list open events with links to `/e/[ref]`; guest →
   static explainer) and a placeholder `/e/[ref]` page showing event ref + computed
   phase (real screens come in TASK-02/03). Persistent "Return to PickCity" link
   (session `returnUrl`) on every session page.

## Implementation Notes

- Env: `DATABASE_URL`, `ROOMS_SIGNING_KEY`, `NEXT_PUBLIC_APP_URL`. `.env.local` for
  dev; the app must build with none of them set.
- Follow botcity conventions: path alias `@/*` → repo root, all SQL in `lib/` modules,
  components never contain SQL, fully dynamic (`no-store`).
- ET handling: use `Intl.DateTimeFormat` with `America/New_York` — do not hand-roll
  UTC offsets (DST). `locks_at`/`settles_at` are stored as timestamptz.
- `ensureEvents` must be race-safe: plain `on conflict do nothing` is sufficient.
- 2026 US market holidays (hardcode): Jan 1, Jan 19, Feb 16, Apr 3, May 25, Jun 19
  (observed), Jul 3, Sep 7, Nov 26, Dec 25.
- Also scaffold `scripts/mint-test-token.mjs` (mirror
  `~/1000Problems/botcity/db/mint-test-token.mjs`): mints a valid `?t=` for local
  testing with a fake playerId/roomId/eventRef.

## Do Not Change

- `GAME-INTEGRATION-V2.md`, `DESIGN-STOCKGAME.md` — read-only references.
- The botcity repo (`~/1000Problems/botcity/`) — reference only, zero modifications.
- Frozen wire names: `roomId`, `t`, `eventRef`, `ROOMS_SIGNING_KEY`,
  `X-Rooms-Signature`, `/api/rooms/close`, `/api/rooms/spine`, `/contract`, `/events`,
  `/api/avatar/{playerId}.svg`.
- DB: any table not prefixed `stockgame_`. Never `drop`/`alter`/`select` anything
  outside the prefix; the shared Neon DB has ~90 other projects' tables.
- JWT verification: never switch to a JWT library that reads the token's `alg` header.

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors.
- [ ] `node db/migrate-additive.mjs` is idempotent (runs twice cleanly) and aborts if a
      non-`stockgame_` table name is injected into its SQL (test by temporarily adding
      one).
- [ ] `curl -i localhost:3000/contract` → `application/json`, `contract: 2`,
      `display.name` present.
- [ ] `curl -i localhost:3000/events` → JSON with exactly 2 open events on a fresh DB,
      refs `d-YYYY-MM-DD` for the next 2 trading days (holiday/weekend aware).
- [ ] Launching with a token from `scripts/mint-test-token.mjs` lands on `/e/<ref>`
      with the token stripped and the session cookie set; a garbage `?t=` lands on the
      guest view without error.
- [ ] `price("NVDA", "2026-07-06", 390)` returns the identical value across two
      separate `node` invocations.

## Verification

1. `npm run build`.
2. `git diff --stat` (after initial commit) — changes only in files this task creates.
3. Run the curl checks + token launch above against `npm run dev`.
