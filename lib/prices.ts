// Deterministic fake 24/7 coin tape. PURE FUNCTIONS — same inputs, same
// outputs, on every serverless invocation, with zero DB state. This is what
// makes live standings identical for every viewer and adjudication
// reproducible.
//
// Model per symbol:
//   anchor(symbol)          — long-term level: real 2026-07-03 marks for the
//                             seeded pool, hash fallback for unknowns
//   mark(sym, d)            — the daily 16:00 ET mark: anchor × Π (1 +
//                             dailyReturn(sym, di)) over EVERY calendar day
//                             EPOCH..d (≤ ~365 iterations/yr, cheap)
//   quoteAt(sym, d, minute) — continuous geometric bridge between consecutive
//                             marks, with micro-noise gated to ZERO at minute
//                             0 and minute 960 so the 00:00 start snapshot and
//                             the 16:00 settle are exact
//
// Swapping in a real feed later (exchange public APIs — Kraken/Binance/
// Coinbase; NOT CoinGecko's personal-use free tier): replace the reads in
// quoteAt/startPrice/endPrice; everything downstream consumes settled prices
// from coingame_event_pool and never calls this at adjudication time again.

import { addDays, prevDay } from "@/lib/calendar";

const EPOCH = "2026-01-02";

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

// Real marks as of 2026-07-03 (slickcharts.com/currency) for the seeded pool:
// top 20 by market cap, stablecoins/pegged assets excluded.
const ANCHORS: Record<string, number> = {
  BTC: 61800, ETH: 1730, BNB: 564, XRP: 1.10, SOL: 81,
  TRX: 0.32, HYPE: 69, DOGE: 0.076, LEO: 9.10, ZEC: 455,
  XLM: 0.20, ADA: 0.17, XMR: 317, LINK: 7.80, CC: 0.14,
  GRAM: 1.68, BCH: 225, LTC: 43.5, HBAR: 0.072, SUI: 0.75,
};

function anchor(symbol: string): number {
  const known = ANCHORS[symbol];
  if (known !== undefined) return known;
  // Fallback: log-uniform $0.001 .. $1,000.
  const r = mulberry32(hash32(`anchor:${symbol}`));
  return Math.pow(10, r() * 6 - 3);
}

/** Daily volatility 1.5%..8%, a stable trait of the symbol. Crypto moves. */
function vol(symbol: string): number {
  const r = mulberry32(hash32(`vol:${symbol}`));
  return 0.015 + r() * 0.065;
}

function dailyReturn(symbol: string, dateStr: string): number {
  const rng = mulberry32(hash32(`day:${symbol}:${dateStr}`));
  return normal(rng) * vol(symbol);
}

// ---- daily marks -----------------------------------------------------------

/**
 * The official 16:00 ET mark for a calendar date (deterministic chain from
 * EPOCH over every day — coins don't take weekends off).
 */
export function mark(symbol: string, dateStr: string): number {
  let p = anchor(symbol);
  if (dateStr <= EPOCH) return roundP(p);
  for (let d = addDays(EPOCH, 1); d <= dateStr; d = addDays(d, 1)) {
    p *= 1 + dailyReturn(symbol, d);
  }
  return roundP(p);
}

/** Settled end price for an event date = that day's 16:00 mark. */
export function endPrice(symbol: string, dateStr: string): number {
  return mark(symbol, dateStr);
}

/** Settled start price for an event date = the tape at 00:00 ET (noise-free). */
export function startPrice(symbol: string, dateStr: string): number {
  return quoteAt(symbol, dateStr, 0);
}

// ---- continuous quote --------------------------------------------------------

const MARK_MIN = 960; // 16:00 ET

/**
 * Quote for `symbol` at ET civil date `dateStr`, minute-of-day `minute`.
 * One continuous tape: a geometric bridge between consecutive daily marks
 * (yesterday 16:00 → today 16:00 → tomorrow 16:00), plus micro-noise gated to
 * zero at minute 0 and minute 960. Invariants:
 *   quoteAt(s, d, 960) === endPrice(s, d)     exactly (settle = last live poll)
 *   quoteAt(s, d, 0)   === startPrice(s, d)   exactly (lock snapshot)
 */
export function quoteAt(symbol: string, dateStr: string, minute: number): number {
  const m = Math.min(1439, Math.max(0, minute));
  const before = m < MARK_MIN;
  const from = before ? mark(symbol, prevDay(dateStr)) : mark(symbol, dateStr);
  const to = before ? mark(symbol, dateStr) : mark(symbol, addDays(dateStr, 1));
  // Segment runs (prev day 16:00) → (this day 16:00), 1440 minutes long.
  const t = before ? (m + (1440 - MARK_MIN)) / 1440 : (m - MARK_MIN) / 1440;
  const level = from * Math.pow(to / from, t);
  // Noise gate: 0 at minute 0 and minute 960, smooth in between.
  const gate = before ? Math.sin((Math.PI * m) / MARK_MIN) : Math.sin((Math.PI * (m - MARK_MIN)) / (1440 - MARK_MIN));
  return roundP(level * (1 + microNoise(symbol, dateStr, m) * gate));
}

/** Small per-minute noise, vol-scaled. Deterministic per minute. */
function microNoise(symbol: string, dateStr: string, minute: number): number {
  const rng = mulberry32(hash32(`m:${symbol}:${dateStr}:${minute}`));
  return normal(rng) * vol(symbol) * 0.15;
}

/** Round to 6 significant digits — enough for $61,800 and $0.0757 alike. */
function roundP(n: number): number {
  return Number(n.toPrecision(6));
}

/** Percent change vs 24h ago (crypto convention). */
export function pctChange(symbol: string, dateStr: string, minute: number): number {
  const q = quoteAt(symbol, dateStr, minute);
  const ref = quoteAt(symbol, prevDay(dateStr), minute);
  return Math.round(((q - ref) / ref) * 10000) / 100;
}
