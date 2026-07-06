# TASK: Keep the room alive after close — post-adjudication chat / gloat

> Once an event closes, the winner should be able to sit in the room, see the final board, and talk trash. Today the room goes silent the moment `closed` flips: the chat composer disappears client-side and the chat API hard-rejects any post to a closed event.

## Context

Reported 2026-07-05 by the CEO: the daily cron adjudicated correctly, but "I am not able to enter the room any more." Entry to *view* the closed board actually works — a locked player passes both gates in `app/e/[ref]/page.tsx` and `roomView` (closed events are spectator-visible) and lands on the frozen board with the podium, 🏆 winner highlight, and their placement. What's dead is the room's **social layer**, and it dies in two places:

- `components/EventRoom.tsx` (~line 316) gates the whole chat card on `data.me.locked && !data.closed` — the composer and message list vanish the instant the board freezes.
- `app/api/chat/route.ts` (line 24) returns `409 "event is closed"` for any post to a closed event, so even if the UI showed the box, the server would refuse the message.

Design decision (CEO-approved, 2026-07-04 thread → confirmed 2026-07-05): the room is a place, not a countdown. When the ride ends, the winner earned the right to gloat and everyone else earned the right to congratulate or complain. Post-close chat stays open **for locked players**, scoped per `(room_id, event_ref)` exactly like live chat. No time-based expiry — the event naturally falls out of the home list after the 7-closed window, and the room quiets on its own as players move to the new day.

`lib/room.ts` already returns closed-event chat for locked callers (`chat = locked ? chatTail(...) : []`) with a working `after` cursor, and the 15s poll keeps running after close (the interval is never cleared on phase change). So gloat messages already stream in — the only thing missing is the ability to *send* one and a box to type it in. No API-shape or schema change.

## Requirements

1. **Un-gate the chat card on closed events (locked players only).** In `components/EventRoom.tsx`, the chat card renders when `data.me.locked` — drop the `&& !data.closed`. Spectators (not locked) still get no composer, closed or not.
2. **Allow posting to a closed event.** In `app/api/chat/route.ts`, remove the `phaseOf(event) === "closed"` → 409 rejection. The `locked` gate (403 for non-lockers) stays; that is the only membership check chat needs.
3. **Closed-room affordance.** When `data.closed`, the chat card reads as a gloat zone: header `Room chat` → keep, and the composer placeholder changes from `Say something…` to `Gloat, congratulate, commiserate…`. Purely cosmetic, no logic branch beyond the existing `data.closed`.

## Implementation Notes

- **Files to modify:** `components/EventRoom.tsx`, `app/api/chat/route.ts`. Two files, nothing else.
- `EventRoom.tsx`: the only logic change is the render condition `data.me.locked && !data.closed` → `data.me.locked`. The placeholder is a one-line ternary on `data.closed`. Polling, cursor, `seen` de-dupe, and `send()` are already phase-agnostic — leave them.
- `app/api/chat/route.ts`: delete line 24 (the closed 409) and update the top comment to note chat stays open post-close for locked players. Keep the `getEvent` 404 and the `hasLockedPick` 403.
- `postChat` still enqueues a `chat_sent` spine event after close. That's intended — the host sees the room is still lively. `flushOutbox` is fire-and-forget with a catch, so a host that ignores post-close spine can't break the send.
- No CSS needed; the chat card styles already exist and are phase-independent.

## Do Not Change

- `lib/room.ts` — closed branch already returns chat + cursor for locked callers; no payload change. Do not touch the 403 spectator gate (`!locked && phase !== "closed"`).
- `lib/adjudicate.ts`, `lib/events.ts`, `lib/picks.ts`, `lib/feed.ts`, `lib/prices.ts` — settlement/price engine is off limits.
- `db/*` — no schema work.
- The closed-board rendering (podium, winner highlight, `.winner`/`.first` styling) — already correct, leave it.
- Frozen wire vocabulary and the spine/outbox contract. `ChatMsg` shape stays frozen.
- The `locked`-only chat membership rule — do NOT open chat to spectators.

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors
- [ ] On a **closed** event, a locked player sees the chat message list AND the composer, and can send a message that appears within one poll
- [ ] `POST /api/chat` to a closed event from a locked player returns `{ ok: true }` (was `409`)
- [ ] A non-locked spectator on a closed event still sees the board but no composer, and `POST /api/chat` still returns `403`
- [ ] The composer placeholder reads `Gloat, congratulate, commiserate…` on a closed event, `Say something…` otherwise
- [ ] `git diff` shows changes ONLY in `components/EventRoom.tsx` and `app/api/chat/route.ts`

## Verification

1. `npm run build`
2. `git diff --stat` — exactly two files
3. `node scripts/mint-test-token.mjs` → launch locally with `PRICE_FEED=tape`, lock a pick on a past/closeable event, drive it to `closed` (or point at an already-closed event), and confirm: board renders, composer present, message posts and streams back, placeholder copy is the gloat variant
4. Repeat as a non-locked session on the same closed event → board visible, no composer, chat POST 403
