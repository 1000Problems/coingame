"use client";

// The 1c "Split Bar" pick screen (design_handoff_pick_screen_1c): a 10-segment
// $1,000 chip bar in per-coin brand colors, 2-col tile grid with steppers, and
// a footer status line + irreversible lock (with confirm).
//
// Deliberate deltas from the mockup (TASK-coingame-07, -08, -10):
//   - per-coin fixed colors everywhere, NOT slot colors
//   - the − stepper is the ONLY deselect: stepping to $0 removes the pick
//     (tile tap is select-only — no accidental unit-nuking taps)
//   - drafts autosave (product behavior the mockup didn't model)
//   - 3..10 coins (TASK-coingame-10): a new selection takes 1 chip; selecting
//     is blocked at $0 unallocated (free a chip first). No auto-seeding.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { priceLabel, sortAllocations } from "@/lib/format";
import { chipTextColor, FALLBACK_COIN_COLOR } from "@/lib/colors";
import { COIN_INFO } from "@/lib/coininfo";
import CoinCard from "@/components/CoinCard";

type Quote = { symbol: string; price: number; pct: number };
type Alloc = { symbol: string; units: number };

const TOTAL_UNITS = 10;
const MIN_COINS = 3;

export default function PickScreen({
  eventRef, dateLabel, locksAt, quotes: initialQuotes, draft, colors,
}: {
  eventRef: string;
  dateLabel: string;
  locksAt: string;
  quotes: Quote[];
  draft: Alloc[];
  colors: Record<string, string>;
}) {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes);
  const [alloc, setAlloc] = useState<Map<string, number>>(
    () => new Map(draft.map((a) => [a.symbol, a.units])),
  );
  const [err, setErr] = useState("");
  const [locking, setLocking] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const colorOf = useCallback(
    (s: string) => colors[s] ?? FALLBACK_COIN_COLOR,
    [colors],
  );

  // Quote refresh — the 24/7 tape ticks live.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/quotes?eventRef=${encodeURIComponent(eventRef)}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.quotes)) setQuotes(j.quotes);
        }
      } catch {}
    }, 30000);
    return () => clearInterval(id);
  }, [eventRef]);

  // Lock countdown.
  useEffect(() => {
    const tick = () => {
      const ms = new Date(locksAt).getTime() - Date.now();
      if (ms <= 0) { setCountdown("locked"); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setCountdown(h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [locksAt]);

  const selected = useMemo(() => [...alloc.keys()], [alloc]);
  const used = useMemo(() => [...alloc.values()].reduce((a, b) => a + b, 0), [alloc]);
  const remaining = TOTAL_UNITS - used;
  // Max 10 is self-capping: 10 coins × ≥1 chip = all 10 chips.
  const valid = selected.length >= MIN_COINS && used === TOTAL_UNITS;

  // Canonical bag order (TASK-coingame-11): biggest position first, ties
  // alphabetical. Bar and legend re-order live as units change.
  const ordered = useMemo(
    () => sortAllocations([...alloc.entries()].map(([symbol, units]) => ({ symbol, units }))),
    [alloc],
  );

  // The 10 segments in canonical order: [{symbol}...] then nulls.
  const segments = useMemo(() => {
    const out: (string | null)[] = [];
    for (const { symbol, units } of ordered) for (let i = 0; i < units; i++) out.push(symbol);
    while (out.length < TOTAL_UNITS) out.push(null);
    return out;
  }, [ordered]);

  const scheduleSave = useCallback((next: Map<string, number>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const entries = [...next.entries()];
    if (entries.length < MIN_COINS || entries.reduce((a, [, u]) => a + u, 0) !== TOTAL_UNITS) return;
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/pick", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventRef,
            allocations: entries.map(([symbol, units]) => ({ symbol, units })),
          }),
        });
        if (!r.ok) setErr((await r.json()).error ?? "couldn't save draft");
        else setErr("");
      } catch { setErr("network hiccup — draft not saved"); }
    }, 500);
  }, [eventRef]);

  function toggle(symbol: string) {
    setErr("");
    setAlloc((prev) => {
      if (prev.has(symbol)) return prev; // select-only; − to $0 is the deselect
      const others = [...prev.values()].reduce((a, b) => a + b, 0);
      if (others >= TOTAL_UNITS) return prev; // no free chip — free one first
      const next = new Map(prev);
      next.set(symbol, 1); // a new pick takes exactly one $100 chip
      scheduleSave(next);
      return next;
    });
  }

  function step(symbol: string, delta: number) {
    setErr("");
    setAlloc((prev) => {
      const cur = prev.get(symbol) ?? 0;
      const totalOthers = [...prev.entries()].filter(([s]) => s !== symbol).reduce((a, [, u]) => a + u, 0);
      const next = new Map(prev);
      const target = cur + delta;
      if (target < 1) {
        next.delete(symbol);                 // − to $0 unselects, freeing the slot
      } else {
        if (totalOthers + target > TOTAL_UNITS) return prev; // never exceed $1,000
        next.set(symbol, target);
      }
      scheduleSave(next);
      return next;
    });
  }

  async function lockIn() {
    if (!window.confirm("Locking is final — picks can't be changed after this. Lock it in?")) return;
    setLocking(true);
    setErr("");
    try {
      // Flush the draft first so lock always sees the latest allocations.
      const save = await fetch("/api/pick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventRef,
          allocations: [...alloc.entries()].map(([symbol, units]) => ({ symbol, units })),
        }),
      });
      if (!save.ok) { setErr((await save.json()).error ?? "couldn't save picks"); setLocking(false); return; }
      const r = await fetch("/api/lock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventRef }),
      });
      if (!r.ok) { setErr((await r.json()).error ?? "couldn't lock"); setLocking(false); return; }
      router.refresh(); // server re-renders → event room
    } catch {
      setErr("network hiccup — try again");
      setLocking(false);
    }
  }

  const statusLine =
    selected.length < MIN_COINS
      ? `Pick ${MIN_COINS - selected.length} more coin${MIN_COINS - selected.length === 1 ? "" : "s"} (3–10 total)`
      : remaining > 0
        ? `$${remaining * 100} still on the sidelines`
        : `All $1,000 in — ${selected.length} coin${selected.length === 1 ? "" : "s"}, ready to lock`;

  return (
    <div className="pickcard">
      <div className="pickhead">
        <div className="pickhead-l">
          <span className="pickbrand">1K Daily</span>
          <span className="pickmeta">{dateLabel} · pool of {quotes.length}</span>
        </div>
        <div className="pickclock">Locks 12:00 AM ET · {countdown}</div>
      </div>

      <div className="howto">
        <p className="howto-hook">Split $1,000 across your coins. The biggest bag at 4PM takes the daily trophy.</p>
        <div className="howto-steps">
          <div className="howto-step">
            <span className="howto-n">1</span>
            <div>
              <b>Split it</b>
              <span>$1,000 across 3–10 coins</span>
            </div>
          </div>
          <div className="howto-step">
            <span className="howto-n">2</span>
            <div>
              <b>Locks 12:00 AM ET</b>
              <span>picks freeze — no changes</span>
            </div>
          </div>
          <div className="howto-step">
            <span className="howto-n">3</span>
            <div>
              <b>Cash out 4:00 PM ET</b>
              <span>top bag wins the trophy</span>
            </div>
          </div>
        </div>
      </div>

      <div className="barwrap">
        <div className="barhead">
          <span className="barlabel">Your $1,000</span>
          <span className="barfree">${remaining * 100} unallocated</span>
        </div>
        <div className="chipbar">
          {segments.map((sym, i) =>
            sym ? (
              <div key={i} className="chipseg" style={{ background: colorOf(sym), borderColor: colorOf(sym), color: chipTextColor(colorOf(sym)) }}>
                {sym}
              </div>
            ) : (
              <div key={i} className="chipseg empty">$100</div>
            ),
          )}
        </div>
        <div className="barlegend">
          {ordered.map((a) => (
            <span key={a.symbol} className="legenditem">
              <span className="swatch" style={{ background: colorOf(a.symbol) }} />
              {a.symbol} ${a.units * 100}
            </span>
          ))}
        </div>
      </div>

      <div className="pooltiles">
        {quotes.map((q) => {
          const sel = alloc.has(q.symbol);
          const faded = !sel && remaining <= 0; // no chip free → can't join
          return (
            <div
              key={q.symbol}
              className={`cointile${sel ? " sel" : ""}`}
              style={{ borderColor: sel ? colorOf(q.symbol) : undefined, opacity: faded ? 0.45 : 1 }}
            >
              <button className="cointile-main" onClick={() => toggle(q.symbol)}>
                <span className="cointile-top">
                  <span className="dot" style={{ background: sel ? colorOf(q.symbol) : "#d6d9e0" }} />
                  <span className="tick">{q.symbol}</span>
                  <span className={`d24 ${q.pct >= 0 ? "pos" : "neg"}`}>
                    {q.pct >= 0 ? "+" : ""}{q.pct.toFixed(2)}%
                  </span>
                </span>
                <span className="priceline">{priceLabel(q.price)} · 24h</span>
              </button>
              {COIN_INFO[q.symbol] ? (
                <button className="infobtn" onClick={() => setInfoFor(q.symbol)} aria-label={`About ${q.symbol}`}>i</button>
              ) : null}
              {sel ? (
                <span className="tilestep">
                  <button className="stepbtn minus" onClick={() => step(q.symbol, -1)}>−</button>
                  <span className="stepamt">${(alloc.get(q.symbol) ?? 0) * 100}</span>
                  <button className="stepbtn plus" onClick={() => step(q.symbol, 1)} disabled={remaining <= 0}>+</button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="pickfoot">
        <span className="footstatus">{err || statusLine}</span>
        <button className="lockbtn" disabled={!valid || locking} onClick={lockIn}>
          {locking ? "Locking…" : "Lock it in"}
        </button>
      </div>
      <p className="tiny" style={{ padding: "0 26px 18px", margin: 0 }}>
        A new pick takes a $100 chip; − to $0 removes it. Locking is final and
        opens the room, where you&apos;ll see everyone else&apos;s picks. If two
        bags tie, the earlier lock wins.
      </p>
      {infoFor ? (
        <CoinCard
          symbol={infoFor}
          color={colorOf(infoFor)}
          price={quotes.find((q) => q.symbol === infoFor)?.price}
          pct={quotes.find((q) => q.symbol === infoFor)?.pct}
          onClose={() => setInfoFor(null)}
        />
      ) : null}
    </div>
  );
}
