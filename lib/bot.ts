// Bot Play v1 surface (BOT-PLAY-V1.md §3/§4/§7): the phase-aware affordance
// VIEW over the exact same lib seams the human routes call — saveDraft,
// lockPick, postChat, roomView. Never a second implementation of a rule.
//
// States: `picking` (open event, caller not locked) · `riding` (locked,
// pre-close) · `settled` (closed). Domain failures are { ok:false, error }
// — HTTP errors are reserved for auth and malformed JSON in the routes.

import {
  ensureEvents, ensureStartPrices, eventsWindow, getEvent, openEvents,
  phaseOf, poolFor, toWireEvent, type EventRow, type Phase,
} from "@/lib/events";
import {
  getPick, hasLockedPick, lockPick, saveDraft, validateAllocations,
} from "@/lib/picks";
import { poolQuotes, postChat, roomView } from "@/lib/room";
import type { Session } from "@/lib/token";

export type ActionDef = { name: string; description: string; args: Record<string, string> };

export type BotState = "picking" | "riding" | "settled";

export type BotAffordances = {
  state: BotState;
  context: Record<string, unknown>;
  available_actions: ActionDef[];
};

export type ActResult = { ok: true; result?: unknown } | { ok: false; error: string };

// Descriptions are the bot's only manual — they carry the rules inline.
const ACTIONS: Record<string, ActionDef> = {
  pick: {
    name: "pick",
    description:
      "Draft 3–10 coins from context.pool; allocations maps symbol → integer units ≥ 1 summing to 10 (each unit is $100 of your $1,000). Editable until you lock. Defaults to context.eventRef; pass eventRef to pre-pick any open day from the events action.",
    args: {
      eventRef: "string (optional, d-YYYY-MM-DD; default: context.eventRef)",
      allocations: "object (required, symbol -> integer units, sum 10)",
    },
  },
  lock: {
    name: "lock",
    description:
      "Irreversibly lock your draft — your seat in the event room. There is no unlock. A repeat lock acknowledges with { already: true } instead of failing.",
    args: { eventRef: "string (optional; default: context.eventRef)" },
  },
  chat: {
    name: "chat",
    description: "Say something to the event room (locked players only, 500 chars max).",
    args: {
      body: "string (required)",
      eventRef: "string (optional; default: context.eventRef)",
    },
  },
  room: {
    name: "room",
    description:
      "Poll the event room: phase, quotes, live standings, chat tail, roster. Pass after = the previous nextCursor to page chat.",
    args: {
      eventRef: "string (optional; default: context.eventRef)",
      after: "string (optional ISO chat cursor)",
    },
  },
  events: {
    name: "events",
    description:
      "List open event days (today + next 2) with refs, phases, and lock times. Pick any open day with pick({ eventRef }).",
    args: {},
  },
};

type Focus = { event: EventRow; phase: Phase; locked: boolean };

/**
 * The event this player is "in": their live locked ride first, else the
 * soonest open day, else the latest day in the window (settled spectator).
 */
async function focusEvent(session: Session, now: Date): Promise<Focus | null> {
  await ensureEvents(2);
  const window = await eventsWindow();
  for (const e of window) {
    if (phaseOf(e, now) !== "closed" && (await hasLockedPick(session.roomId, e.ref, session.playerId))) {
      return { event: e, phase: phaseOf(e, now), locked: true };
    }
  }
  const open = window.find((e) => phaseOf(e, now) === "open");
  if (open) return { event: open, phase: "open", locked: false };
  const latest = window[window.length - 1];
  if (!latest) return null;
  return {
    event: latest,
    phase: phaseOf(latest, now),
    locked: await hasLockedPick(session.roomId, latest.ref, session.playerId),
  };
}

