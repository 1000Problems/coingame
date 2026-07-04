# DESIGN — 1K Daily Stock Pick 'Em

**Status: design of record (2026-07-03).** A third-party game for the botcity/PickCity
host, speaking the **Game Integration v2** contract (`GAME-INTEGRATION-V2.md`, in this
folder). Read that first; this doc never restates the wire — it implements it.

## The game in one paragraph

Every US trading day is one **event**, and **the next two trading days always have an
open event** (`ensureEvents(2)` — at attach time the host immediately sees tomorrow and
the day after). From the curated pool (30–40 tickers; 8 in the mockups), a player picks
**exactly 3 stocks** and splits **$1,000 in $100 units** (10 units) across them. Picks
start as a **private draft**; hitting **Lock it in** is the real, irreversible commit —
and the ticket into that event's room (chat, roster, everyone else's picks). You can't
see other people's selections until your own are locked, so nobody copies. **Midnight
ET is only the deadline**: after `locks_at`, no more locks, and unlocked drafts are
discarded — you're not in that event. The portfolio rides the trading day from the 9:30
open to the 4:00 close; the room re-ranks live; at close, final values decide the
board. Highest value takes the daily trophy. The game is **perpetual**: it never pushes
`game-close`; when an event resolves, the next one is appended.

## Player flow (matches the mockups in the design zip)

1. Player opens the game from their PickCity room → host landing page lists our events
   (host-rendered; we serve none of it): two open events, plus locked/playing/closed ones.
2. Play on an open event → browser lands on `https://<game>/?t=<token>` with `eventRef`
   → we verify HS256, mint our own session cookie, strip `?t=`, and land directly on
   that event's **pick screen**.
3. Pick 3, allocate 10 chips — saved as an editable **draft**, visible only to you.
   **Lock it in** (irreversible) → you enter the **event room**: chat, roster, other
   locked players' picks, and — once the day is trading — live re-ranking standings.
4. Back on the host landing page, Play into the *other* open event: separate pick,
   separate lock, separate room. Every event is fully isolated — its own chat, roster,
   picks, board.
5. Persistent **"Return to PickCity"** (token `returnUrl`) on every screen.

