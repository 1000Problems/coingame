"use client";

// The event room (Live Room mockup): my picks ticking, my $1,000 bar,
// standings re-ranking live, per-event chat. One ~15s poll drives everything.
// Lock-gated server-side; this component assumes admission.

import { useCallback, useEffect, useRef, useState } from "react";
import { priceLabel, sortAllocations } from "@/lib/format";
import { chipTextColor, FALLBACK_COIN_COLOR } from "@/lib/colors";
import { COIN_INFO } from "@/lib/coininfo";
import CoinCard from "@/components/CoinCard";

type Alloc = { symbol: string; units: number };
type Standing = {
  playerId: string; displayName: string; avatarUrl: string | null;
  valueCents: number; pct: number; placement: number; allocations: Alloc[];
  lockedAt: string | null;
};
type Quote = {
  symbol: string; price: number;
  pct: number; // 24h ticker change
  startPrice?: number | null; pctFromStart?: number | null; // TASK-coingame-13
};
type Msg = { id: string; playerId: string; displayName: string; body: string; createdAt: string };

type RoomPayload = {
  phase: "open" | "locked" | "adjudicating" | "closed";
  closed: boolean;
  quotes: Quote[];
  colors: Record<string, string>;
  standings: Standing[];
  chat: Msg[];
  nextCursor: string | null;
  me: { playerId: string; locked: boolean };
  error?: string;
};

const lockFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit",
});
function lockTimeET(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${lockFmt.format(d)} ET`;
}

function dollars(cents: number): string {
  const d = Math.floor(Math.abs(cents) / 100);
  const c = Math.abs(cents) % 100;
  return `${cents < 0 ? "-" : ""}$${d.toLocaleString("en-US")}.${String(c).padStart(2, "0")}`;
}

export default function EventRoom({
  eventRef, dateLabel, me,
}: {
  eventRef: string;
  dateLabel: string;
  me: string;
}) {
  const [data, setData] = useState<RoomPayload | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const chatEnd = useRef<HTMLDivElement | null>(null);

  const poll = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ eventRef });
      if (cursor.current) qs.set("after", cursor.current);
      const r = await fetch(`/api/room?${qs}`, { cache: "no-store" });
      if (!r.ok) return;
      const j: RoomPayload = await r.json();
      setData(j);
      if (Array.isArray(j.chat) && j.chat.length) {
        setMsgs((prev) => {
          const add = j.chat.filter((m) => !seen.current.has(m.id));
          add.forEach((m) => seen.current.add(m.id));
          return [...prev, ...add];
        });
      }
      if (j.nextCursor) cursor.current = j.nextCursor;
    } catch {}
  }, [eventRef]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setErr("");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventRef, body }),
      });
      if (!r.ok) { setErr((await r.json()).error ?? "couldn't send"); return; }
      poll(); // pull the message (and anyone else's) right away
    } catch { setErr("network hiccup"); }
  }

  if (!data) return <div className="card"><p className="muted">Loading the room…</p></div>;

  const mine = data.standings.find((s) => s.playerId === me);
  const colorOf = (s: string) => data.colors?.[s] ?? FALLBACK_COIN_COLOR;
  const statusLine =
    data.phase === "open" ? "Picks are in — the ride starts at midnight ET." :
    data.phase === "locked" ? "Live — riding to the 4pm mark." :
    data.phase === "adjudicating" ? "4pm mark — settling the board…" :
    "Final board.";

  return (
    <>
      <div className="card">
        <h2>{dateLabel} · The Room <span className={`pill ${data.phase}`}>{data.phase}</span></h2>
        <p className="muted">{statusLine}</p>
        {mine ? (
          <>
            <div className="splitbar" style={{ marginTop: 8 }}>
              {sortAllocations(mine.allocations).map((a) => (
                <div
                  key={a.symbol}
                  className="seg"
                  style={{ width: `${a.units * 10}%`, background: colorOf(a.symbol), color: chipTextColor(colorOf(a.symbol)) }}
                >
                  {a.symbol} ${a.units * 100}
                </div>
              ))}
            </div>
            <p style={{ margin: "8px 0 0", fontWeight: 800, fontSize: 18 }}>
              {dollars(mine.valueCents)}{" "}
              <span className={mine.pct >= 0 ? "pos" : "neg"} style={{ fontSize: 14 }}>
                {mine.pct >= 0 ? "+" : ""}{mine.pct.toFixed(2)}%
              </span>{" "}
              <span className="tiny">
                · you&apos;re #{mine.placement}
                {lockTimeET(mine.lockedAt) ? ` · 🔒 ${lockTimeET(mine.lockedAt)}` : ""}
              </span>
            </p>
          </>
        ) : null}
      </div>

      {!data.closed && data.quotes.length && mine ? (
        <div className="card">
          {/* Once the gun fires, per-coin ± measures from the 00:00 snapshot —
              the number that reconciles with the bag ± above. Pre-game it's
              the 24h ticker (there is no "start" yet). */}
          <h2>
            Your picks{" "}
            <span className="tiny" style={{ fontWeight: 400 }}>
              {data.quotes.some((x) => x.pctFromStart != null) ? "± since the midnight start" : "± last 24h"}
            </span>
          </h2>
          <div className="rows">
            {sortAllocations(mine.allocations).map((a) => {
              const q = data.quotes.find((x) => x.symbol === a.symbol);
              const shown = q ? q.pctFromStart ?? q.pct : null;
              const hasInfo = Boolean(COIN_INFO[a.symbol]);
              return (
                <div
                  key={a.symbol}
                  className="row"
                  style={hasInfo ? { cursor: "pointer" } : undefined}
                  onClick={hasInfo ? () => setInfoFor(a.symbol) : undefined}
                >
                  <span className="who">{a.symbol}</span>
                  <span className="tiny">${a.units * 100}</span>
                  <span className="val">{q ? priceLabel(q.price) : "—"}</span>
                  <span className={`pct ${shown != null && shown >= 0 ? "pos" : "neg"}`}>
                    {shown != null ? `${shown >= 0 ? "+" : ""}${shown.toFixed(2)}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>{data.closed ? "Final board" : "Room standings"}</h2>
        <p className="tiny">
          {data.standings.length} player{data.standings.length === 1 ? "" : "s"}
          {data.closed ? "" : " · re-ranks live"} · equal bags? the earlier 🔒 wins
        </p>
        <div className="rows">
          {data.standings.map((s) => (
            <div key={s.playerId} className={`row${s.playerId === me ? " me" : ""}${data.closed && s.placement === 1 ? " winner" : ""}`}>
              <span className="rank">{s.placement}</span>
              {s.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- host-rendered SVG avatar (contract §2)
                <img className="avatar" src={s.avatarUrl} alt="" width={28} height={28} />
              ) : (
                <span className="avatar" />
              )}
              <span className="who">
                {data.closed && s.placement === 1 ? "🏆 " : ""}{s.displayName}{s.playerId === me ? " (you)" : ""}
                {lockTimeET(s.lockedAt) ? (
                  <span className="tiny" style={{ display: "block", fontWeight: 400 }}>🔒 {lockTimeET(s.lockedAt)}</span>
                ) : null}
              </span>
              {/* Canonical order at render too — covers bags locked pre-TASK-11. */}
              <span className="chips">
                {sortAllocations(s.allocations).map((a) => (
                  <span
                    key={a.symbol}
                    className="chip"
                    style={{ background: colorOf(a.symbol), color: chipTextColor(colorOf(a.symbol)) }}
                  >
                    {a.symbol} {a.units}
                  </span>
                ))}
              </span>
              <span className="val">{dollars(s.valueCents)}</span>
              <span className={`pct ${s.pct >= 0 ? "pos" : "neg"}`}>{s.pct >= 0 ? "+" : ""}{s.pct.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </div>

      {data.me.locked && !data.closed ? (
        <div className="card">
          <h2>Room chat</h2>
          <div className="chatbox">
            {msgs.map((m) => (
              <div key={m.id} className="msg">
                <div>
                  <div className="name">{m.displayName}</div>
                  <div className="body">{m.body}</div>
                </div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <form className="chatform" onSubmit={send}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Say something…"
              maxLength={500}
            />
            <button type="submit">Send</button>
          </form>
          <p className="err">{err}</p>
        </div>
      ) : null}
      {infoFor ? (
        <CoinCard
          symbol={infoFor}
          color={colorOf(infoFor)}
          price={data.quotes.find((q) => q.symbol === infoFor)?.price}
          pct={data.quotes.find((q) => q.symbol === infoFor)?.pct}
          pctFromStart={data.quotes.find((q) => q.symbol === infoFor)?.pctFromStart ?? undefined}
          onClose={() => setInfoFor(null)}
        />
      ) : null}
    </>
  );
}
