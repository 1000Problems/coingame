# TASK: Flex picks — 3 to 10 coins + visible lock-time tiebreak

> Replace "exactly 3 coins" with "3–10 coins" (units ≥1, sum 10), and surface
> `locked_at` in the room so the earliest-lock tiebreak is visible and trusted.

## Context

PickCity needs exactly one placement-1 per event (`event-close` carries explicit
`placement`; the host trusts our ranking). Widening the pick range from exactly-3
to 3..10 grows the portfolio space ~21× (4,320 → ~92k combinations), cutting
identical-portfolio collisions. Value ties that remain are settled by earliest
`locked_at` — that sort already exists in `lib/adjudicate.ts:77` and
`lib/room.ts:55`; what's missing is (a) the relaxed validation, (b) the UI for a
variable coin count, (c) showing lock times so the tiebreak isn't a mystery, and
(d) a deterministic third sort key (ISO strings truncate to ms; swarm bots can
lock in the same ms). Max stays 10 by decision of record 2026-07-04: the
10-coin/1-chip-each "index" pick is allowed as a personality play; the tiebreak
absorbs the collisions it creates.

## Requirements

1. `validateAllocations` accepts 3..10 distinct pool symbols, integer units ≥1,
   sum exactly 10. Errors: "pick at least 3 coins" / "pick at most 10 coins".
2. PickScreen supports variable coin count: newly selected coin takes 1 chip
   (selection blocked at $0 unallocated — free a chip first); − to $0 still
   unselects; lock enabled only at ≥3 coins and $0 unallocated.
3. Room standings and the "you're #N" line show each player's lock time
   (ET, with seconds) plus a "ties go to the earliest lock" note.
4. Rank sort everywhere is `value desc, locked_at asc, player_id asc` —
   fully deterministic, exactly one placement 1.
5. Copy sweep: contract blurb, landing page, layout description, docs say
   "3–10 coins" (frozen wire vocabulary untouched).

## Implementation Notes

- `lib/picks.ts` — rules comment + `validateAllocations` length checks. No SQL
  changes; lock-time guards stay in SQL.
- `components/PickScreen.tsx` — drop the 4/3/3 seed and the `size >= 3` cap in
  `toggle()`: new coin gets `1` unit, guarded by `remaining >= 1`. Tile fade
  condition becomes `!sel && remaining === 0`. `valid` = `selected.length >= 3
  && used === TOTAL_UNITS` (10 coins × ≥1 chip self-caps at 10). Autosave gate
  mirrors server rule (≥3 entries, sum 10). Status line: "Pick N more coins" →
  "$X still on the sidelines" → "All $1,000 in — K coins, ready to lock".
- `lib/room.ts` — add `lockedAt: string | null` to `StandingRow`; pass through
  in `liveStandings` (roster already has it) and select `p.locked_at` in
  `finalBoard` (pick join already exists). Add `playerId` third sort key.
- `lib/adjudicate.ts` — add `playerId` third sort key on line 77's sort.
- `components/EventRoom.tsx` — extend `Standing` type with `lockedAt`; render
  `🔒 h:mm:ss AM ET` via `Intl.DateTimeFormat("en-US", { timeZone:
  "America/New_York", hour/minute/second })`; tiebreak note under the
  standings header.
- Copy: `app/contract/route.ts` blurb, `app/page.tsx` h2 + paragraph,
  `app/layout.tsx` description, `DESIGN-COINGAME.md` (§rules, §contract
  deltas), `CLAUDE.md` picks.ts bullet.
- No schema change, no migration — `locked_at` exists and is set by `now()` in
  the lock UPDATE.

## Do Not Change

- `lib/prices.ts` — the deterministic tape; 16:00 quote must equal settled
  `end_price`.
- `lib/token.ts`, `lib/outbox.ts` — auth + HMAC push machinery.
- `db/schema.sql`, `db/migrate-additive.mjs` — no schema change in this task.
- Frozen wire vocabulary: `roomId`, `t`, `ROOMS_SIGNING_KEY`, `X-Rooms-*`,
  `POST /api/rooms/close`, refs `d-YYYY-MM-DD`, points = cents.
- `event-close` payload shape — `{ playerId, points, placement }` unchanged.
- Avatar rule (host-rendered SVG only), chat, spine verbs.

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors
- [ ] POST /api/pick rejects 2 coins ("pick at least 3 coins") and 11 coins,
      accepts 3, 5, and 10-coin allocations summing to 10
- [ ] Pick screen: can select a 4th..10th coin while chips are free; cannot
      select a new coin at $0 unallocated; lock button live at ≥3 coins + $0 free
- [ ] Room standings show 🔒 lock times and the tiebreak note
- [ ] Two equal-value players rank by earlier lock (verify with two test tokens)
- [ ] `git diff` touches only the files listed in Implementation Notes

## Verification

1. `npm run build`
2. `git diff --stat` — scope check against Implementation Notes
3. `node scripts/mint-test-token.mjs` → lock a 5-coin and a 10-coin pick,
   confirm room renders both with lock times
