// America/New_York trading calendar. All game time is ET; DST is handled via
// Intl (never hand-rolled UTC offsets).

const ET = "America/New_York";

// 2026 US market holidays (NYSE). Good Friday Apr 3; Juneteenth observed Jun 19.
const HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit",
});
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** 'YYYY-MM-DD' for the given instant, in ET. */
export function dateET(d: Date = new Date()): string {
  return dateFmt.format(d); // en-CA gives YYYY-MM-DD
}

export function todayET(): string {
  return dateET(new Date());
}

/** Minute-of-day in ET for an instant (9:30 AM = 570, 4:00 PM = 960). */
export function minuteOfDayET(d: Date = new Date()): number {
  const parts = Object.fromEntries(partsFmt.formatToParts(d).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function dayOfWeek(dateStr: string): number {
  // Noon UTC avoids date rollover for any timezone question about the civil date.
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

export function isTradingDay(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  if (dow === 0 || dow === 6) return false;
  return !HOLIDAYS_2026.has(dateStr);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Next n trading days STRICTLY AFTER `fromDateStr` (ET civil date). */
export function nextTradingDays(fromDateStr: string, n: number): string[] {
  const out: string[] = [];
  let d = fromDateStr;
  while (out.length < n) {
    d = addDays(d, 1);
    if (isTradingDay(d)) out.push(d);
  }
  return out;
}

export function prevTradingDay(dateStr: string): string {
  let d = dateStr;
  for (;;) {
    d = addDays(d, -1);
    if (isTradingDay(d)) return d;
  }
}

/**
 * The instant (UTC Date) of ET wall-clock `HH:MM` on civil date `dateStr`.
 * Technique: start from a UTC guess, measure what ET wall time that guess
 * renders as, and correct by the difference (converges in one step for any
 * fixed-offset regime, two around DST transitions).
 */
export function etInstant(dateStr: string, hour: number, minute: number): Date {
  let guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(partsFmt.formatToParts(guess).map((p) => [p.type, p.value]));
    const gotDate = `${parts.year}-${parts.month}-${parts.day}`;
    const gotMin = Number(parts.hour) * 60 + Number(parts.minute);
    const wantMin = hour * 60 + minute;
    const dayDelta = (new Date(`${dateStr}T12:00:00Z`).getTime() - new Date(`${gotDate}T12:00:00Z`).getTime()) / 86400000;
    const deltaMin = dayDelta * 1440 + (wantMin - gotMin);
    if (deltaMin === 0) return guess;
    guess = new Date(guess.getTime() + deltaMin * 60000);
  }
  return guess;
}

/** Midnight ET at the start of `tradingDate` — the pick deadline. */
export function locksAt(tradingDate: string): Date {
  return etInstant(tradingDate, 0, 0);
}

/** 16:10 ET on `tradingDate` — settle/adjudication time. */
export function settlesAt(tradingDate: string): Date {
  return etInstant(tradingDate, 16, 10);
}

const labelFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET, weekday: "short", month: "short", day: "numeric",
});

/** 'Mon, Jul 6' style label for an ET civil date. */
export function labelFor(dateStr: string): string {
  return labelFmt.format(new Date(`${dateStr}T12:00:00Z`));
}

/** 'Jul 6' short form (trophy labels). */
export function shortLabelFor(dateStr: string): string {
  return labelFor(dateStr).split(", ")[1] ?? dateStr;
}
