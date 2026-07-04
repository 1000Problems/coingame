# TASK: 1c Split Bar pick screen + per-coin colors + pool of 10

> Rebuild the pick screen to the design-handoff 1c "Split Bar" spec, introduce one
> fixed brand color per coin used on every screen, and shrink the pool to 10 coins.

## Context

The design zip (`design_handoff_pick_screen_1c/README.md`) is the high-fidelity spec
for the pick screen: a 10-segment $1,000 chip bar, 2-col tile grid with steppers, and
a footer status line. Product decision on colors (2026-07-04): **per-coin fixed brand
colors, not slot colors** — with a pool of 10, chips read at a glance ("5 BTC bars,
3 HBAR, 2 ETH"). The mockup's slot-color scheme and its deselect-remap complexity die.

## Requirements

1. **Palette + pool of 10.** `coingame_coin` gains `color text` (two-places rule).
   Seed becomes exactly: BTC #F7931A, ETH #627EEA, BNB #F0B90B, XRP #00AAE4,
   SOL #9945FF, TRX #EB0029, HYPE #2EBFA5, DOGE #C2A633, LINK #2A5ADA, HBAR #3B3F46.
   (Top 10 by mcap minus LEO — dead pick — and ZEC — third yellow; LINK and HBAR in.)
   Chip text color = computed light/dark by background luminance (`lib/colors.ts`).
2. **Data plumbing.** `poolFor` joins `coingame_coin` and returns `color` (fallback
   `#8b909c` for a symbol missing a row). `/api/room` payload gains
   `colors: Record<symbol, hex>`. `/e/[ref]` passes colors into both components.
3. **PickScreen → 1c.** Header strip (brand · "date · pool of N" · live countdown
   "Locks 12:00 AM ET · 6h 24m"), the segmented bar (`repeat(10,1fr)`, 34px chips,
   radius 6, gap 3; empty = "$100" faint, filled = ticker on coin color, fill order =
   selection order), legend row ("BTC $500" per pick), 2-col tile grid (color dot,
   ticker, 24h %, live price via `priceLabel`; selected = coin-color border +
   stepper; unselected fades to .45 when 3 picked), footer status line ("Pick 2 more
   coins" / "$400 still on the sidelines" / "All $1,000 allocated — ready to lock")
   + Lock button, `window.confirm` before the irreversible lock. KEEP: draft
   autosave, 4/3/3 seed on third pick, min-1-per-coin clamp (steppers stop at 1 —
   stricter than the mockup's 0, matches server validation).
4. **EventRoom colors.** My-bar segments and standings mini-bars use per-coin colors
   (replace `.seg.s0/s1/s2` slot classes); standings chips tinted per coin.
5. **Docs.** DESIGN-COINGAME.md pool/color section; README + CLAUDE.md pool count.

## Do Not Change

- APIs' shapes beyond ADDING `colors`; pick/lock/draft rules; wire contract; prices
  engine; adjudication; chat; `lib/token.ts`, `lib/outbox.ts`, `lib/db.ts`.
- ANCHORS in `lib/prices.ts` keeps all 20 entries (inactive coins may return).

## Acceptance Criteria

- [ ] `tsc --noEmit` clean; live DB rebuilt: 10 coins, each with color
- [ ] Segmented bar renders 5/3/2 as three contiguous color runs with ticker labels
- [ ] Lock requires confirm; drafts still autosave; min 1 unit per selected coin
- [ ] Same coin = same color on pick screen and event room
