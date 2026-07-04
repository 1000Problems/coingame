# TASK: Pivot 1K Daily from stocks to digital coins

> Convert the built stock game to a coin game: 7-day calendar, 00:00→16:00 ET ride,
> continuous 24/7 fake tape, coin pool, coin-native copy. One atomic pass — the build
> is broken mid-way, so this ships as a single commit.

## Context

Free commercial-use stock price data doesn't exist; crypto exchange data is free
(exchanges own it and publish it keyless). Design of record is `DESIGN-COINGAME.md`
(read it first — especially the delta table). Everything social/wire stays: chips,
lock-to-enter, rooms, scoring formula, outbox, contract endpoints. DB data is
disposable test data — destructive rebuild via `db/schema.sql` is expected and fine.

## Requirements

1. **Calendar goes 7/7** (`lib/calendar.ts`): delete `HOLIDAYS_2026`, `isTradingDay`,
   `prevTradingDay`, `nextTradingDays`; add `nextDays(fromDateStr, n)` (pure date
   arithmetic, every day qualifies) and `prevDay(dateStr)`. Keep `dateET`, `todayET`,
   `minuteOfDayET`, `etInstant`, `locksAt` (still 00:00 ET), `settlesAt` (still 16:10
   ET), `labelFor`, `shortLabelFor` unchanged.
2. **Prices v2** (`lib/prices.ts`): continuous 24/7 tape. `mark(symbol, date)` =
   deterministic daily chain from EPOCH `2026-01-02` over EVERY calendar day, anchored
   16:00 ET. `quoteAt(symbol, date, minute)` = geometric bridge from `mark(prevDay)` to
   `mark(date)` across the full 0–1440 range mapped so the bridge hits `mark(date)`
   exactly at minute 960, with micro-noise pinned to zero at minute 0 and minute 960
   (start snapshot and settle must be exact). Delete `openPrice`, `overnightGap`, the
   pre-market/after-hours branches. Export `startPrice(symbol, date)` (= quoteAt at
   minute 0) and `endPrice(symbol, date)` (= mark). Vol range 0.015–0.08. Add a
   hardcoded anchor map for the seeded pool — **top 20 by market cap as of 2026-07-03
   (slickcharts.com/currency), stablecoins and gold-pegged tokens excluded** (pegged
   assets are non-picks: a $100 chip returns $100): BTC 61800, ETH 1730, BNB 564,
   XRP 1.10, SOL 81, TRX 0.32, HYPE 69, DOGE 0.076, LEO 9.10, ZEC 455, XLM 0.20,
   ADA 0.17, XMR 317, LINK 7.80, CC 0.14, GRAM 1.68, BCH 225, LTC 43.5, HBAR 0.072,
   SUI 0.75; hash fallback for unknowns.
3. **Schema rename + seed** (`db/schema.sql` + `db/migrate-additive.mjs` + `db/seed.sql`
   + `db/seed.mjs`, two-places rule): `coingame_ticker` → `coingame_coin` with
   `category` replacing `sector`; `coingame_event.trading_date` → `event_date`;
   `coingame_event_pool`: `prev_close` → `ref_price`, `open_price` → `start_price`,
   `close_price` → `end_price`. Seed the 20 coins from req 2's anchor map with
   categories (L1, Payments, Exchange, Meme, Privacy, Oracle, DeFi). Since the additive script
   can't rename, its idempotent form is create-if-missing of the new shapes; the
   rebuild path is authoritative for this pivot.
4. **Window rewiring** (`lib/events.ts`, `lib/adjudicate.ts`, `lib/room.ts`,
   `lib/picks.ts`): events for next 2 calendar days; pool snapshot writes `ref_price`
   (= quoteAt 24h before `locks_at`); lazy settlement writes `start_price` on first
   read after 00:00 and `end_price`/boards after 16:10 (both pure recomputations —
   no race); scoring = `Σ units × $100 × (end_price / start_price)` in cents; delete
   the "flat $1,000 before open" branch in `liveValueCents` — value is live from
   minute 0 of `event_date`; `quotesForPool` loses OPEN_MIN logic.
