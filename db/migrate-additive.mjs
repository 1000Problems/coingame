// SAFE additive migration for the SHARED Neon DB. Idempotent: CREATE IF NOT
// EXISTS / ADD COLUMN IF NOT EXISTS only. Never drops, never touches any table
// outside the stockgame_ prefix — and refuses to run if it would (see guard).
//
// Usage: node db/migrate-additive.mjs   (DATABASE_URL from env or .env.local)

import { readFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^DATABASE_URL=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DATABASE_URL not set (env or .env.local)");
}

const statements = [
  `create table if not exists stockgame_ticker (
     symbol text primary key,
     name   text not null,
     sector text,
     active boolean not null default true
   )`,
  `create table if not exists stockgame_event (
     ref          text primary key,
     trading_date date not null unique,
     locks_at     timestamptz not null,
     settles_at   timestamptz not null,
     trophy_label text not null,
     closed_at    timestamptz,
     claim_at     timestamptz,
     created_at   timestamptz not null default now()
   )`,
  `create table if not exists stockgame_event_pool (
     event_ref   text not null references stockgame_event(ref) on delete cascade,
     symbol      text not null,
     prev_close  numeric(12,4),
     open_price  numeric(12,4),
     close_price numeric(12,4),
     primary key (event_ref, symbol)
   )`,
  `create table if not exists stockgame_instance (
     room_id       text primary key,
     host_origin   text not null,
     return_url    text not null,
     first_seen_at timestamptz not null default now()
   )`,
  `create table if not exists stockgame_player (
     player_id    text primary key,
     display_name text not null,
     avatar_url   text,
     last_seen_at timestamptz
   )`,
  `create table if not exists stockgame_pick (
     room_id     text not null references stockgame_instance(room_id) on delete cascade,
     event_ref   text not null references stockgame_event(ref) on delete cascade,
     player_id   text not null references stockgame_player(player_id) on delete cascade,
     allocations jsonb not null,
     status      text not null default 'draft',
     locked_at   timestamptz,
     updated_at  timestamptz not null default now(),
     primary key (room_id, event_ref, player_id)
   )`,
  `create index if not exists stockgame_pick_event_idx on stockgame_pick (event_ref, status)`,
  `create table if not exists stockgame_board (
     room_id     text not null,
     event_ref   text not null,
     player_id   text not null,
     final_cents bigint not null,
     placement   int not null,
     primary key (room_id, event_ref, player_id)
   )`,
  `create table if not exists stockgame_chat (
     id         uuid primary key default gen_random_uuid(),
     room_id    text not null,
     event_ref  text not null,
     player_id  text not null,
     body       text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists stockgame_chat_room_idx on stockgame_chat (room_id, event_ref, created_at)`,
  `create table if not exists stockgame_outbox (
     id           uuid primary key default gen_random_uuid(),
     kind         text not null,
     room_id      text not null,
     payload      jsonb not null,
     attempts     int not null default 0,
     next_try_at  timestamptz not null default now(),
     delivered_at timestamptz,
     created_at   timestamptz not null default now()
   )`,
  `create index if not exists stockgame_outbox_due_idx on stockgame_outbox (next_try_at) where delivered_at is null`,
];

// ---- PREFIX GUARD ---------------------------------------------------------
// The DB is shared with ~90 other projects. Abort loudly if any statement
// targets an object that isn't stockgame_-prefixed. This scans DDL targets and
// foreign-key references.
const TARGET_RE =
  /\b(?:create\s+table(?:\s+if\s+not\s+exists)?|drop\s+table(?:\s+if\s+exists)?|alter\s+table(?:\s+if\s+exists)?|create\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+(\S+)\s+on|references)\s+([a-zA-Z_"][\w".]*)/gi;

function guard(sqlText) {
  const bad = [];
  for (const m of sqlText.matchAll(TARGET_RE)) {
    for (const name of [m[1], m[2]]) {
      if (!name) continue;
      const clean = name.replace(/["()]/g, "").split(".").pop();
      if (clean && !clean.startsWith("stockgame_")) bad.push(clean);
    }
  }
  if (bad.length) {
    console.error(`REFUSING TO RUN: non-stockgame_ targets in migration SQL: ${[...new Set(bad)].join(", ")}`);
    process.exit(1);
  }
}

const all = statements.join(";\n");
guard(all);

const sql = neon(loadDatabaseUrl());
for (const stmt of statements) {
  guard(stmt);
  await sql.query(stmt);
  console.log("ok:", stmt.slice(0, 72).replace(/\s+/g, " ") + "…");
}
console.log(`\nstockgame additive migration complete (${statements.length} statements).`);
