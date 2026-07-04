# TASK: Game start/end countdown timer on home and event pages

> A live ticking timer on both game pages: counts down to the start gun before
> midnight ET, counts down to the 4pm finish while the ride is on, and reads
> "Ended" after.

## Context

Players currently see only a phase pill (`open`/`locked`/…) with no sense of
*when* anything happens. The pick screen has a lock countdown, but the home
event list and the event room have nothing. Decision (2026-07-04): add one
shared timer component to both pages. Game clock recap: the ride is
00:00 ET (`locks_at`, the start gun) → 16:00 ET (the finish). `settles_at`
(16:10 ET) is adjudication plumbing, NOT the finish — the timer must never
target it.

## Requirements

1. New ET helper `endsAt(eventDate)` in `lib/calendar.ts` returning the
   16:00 ET instant of the event date (via the existing `etInstant`).
2. New client component `components/GameTimer.tsx` with props
   `{ startsAt: string; endsAt: string }` (both ISO). Renders exactly one of:
   - now < startsAt → `Starts in {countdown}`
   - startsAt ≤ now < endsAt → `Ends in {countdown}`
   - now ≥ endsAt → `Ended`
   Ticks every second; countdown format matches PickScreen's lock countdown
   (`{h}h {m}m` when ≥ 1h, else `{m}m {ss}s`). Transitions between the three
   states happen live without a page reload.
3. Home (`app/page.tsx`): every event row shows the timer next to the phase
   pill, inside the existing `<Link>`.
4. Event page (`app/e/[ref]/page.tsx`): the timer renders in the shared
   `header` topbar so all screen variants (pick, sat-out, room, closed) get it.
5. Hydration-safe: first client render must not mismatch the server. Render a
   stable placeholder (empty span) until the first client tick effect runs.

## Implementation Notes

- Files touched: `lib/calendar.ts` (add `endsAt`), `components/GameTimer.tsx`
  (new, `"use client"`), `app/page.tsx`, `app/e/[ref]/page.tsx`. Nothing else.
- Pages are server components: compute `endsAt(e.event_date).toISOString()`
  server-side and pass strings down. `startsAt` is the event's `locks_at`
  (already ISO on `EventRow`).
- Follow the tick pattern in `components/PickScreen.tsx` lines 68–81
  (`useEffect` + `setInterval(tick, 1000)` + cleanup).
- Styling: a muted inline `<span className="gametimer">`. If a class is
  needed, add it to `app/globals.css`; keep it one rule.
- Do NOT store an "ended" flag anywhere — state is computed from the clock,
  same philosophy as `phaseOf`.

## Do Not Change

- `lib/prices.ts` — deterministic tape invariant (16:00 quote == settled `end_price`).
- `lib/adjudicate.ts`, `lib/outbox.ts` — settlement/close pipeline untouched.
- `lib/events.ts` `phaseOf` / wire shapes — phase semantics stay as-is; the
  timer is display-only.
- `db/*` — no schema changes.
- Frozen wire vocabulary (`roomId`, `t`, event refs, etc.).
- PickScreen's existing lock countdown — leave it; it answers a different
  question (pick deadline) than the game timer (ride start/finish).

## Acceptance Criteria

- [ ] `npm run build` passes with zero errors.
- [ ] Home: tomorrow's event shows "Starts in …", today's (before 16:00 ET)
      shows "Ends in …", a closed event shows "Ended".
- [ ] `/e/[ref]` header shows the same timer on every screen variant.
- [ ] Between 16:00 and 16:10 ET the timer already reads "Ended" even though
      phase is still `locked`/`adjudicating`.
- [ ] `git diff` shows changes only in the four files listed above (+ this
      TASK file, + optional one-rule `globals.css` addition).

## Verification

1. `npm run build`.
2. `git diff --stat` — no files outside scope.
3. `node scripts/mint-test-token.mjs`, launch locally, check both pages.