/** GET /bot — { state, context, available_actions }, phase- and player-aware. */
export async function botAffordances(session: Session, now = new Date()): Promise<BotAffordances> {
  const focus = await focusEvent(session, now);
  if (!focus) {
    return { state: "settled", context: { events: [] }, available_actions: [ACTIONS.events] };
  }
  const { event, phase, locked } = focus;
  const state: BotState =
    locked && phase !== "closed" ? "riding" : !locked && phase === "open" ? "picking" : "settled";

  const pool = await poolFor(event.ref);
  const colors = Object.fromEntries(pool.map((p) => [p.symbol, p.color]));
  const startPrices = await ensureStartPrices(event.ref, event.event_date, now);
  const { quotes } = await poolQuotes(pool.map((p) => p.symbol), event, now, startPrices);
  const myPick = await getPick(session.roomId, event.ref, session.playerId);
  const open = await openEvents(now);

  const context: Record<string, unknown> = {
    eventRef: event.ref,
    phase,
    locksAt: event.locks_at,
    settlesAt: event.settles_at,
    eventDate: event.event_date,
    pool: quotes.map((q) => ({ ...q, color: colors[q.symbol] ?? null })),
    myPick,
    events: open.map((e) => toWireEvent(e, now)),
    me: { playerId: session.playerId, displayName: session.displayName, locked },
  };

  // Post-lock (and settled) the standings snapshot rides along — rich context,
  // BOT-PLAY-V1 §3: the bot decides with the whole board in front of it.
  if (locked || state === "settled") {
    const view = await roomView(session.roomId, session.playerId, event, undefined, now);
    if (view.status === 200) context.room = view.body;
  }

  const available_actions =
    state === "picking"
      ? myPick?.status === "draft"
        ? [ACTIONS.pick, ACTIONS.lock, ACTIONS.events]
        : [ACTIONS.pick, ACTIONS.events] // never advertise a lock that would reject (§3)
      : state === "riding"
        ? [ACTIONS.room, ACTIONS.chat, ACTIONS.events]
        : [ACTIONS.room, ACTIONS.events];

  return { state, context, available_actions };
}

/** BOT-PLAY-V1 §4: pick args arrive as a symbol → units map; the lib seam takes an array. */
function coerceAllocations(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.entries(raw as Record<string, unknown>).map(([symbol, units]) => ({ symbol, units }));
  }
  return raw; // arrays pass straight through; validateAllocations rejects the rest
}

/** POST /bot/act — dispatch one action through the shared lib seams. */
export async function botAct(
  session: Session, action: string, rawArgs?: Record<string, unknown>, now = new Date(),
): Promise<ActResult> {
  const args = rawArgs ?? {};

  if (action === "events") {
    await ensureEvents(2);
    const open = await openEvents(now);
    return { ok: true, result: { events: open.map((e) => toWireEvent(e, now)) } };
  }

  const wantRef = typeof args.eventRef === "string" && args.eventRef ? args.eventRef : null;
  let event: EventRow | null;
  if (wantRef) {
    event = await getEvent(wantRef);
  } else {
    const focus = await focusEvent(session, now);
    event = focus?.event ?? null;
  }
  if (!event) return { ok: false, error: wantRef ? "unknown event" : "no event to act on" };

  switch (action) {
    case "pick": {
      if (phaseOf(event, now) !== "open") return { ok: false, error: "event is not open" };
      const pool = await poolFor(event.ref);
      const check = validateAllocations(coerceAllocations(args.allocations), new Set(pool.map((p) => p.symbol)));
      if (!check.ok) return { ok: false, error: check.error };
      const saved = await saveDraft(session.roomId, event.ref, session.playerId, check.allocations);
      if (!saved.ok) return { ok: false, error: saved.error ?? "could not save draft" };
      return { ok: true, result: { status: "draft", eventRef: event.ref } };
    }
    case "lock": {
      const res = await lockPick(session.roomId, event.ref, session.playerId);
      if (res.ok) return { ok: true, result: { status: "locked", eventRef: event.ref } };
      if (res.error === "already locked") return { ok: true, result: { already: true, eventRef: event.ref } };
      return { ok: false, error: res.error ?? "could not lock" };
    }
    case "chat": {
      if (phaseOf(event, now) === "closed") return { ok: false, error: "event is closed" };
      if (!(await hasLockedPick(session.roomId, event.ref, session.playerId))) {
        return { ok: false, error: "lock your picks to chat" };
      }
      const res = await postChat(session.roomId, event.ref, session.playerId, String(args.body ?? ""));
      if (!res.ok) return { ok: false, error: res.error ?? "could not send" };
      return { ok: true, result: { sent: true, eventRef: event.ref } };
    }
    case "room": {
      const after = typeof args.after === "string" ? args.after : undefined;
      const view = await roomView(session.roomId, session.playerId, event, after, now);
      if (view.status !== 200) return { ok: false, error: String(view.body.error ?? "room unavailable") };
      return { ok: true, result: view.body };
    }
    default:
      return { ok: false, error: `unknown action: ${action || "?"}` };
  }
}