Pick screen visual direction: **merge 1a Gallery's calm with 1c Split Bar's segmented
bar + steppers** (the mockup's own "try next" note). 1b Game Floor's chip-stacking is
kept as a possible later skin, not v1.

## Stack

Mirror the host exactly — Next.js (App Router) + React on Vercel, no ORM, no auth
provider. Runtime deps: `next`, `react`, `@neondatabase/serverless`. Env:
`DATABASE_URL`, `ROOMS_SIGNING_KEY`, `NEXT_PUBLIC_APP_URL`. Deployable with essentially
just those set. `lib/db.ts` = same lazy tagged-template SQL client pattern as botcity.

## Database — shared Neon, hard isolation rules

The DB is shared with ~90 other 1000Problems projects. Non-negotiables:

- **Every table is prefixed `coingame_`.** No exceptions, including indexes
  (`coingame_*_idx`).
- **Migrations may only ever reference `coingame_*` objects.** No `drop`/`alter` on
  anything else, ever. The additive migration script greps its own SQL for the prefix
  as a self-check before executing.
- **Recommended (botcity precedent): a dedicated `coingame_app` Neon role** scoped to
  its own schema with zero privileges on other projects' tables. Prefix = belt, role =
  suspenders. Set this up once at provisioning; the app itself never needs to know.
- Two-places rule inherited from botcity: every schema change lands in both
  `db/schema.sql` (full rebuild, drops **only** `coingame_*`) and an idempotent
  statement in `db/migrate-additive.mjs`.

### Tables

```sql
-- Curated master pool. Rotation = flipping active flags.
coingame_ticker (
  symbol text primary key,          -- 'NVDA'
  name   text not null,
  sector text,
  active boolean not null default true
)

-- One row per trading day. ref is the contract eventRef, permanent once published.
coingame_event (
  ref          text primary key,     -- 'd-2026-07-06'
  trading_date date not null unique,
  phase        text not null default 'open',  -- open|locked|adjudicating|closed
  locks_at     timestamptz not null,          -- midnight ET before trading_date
  settles_at   timestamptz not null,          -- ~16:10 ET on trading_date
  trophy_label text not null,                 -- 'Daily Champ · Jul 6'
  created_at   timestamptz not null default now()
)

-- The pool snapshot for an event, with settled prices. The adjudication source of
-- truth — when real data arrives later, only the writer of open/close changes.
coingame_event_pool (
  event_ref  text not null references coingame_event(ref),
  symbol     text not null,
  prev_close numeric(12,4),
  open_price numeric(12,4),          -- settled at 09:30 ET
  close_price numeric(12,4),         -- settled at 16:00 ET
  primary key (event_ref, symbol)
)

-- One row per roomId we've ever seen (public room + every private instance).
-- allowsPrivate: true — any unknown roomId auto-creates a row, idempotently.
coingame_instance (
  room_id       text primary key,    -- host uuid, echoed on every push
  host_origin   text not null,       -- origin of returnUrl: avatars + push target
  return_url    text not null,
  first_seen_at timestamptz not null default now()
)

-- One row per pseudonymous player. Never an email, never a real id.
coingame_player (
  player_id    text primary key,     -- 'p_79c5f9d8dd4e0756' from the launch token
  display_name text not null,
  avatar_url   text,
  last_seen_at timestamptz
)

-- The pick. Allocations: exactly 3 symbols, integer units 1..8, sum = 10.
-- status 'draft' = editable, private. 'locked' = irreversible, admits the player
-- to the event room. Drafts still unlocked at locks_at are dead — never scored.
-- Server rejects any write after locks_at, regardless of UI state (contract rule).
coingame_pick (
  room_id    text not null references coingame_instance(room_id),
  event_ref  text not null references coingame_event(ref),
  player_id  text not null references coingame_player(player_id),
  allocations jsonb not null,        -- [{"symbol":"NVDA","units":4}, ...]
  status     text not null default 'draft',   -- draft | locked
  locked_at  timestamptz,                     -- set once, at lock; tie-breaker
  updated_at timestamptz not null default now(),
  primary key (room_id, event_ref, player_id)
)

-- Adjudicated board per instance per event (what event-close pushes).
coingame_board (
  room_id     text not null,
  event_ref   text not null,
  player_id   text not null,
  final_cents bigint not null,       -- points on the wire
  placement   int not null,
  primary key (room_id, event_ref, player_id)
)

-- In-game live-room chat, per instance (contract: in-game chat is per-roomId).
coingame_chat (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  event_ref  text not null,
  player_id  text not null,
  body       text not null,
  created_at timestamptz not null default now()
)

-- Durable outbox for /spine and /close pushes (contract: keep close pushes
-- durable on your side — host-pull recovery is deferred).
coingame_outbox (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,        -- 'spine' | 'close'
  room_id      text not null,
  payload      jsonb not null,       -- exact body to sign & send
  attempts     int not null default 0,
  next_try_at  timestamptz not null default now(),
  delivered_at timestamptz
)
```

No session table — session is a signed httpOnly cookie (HS256 with
`ROOMS_SIGNING_KEY`, per contract suggestion) carrying
`{playerId, roomId, displayName, avatar, returnUrl, exp}`. Latest launch wins.

## Prices — deterministic fake engine, real feed later

v1 uses **no external feed**. `lib/prices.ts` exposes one pure function:

```
price(symbol, t) -> numeric      // geometric walk, PRNG seeded by (symbol, tradingDate)
```

Deterministic by construction: every serverless invocation, every user, every instance
sees identical prices for the same minute, with zero shared state and zero crons for
ticking. Open (9:30) and close (16:00) fall out of the same function; at settle time we
**write them into `coingame_event_pool`**, and adjudication reads only that table.
Swapping in Finnhub/Polygon later touches exactly two code paths — the quote read and
the settle write — and nothing downstream. Off-hours the walk keeps drifting gently
(the mockups' "after-hours moves tick live").

## Scoring & adjudication

- **Only locked picks play.** Drafts still unlocked at `locks_at` are ignored forever.
- Per pick: `final = Σ units × $100 × (close_price / open_price)`, in cents.
- Board per instance: rank by `final_cents` desc. Tie → earlier `locked_at` wins the
  higher placement (a tie at placement 1 must still mint exactly one trophy).
- `event-close` per instance: `points = final_cents`, whole board, every participant.
- Players who locked picks but never returned are still scored and pushed — contract
  requires the whole board.
- **No `game-close`, ever.** `/events` top-level phase is permanently `"open"`.

## Time & calendar

Everything keyed to `America/New_York`. Trading days = weekdays minus a hardcoded 2026
US market holiday list (`lib/calendar.ts`) — fine for a prototype, revisit with real
data. Event lifecycle for trading day T:

**Invariant: the next 2 trading days always have events** — `ensureEvents(2)` is
idempotent (`insert … on conflict do nothing`) and runs lazily on every `/events` read
and after every adjudication. At attach time this is what makes the host immediately
see two open events.

| When (ET)          | What                                                        |
|--------------------|-------------------------------------------------------------|
| any read           | `ensureEvents(2)`: events exist for next 2 trading days      |
| T 00:00            | `locks_at` passes → phase reads `locked`; locks/edits rejected; drafts dead |
| T 09:30            | Open prices settle into pool                                 |
| T 16:00–16:10      | Close settles; phase `adjudicating`; boards computed         |
| T ~16:10           | `event-close` enqueued per instance; phase `closed`; `ensureEvents(2)` appends the next day |

Phase is **computed, not stored** (`closed_at` set + clock comparisons); the lock needs
no scheduler — a pick write at 00:00:01 just fails the `locks_at` check.

**Lazy-first execution:** phase transitions, event creation, settling, and adjudication
all run opportunistically on read (any request notices "it's past settle time and this
event isn't closed" and does the work, guarded by an advisory lock). A **single daily
Vercel cron** (`vercel.json`, ~21:15 UTC) is the sweeper for zero-traffic days — it
settles, adjudicates, and flushes the outbox so results push even if nobody comes back.
This avoids depending on minute-level cron precision.

## Routes

**Contract endpoints (server routes, JSON, root-level — not swallowed by the SPA):**
- `GET /contract` → `{ contract: 2, display: { name: "1K Daily", blurb: "Pick 3 · split a grand · fastest bag wins" }, allowsPrivate: true }`
- `GET /events` → game phase `open` + events trimmed to a window (last 14 closed +
  anything open/locked/adjudicating). Refs permanent, phases per the table above.
- `GET /?t=…` → verify (pinned HS256, exp+60s skew), upsert player + instance, mint
  session cookie, redirect to `/e/<eventRef>` (unknown ref → `/`, never an error).

**Game pages:**
- `/` — home: today's event state for the session's room; redirects into pick or live
  room as appropriate. Guest view if no session (never crash, never loop).
- `/e/[ref]` — one route; phase **and the caller's lock status** decide the screen:
  open + no locked pick → pick screen (draft editing); open + locked → event room
  (pre-game chat, roster, others' picks); locked/adjudicating → event room, live
  re-ranking; closed → frozen board. Not locked in time → spectator view of the board
  only, no chat.

**JSON APIs (session-cookie auth) — deliberately JSON, not server actions, so botcity
swarm bots can play headlessly with nothing but a launch token:**
- `POST /api/pick` — `{ eventRef, allocations }`; draft upsert. Validates 3 symbols /
  10 units / all in pool / before `locks_at` / not already locked. Drafts are private —
  no spine event.
- `POST /api/lock` — `{ eventRef }`; irreversible. Sets `status='locked'`, `locked_at`,
  enqueues the `picked` spine event (`data.selection` human-readable), and admits the
  player to the event room.
- `GET /api/room?eventRef=` — live room poll (~15s): quotes, your bar, standings, chat
  tail. Standings computed on the fly from picks × `price(symbol, now)`.
- `POST /api/chat` — appends to `coingame_chat`, enqueues `chat_sent` spine event.

**Outbound (via outbox, HMAC over raw body bytes):**
- `POST {host_origin}/api/rooms/spine` — verbs `picked`, `pick_changed`, `chat_sent`;
  batched a few seconds; hard deadline: all picks pushed by lock (they're enqueued on
  action, so this holds by construction).
- `POST {host_origin}/api/rooms/close` — `event-close` per instance per day.

**Avatars:** always `{host_origin}/api/avatar/{playerId}.svg` — pick tiles, standings,
chat. Zero local avatar rendering (contract rule).

## Opinions baked in (flagging, not hiding)

1. **In-game chat stays** despite the host owning room chat. During market hours the
   player lives in the event room, not the lobby; the contract explicitly scopes
   in-game chat per instance, and `chat_sent` spine events keep the host's social
   engine fed. Chat is **per event** and **lock-gated**: you buy your seat with an
   irreversible pick, which is both the anti-copy mechanism and what makes the room
   feel earned.
2. **Points = final portfolio value in cents**, not P&L. Monotonic with rank, always
   positive, and "your $1,000 became $1,013.40" reads better on a board than "+1340".
3. **One route for pick + live room** (`/e/[ref]`) instead of separate pages — the
   phase flip is the screen flip, so a stale tab self-corrects on next poll.
4. **Private instances cost us nothing**: picks, boards, and chat are already keyed by
   `room_id`; `/events` is instance-agnostic; closes fan out per instance from the same
   adjudication pass. `allowsPrivate: true` from day one.

## Build order (each → its own TASK file when we're ready)

1. **Scaffold + contract surface** — repo, db bootstrap (role, prefix-guard migration
   script, schema), `/contract`, `/events`, launch verify + session, fake price lib.
2. **Pick screen** — pool tiles, 1a+1c allocation UI, `POST /api/pick`, lock
   enforcement, spine outbox.
3. **Live room** — poll endpoint, standings re-rank, segmented bar, chat.
4. **Adjudication + close wire** — settle, boards, event-close fan-out, daily sweeper
   cron, outbox retries.
5. **Connect** — deploy, `curl /contract` + `/events` sanity, paste URL on botcity
   `/developer`, set `ROOMS_SIGNING_KEY`, redeploy, go live, run a bot room through it.

## Out of scope for v1

Real price feed (swap-in points defined above) · `game-close` / cumulative season
standings · 1b chip-stacking skin · key rotation (`kid`) · host-pull result recovery
(both deferred host-side anyway).
