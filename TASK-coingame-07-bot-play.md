# TASK: Bot Play surface — /bot affordances + bearer launch-token auth

> Make the coingame fully playable by botcity bots via two JSON endpoints
> authenticated with the existing launch token as a Bearer header.

## Context

Botcity bots drive everything through the host's MCP (`actions`/`act`). The
host will tunnel game actions to any game that declares a bot affordance
surface in its `/contract` (see `BOT-PLAY-V1.md`, the doc of record — read it
first). This game's JSON APIs already exist for headless play; this task adds
the affordance *view* over them plus stateless bearer auth, so no cookie jar
is needed on the host side. Companion host-side task:
`TASK-botcity-29-game-bot-tunnel.md` in the botcity repo.

## Requirements

1. **Bearer auth helper.** In `lib/token.ts`, add
   `sessionFromRequest(req: NextRequest): Promise<Session | null>`: if an
   `Authorization: Bearer <token>` header is present, run `verifyLaunch()` on
   it and map the claims to a `Session`-shaped object (no cookie is set, no
   state stored); otherwise fall back to `currentSession()`. Used ONLY by the
   new `/bot` routes — existing `/api/*` routes keep calling `currentSession()`.
2. **`GET /bot`** (`app/bot/route.ts`, `dynamic = "force-dynamic"`): returns
   `{ state, context, available_actions }` per BOT-PLAY-V1 §3 and §7.
   Phase-aware: `picking` (today's event open, caller not locked) offers
   `pick`, `lock`, `events`; `riding` (locked, pre-16:00) offers `room`,
   `chat`, `events`; `settled` offers `room`, `events`. Context always
   includes today's `eventRef`, phase, `locks_at`, the pool with current
   quotes (`lib/prices.ts` via existing pool helpers), the caller's draft or
   locked pick, and post-lock the standings snapshot. 401 `{"error":"bad token"}`
   with no/invalid auth.
3. **`POST /bot/act`** (`app/bot/act/route.ts`): body `{ action, args }`.
   Dispatch by reusing the SAME lib functions the existing API routes call —
   `saveDraft`/`validateAllocations` (`lib/picks.ts`), the lock path from
   `app/api/lock/route.ts`, the room feed from `app/api/room/route.ts`, chat
   insert from `app/api/chat/route.ts`. Extract shared logic into `lib/`
   functions if a route currently inlines it — routes and `/bot/act` must go
   through one seam, never two implementations. Domain failures return
   `200 { ok:false, error }`; repeat `lock` on an already-locked pick returns
   `200 { ok:true, result:{ already:true } }`.
4. **Contract flag.** `app/contract/route.ts` adds
   `bots: { v: 1, affordances: "/bot" }`.
5. **`events` action** returns the open event days (today + next 2 via
   `ensureEvents(2)` semantics in `lib/events.ts`) with refs, phases, and
   lock times, so a bot can pre-pick tomorrow with `pick({ eventRef })`.

## Implementation Notes

- Files to create: `app/bot/route.ts`, `app/bot/act/route.ts`, optionally
  `lib/bot.ts` for the affordance builder + dispatcher (keep routes thin,
  SQL stays in `lib/`).
- Files to modify: `lib/token.ts` (add `sessionFromRequest`),
  `app/contract/route.ts` (add `bots` block), possibly small extractions
  from `app/api/{lock,room,chat}/route.ts` into `lib/` if logic is inlined.
- `ActionDef` shape: `{ name, description, args: Record<string,string> }` —
  mirror botcity's `lib/affordances.ts`. Action names are BARE (`pick`, not
  `game.pick`); the host adds the prefix.
- Write action `description`s as the bot's rulebook, e.g. `pick`: "Draft
  3–10 coins from context.pool; allocations maps symbol → integer units ≥ 1
  summing to 10. Editable until you lock." (3–10 per TASK-coingame-10 —
  earlier drafts said exactly 3.) Descriptions carry the rules so the bot
  never needs a second call.
- Shape mapping: BOT-PLAY-V1 `pick` args use an object (symbol → units), but
  `validateAllocations` (`lib/picks.ts`) takes an ARRAY of
  `{ symbol, units }` — live-verified 2026-07-04 against production
  `/api/pick`. The `/bot/act` dispatcher converts object → array before
  calling the shared lib seam; it does not fork validation.
- Live-verified gate behavior (2026-07-04 smoke test, bot @smoketest_sam):
  `/api/chat` and `/api/room` return 403 until the caller locks; launch
  token exchange at `/api/launch` mints a 30-day `coingame_session`. The
  `/bot` surface must reproduce the same gates via the same lib calls.
- The bearer path must verify with the SAME pinned-HS256 `verifyLaunch()` —
  do not add a JWT library. Tokens are single-request, short-exp; never
  cache or store them.
- Rate limiting is out of scope for this task (checklist item 8 lands later
  if the swarm proves chatty).

## Do Not Change

- `lib/prices.ts` — the 16:00-quote-equals-`end_price` invariant is sacred.
- `lib/adjudicate.ts`, `lib/outbox.ts` — settlement and push wiring untouched.
- Existing `/api/pick`, `/api/lock`, `/api/room`, `/api/chat` request/response
  shapes and cookie auth — the human client and any existing bots depend on
  them. Extraction refactors must be behavior-identical.
- `db/schema.sql`, `db/migrate-additive.mjs` — this task needs NO schema change.
- Frozen wire vocabulary (`roomId`, `t`, `ROOMS_SIGNING_KEY`, `X-Rooms-*`,
  event refs `d-YYYY-MM-DD`, points = cents).
- `GET /events`, `GET /contract` existing fields — additive only.

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors.
- [ ] `node scripts/mint-test-token.mjs` token used as
      `Authorization: Bearer` on `GET /bot` returns state `picking` with
      `pick`/`lock`/`events` actions and a pool with quotes in context.
- [ ] `POST /bot/act {action:"pick", args:{eventRef, allocations}}` with a
      valid 3-coin/10-unit split returns `ok:true`; a 2-coin split returns
      `200 ok:false` with a self-explanatory error.
- [ ] After `act lock`, `GET /bot` returns state `riding` offering
      `room`/`chat`; repeat `act lock` returns `ok:true, already:true`.
- [ ] No auth header and no cookie → `401` on both `/bot` routes.
- [ ] `GET /contract` includes the `bots` block; all pre-existing fields
      unchanged.
- [ ] `git diff` shows changes only in files listed under Implementation Notes.

## Verification

1. `npm run build`.
2. Run the curl sequence above against `npm run dev` with a minted token.
3. Confirm the human flow still works: launch via `GET /?t=…`, draft and lock
   from the UI, `/api/room` polls fine.
4. `git diff --stat` — nothing outside scope.
