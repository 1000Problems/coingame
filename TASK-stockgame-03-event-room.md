> **SUPERSEDED (2026-07-04)** by the coin pivot — see `DESIGN-COINGAME.md` and `TASK-coingame-06-coin-pivot.md`. Kept as the historical record of the stock build. Do not build from this doc.

# TASK: Event room — per-event chat, roster, live standings

> The social payoff for locking: each event's own room with chat, the roster of locked
> players, everyone's picks, and standings that re-rank live off the fake price feed.

## Context

Depends on TASK-stockgame-01/02. Design: `DESIGN-STOCKGAME.md`; Live Room mockup in
the design zip is the visual reference. Hard rule from Angel: **every event is fully
isolated** — its own chat log, roster, picks, board. And **nobody enters a room, sees
its chat, or sees anyone's picks until their own pick for that event is locked** (the
anti-copy mechanism). The host's landing page has its own single room chat; this
per-event chat is a different, contract-sanctioned surface (in-game chat is scoped per
`roomId`; every message goes up the spine as `chat_sent`).

## Requirements

1. `/e/[ref]` room view, per the screen matrix in DESIGN-STOCKGAME.md "Routes":
   locked player + phase `open` → pre-game room (chat, roster with host avatars, each
   locked player's allocations, countdown to `locks_at`); phase `locked`/
   `adjudicating` → live view (my 3 picks ticking with prices and %, my segmented
   $1,000 bar at current value, standings re-ranking); phase `closed` → frozen final
   board from `coingame_board` with winner highlight. Player without a locked pick:
   for `closed` events a spectator board view; for anything earlier, redirect to the
   pick screen (or "locks passed — you sat this one out" if drafts died).
2. `GET /api/room?eventRef=&after=<chatCursor>` — the single poll (~15s client
   interval). 401 no session; 403 if caller has no locked pick for that event (except
   phase `closed`). Returns: event phase, pool quotes at the current minute
   (`price()`), standings, chat tail after cursor, roster. Everything scoped
   `(room_id, event_ref)` — a Tuesday poll can never leak Monday data.
3. Standings, computed on the fly (never stored before adjudication), **locked picks
   only**: before 9:30 ET on trading day → everyone flat at $1,000.00; during/after →
   `value_cents = Σ units × 10000 × price(sym, now) / open` where `open` =
   `openPrice(sym, trading_date)`. Rank desc; tie → earlier `locked_at` ranks higher.
   Include per-player pick chips (symbols + weights) like the mockup's standings rows.
4. `POST /api/chat` — `{ eventRef, body }`. Locked players only (403 otherwise; also
   reject on `closed` events), max ~500 chars, insert into `coingame_chat` keyed
   `(room_id, event_ref)`, enqueue spine `chat_sent` (`data: { text }`) via
   `lib/outbox.ts`. No editing/deleting messages in v1.
5. Client: one polling hook driving the whole room (quotes, standings, chat) from
   `GET /api/room`; optimistic append for own chat messages; re-rank animation can be
   a simple CSS transition on row order (no animation library).

## Implementation Notes

- Roster = `select ... from coingame_pick where room_id=$1 and event_ref=$2 and
  status='locked'` joined to `coingame_player`. There is no separate membership
  table — the locked pick IS the membership.
- Avatars: `<img src="{host_origin}/api/avatar/{playerId}.svg">` from
  `coingame_instance.host_origin`. Never draw locally (contract §2).
- Chat cursor: `created_at` + id tiebreak is fine; return `nextCursor`.
- All money display from integer cents; format in one shared util.
- Keep the poll handler fast — it's the hot path; one round trip of SQL (batched
  queries with `Promise.all`) plus pure-function pricing.

## Do Not Change

- Everything under "Do Not Change" in TASK-stockgame-01.
- `POST /api/pick` / `POST /api/lock` validation and irreversibility (TASK-02).
- `lib/outbox.ts` signing/idempotency behavior — reuse `enqueue`, don't fork it.
- Lock-gating: no "read-only preview" of an open event's room for unlocked players —
  that reintroduces pick-copying, the exact thing the gate exists to prevent.

## Acceptance Criteria

- [ ] `npm run build` passes.
- [ ] Two sessions, same event: A locks, B drafts only → A sees room + chat; B's
      `GET /api/room` → 403 and B's page shows the pick screen. B locks → B enters,
      sees A's picks and messages.
- [ ] Two events: messages/roster/standings posted in `d-<T>` never appear in
      `d-<T+1>` responses (verify by SQL and by API).
- [ ] Standings re-rank when the clock minute changes (deterministic `price()` makes
      this reproducible); before 9:30 ET everyone shows $1,000.00.
- [ ] Each chat POST creates exactly one `chat_sent` outbox row, delivered signed to a
      mock spine endpoint.
- [ ] Closed event renders the frozen board for a player who never participated,
      chat input absent.

## Verification

1. `npm run build`.
2. Two-browser (or two-cookie curl) walkthrough of the A/B scenario above against a
   mock spine host.
3. `git diff` — changes only in `app/e/`, `app/api/room/`, `app/api/chat/`,
   `lib/room.ts`, and room components.
