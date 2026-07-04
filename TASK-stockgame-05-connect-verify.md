> **SUPERSEDED (2026-07-04)** by the coin pivot — see `DESIGN-COINGAME.md` and `TASK-coingame-06-coin-pivot.md`. Kept as the historical record of the stock build. Do not build from this doc.

# TASK: Deploy, connect to botcity, full-loop verification

> Ship stockgame to Vercel, connect it on botcity's `/developer`, and prove the whole
> loop: two events visible → pick → lock → room → close → trophy on the host.

## Context

Depends on TASK-stockgame-01..04 all merged and building. This task is mostly ops +
verification; the only code allowed is small fixes surfaced by the checklist. The
botcity host is the authority on what "connected" looks like: paste the deployed URL
on `/developer`, the tile name comes from `/contract`, and the per-source signing key
shown there becomes our `ROOMS_SIGNING_KEY`.

## Requirements

1. Provision: dedicated Neon role/schema for stockgame on the shared DB (mirror the
   botcity_app pattern — zero privileges on other projects' tables), run
   `db/migrate-additive.mjs` + seed. Document the role setup in `README.md`.
2. Deploy to Vercel with `DATABASE_URL`, `NEXT_PUBLIC_APP_URL` set. Run the contract
   pre-flight from GAME-INTEGRATION-V2.md: `curl -i <url>/contract` and
   `curl -i <url>/events` both return `application/json` (not HTML), `/events` shows
   exactly 2 open events for the next 2 trading days.
3. Connect on botcity `/developer` (paste URL → Connect game), copy the issued signing
   key into Vercel as `ROOMS_SIGNING_KEY`, **redeploy** (env vars don't apply to
   existing deployments — the classic failure), confirm the tile shows "1K Daily" (a
   bare URL as the name = contract read failed).
4. Full-loop smoke test as a real botcity user: launch from the host landing page into
   tomorrow's event (deep-link honored, `?t=` stripped, avatar rendering from host),
   draft → lock → room chat message (verify `chat_sent` arrives host-side via spine),
   second event stays isolated. Then time-compress a test event (short `locks_at`/
   `settles_at` on a staging event row) to force adjudication and confirm the board
   and daily trophy appear on the host landing page.
5. Run the pre-launch checklist at the bottom of `GAME-INTEGRATION-V2.md` line by
   line; record each item pass/fail in `README.md` under "Contract checklist", with
   fixes applied for any failure.

## Implementation Notes

- Use `scripts/mint-test-token.mjs` only for local pre-checks; the real verification
  must go through an actual botcity launch (the host is what mints real tokens).
- If the tile shows the hostname instead of "1K Daily": `/contract` is being swallowed
  by a catch-all or returning HTML — fix the route, not the host.
- If launches land as guest: `ROOMS_SIGNING_KEY` mismatch/whitespace or deploy
  predates the env var (contract "check this first" list).
- Bot smoke test (optional if the swarm MCP is available): spawn a small swarm on the
  host, have bots launch in with tokens and hit `POST /api/pick` + `/api/lock` as
  JSON — this is exactly why those routes are JSON, not server actions.

## Do Not Change

- Everything under "Do Not Change" in TASK-stockgame-01.
- No schema changes in this task beyond the role/permissions provisioning.
- No changes to the botcity host to "make it work" — if the host seems wrong, stop
  and report; the contract doc wins.

## Acceptance Criteria

- [ ] `/contract` + `/events` curls pass against the production URL.
- [ ] botcity tile shows "1K Daily" with two open events on the landing page.
- [ ] A real host launch lands signed-in on the right event's pick screen, token
      stripped.
- [ ] Lock → room → chat works end-to-end; spine rows visible host-side.
- [ ] Forced adjudication produces an `event-close` the host accepts (board + trophy
      visible on the landing page).
- [ ] README contains the completed contract checklist with every item checked.

## Verification

1. Production curls + host walkthrough per requirements 2–4.
2. Vercel logs clean of unhandled errors during the walkthrough.
3. `git diff` — only `README.md` and genuine fix-ups; any fix touching contract
   surfaces re-runs the relevant TASK's acceptance criteria.
