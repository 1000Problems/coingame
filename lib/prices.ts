// Deterministic fake price feed. PURE FUNCTIONS — same inputs, same outputs, on
// every serverless invocation, with zero DB state. This is what makes live
// standings identical for every viewer and adjudication reproducible.
//
// Model per symbol:
//   base(symbol)            — long-term anchor price ($18..$680) from a hash
//   close(sym, d)           — base × Π (1 + dailyReturn(sym, di)) over trading
//                             days from EPOCH..d (≤ ~260 iterations, cheap)
//   open(sym, d)            — close(prevTradingDay) × (1 + overnight gap)
//   price(sym, d, minute)   — Brownian-bridge walk open→close during 9:30–16:00,
//                             gentle drift around prev close before the open and
//                             around close after 16:00 ("after-hours ticks")
//
// Swapping in a real feed later: replace the reads in quoteAt/openPrice/
// closePrice; everything downstream consumes settled prices from
// coingame_event_pool and never calls this at adjudication time again.

import { isTradingDay, prevTradingDay } from "@/lib/calendar";

const EPOCH = "2026-01-02"; // first 2026 trading day

// ---- seeded PRNG ----------------------------------------------------------

function hash32(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller from a seeded stream. */
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- per-symbol character --------------------------------------------------

function base(symbol: string): number {
  const r = mulberry32(hash32(`base:${symbol}`));
  return Math.round((18 + r() * 662) * 100) / 100; // $18 .. $680
}

/** Daily volatility 0.8%..3.5%, a stable trait of the symbol. */
function vol(symbol: string): number {
  const r = mulberry32(hash32(`vol:${symbol}`));
  return 0.008 + r() * 0.027;
}

function dailyReturn(symbol: string, dateStr: string): number {
  const rng = mulberry32(hash32(`day:${symbol}:${dateStr}`));
  return normal(rng) * vol(symbol);
}

function overnightGap(symbol: string, dateStr: string): number {
  const rng = mulberry32(hash32(`gap:${symbol}:${dateStr}`));
  return normal(rng) * vol(symbol) * 0.4;
}

// ---- daily anchors ---------------------------------------------------------

function tradingDaysBetween(fromStr: string, toStr: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromStr}T12:00:00Z`);
  const end = new Date(`${toStr}T12:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    const s = d.toISOString().slice(0, 10);
    if (isTradingDay(s)) out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Official close for a trading date (deterministic chain from EPOCH). */
export function closePrice(symbol: string, dateStr: string): number {
  let p = base(symbol);
  for (const d of tradingDaysBetween(EPOCH, dateStr)) {
    p *= 1 + dailyReturn(symbol, d);
  }
  return round2(p);
}

/** Official open for a trading date: previous close plus an overnight gap. */
export function openPrice(symbol: string, dateStr: string): number {
  const prev = dateStr <= EPOCH ? base(symbol) : closePrice(symbol, prevTradingDay(dateStr));
  return round2(prev * (1 + overnightGap(symbol, dateStr)));
}

// ---- intraday / off-hours quote --------------------------------------------

const OPEN_MIN = 570;  // 9:30 ET
const CLOSE_MIN = 960; // 16:00 ET

/**
 * Quote for `symbol` at ET civil date `dateStr`, minute-of-day `minute`.
 * `dateStr` may be a non-trading day (weekend drift around the last close).
 */
export function quoteAt(symbol: string, dateStr: string, minute: number): number {
  const trading = isTradingDay(dateStr);
  const lastClose = trading
    ? (dateStr <= EPOCH ? base(symbol) : closePrice(symbol, prevTradingDay(dateStr)))
    : closePrice(symbol, prevTradingDayOrSelf(dateStr));

  if (!trading) return round2(lastClose * (1 + microNoise(symbol, dateStr, minute) * 0.3));

  const open = openPrice(symbol, dateStr);
  const close = closePrice(symbol, dateStr);

  if (minute < OPEN_MIN) {
    // Pre-market: drift from last close toward the open.
    const t = Math.max(0, minute) / OPEN_MIN;
    const level = lastClose * Math.pow(open / lastClose, t);
    return round2(level * (1 + microNoise(symbol, dateStr, minute) * 0.25));
  }
  if (minute >= CLOSE_MIN) {
    // After-hours: gentle ticks around the close. Ramp the noise in from zero
    // over 30 min so the 16:00 quote EQUALS the official close — the last live
    // standings view must match the adjudicated board.
    const ramp = Math.min(1, (minute - CLOSE_MIN) / 30);
    return round2(close * (1 + microNoise(symbol, dateStr, minute) * 0.3 * ramp));
  }
  // Regular session: geometric bridge open→close with a noise term that is
  // zero at both ends (so 9:30 == open, 16:00 == close, exactly).
  const t = (minute - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN);
  const level = open * Math.pow(close / open, t);
  const bridge = Math.sin(Math.PI * t); // 0 at ends, 1 mid-day
  return round2(level * (1 + microNoise(symbol, dateStr, minute) * bridge));
}

function prevTradingDayOrSelf(dateStr: string): string {
  return isTradingDay(dateStr) ? dateStr : prevTradingDay(dateStr);
}

/** Small per-minute noise, ±~0.4% × vol-scaled. Deterministic per minute. */
function microNoise(symbol: string, dateStr: string, minute: number): number {
  const rng = mulberry32(hash32(`m:${symbol}:${dateStr}:${minute}`));
  return normal(rng) * vol(symbol) * 0.15;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Percent change vs the session reference (open during the day, prev close off-hours). */
export function pctChange(symbol: string, dateStr: string, minute: number): number {
  const q = quoteAt(symbol, dateStr, minute);
  const ref =
    isTradingDay(dateStr) && minute >= OPEN_MIN
      ? openPrice(symbol, dateStr)
      : closePrice(symbol, prevTradingDayOrSelf(isTradingDay(dateStr) ? prevTradingDay(dateStr) : dateStr));
  return Math.round(((q - ref) / ref) * 10000) / 100;
}
