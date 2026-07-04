"use client";

// The allocation screen: 1a Gallery's calm tiles + 1c Split Bar's segmented
// $1,000 bar with steppers. Drafts autosave (debounced); Lock it in is the
// real, irreversible commitment and the door into the event room.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { priceLabel } from "@/lib/format";

type Quote = { symbol: string; price: number; pct: number };
type Alloc = { symbol: string; units: number };

const TOTAL_UNITS = 10;

export default function PickScreen({
  eventRef, dateLabel, locksAt, quotes: initialQuotes, draft,
}: {
  eventRef: string;
  dateLabel: string;
  locksAt: string;
  quotes: Quote[];
  draft: Alloc[];
}) {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes);
  const [alloc, setAlloc] = useState<Map<string, number>>(
    () => new Map(draft.map((a) => [a.symbol, a.units])),
  );
  const [err, setErr] = useState("");
  const [locking, setLocking] = useState(false);
  const [countdown, setCountdown] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quote refresh (after-hours moves tick live).
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
      const next = new Map(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        if (next.size >= 3) return prev; // pick exactly 3
        next.set(symbol, 0);
        // Seed sensible defaults when the third pick lands: 4/3/3.
        if (next.size === 3) {
          const syms = [...next.keys()];
          next.set(syms[0], 4); next.set(syms[1], 3); next.set(syms[2], 3);
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
      if (target < 1) return prev;                       // min 1 unit per selected coin
      if (totalOthers + target > TOTAL_UNITS) return prev; // never exceed $1,000
      next.set(symbol, target);
      scheduleSave(next);
      return next;
    });
  }

  async function lockIn() {
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

  return (
    <>
      <div className="card">
        <h2>Pick three. Split $1,000.</h2>
        <p className="muted">
          {dateLabel} pool · allocations in $100 steps · locks in {countdown}
        </p>
      </div>

      <div className="tilegrid">
        {quotes.map((q) => {
          const sel = alloc.has(q.symbol);
          return (
            <button key={q.symbol} className={`tile${sel ? " sel" : ""}`} onClick={() => toggle(q.symbol)}>
              <div className="t">{q.symbol}</div>
              <div className="px">
                {priceLabel(q.price)}{" "}
                <span className={q.pct >= 0 ? "pos" : "neg"}>
                  {q.pct >= 0 ? "+" : ""}{q.pct.toFixed(2)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="card">
        <h2>Your $1,000</h2>
        {selected.length < 3 ? (
          <p className="muted">Select {3 - selected.length} more coin{selected.length === 2 ? "" : "s"} above to start allocating.</p>
        ) : (
          <>
            <div className="splitbar" aria-hidden>
              {selected.map((s, i) => {
                const units = alloc.get(s) ?? 0;
                return (
                  <div key={s} className={`seg s${i}`} style={{ width: `${units * 10}%` }}>
                    {units > 0 ? `${s} $${units * 100}` : ""}
                  </div>
                );
              })}
              {remaining > 0 ? (
                <div className="seg rest" style={{ width: `${remaining * 10}%` }}>${remaining * 100} free</div>
              ) : null}
            </div>
            <div style={{ marginTop: 10 }}>
              {selected.map((s) => (
                <div key={s} className="alloc-row">
                  <span className="sym">{s}</span>
                  <span className="tiny">{alloc.get(s)} × $100</span>
                  <span className="step">
                    <button onClick={() => step(s, -1)} disabled={(alloc.get(s) ?? 0) <= 1}>−</button>
                    <span className="amt">${(alloc.get(s) ?? 0) * 100}</span>
                    <button onClick={() => step(s, 1)} disabled={remaining <= 0}>+</button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="err">{err}</p>
        <button className="cta" disabled={!valid || locking} onClick={lockIn}>
          {locking ? "Locking…" : valid ? "Lock it in" : remaining > 0 && selected.length === 3 ? `$${remaining * 100} unallocated` : "Lock it in"}
        </button>
        <p className="tiny" style={{ marginTop: 8 }}>
          Locking is final — it opens the room, where you&apos;ll see everyone else&apos;s picks.
        </p>
      </div>
    </>
  );
}
