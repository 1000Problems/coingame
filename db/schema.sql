-- stockgame schema — 1K Daily Stock Pick 'Em (DESIGN-STOCKGAME.md).
-- SHARED NEON DB (~90 projects). Every object is prefixed stockgame_.
-- This file is the DESTRUCTIVE full-rebuild path: it drops ONLY stockgame_* tables.
-- Two-places rule: every change here also lands as an idempotent statement in
-- db/migrate-additive.mjs.

drop table if exists stockgame_outbox cascade;
drop table if exists stockgame_chat cascade;
drop table if exists stockgame_board cascade;
drop table if exists stockgame_pick cascade;
drop table if exists stockgame_player cascade;
drop table if exists stockgame_instance cascade;
drop table if exists stockgame_event_pool cascade;
drop table if exists stockgame_event cascade;
drop table if exists stockgame_ticker cascade;

-- Curated master pool. Rotation = flipping active flags.
create table stockgame_ticker (
  symbol text primary key,
  name   text not null,
  sector text,
  active boolean not null default true
);

-- One row per trading day. ref is the contract eventRef, permanent once published.
-- Phase is COMPUTED from the clock (lib/events.ts phaseOf); only closed is stored.
-- claim_at is the adjudication mutex (atomic UPDATE claim; advisory locks don't
-- survive Neon's per-query http sessions).
create table stockgame_event (
  ref          text primary key,               -- 'd-2026-07-06'
  trading_date date not null unique,
  locks_at     timestamptz not null,           -- midnight ET before trading_date
  settles_at   timestamptz not null,           -- 16:10 ET on trading_date
  trophy_label text not null,
  closed_at    timestamptz,
  claim_at     timestamptz,
  created_at   timestamptz not null default now()
);

-- Pool snapshot per event, with settled prices. Adjudication source of truth —
-- a real price feed later only changes who writes open/close.
create table stockgame_event_pool (
  event_ref   text not null references stockgame_event(ref) on delete cascade,
  symbol      text not null,
  prev_close  numeric(12,4),
  open_price  numeric(12,4),
  close_price numeric(12,4),
  primary key (event_ref, symbol)
);

-- One row per roomId ever seen (public room + every private instance).
create table stockgame_instance (
  room_id       text primary key,
  host_origin   text not null,
  return_url    text not null,
  first_seen_at timestamptz not null default now()
);

-- One row per pseudonymous player. Never an email, never a real id.
create table stockgame_player (
  player_id    text primary key,
  display_name text not null,
  avatar_url   text,
  last_seen_at timestamptz
);

-- The pick. Allocations: exactly 3 symbols, integer units >=1, sum = 10.
-- status 'draft' = editable, private. 'locked' = irreversible; admits the player
-- to the event room. Drafts still unlocked at locks_at are dead — never scored.
create table stockgame_pick (
  room_id     text not null references stockgame_instance(room_id) on delete cascade,
  event_ref   text not null references stockgame_event(ref) on delete cascade,
  player_id   text not null references stockgame_player(player_id) on delete cascade,
  allocations jsonb not null,
  status      text not null default 'draft',
  locked_at   timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (room_id, event_ref, player_id)
);
create index stockgame_pick_event_idx on stockgame_pick (event_ref, status);

-- Adjudicated board per instance per event (what event-close pushes). Write-once.
create table stockgame_board (
  room_id     text not null,
  event_ref   text not null,
  player_id   text not null,
  final_cents bigint not null,
  placement   int not null,
  primary key (room_id, event_ref, player_id)
);

-- In-game chat, PER EVENT per instance (lock-gated).
create table stockgame_chat (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  event_ref  text not null,
  player_id  text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index stockgame_chat_room_idx on stockgame_chat (room_id, event_ref, created_at);

-- Durable outbox for /spine and /close pushes. payload is the exact body sent;
-- for spine rows the embedded event id is the host-side idempotency key.
create table stockgame_outbox (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                  -- 'spine' | 'close'
  room_id      text not null,
  payload      jsonb not null,
  attempts     int not null default 0,
  next_try_at  timestamptz not null default now(),
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);
create index stockgame_outbox_due_idx on stockgame_outbox (next_try_at) where delivered_at is null;