5. **Copy pass**: `app/contract/route.ts` blurb → `"Pick 3 coins · split a grand ·
   fastest bag wins"`; `lib/events.ts:101` label → `Coin Picks · …`; `lib/picks.ts:23`
   → `"pick exactly 3 coins"`; `app/page.tsx` landing copy (coins, every day, midnight
   start); `components/PickScreen.tsx` strings ("stock" → "coin"); `lib/format.ts`
   gains dynamic-decimal price formatting (≥$1: 2dp; <$1: 4 significant digits, e.g.
   `$0.00001842`) used by PickScreen and EventRoom quote displays.

## Implementation Notes

- Read `DESIGN-COINGAME.md` and `CLAUDE.md` before starting; `GAME-INTEGRATION-V2.md`
  is untouched by this pivot.
- Event refs stay `d-YYYY-MM-DD`; they simply become dense. `refFor` unchanged.
- Phase stays computed (clock + `closed_at`); `locksAt`/`settlesAt` times are
  unchanged. (Post-pivot decision: `vercel.json` cron and `CRON_SECRET` were removed —
  `/api/sweep` is open/idempotent and pinged by a Cowork scheduled task instead.)
- Keep prices pure: no DB reads in `lib/prices.ts`; the anchor map is a literal.
- The mark chain is ≤ ~365 iterations/symbol/year — same cost profile as before.
- Allocation shape unchanged: `[{"symbol":"BTC","units":4}]`, 3 symbols, units 1..8,
  sum 10, validated in `lib/picks.ts`.
- Follow the existing tagged-template SQL style in `lib/` modules; no SQL in components.

## Do Not Change

- `GAME-INTEGRATION-V2.md` and every wire name: `roomId`, `t`, `ROOMS_SIGNING_KEY`,
  `X-Rooms-Timestamp`, `X-Rooms-Signature`, `POST {host}/api/rooms/close`, spine verbs
  `picked`/`pick_changed`/`chat_sent`, `points` semantics (final cents).
- `lib/token.ts`, `lib/db.ts`, `lib/outbox.ts`, `lib/players.ts` — no stock DNA, off limits.
- `app/api/*` route shapes and auth (session cookie) — bots depend on them.
- `coingame_instance`, `coingame_player`, `coingame_pick`, `coingame_board`,
  `coingame_chat`, `coingame_outbox` table shapes.
- Contract `display.name` stays `"1K Daily"`. Avatar rule (host-served SVGs only).
- `scripts/mint-test-token.mjs`, superseded stock-era docs
  (`DESIGN-STOCKGAME.md`, `TASK-stockgame-01..05` — history, not targets).

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors
- [ ] `grep -ri "stock\|ticker\|trading" lib app components db --include="*.ts*" --include="*.sql" --include="*.mjs"` returns nothing (comments included)
- [ ] Fresh rebuild + seed: `/events` shows 2 open events with **tomorrow and day-after calendar dates** (run on a Friday: Saturday and Sunday must appear)
- [ ] `quoteAt(sym, d, 960) === endPrice(sym, d)` and `quoteAt(sym, d, 0) === startPrice(sym, d)` exactly, for several symbols/dates
- [ ] Full loop with the fake clock: draft → lock → live standings move before 09:30 ET equivalent (e.g. minute 300) → adjudicate → board matches last live poll → `event-close` enqueued
- [ ] PEPE renders as `$0.0000…` with significant digits, BTC as `$100,…` with 2dp
- [ ] `git diff` shows changes ONLY in files named in Requirements/Implementation Notes

## Verification

1. `npm run build`
2. `git diff --stat` — nothing outside scope
3. `node db/migrate-additive.mjs && node db/seed.mjs` against the dev DB, then curl
   `/contract` and `/events` locally
4. Mint a test token, play a full event through with the fake clock, confirm the
   acceptance loop above
