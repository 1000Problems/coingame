# TASK: Stepper minus unselects at zero

> On the pick screen, the − stepper is the one way to drop a coin: stepping a
> selected coin down to $0 unselects it, freeing the slot for a different pick.

## Context

TASK-07 shipped with a min-1 clamp (− disabled at 1 unit), so a locked-in trio
couldn't be changed without tapping the tile — and tile-tap deselect nukes a
coin's units on an accidental tap. Product decision (2026-07-04): the minus sign
is the deselect gesture; tile tap only ever selects.

## Requirements

1. `step(sym, -1)` with 1 unit (or 0) left → remove the coin from the allocation
   entirely; − is never disabled on a selected coin. Tile main click no longer
   deselects (select-only, capped at 3).
2. Third-pick seeding respects survivors: if the two existing picks are all
   zeros (fresh flow) seed 4/3/3 as before; otherwise the new coin gets the
   freed remainder (e.g. 3/3 survivors → new coin starts at $400).
3. Footer hint mentions the gesture ("− to $0 removes a pick").
4. Draft autosave, lock confirm, server rules unchanged — a 0-unit coin can
   never reach the server because removal happens client-side at 0.

## Acceptance

- [ ] tsc clean; pick 3 → minus one to $0 → tile deselects, remaining units keep
      their values, a 4th coin can be selected and starts with the freed budget
- [ ] Tapping a selected tile does NOT deselect
