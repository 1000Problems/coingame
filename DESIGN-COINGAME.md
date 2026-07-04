# DESIGN — 1K Daily Coin Pick 'Em

**Status: design of record (2026-07-04).** Supersedes `DESIGN-STOCKGAME.md` — same game,
pivoted from stocks to digital coins because crypto exchange market data is free to use
commercially (exchanges own their data and publish it) while equity display data is not.
A third-party game for the botcity/PickCity host, speaking the **Game Integration v2**
contract (`GAME-INTEGRATION-V2.md`, in this folder). Read that first; this doc never
restates the wire — it implements it.

## The game in one paragraph

Every calendar day is one **event** — crypto never closes, so neither do we: no weekends,
no holidays, 365 trophies a year. **The next two days always have an open event**
(`ensureEvents(2)`). From the curated pool (**10 coins: top 10 by market cap,
stablecoins/pegged excluded, LEO and ZEC swapped for LINK and HBAR** — see
TASK-coingame-07), a player picks **exactly 3 coins**
and splits **$1,000 in $100 units** (10 units) across them — notional chips, so it never
matters that a whole BTC costs six figures. Picks start as a **private draft**; hitting
**Lock it in** is the real, irreversible commit — and the ticket into that event's room
(chat, roster, everyone else's picks). You can't see other people's selections until your
own are locked, so nobody copies. **Midnight ET is the deadline AND the start gun**: at
`locks_at` the start prices snapshot, unlocked drafts are discarded, and the portfolio is
live immediately — no dead zone between locking and riding. The ride runs 00:00 → 16:00
ET; the room re-ranks live the whole way; at 16:00 the end prices settle and final values
decide the board. Highest value takes the daily trophy. The game is **perpetual**: it
never pushes `game-close`; when an event resolves, the next one is appended.

## What changed from the stock version (delta summary)

| Concept            | Stock version                          | Coin version                                  |
|--------------------|----------------------------------------|-----------------------------------------------|
| Event days         | US trading days (weekdays − holidays)  | **Every calendar day**                         |
| Ride window        | 09:30 → 16:00 ET (market session)      | **00:00 → 16:00 ET** (lock = start)            |
| Start price        | Official 9:30 open                     | Snapshot at `locks_at` (00:00 ET)              |
| End price          | Official 16:00 close                   | Snapshot at 16:00 ET (the daily "mark")        |
| Reference display  | Previous close                         | Price 24h ago (`ref_price`, crypto convention) |
| Pool               | 30 tickers, `sector`                   | 10 coins, `category` + fixed brand `color`     |
| Pre-market logic   | Flat $1,000 until 9:30                 | **Gone** — value live from lock                |
| Calendar code      | Holiday list, `isTradingDay`           | **Deleted**                                    |
| Everything else    | — unchanged: chips, lock, rooms, chat, scoring, outbox, contract surface, cron —          |

## Player flow

Unchanged from the stock design: host landing page → `Play` → token launch → pick 3,
allocate 10 chips as an editable private draft → **Lock it in** → event room (chat,
roster, others' picks, live standings) → persistent "Return to PickCity" everywhere.
Pick screen keeps the 1a Gallery + 1c Split Bar direction. The only flow difference:
standings start moving at midnight, not 9:30 — lock late and you join a race already
running (your start price is still the same 00:00 snapshot as everyone else's; nobody
locks after 00:00 anyway, that's the deadline).

## Stack

Unchanged: Next.js (App Router) + React on Vercel, no ORM, no auth provider. Runtime
deps: `next`, `react`, `@neondatabase/serverless`. Env: `DATABASE_URL` and
`ROOMS_SIGNING_KEY` — nothing else. No Vercel cron and no `CRON_SECRET`: the sweeper
is an open, idempotent `GET /api/sweep` pinged daily by a Cowork scheduled task
(hammering it is no worse than polling `/events`).

## Database — shared Neon, hard isolation rules

Unchanged and non-negotiable: every object prefixed `coingame_` (the prefix was chosen
for this pivot before the pivot existed — fortunate), migrations self-check the prefix,
dedicated `coingame_app` Neon role recommended, two-places rule (`db/schema.sql` +
`db/migrate-additive.mjs`) applies to every schema change.

**Pivot renames (destructive rebuild is acceptable — prototype data is disposable):**

```sql
coingame_ticker  → coingame_coin (symbol, name, category, active)
coingame_event.trading_date → event_date        -- one row per CALENDAR day now
coingame_event_pool:
  prev_close  → ref_price                       -- 24h-ago display reference
  open_price  → start_price                     -- settled at 00:00 ET (lock)
  close_price → end_price                       -- settled at 16:00 ET
```

All other tables (`coingame_instance`, `coingame_player`, `coingame_pick`,
`coingame_board`, `coingame_chat`, `coingame_outbox`) unchanged. `allocations` stays
`[{"symbol":"BTC","units":4}, ...]`. Session cookie scheme unchanged.

## Prices — deterministic fake engine, real feed later

Still no external feed in v1. `lib/prices.ts` v2 models a **continuous 24/7 tape**:

- **Daily marks** replace closes: `mark(symbol, date)` = deterministic chain from EPOCH,
  anchored at 16:00 ET each day. Every calendar day has a mark.
- **No overnight gap, no pre-market/after-hours branches** — one geometric bridge from
  yesterday's mark to today's mark, micro-noise zero at both ends so the 16:00 quote
  equals the settled mark exactly (live standings must match the adjudicated board).
- `startPrice(symbol, date)` = the bridge value at minute 0 (00:00 ET) — written to the
  pool at lock time. `endPrice(symbol, date)` = the 16:00 mark.
- **Crypto character:** daily vol 1.5%–8% keyed per symbol (memes at the top of the
  range — that's the fun). A small hardcoded anchor map gives the pool believable
  levels from real 2026-07-03 marks (BTC ~$61.8k, ETH ~$1,730, DOGE ~$0.076, …);
  unknown symbols fall back to a hash.
- **Price formatting** grows dynamic decimals (`lib/format.ts`): $97,412 for BTC,
  $0.00001842 for PEPE. Chip math is unaffected — units are $100 notional.

**Real feed later (the actual reason for this pivot):** swap targets are exchange public
APIs — Kraken/Binance/Coinbase OHLC & ticker endpoints, free, keyless, no redistribution
license. **Not CoinGecko's free tier** (personal-use only — a trap for a commercial
game). As before, the swap touches exactly two code paths: the live quote read and the
settle write; adjudication reads only `coingame_event_pool`.

## Scoring & adjudication

Unchanged mechanics, new window:

- Only locked picks play; drafts alive at `locks_at` die unscored.
- Per pick: `final = Σ units × $100 × (end_price / start_price)`, in cents.
- Board per instance: rank by `final_cents` desc; tie → earlier `locked_at` wins.
- `event-close` per instance: `points = final_cents`, whole board, every participant.
- No `game-close`, ever. `/events` top-level phase permanently `"open"`.

## Time & calendar

Everything stays keyed to `America/New_York` — the host's social rhythm is ET and the
daily trophy should land in the afternoon, not at 3am. `lib/calendar.ts` shrinks: the
holiday set, `isTradingDay`, and `prevTradingDay` are deleted; "next N days" is pure
date arithmetic. Event lifecycle for day D:

| When (ET)     | What                                                                    |
|---------------|-------------------------------------------------------------------------|
| any read      | `ensureEvents(2)`: events exist for the next 2 calendar days             |
| D 00:00       | `locks_at` — locks/edits rejected, drafts dead, **start prices settle**, ride begins |
| D 00:00–16:00 | Live re-ranking in the room (16-hour ride)                               |
| D 16:00–16:10 | End prices settle; phase `adjudicating`; boards computed                 |
| D ~16:10      | `event-close` enqueued per instance; phase `closed`; next day appended   |

Phase remains **computed, not stored**. Lazy-first execution unchanged: transitions,
settling, and adjudication run opportunistically on read behind an atomic claim; a
Cowork scheduled task pings `GET /api/sweep` daily (any time after ~16:15 ET) as the
zero-traffic sweeper. One new wrinkle: start-price settlement also runs lazily — the first read after
00:00 writes the 00:00 bridge snapshot into the pool (deterministic function of
(symbol, date), so "late" settlement computes the identical number; there is no race).

## Routes

Unchanged surface. Deltas only:

- `GET /contract` → `{ contract: 2, display: { name: "1K Daily", blurb: "Pick 3 coins ·
  split a grand · fastest bag wins" }, allowsPrivate: true }`
- `/events` labels: `Coin Picks · Sat, Jul 4`. Refs stay `d-YYYY-MM-DD` — now dense
  (every date), which no consumer cares about.
- `POST /api/pick` validation message: "pick exactly 3 coins".
- All JSON APIs, spine verbs, avatar rule, outbox/HMAC behavior: identical.

## Opinions baked in (flagging, not hiding)

1. **Lock = start gun.** The stock version had a 9.5-hour dead zone (locked at midnight,
   nothing counted until 9:30). Killing it makes the room live the moment it fills, and
   removes the "flat $1,000 pre-open" special case from the code.
2. **Settle at 16:00 ET, not midnight.** A 24h window is the purer crypto story, but the
   trophy would mint while the room sleeps. 16:00 keeps the celebration at the same
   wall-clock hour as before, keeps the cron, and gives a 16-hour ride — plenty.
3. **7-day weeks.** Keeping a market calendar for an asset class without one is a
   permanent explanation debt. Weekends are now content, and the bot swarm never idles.
4. **Points stay = final portfolio value in cents.** "$1,000 became $1,074" still reads
   better than "+7400", and crypto's bigger daily moves make the number livelier.
5. **Meme coins stay in the pool.** High-vol picks are the strategic spice — safe BTC
   spread vs. a 4-chip DOGE gamble is exactly the decision the game wants to pose.
6. **One fixed brand color per coin, everywhere** (TASK-coingame-07). Chips, bars,
   tiles, and standings all read by color — "5 BTC bars, 3 HBAR, 2 ETH" at a glance.
   Colors live in `coingame_coin.color`; the pick screen is the 1c "Split Bar" design
   with per-coin colors replacing the mockup's slot-color scheme.

## Build order

TASK-01..05 (stock version) are built and superseded. The pivot is **TASK-coingame-06**:
calendar simplification → prices v2 → schema rename + coin seed → window rewiring in
events/adjudicate/room → copy pass → verify with `npm run build` + a full fake-day loop.

## Out of scope for v1

Real price feed (swap points above) · game-close / season standings · chip-stacking
skin · key rotation · host-pull recovery · folder/repo rename (`stockgame` stays as the
directory name for now — cosmetic, and renaming breaks Vercel/git plumbing for zero
gameplay value).
