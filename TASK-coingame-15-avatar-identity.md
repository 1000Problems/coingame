# TASK: Avatar identity system — rings, bigger avatars, chat faces, podium

> Make the host-rendered avatars the visual identity of the room: coin-color rings, 40px standings avatars, a hero avatar on the my-bag card, avatars + names in chat, and a top-3 podium on the closed board.

## Context

Avatars currently appear in exactly one place — 28px circles in standings rows — and chat is a bare name + bubble. The avatars are beautiful host-rendered SVGs (contract §2) and we're wasting them. Design decision (2026-07-04, CEO-approved): one identity system used identically everywhere, whose signature is a ring around every avatar in the brand color of that player's **biggest holding** — your identity wears your bet. Coin colors are already fixed per coin (`coingame_coin.color`) and identical on every screen, so the ring is instantly legible. Zero API or schema changes: every surface that needs an avatar already has (or can derive) the data from the existing `/api/room` poll payload.

## Requirements

1. **Identity ring.** Every avatar rendered in `components/EventRoom.tsx` gets a 2–3px ring in the color of that player's largest allocation. Largest = first element of `sortAllocations(allocations)` (canonical order from `lib/format.ts` — it already breaks ties). Color via the existing `colorOf(symbol)` map. No allocations available → ring in `var(--line)`. On the **closed** board, placement 1's ring is `var(--gold)` instead.
2. **Standings rows.** Avatar 28px → 40px (`width`/`height` attrs AND `.avatar` CSS). Winner row on closed board: 48px. `alt=""` → `alt={s.displayName}` (and empty-string fallback span keeps `aria-hidden`). Row spacing may grow a few px to fit; keep the existing flex row structure.
3. **Hero avatar on the my-bag card.** The top card (the one with the splitbar and `dollars(mine.valueCents)`) shows the caller's own avatar at 52px with its ring, left of the value/placement line. Data comes from `mine` (already a `Standing` with `avatarUrl` + `allocations`).
4. **Chat avatars + names + grouping.** Each chat message run renders a 30px ringed avatar + display name + current placement (e.g. `moonkid · #3`). Consecutive messages from the same `playerId` within 3 minutes group under one avatar/name header (subsequent bubbles only). Avatar/ring/placement come from a client-side `Map<playerId, Standing>` built from `data.standings` each poll — **no change to the chat API or `ChatMsg` shape**. A chatter missing from the map (shouldn't happen — chat is lock-gated) falls back to placeholder avatar, no rank.
5. **Podium header on the closed board.** When `data.closed`, above the final-board rows render the top 3 as large avatars: #1 centered at 64px, gold ring, 🏆 badge; #2 and #3 flanking at 52px with their coin rings; name + final `dollars()` under each. Fewer than 3 players → render however many exist, #1 always centered. Rows below keep showing everyone including the top 3.

## Implementation Notes

- **Files to modify:** `components/EventRoom.tsx`, `app/globals.css`. Optionally extract a small `components/Avatar.tsx` (`{ url, name, size, ring }`) since the same img-or-placeholder-span pattern now appears in four places — recommended, keeps the eslint-disable comment for `no-img-element` in one spot.
- Ring implementation: `border: 2.5px solid <ring>` on the img/span (border-radius 50% already). Don't use box-shadow (streams badly, and the row hover/me gradient sits behind it).
- Ring color helper inside EventRoom:
  ```ts
  const ringOf = (allocs: Alloc[]) =>
    allocs.length ? colorOf(sortAllocations(allocs)[0].symbol) : "var(--line)";
  ```
- Chat grouping: compare `m.playerId` to previous message's, and `new Date(m.createdAt) - new Date(prev.createdAt) < 3 * 60_000`.
- The avatar URL is **always embedded, never drawn locally** (contract §2). Keep the `// eslint-disable-next-line @next/next/no-img-element` comment on the `<img>`.
- CSS: add `.avatar-lg`, `.msg .avatar`, `.podium` styles in `app/globals.css` next to the existing `.avatar` rule (line ~104). Follow the existing flat/calm style — no shadows, no gradients beyond what's there.
- Podium markup goes inside the existing "Final board" card, between the `<h2>` and `.rows`.

## Do Not Change

- `lib/room.ts` — no API or payload changes; chat avatars are a client-side join. `ChatMsg` shape is frozen.
- `lib/db.ts`, `db/schema.sql`, `db/migrate-additive.mjs` — no schema work in this task.
- `lib/feed.ts`, `lib/prices.ts`, `lib/adjudicate.ts`, `lib/events.ts`, `lib/picks.ts` — price/settlement engine is off limits.
- The pick screen (`.pickcard` markup and all `pick*`/`cointile`/`chipbar` CSS) — deliberately avatar-free, don't touch.
- `components/CoinCard.tsx`, `lib/coininfo.ts` — unrelated.
- Frozen wire vocabulary (`roomId`, `t`, `X-Rooms-*`, event refs `d-YYYY-MM-DD`) and the avatar contract rule (embed host URL, never render locally).
- Existing standings sort/tiebreak logic and the 15s poll cadence in `EventRoom.tsx`.

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors
- [ ] Standings avatars render at 40px with a ring matching each player's largest-allocation coin color; `(you)` row and winner behave as specified
- [ ] My-bag card shows the caller's 52px ringed avatar
- [ ] Chat messages show 30px ringed avatar + name + placement; consecutive same-player messages within 3 min share one header
- [ ] Closed event shows the top-3 podium (#1 gold ring, 64px, centered) above the full board
- [ ] All `<img>` avatars have `alt={displayName}`
- [ ] `git diff` shows changes ONLY in `components/EventRoom.tsx`, `app/globals.css`, and (if extracted) `components/Avatar.tsx`

## Verification

1. `npm run build`
2. `git diff --stat` — no files outside the three listed above
3. `node scripts/mint-test-token.mjs` → launch locally with `PRICE_FEED=tape`, lock a pick, verify open-phase room (hero avatar, standings, chat) and a closed event's podium + final board
4. Toggle a player with no avatar_url (placeholder span) — ring and layout must still hold
