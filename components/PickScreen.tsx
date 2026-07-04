"use client";

// The 1c "Split Bar" pick screen (design_handoff_pick_screen_1c): a 10-segment
// $1,000 chip bar in per-coin brand colors, 2-col tile grid with steppers, and
// a footer status line + irreversible lock (with confirm).
//
// Deliberate deltas from the mockup (TASK-coingame-07, -08):
//   - per-coin fixed colors everywhere, NOT slot colors
//   - the − stepper is the ONLY deselect: stepping to $0 removes the pick
//     (tile tap is select-only — no accidental unit-nuking taps)
//   - drafts autosave (product behavior the mockup didn't model)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { priceLabel } from "@/lib/format";
import { chipTextColor, FALLBACK_COIN_COLOR } from "@/lib/colors";
import { COIN_INFO } from "@/lib/coininfo";
import CoinCard from "@/components/CoinCard";

type Quote = { symbol: string; price: number; pct: number };
type Alloc = { symbol: string; units: number };

const TOTAL_UNITS = 10;

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
  const valid = selected.length === 3 && used === TOTAL_UNITS;

  // The 10 segments, filled in selection order: [{symbol}...] then nulls.
  const segments = useMemo(() => {
    const out: (string | null)[] = [];
    for (const [sym, units] of alloc) for (let i = 0; i < units; i++) out.push(sym);
    while (out.length < TOTAL_UNITS) out.push(null);
    return out;
  }, [alloc]);

  const scheduleSave = useCallback((next: Map<string, number>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const entries = [...next.entries()];
    if (entries.length !== 3 || entries.reduce((a, [, u]) => a + u, 0) !== TOTAL_UNITS) return;
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
      if (prev.size >= 3) return prev;   // pick exactly 3
      const next = new Map(prev);
      const others = [...next.values()].reduce((a, b) => a + b, 0);
      next.set(symbol, 0);
      if (next.size === 3) {
        if (others === 0) {
          // Fresh flow: seed sensible defaults 4/3/3.
          const syms = [...next.keys()];
          next.set(syms[0], 4); next.set(syms[1], 3); next.set(syms[2], 3);
        } else {
          // Re-pick after a − unselect: the newcomer inherits the freed budget.
          next.set(symbol, TOTAL_UNITS - others);
        }
      }
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
    selected.length < 3
      ? `Pick ${3 - selected.length} more coin${selected.length === 2 ? "" : "s"}`
      : remaining > 0
        ? `$${remaining * 100} still on the sidelines`
        : "All $1,000 allocated — ready to lock";

  return (
    <div className="pickcard">
      <div className="pickhead">
        <div className="pickhead-l">
          <span className="pickbrand">1K Daily</span>
          <span className="pickmeta">{dateLabel} · pool of {quotes.length}</span>
        </div>
        <div className="pickclock">Locks 12:00 AM ET · {countdown}</div>
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
          {selected.map((s) => (
            <span key={s} className="legenditem">
              <span className="swatch" style={{ background: colorOf(s) }} />
              {s} ${(alloc.get(s) ?? 0) * 100}
            </span>
          ))}
        </div>
      </div>

      <div className="pooltiles">
        {quotes.map((q) => {
          const sel = alloc.has(q.symbol);
          const faded = !sel && selected.length >= 3;
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
        − to $0 removes a pick. Locking is final — it opens the room, where
        you&apos;ll see everyone else&apos;s picks. The ride starts at midnight ET.
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
