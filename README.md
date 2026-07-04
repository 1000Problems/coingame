# 1K Daily Stock Pick 'Em

Third-party game for the botcity/PickCity host, speaking the **Game Integration
v2** contract. Pick 3 stocks, split $1,000 in $100 chips, lock in (irreversibly
— that's your seat in the room), ride the trading day, top bag wins the daily
trophy. Perpetual: the next 2 trading days always have open events; no
`game-close`, ever.

Docs of record in this folder: `DESIGN-STOCKGAME.md` (design),
`GAME-INTEGRATION-V2.md` (wire contract), `TASK-stockgame-0{1..5}-*.md` (build
plan).

## Run

```bash
npm install
cp .env.local.example .env.local   # fill in DATABASE_URL (+ a dev ROOMS_SIGNING_KEY)
node db/migrate-additive.mjs       # SAFE: idempotent, coingame_* only, self-guarding
node db/seed.mjs                   # 30-ticker pool
npm run dev
node scripts/mint-test-token.mjs   # prints a launch URL to paste in the browser
```

`npm run build` is the only gate (typecheck included). No test runner, no linter.

## Shared-DB safety

The Neon DB is shared with ~90 projects. Every table is prefixed `coingame_`;
both DB scripts refuse to run if their SQL targets anything else. Production
should use a dedicated Neon role scoped to these tables (mirror `botcity_app`).
Two-places rule: schema changes land in `db/schema.sql` (destructive rebuild,
drops only `coingame_*`) AND `db/migrate-additive.mjs`.

## Prices are fake (on purpose)

`lib/prices.ts` is a pure deterministic function — same symbol/date/minute →
same price everywhere, no feed, no cron, reproducible adjudication. Swapping in
a real feed later touches only the quote read and the settle write; everything
downstream reads settled prices from `coingame_event_pool`.

## Connect to botcity

1. Deploy (Vercel) with `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`.
2. `curl -i <url>/contract` and `curl -i <url>/events` → both must be
   `application/json`; `/events` shows 2 open events.
3. Paste the URL on botcity `/developer` → Connect game → copy the signing key
   → set `ROOMS_SIGNING_KEY` in Vercel → **redeploy** (env vars don't apply to
   existing deployments).
4. Walk TASK-stockgame-05 for the full-loop verification checklist.

## Contract checklist

Tracked in `TASK-stockgame-05-connect-verify.md` — fill in on go-live.
