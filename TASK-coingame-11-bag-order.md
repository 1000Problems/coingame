# TASK: Canonical bag order — largest position first, everywhere

> Render every allocation list sorted by units desc, tie → symbol asc, so any
> two players' bags compare visually left-to-right in the room.

## Context

With 3–10 coin picks (TASK-coingame-10), bags render in selection order today —
two players holding the same portfolio can show it in different sequences,
which defeats at-a-glance comparison in standings. Decision of record
2026-07-04: canonical order is **units desc, then symbol asc** (alphabetical =
the pick-grid order, since the pool query is `order by symbol`). The
"first-to-quantity keeps rank" alternative was rejected as stateful and
non-canonical.

## Requirements

1. `sortAllocations` pure helper in `lib/format.ts` (client-safe): units desc,
   `symbol.localeCompare` asc. Never mutates its input.
2. `validateAllocations` returns allocations in canonical order → DB rows and
   the spine `selection` string store sorted bags.
3. PickScreen chip bar + legend re-order live as units change.
4. EventRoom sorts at render (my split bar, "Your picks" rows, standings
   chips) — covers rows locked before this change.

## Implementation Notes

- `lib/format.ts` — generic helper:
  `sortAllocations<T extends { symbol: string; units: number }>(a: T[]): T[]`.
- `lib/picks.ts` — sort `out` before the ok-return in `validateAllocations`.
- `components/PickScreen.tsx` — derive one sorted list from the `alloc` Map
  (useMemo) and build both `segments` and the legend from it. Tile grid stays
  pool-ordered; steppers untouched.
- `components/EventRoom.tsx` — wrap the three allocation renders in
  `sortAllocations`.
- No schema change, no API shape change — `allocations` is the same JSON,
  just canonically ordered.

## Do Not Change

- Sort keys for *ranking* (value desc, locked_at, player_id) — this task is
  display order within a bag, not standings order.
- `lib/prices.ts`, `lib/adjudicate.ts`, `lib/outbox.ts`, `lib/token.ts`.
- Frozen wire vocabulary; `event-close` payload shape.
- The pick-grid tile order (`order by symbol` from the pool query).

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors
- [ ] Draft 1 BTC / 2 ETH → bar shows ETH ETH BTC; step BTC to 2 → BTC BTC
      ETH ETH (alphabetical tie); step BTC to 4 → BTC×4 ETH×2
- [ ] Standings chips render every player's bag largest-first
- [ ] A pick locked before this change still renders sorted in the room
- [ ] `git diff` touches only: lib/format.ts, lib/picks.ts,
      components/PickScreen.tsx, components/EventRoom.tsx, docs

## Verification

1. `npm run build` (or `npx tsc --noEmit` if sandboxed)
2. `git diff --stat` scope check
3. Mint a test token, draft the scenario above, watch the bar re-order
