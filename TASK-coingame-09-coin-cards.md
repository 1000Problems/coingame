# TASK: Coin info pop-up cards

> Every coin gets a pop-up card — intro paragraph plus rotating "Did you know?"
> facts — opened from an ⓘ on pick tiles and from the room's "Your picks" rows.

## Context

Players (especially bot-room testers) meet coins they don't know. Research doc
(`cripto.md`, 2026-07-04) provides beginner intros + fact snippets per coin.
Cards teach without leaving the screen and give the pick decision some flavor.

## Requirements

1. **Content module** `lib/coininfo.ts`: `COIN_INFO: Record<symbol, { intro: string;
   facts: string[] }>` for the 10 pool coins, sourced from cripto.md. EXCLUDED on
   purpose: the three real-price-record facts (BNB >$1,000, DOGE ATH $0.7376,
   HYPE ATH >$70) — they contradict the deterministic fake tape shown on screen.
2. **`components/CoinCard.tsx`** (client): modal overlay. Header striped in the
   coin's brand color (dot, name, ticker) + live price (`priceLabel`) and 24h%.
   Body: intro, then one fact under "Did you know?" starting at a random index,
   "Next fact" cycles in order. Close: ×, backdrop click, Escape. No deps.
3. **PickScreen**: ⓘ button per tile (sibling of the tile's main button — never
   nested inside it), opens the card; selection behavior untouched.
4. **EventRoom**: rows in "Your picks" open the card on tap (colors + quotes are
   already in the poll payload).
5. Unknown symbol (pool rotation before content lands) → ⓘ hidden, never a crash.

## Do Not Change

Pick/lock/draft logic, steppers, minus-unselect (TASK-08), APIs, prices, DB.

## Acceptance

- [ ] tsc clean; ⓘ on every tile opens the right card with live price
- [ ] Fact cycles; card closes via ×, backdrop, and Esc
- [ ] Selecting/stepping a tile never opens the card accidentally
