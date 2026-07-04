# TASK: Kraken live feed — quote cache + live display

> Real market data for live screens, fetched directly from Kraken's public
> API only when a request arrives. No Vercel cron, no API key, no per-player
> upstream cost.

## Context

The deterministic tape (`lib/prices.ts`) was always a placeholder; the real
feed decision landed 2026-07-04 (see `coinsMarket.md` research): **Kraken
public API** — license-clean for commercial display, keyless, batched. All 10
active pool coins verified live on Kraken (BNB and HYPE included; checked
2026-07-04 against `/0/public/Ticker`). Companion spec TASK-coingame-14b
covers settlement (exact 00:00/16:00 prices via OHLC candles).

## Requirements

1. New `lib/feed.ts`:
   - `feedMode()`: `"tape"` iff `PRICE_FEED=tape`, else `"kraken"` (default).
   - Pair mapping: request `XBTUSD` for BTC, else `{SYMBOL}USD`. Response
     keys differ: `BTC→XXBTZUSD`, `ETH→XETHZUSD`, `XRP→XXRPZUSD`,
     `DOGE→XDGUSD`, others echo the request name.
   - `cachedLiveQuotes(symbols)` → `Record<symbol, { price, pct }>`:
     read-through cache over new table `coingame_quote`, TTL ~20s.
     Single-flight: conditional-UPDATE claim (same trick as
     `coingame_event.claim_at`) so N concurrent pollers cause ONE upstream
     call — one batched `Ticker` request for all symbols, 5s timeout.
     On upstream failure: clear claim, serve the stale rows. Never throw.
   - `pct` = (last − today's UTC open)/open from ticker fields `c[0]`/`o`
     (day change; closest free approximation of the 24h figure).
2. New table `coingame_quote (symbol text pk, price numeric(20,8),
   pct numeric(10,4), fetched_at timestamptz not null default 'epoch',
   claim_at timestamptz)` — in BOTH `db/schema.sql` and
   `db/migrate-additive.mjs` (two-places rule).
3. `lib/room.ts`: `quotesForPool` becomes async `poolQuotes(symbols,
   eventDate, now, startPrices?)`, same output shape (+ nothing renamed).
   Kraken mode: pre-16:00 → cache quotes; after 16:00 of the event day →
   prices ARE the settled `end_price` rows (preserves the invariant: last
   live poll == adjudicated board), `pctFromStart` computed vs settled
   start. Tape mode: existing logic verbatim.
4. `liveValueCents` gains a `quotePrices` map (kraken mode: cache or settled
   end). A coin missing either start or quote contributes its flat notional
   (`units × $100`) — degraded, never NaN, never fake-tape-mixed-with-real.
5. Callers updated: `/api/room`, `/api/quotes`, `app/e/[ref]/page.tsx` await
   the new function. No component changes — payload shape is unchanged.
6. `PRICE_FEED` documented in CLAUDE.md env list.

## Do Not Change

- `lib/prices.ts` — the tape stays intact as dev/test mode and emergency
  fallback. Only its callers learn about modes.
- `/api/room` response field names; frozen wire vocabulary.
- `components/EventRoom.tsx`, `PickScreen.tsx` — payload-compatible by design.
- `db/schema.sql` beyond adding the one table (destructive path untouched).

## Acceptance Criteria

- [ ] `npm run build` passes.
- [ ] With no players polling, zero Kraken calls occur (request-driven only).
- [ ] Concurrent room polls produce ≤1 upstream call per TTL window.
- [ ] Kraken unreachable → screens keep last cached prices; no 500s.
- [ ] `PRICE_FEED=tape` reproduces today's behavior exactly.
