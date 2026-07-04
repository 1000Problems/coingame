-- coingame schema — 1K Daily Coin Pick 'Em (DESIGN-COINGAME.md).
-- SHARED NEON DB (~90 projects). Every object is prefixed coingame_.
-- This file is the DESTRUCTIVE full-rebuild path: it drops ONLY coingame_* tables.
-- Two-places rule: every change here also lands as an idempotent statement in
-- db/migrate-additive.mjs.

drop table if exists coingame_outbox cascade;
drop table if exists coingame_chat cascade;
drop table if exists coingame_board cascade;
drop table if exists coingame_pick cascade;
drop table if exists coingame_player cascade;
drop table if exists coingame_instance cascade;
drop table if exists coingame_event_pool cascade;
drop table if exists coingame_event cascade;
drop table if exists coingame_coin cascade;
drop table if exists coingame_ticker cascade; -- legacy stock-era name

-- Curated master pool: top 20 by market cap, stablecoins/pegged excluded.
-- Rotation = flipping active flags.
create table coingame_coin (
  symbol   text primary key,
  name     text not null,
  category text,
  active   boolean not null default true
);

-- One row per CALENDAR day (coins trade 24/7 — no market calendar). ref is
-- the contract eventRef, permanent once published.
-- Phase is COMPUTED from the clock (lib/events.ts phaseOf); only closed is stored.
-- claim_at is the adjudication mutex (atomic UPDATE claim; advisory locks don't
-- survive Neon's per-query http sessions).
create table coingame_event (
  ref          text primary key,               -- 'd-2026-07-06'
  event_date   date not null unique,
  locks_at     timestamptz not null,           -- 00:00 ET on event_date — deadline AND start gun
  settles_at   timestamptz not null,           -- 16:10 ET on event_date
  trophy_label text not null,
  closed_at    timestamptz,
  claim_at     timestamptz,
  created_at   timestamptz not null default now()
);

-- Pool snapshot per event, with settled prices. Adjudication source of truth —
-- a real price feed later only changes who writes start/end.
-- numeric(20,8): BTC at $61,800 and sub-cent coins both fit.
create table coingame_event_pool (
  event_ref   text not null references coingame_event(ref) on delete cascade,
  symbol      text not null,
  ref_price   numeric(20,8),                   -- 24h-ago display reference
  start_price numeric(20,8),                   -- settled at 00:00 ET (lock)
  end_price   numeric(20,8),                   -- settled at 16:00 ET
  primary key (event_ref, symbol)
);

-- One row per roomId ever seen (public room + every private instance).
create table coingame_instance (
  room_id       text primary key,
  host_origin   text not null,
  return_url    text not null,
  first_seen_at timestamptz not null default now()
);

-- One row per pseudonymous player. Never an email, never a real id.
create table coingame_player (
  player_id    text primary key,
  display_name text not null,
  avatar_url   text,
  last_seen_at timestamptz
);

-- The pick. Allocations: exactly 3 symbols, integer units >=1, sum = 10.
-- status 'draft' = editable, private. 'locked' = irreversible; admits the player
-- to the event room. Drafts still unlocked at locks_at are dead — never scored.
create table coingame_pick (
  room_id     text not null references coingame_instance(room_id) on delete cascade,
  event_ref   text not null references coingame_event(ref) on delete cascade,
  player_id   text not null references coingame_player(player_id) on delete cascade,
  allocations jsonb not null,
  status      text not null default 'draft',
  locked_at   timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (room_id, event_ref, player_id)
);
create index coingame_pick_event_idx on coingame_pick (event_ref, status);

-- Adjudicated board per instance per event (what event-close pushes). Write-once.
create table coingame_board (
  room_id     text not null,
  event_ref   text not null,
  player_id   text not null,
  final_cents bigint not null,
  placement   int not null,
  primary key (room_id, event_ref, player_id)
);

-- In-game chat, PER EVENT per instance (lock-gated).
create table coingame_chat (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  event_ref  text not null,
  player_id  text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index coingame_chat_room_idx on coingame_chat (room_id, event_ref, created_at);

-- Durable outbox for /spine and /close pushes. payload is the exact body sent;
-- for spine rows the embedded event id is the host-side idempotency key.
create table coingame_outbox (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                  -- 'spine' | 'close'
  room_id      text not null,
  payload      jsonb not null,
  attempts     int not null default 0,
  next_try_at  timestamptz not null default now(),
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);
create index coingame_outbox_due_idx on coingame_outbox (next_try_at) where delivered_at is null;
