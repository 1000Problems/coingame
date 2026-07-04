# 1K Daily Coin Pick 'Em

Third-party game for the botcity/PickCity host, speaking the **Game Integration
v2** contract. Pick 3 coins, split $1,000 in $100 chips, lock in (irreversibly —
that's your seat in the room), ride midnight→4pm ET, top bag wins the daily
trophy. Crypto never closes, so neither do we: **every calendar day is an
event**, and the next 2 days always have open ones. Perpetual — no `game-close`,
ever.

Pivoted from stocks (2026-07-04): crypto exchange market data is free for
commercial use; equity display data is not. Docs of record: `DESIGN-COINGAME.md`
(design), `GAME-INTEGRATION-V2.md` (wire contract), `CLAUDE.md` (working guide),
`TASK-coingame-06-coin-pivot.md` (pivot spec). Stock-era docs are marked
superseded and kept as history.

## Run

```bash
npm install
cp .env.local.example .env.local   # fill in DATABASE_URL (+ a dev ROOMS_SIGNING_KEY)
node db/migrate-additive.mjs       # SAFE: idempotent, coingame_* only, self-guarding
node db/seed.mjs                   # ~30-coin pool
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

`lib/prices.ts` is a pure deterministic 24/7 tape — same symbol/date/minute →
same price everywhere, no feed, no cron, reproducible adjudication. Daily marks
anchor at 16:00 ET; start prices snapshot at the 00:00 lock. Swapping in a real
feed later touches only the quote read and the settle write — use exchange
public APIs (Kraken/Binance/Coinbase; free, keyless), **not** CoinGecko's
personal-use free tier. Everything downstream reads settled prices from
`coingame_event_pool`.

## Sweeper (no Vercel cron)

Settlement is lazy-first — any read (including botcity's own `/events` polls)
adjudicates whatever is due. The only backstop is `GET /api/sweep`
(unauthenticated, idempotent, claim-guarded), pinged once a day by a **Cowork
scheduled task** after deploy. Zero env vars involved.

## Connect to botcity

1. Deploy (Vercel) with `DATABASE_URL`.
2. `curl -i <url>/contract` and `curl -i <url>/events` → both must be
   `application/json`; `/events` shows 2 open events.
3. Paste the URL on botcity `/developer` → Connect game → copy the signing key
   → set `ROOMS_SIGNING_KEY` in Vercel → **redeploy** (env vars don't apply to
   existing deployments).
4. Walk TASK-stockgame-05 (superseded but the verification loop still applies)
   for the full-loop checklist.
