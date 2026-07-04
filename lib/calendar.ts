// America/New_York time helpers. All game time is ET; DST is handled via
// Intl (never hand-rolled UTC offsets). NO market calendar — coins trade 24/7,
// so every calendar day is an event day.

const ET = "America/New_York";

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

/** Minute-of-day in ET for an instant (00:00 = 0, 4:00 PM = 960). */
export function minuteOfDayET(d: Date = new Date()): number {
  const parts = Object.fromEntries(partsFmt.formatToParts(d).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function addDays(dateStr: string, n: number): string {
  // Noon UTC avoids date rollover for any timezone question about the civil date.
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Next n calendar days STRICTLY AFTER `fromDateStr` (ET civil date). */
export function nextDays(fromDateStr: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(addDays(fromDateStr, i));
  return out;
}

export function prevDay(dateStr: string): string {
  return addDays(dateStr, -1);
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

/** Midnight ET at the start of `eventDate` — the pick deadline AND the start gun. */
export function locksAt(eventDate: string): Date {
  return etInstant(eventDate, 0, 0);
}

/** 16:10 ET on `eventDate` — settle/adjudication time. */
export function settlesAt(eventDate: string): Date {
  return etInstant(eventDate, 16, 10);
}

/** 16:00 ET on `eventDate` — the finish line the ride actually ends at.
 * NOT settlesAt (16:10), which is adjudication plumbing. */
export function endsAt(eventDate: string): Date {
  return etInstant(eventDate, 16, 0);
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
