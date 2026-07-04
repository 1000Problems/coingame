# TASK: Settle start prices at the gun; per-coin ± from start

> Persist each pool coin's 00:00 ET price when the ride starts (not at 16:10
> adjudication), and make the per-coin ± in the room measure from that start
> price instead of the 24h ticker window.

## Context

Bag values already anchor at the start gun (`liveValueCents` prices bags as
`units × $100 × quote/startPrice`, and the tape's noise gate pins minute 0
exactly). Two gaps remain. (1) The per-coin ± shown in "Your picks" and
CoinCard is `pctChange` — 24h vs the same minute yesterday — so mid-ride the
coin rows can all read red while the bag reads +2%; the screen doesn't
reconcile. (2) `start_price` in `coingame_event_pool` is only written at
adjudication by recomputing the tape. Deterministic today, but `lib/prices.ts`
plans a real-feed swap, and a real 00:00 price can't be recomputed at 16:10 —
the snapshot must be taken at start. Decision of record (2026-07-04): everyone
starts at the same 00:00 snapshot; NO per-player entry prices at lock time.

## Requirements

1. `lib/events.ts`: new `ensureStartPrices(ref, eventDate, now?)` returning
   `Record<string, number>` (symbol → start price). For every pool row with
   `start_price IS NULL` and `now >= locksAt(eventDate)`, write the tape's
   `startPrice(symbol, eventDate)` via
   `UPDATE … SET start_price = X WHERE … AND start_price IS NULL`
   (write-once; first writer wins under a future non-deterministic feed).
   Settled values are returned as stored; unsettled fall back to the tape.
2. `lib/room.ts`: `liveValueCents` and `liveStandings` accept an optional
   `startPrices` map and prefer it over the tape (tape stays the fallback).
   `quotesForPool` gains the same optional map and each quote gains
   `startPrice: number | null` and `pctFromStart: number | null` —
   `pctFromStart` is non-null only once `nowDate >= eventDate`, computed as
   `(price − start)/start`, rounded to 2dp like `pctChange`.
3. `app/api/room/route.ts`: call `ensureStartPrices` once per request (live
   branch) and pass the map to both `liveStandings` and `quotesForPool`.
   Additive payload fields only — headless bots must not break.
4. `lib/adjudicate.ts` step 2: get start prices from `ensureStartPrices`
   (which settles any stragglers), write only `end_price` in the pool update,
   and score bags from the settled map (tape fallback per symbol, defensive).
5. `components/EventRoom.tsx`: "Your picks" rows show `pctFromStart` when
   non-null, else the 24h `pct` (pre-game). Sign colors via existing
   `pos`/`neg`. Pass `pctFromStart` through to CoinCard.
6. `components/CoinCard.tsx`: optional `pctFromStart` prop; when defined,
   render it labeled "since start" alongside the existing labeled "24h".

## Implementation Notes

- Files: `lib/events.ts`, `lib/room.ts`, `lib/adjudicate.ts`,
  `app/api/room/route.ts`, `components/EventRoom.tsx`,
  `components/CoinCard.tsx`. Nothing else.
- No schema change — `coingame_event_pool.start_price` exists and is nullable.
- No new trigger machinery: this is the lazy-first pattern (`ensureEvents`
  precedent). The `/api/room` poll is the hot path that settles the snapshot
  within ~15s of midnight for any watched event; adjudication is the backstop.
- `ensureStartPrices` lives in `lib/events.ts` (imports `startPrice` from
  `@/lib/prices`, `locksAt` from `@/lib/calendar`). No import cycle: prices
  and calendar import nothing from events/room.
- Preserve exact rounding conventions: cents via `Math.round`, pct
  `Math.round(x * 10000) / 100`.

## Do Not Change

- `lib/prices.ts` — the tape and its invariants (minute-0/960 pinning) are
  untouched; this task only changes WHERE start prices are read from.
- `lib/picks.ts`, `lib/token.ts`, `lib/outbox.ts` — out of scope.
- `db/*` — no migrations.
- Board scoring semantics: `final_cents` math must produce identical numbers
  to today for the deterministic tape (settled value == tape value).
- Existing `/api/room` payload fields — rename nothing; add only.
- Frozen wire vocabulary; points on the wire stay final value in cents.

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors.
- [ ] After midnight ET, `coingame_event_pool.start_price` is populated for
      the live event within one room poll, before any adjudication.
- [ ] Mid-ride, each pick row's ± equals its quote vs the settled
      `start_price`, and the weighted sum reconciles with the bag's ±.
- [ ] Pre-game room (before midnight) still shows the 24h ticker ± and no
      "since start" figure anywhere.
- [ ] Re-running settle on an already-settled event changes nothing
      (write-once respected).
- [ ] `git diff` touches only the six listed files (+ this TASK file).

## Verification

1. `npm run build`.
2. `git diff --stat` — no files outside scope.
3. Local: mint a token, open today's room, confirm pick-row ± matches
   `(price − start_price)/start_price` and the bag reconciles.
