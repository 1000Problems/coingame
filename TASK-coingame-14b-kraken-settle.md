# TASK: Kraken settlement — exact 00:00/16:00 prices via OHLC candles

> Winners are decided by the true price at the start gun and the finish line,
> recoverable at ANY time after the fact — settlement doesn't depend on
> anything running at those instants.

## Context

Companion to TASK-coingame-14a. On Vercel nothing is alive at 00:00/16:00 ET.
Kraken's public OHLC endpoint serves historical candles, so the first read
after the moment (a player poll, or the daily Cowork sweep ping) fetches the
candle that OPENED at the target instant and settles it write-once. Verified
2026-07-04: `OHLC?pair=XBTUSD&interval=60&since=…` returns the 04:00 UTC
(= 00:00 EDT) candle with open 62575.0. Coverage: 720 candles per interval →
1-min ≈ 12h back, 5-min ≈ 60h, 15-min ≈ 7.5d, 60-min ≈ 30d. Our instants are
hour-aligned, so every ladder rung lands on a candle boundary in all DST
regimes.

## Requirements

1. `lib/feed.ts`: `priceAtInstant(symbol, at)` → `number | null`. Picks the
   smallest interval from [1, 5, 15, 60] whose 720-candle window still covers
   `now − at` (plus margin), fetches OHLC, returns the OPEN of the candle
   whose time equals `at`. Exact candle missing at one rung → try the next
   rung up. All rungs exhausted or fetch fails → null. 5s timeout, never throws.
2. `lib/events.ts` `ensureStartPrices`: kraken mode reads
   `priceAtInstant(symbol, locksAt(eventDate))`; null → no write, symbol
   omitted from the returned map (callers already tolerate missing keys per
   14a). Tape mode unchanged. Write-once `IS NULL` guard stays.
3. `lib/adjudicate.ts`: kraken mode settles `end_price` from
   `priceAtInstant(symbol, endsAt(eventDate))`, write-once
   (`coalesce(end_price, …)`). **All-or-abort guard:** if any pool symbol
   lacks a start or end price, release the claim (`claim_at = null`) and
   return `{ ran: false }` — the next trigger retries. Never close an event
   or push results on partial data. Scoring reads the settled maps.
4. `ensureEvents` pool snapshot: kraken mode leaves `ref_price` null (it is
   written from the tape today and consumed by no UI — grep-verified).
5. Cowork scheduled task re-pointed to fire daily ~16:12 ET (settle trigger
   for zero-traffic days; candles make its exact timing irrelevant).
6. CLAUDE.md: prices section updated — tape is `PRICE_FEED=tape` dev mode;
   settlement source of record is Kraken candles → `coingame_event_pool`.

## Do Not Change

- Write-once semantics on `start_price`/`end_price`; board write-once;
  close-push idempotency by `(roomId, ref)`.
- `lib/outbox.ts`, `lib/picks.ts`, `lib/token.ts`.
- The claim mechanism shape in `settleAndClose` (only add the release path).
- Points on the wire = final value in cents.

## Acceptance Criteria

- [ ] `npm run build` passes.
- [ ] Settlement triggered hours late produces the same start/end prices as
      one triggered on time (candle-addressed, not fetch-time).
- [ ] Kraken down at settle time → event stays open, claim released, next
      trigger retries; no partial board, no close push.
- [ ] After 16:00, room quotes equal the settled `end_price` exactly.
- [ ] `PRICE_FEED=tape` settles from the tape as before.

## Ops (launch-day)

- [ ] `node db/migrate-additive.mjs` run against prod (adds `coingame_quote`).
- [ ] Cowork sweep task scheduled ~16:12 ET daily → `GET /api/sweep`.
- [ ] No new env needed in prod (kraken is the default mode).
