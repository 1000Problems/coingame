# TASK: Pick screen — draft, allocate, irreversible lock

> The allocation screen (merge of mockups 1a Gallery + 1c Split Bar): pick 3 stocks,
> split $1,000 in $100 units, save as private draft, then Lock it in — irreversibly —
> which admits the player to the event room and fires the `picked` spine event.

## Context

Depends on TASK-stockgame-01 (scaffold, session, events engine). Design of record:
`DESIGN-STOCKGAME.md`; wire contract: `GAME-INTEGRATION-V2.md` (§4 Spine). Core
gameplay rule decided with Angel: **drafts are private and editable; the explicit lock
is the real commitment** — it's the only way into the event's chat/roster, because
seeing others' picks while still editable would allow copying. Midnight ET
(`locks_at`) is merely the deadline; drafts still unlocked then are dead.

## Requirements

1. `/e/[ref]` pick screen (shown when `phaseOf(event)==='open'` and the session player
   has no **locked** pick): pool tiles (ticker, name, live `price()` quote, after-hours
   drift), select exactly 3, allocate via a single segmented $1,000 bar with +/−
   steppers per selected stock ($100 units, min 1 unit per selected stock, total
   exactly 10). Visual tone: 1a Gallery calm; allocation metaphor: 1c Split Bar. Show
   remaining-unallocated state and disable Lock until valid. Avatars anywhere a player
   appears use `{host_origin}/api/avatar/{playerId}.svg` — never render avatars
   locally.
2. `POST /api/pick` — `{ eventRef, allocations: [{symbol, units}] }`. Session required
   (401 otherwise). Server-side validation, all returning 4xx JSON errors: event
   exists and `phaseOf==='open'`; exactly 3 distinct symbols, all in
   `coingame_event_pool` for that event; integer units ≥ 1 summing to 10; existing
   pick not `status='locked'`. Upserts the draft (`status='draft'`). No spine event
   for drafts.
3. `POST /api/lock` — `{ eventRef }`. Requires an existing valid draft, `phaseOf===
   'open'`. Sets `status='locked'`, `locked_at=now()` — **no code path may ever revert
   or edit a locked pick**. Enqueues one spine event to the outbox: verb `picked`,
   `data.selection` human-readable (e.g. `"NVDA $400 · AAPL $300 · TSLA $300"`) plus
   structured `data.allocations`. Responds with a redirect target of the event room.
4. `lib/outbox.ts` — `enqueue(kind, roomId, payload)` inserts into `coingame_outbox`;
   `flush()` picks due rows (`delivered_at is null and next_try_at <= now()`), signs
   the **raw body bytes** with hex HMAC-SHA256(`ROOMS_SIGNING_KEY`) in
   `X-Rooms-Signature`, POSTs to `{host_origin}/api/rooms/spine` (or `/api/rooms/close`
   for kind `close`), marks delivered on 2xx, else exponential backoff via `attempts`
   and `next_try_at`. Spine bodies follow contract §4 exactly: `{ roomId, events: [{
   id: <uuid>, playerId, ref, ts, verb, data }] }` — the row's `id` is the idempotency
   key, generated once at enqueue. Call `flush()` fire-and-forget after enqueue.
5. Post-lock state: pick screen becomes read-only confirmation ("✓ Locked for <date>")
   linking into the event room view (placeholder until TASK-03). A player landing on
   `/e/[ref]` with a locked pick goes straight to that view.

## Implementation Notes

- Client can be a client component polling `GET /api/room` later; for this task a
  lightweight fetch of quotes on load + 30s refresh is enough.
- Draft UX: save on every valid change (debounced) so a player can leave and return;
  no explicit save button.
- Reject-after-lock is enforced in SQL, not just app logic:
  `update ... where status='draft'` / insert guarded by `locks_at > now()` comparisons
  in the query itself, so a stale UI can't slip a write through.
- `data.selection` convention comes from contract §4 ("human-readable"); keep the
  structured allocations alongside.
- Money math in integer cents everywhere. No floats in stored values.

## Do Not Change

- Everything under "Do Not Change" in TASK-stockgame-01 (frozen wire names, botcity
  repo, non-`coingame_` tables, reference docs).
- `lib/token.ts` verification logic and session cookie shape (TASK-01).
- `lib/events.ts` `ensureEvents` / `phaseOf` semantics.
- Spine verbs: only `picked` (and later `chat_sent`) — never invent new verbs or
  repurpose existing ones (contract rule).

## Acceptance Criteria

- [ ] `npm run build` passes.
- [ ] Draft flow: save 3 picks summing to 10 units → reload page → draft restored.
      Invalid payloads (2 symbols, 11 units, symbol outside pool, units 0) all 4xx.
- [ ] `POST /api/lock` flips status; any subsequent `POST /api/pick` for that event
      returns 4xx. No API or UI path un-locks.
- [ ] Locking inserts exactly one `coingame_outbox` row, kind `spine`, verb `picked`,
      with a stable uuid `id`; running `flush()` twice against a mock host delivers
      once (verify idempotency key reuse, not duplicate ids).
- [ ] After `locks_at` (simulate by editing the event row), both `/api/pick` and
      `/api/lock` return 4xx regardless of prior state.
- [ ] Signature check: recompute HMAC of the exact bytes sent to the mock host and
      match the `X-Rooms-Signature` header.

## Verification

1. `npm run build`.
2. Exercise the flow with a `scripts/mint-test-token.mjs` launch against `npm run dev`
   and a local mock spine endpoint (tiny node script asserting the signature).
3. `git diff` — changes only in `app/e/`, `app/api/pick/`, `app/api/lock/`,
   `lib/outbox.ts`, `lib/picks.ts`, and components created for the pick screen.
