> **SUPERSEDED (2026-07-04)** by the coin pivot — see `DESIGN-COINGAME.md` and `TASK-coingame-06-coin-pivot.md`. Kept as the historical record of the stock build. Do not build from this doc.

# TASK: Adjudication + close wire — settle, boards, event-close fan-out, sweeper

> Turn 4:00 PM ET into results: settle prices, compute per-instance boards, push
> signed `event-close` per roomId, append the next event, and guarantee it all happens
> even on zero-traffic days via one daily cron.

## Context

Depends on TASK-stockgame-01/02/03. Contract: `GAME-INTEGRATION-V2.md` §5 (close), §6
(private instances). This is the money path: the host mints trophies from exactly what
we push and never recomputes, so the board must be right, complete (every locked
participant, not just winners), and durable (host-pull recovery is deferred host-side —
if we lose a push, results are gone). The game is perpetual: **never push
`game-close`**.

## Requirements

1. `lib/adjudicate.ts` — `settleAndClose(ref)`, guarded by a Postgres advisory lock
   (`pg_try_advisory_lock` keyed on the ref hash; bail silently if not acquired):
   a) write `open_price`/`close_price` from `openPrice()`/`closePrice()` into
   `coingame_event_pool` for the event's trading date; b) for **every instance with
   ≥1 locked pick** for this event, compute `final_cents` per player (formula in
   DESIGN-STOCKGAME.md "Scoring"), rank (tie → earlier `locked_at`), insert
   `coingame_board` rows; c) enqueue one `close` outbox row per instance with the
   contract §5 `event-close` shape — `{ type: "event-close", roomId, ref,
   trophyLabel: <event.trophy_label>, results: [{ playerId, points: final_cents,
   placement }] }`, whole board; d) set `coingame_event.closed_at`; e) call
   `ensureEvents(2)`. Steps a–e idempotent: re-running on a closed event is a no-op.
2. Lazy triggering: `GET /events` and `GET /api/room` check for any event past
   `settles_at` without `closed_at` and fire `settleAndClose` without blocking the
   response (`waitUntil` / fire-and-forget with the advisory lock as the safety).
3. `GET /api/sweep` — cron route (protect with a `CRON_SECRET` header check, Vercel
   cron pattern): settles all due events, runs `ensureEvents(2)`, runs
   `outbox.flush()`. Add `vercel.json` scheduling it daily at `15 21 * * *` UTC
   (≈16:15 ET during DST; acceptable drift in winter — note it in a comment).
4. Outbox hardening for `close` kind: exponential backoff capped at ~1h, no max
   attempts (close pushes must eventually land); `flush()` processes spine before
   close is NOT required — order-independent, both idempotent host-side (`(roomId,
   ref)` for closes, event `id` for spine). Deliveries POST to
   `{host_origin}/api/rooms/close` with raw-body HMAC per contract.
5. Draft hygiene: adjudication reads `status='locked'` only; add a cleanup in the
   sweeper deleting draft rows for events closed more than 7 days (keeps the table
   tidy; drafts are worthless post-lock).

## Implementation Notes

- Instances discovered per event via `select distinct room_id from coingame_pick
  where event_ref=$1 and status='locked'` — private instances (unknown roomIds
  auto-created at launch) fan out with zero extra code (contract §6).
- An instance's push target is its own `coingame_instance.host_origin` — do not
  assume one host origin globally.
- Zero-participant instances: skip (no board, no push). Zero participants overall:
  still set `closed_at` and append the next event.
- `points` must be `final_cents` as integer; `placement` starts at 1; every locked
  player appears exactly once.
- The host sanity-checks but trusts placements — double-check the tie-break sort is
  stable (`order by final_cents desc, locked_at asc`).

## Do Not Change

- Everything under "Do Not Change" in TASK-stockgame-01.
- Never emit `game-close` — grep the diff for `game-close` before finishing; the only
  allowed close type is `event-close`.
- `coingame_board` rows are write-once: no updates after insert; re-adjudication of a
  closed event must be a no-op, not a recompute.
- Locked picks: adjudication must never read or resurrect drafts.

## Acceptance Criteria

- [ ] `npm run build` passes.
- [ ] Scenario test against a mock host: 2 instances (public + private roomId), 3
      locked players in one, 2 in the other, event past `settles_at` → exactly 2
      signed `event-close` POSTs, each with its own complete board, `points` =
      deterministic expected cents from `prices.ts`, placements 1..n.
- [ ] Running `settleAndClose` twice (and concurrently, two parallel invocations) →
      boards inserted once, pushes enqueued once (advisory lock + idempotency).
- [ ] After close: event phase reads `closed`, `/events` shows it plus 2 future open
      events (the new day appeared).
- [ ] Kill the mock host during flush → outbox row survives with backoff; restore
      host → next flush delivers; host receiving a duplicate is tolerable
      (idempotent) but the outbox must not duplicate rows.
- [ ] `/api/sweep` without the secret header → 401; with it → performs all three
      duties.

## Verification

1. `npm run build`.
2. Run the 2-instance scenario end-to-end locally (mint tokens for two roomIds, lock
   picks, time-travel the event rows, hit `/api/sweep`).
3. `grep -r "game-close" app lib` → no matches.
4. `git diff` — changes only in `lib/adjudicate.ts`, `lib/outbox.ts`,
   `app/api/sweep/`, `vercel.json`, and touched read-paths for lazy triggering.
