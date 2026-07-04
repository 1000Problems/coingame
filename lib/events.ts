// Event engine. Invariant: the next 2 trading days ALWAYS have events —
// ensureEvents() is idempotent and runs lazily on every /events read and after
// every adjudication. Phase is COMPUTED from the clock, never stored (only
// closed_at is stored); the midnight lock needs no scheduler.

import { sql } from "@/lib/db";
import {
  labelFor, locksAt, nextTradingDays, prevTradingDay, settlesAt, shortLabelFor, todayET,
} from "@/lib/calendar";
import { closePrice } from "@/lib/prices";

export type Phase = "open" | "locked" | "adjudicating" | "closed";

export type EventRow = {
  ref: string;
  trading_date: string; // YYYY-MM-DD
  locks_at: string;     // ISO
  settles_at: string;   // ISO
  trophy_label: string;
  closed_at: string | null;
};

export function refFor(tradingDate: string): string {
  return `d-${tradingDate}`;
}

export function phaseOf(e: Pick<EventRow, "locks_at" | "settles_at" | "closed_at">, now = new Date()): Phase {
  if (e.closed_at) return "closed";
  if (now >= new Date(e.settles_at)) return "adjudicating";
  if (now >= new Date(e.locks_at)) return "locked";
  return "open";
}

function normalizeDate(v: unknown): string {
  // neon returns date columns as 'YYYY-MM-DD' strings or Date objects depending
  // on config; normalize defensively.
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function rowToEvent(r: Record<string, unknown>): EventRow {
  return {
    ref: String(r.ref),
    trading_date: normalizeDate(r.trading_date),
    locks_at: new Date(String(r.locks_at)).toISOString(),
    settles_at: new Date(String(r.settles_at)).toISOString(),
    trophy_label: String(r.trophy_label),
    closed_at: r.closed_at ? new Date(String(r.closed_at)).toISOString() : null,
  };
}

/**
 * Idempotent: create events for the next `n` trading days (after today ET) if
 * missing, snapshotting the active ticker pool with prev_close. Race-safe via
 * `on conflict do nothing`.
 */
export async function ensureEvents(n = 2): Promise<void> {
  const days = nextTradingDays(todayET(), n);
  for (const d of days) {
    const ref = refFor(d);
    const inserted = await sql`
      insert into coingame_event (ref, trading_date, locks_at, settles_at, trophy_label)
      values (${ref}, ${d}, ${locksAt(d).toISOString()}, ${settlesAt(d).toISOString()},
              ${"Daily Champ · " + shortLabelFor(d)})
      on conflict (ref) do nothing
      returning ref`;
    if (inserted.length > 0) {
      // Snapshot the pool. prev_close from the deterministic feed.
      const tickers = await sql`select symbol from coingame_ticker where active order by symbol`;
      const prev = prevTradingDay(d);
      for (const t of tickers) {
        const symbol = String(t.symbol);
        await sql`
          insert into coingame_event_pool (event_ref, symbol, prev_close)
          values (${ref}, ${symbol}, ${closePrice(symbol, prev)})
          on conflict (event_ref, symbol) do nothing`;
      }
    }
  }
}

export async function getEvent(ref: string): Promise<EventRow | null> {
  const rows = await sql`select * from coingame_event where ref = ${ref}`;
  return rows.length ? rowToEvent(rows[0]) : null;
}

/** Window for GET /events: last 7 closed + everything not closed. */
export async function eventsWindow(): Promise<EventRow[]> {
  const rows = await sql`
    (select * from coingame_event where closed_at is not null order by trading_date desc limit 7)
    union all
    (select * from coingame_event where closed_at is null)
    order by trading_date asc`;
  return rows.map(rowToEvent);
}

/** Contract §3 shape for one event. */
export function toWireEvent(e: EventRow, now = new Date()) {
  return {
    ref: e.ref,
    label: `Stock Picks · ${labelFor(e.trading_date)}`,
    group: "1K Daily",
    phase: phaseOf(e, now),
    expectedLockAt: e.locks_at,
  };
}

/** Events currently open for picking, soonest first. */
export async function openEvents(now = new Date()): Promise<EventRow[]> {
  const all = await eventsWindow();
  return all.filter((e) => phaseOf(e, now) === "open");
}

export async function poolFor(ref: string): Promise<{ symbol: string; prev_close: number | null }[]> {
  const rows = await sql`
    select p.symbol, p.prev_close from coingame_event_pool p where p.event_ref = ${ref} order by p.symbol`;
  return rows.map((r) => ({
    symbol: String(r.symbol),
    prev_close: r.prev_close == null ? null : Number(r.prev_close),
  }));
}
