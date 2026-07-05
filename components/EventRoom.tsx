"use client";

// The event room (Live Room mockup): my picks ticking, my $1,000 bar,
// standings re-ranking live, per-event chat. One ~15s poll drives everything.
// Lock-gated server-side; this component assumes admission.

import { useCallback, useEffect, useRef, useState } from "react";
import { priceLabel, sortAllocations } from "@/lib/format";
import { chipTextColor, FALLBACK_COIN_COLOR } from "@/lib/colors";
import { COIN_INFO } from "@/lib/coininfo";
import CoinCard from "@/components/CoinCard";
import Avatar from "@/components/Avatar";

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
  // Identity ring: the brand color of the biggest holding (canonical order
  // from sortAllocations breaks ties). No bag data → neutral ring.
  const ringOf = (allocs: Alloc[]) =>
    allocs.length ? colorOf(sortAllocations(allocs)[0].symbol) : "var(--line)";
  // Chat wears the same identity: avatar/ring/rank come from standings —
  // chat is lock-gated, so every chatter is on the board (no API change).
  const byId = new Map(data.standings.map((s) => [s.playerId, s]));
  const podium = data.closed ? data.standings.slice(0, 3) : [];
  const statusLine =
    data.phase === "open" ? "Picks are in — the ride starts at midnight ET." :
    data.phase === "locked" ? "Live — riding to the 4pm mark." :
    data.phase === "adjudicating" ? "4pm mark — settling the board…" :
    "Final board.";

  // Coins in play: every coin anyone locked, best-performer first, with how many
  // players hold it and my own stake (to mark mine). Perf reads from the 00:00
  // start once the gun fires (reconciles with the bags), else the 24h ticker.
  const perfFromStart = data.quotes.some((x) => x.pctFromStart != null);
  const quoteBy = new Map(data.quotes.map((q) => [q.symbol, q]));
  const holdBy = new Map<string, { count: number; myUnits: number }>();
  for (const s of data.standings) {
    for (const a of s.allocations) {
      const cur = holdBy.get(a.symbol) ?? { count: 0, myUnits: 0 };
      cur.count += 1;
      if (s.playerId === me) cur.myUnits = a.units;
      holdBy.set(a.symbol, cur);
    }
  }
  const pool = Object.keys(data.colors);
  const coinsInPlay = pool
    .map((symbol) => {
      const h = holdBy.get(symbol) ?? { count: 0, myUnits: 0 };
      const q = quoteBy.get(symbol);
      const perf = q ? q.pctFromStart ?? q.pct ?? null : null;
      return { symbol, count: h.count, myUnits: h.myUnits, q, perf };
    })
    .sort((a, b) => (b.perf ?? -Infinity) - (a.perf ?? -Infinity));

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
            <div className="heroline">
              <Avatar url={mine.avatarUrl} name={mine.displayName} size={52} ring={ringOf(mine.allocations)} />
              <p style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>
                {dollars(mine.valueCents)}{" "}
                <span className={mine.pct >= 0 ? "pos" : "neg"} style={{ fontSize: 14 }}>
                  {mine.pct >= 0 ? "+" : ""}{mine.pct.toFixed(2)}%
                </span>{" "}
                <span className="tiny">
                  · you&apos;re #{mine.placement}
                  {lockTimeET(mine.lockedAt) ? ` · 🔒 ${lockTimeET(mine.lockedAt)}` : ""}
                </span>
              </p>
            </div>
          </>
        ) : null}
      </div>

      {!data.closed && coinsInPlay.length ? (
        <div className="card">
          {/* The whole pool, best-performer first — so you can see the coins you
              didn't take, too. Perf measures from the 00:00 snapshot once the gun
              fires (reconciles with the bags), else the 24h ticker. Your own picks
              are tinted + carry a "You" chip. */}
          <h2>
            Every coin{" "}
            <span className="tiny" style={{ fontWeight: 400 }}>
              {perfFromStart ? "± since the midnight start" : "± last 24h"} · best to worst
            </span>
          </h2>
          <div className="rows">
            {coinsInPlay.map((c, i) => {
              const color = colorOf(c.symbol);
              const hasInfo = Boolean(COIN_INFO[c.symbol]);
              const mineCoin = c.myUnits > 0;
              return (
                <div
                  key={c.symbol}
                  className={`row${mineCoin ? " me" : ""}`}
                  style={hasInfo ? { cursor: "pointer" } : undefined}
                  onClick={hasInfo ? () => setInfoFor(c.symbol) : undefined}
                >
                  <span className="rank">{i + 1}</span>
                  <span
                    style={{
                      background: color, color: chipTextColor(color),
                      borderRadius: 7, padding: "3px 9px", fontWeight: 800,
                      fontSize: 12.5, letterSpacing: ".2px", flexShrink: 0,
                    }}
                  >
                    {c.symbol}
                  </span>
                  <span className="tiny" style={{ whiteSpace: "nowrap" }}>
                    {c.count === 0 ? "no takers" : `${c.count} holder${c.count === 1 ? "" : "s"}`}
                  </span>
                  {mineCoin ? (
                    <span className="chip" style={{ background: color, color: chipTextColor(color) }}>
                      You ${c.myUnits * 100}
                    </span>
                  ) : null}
                  <span className="val">{c.q ? priceLabel(c.q.price) : "—"}</span>
                  <span className={`pct ${c.perf != null && c.perf >= 0 ? "pos" : "neg"}`}>
                    {c.perf != null ? `${c.perf >= 0 ? "+" : ""}${c.perf.toFixed(2)}%` : ""}
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
        {podium.length ? (
          <div className="podium">
            {/* #1 center at 64px w/ gold ring; #2/#3 flank at 52px. <3 players: rank order. */}
            {(podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium).map((s) => (
              <div key={s.playerId} className={`p${s.placement === 1 ? " first" : ""}`}>
                <Avatar
                  url={s.avatarUrl}
                  name={s.displayName}
                  size={s.placement === 1 ? 64 : 52}
                  ring={s.placement === 1 ? "var(--gold)" : ringOf(s.allocations)}
                />
                <span className="pname">{s.placement === 1 ? "🏆 " : ""}{s.displayName}</span>
                <span className="pval">{dollars(s.valueCents)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rows">
          {data.standings.map((s) => (
            <div key={s.playerId} className={`row${s.playerId === me ? " me" : ""}${data.closed && s.placement === 1 ? " winner" : ""}`}>
              <span className="rank">{s.placement}</span>
              <Avatar
                url={s.avatarUrl}
                name={s.displayName}
                size={data.closed && s.placement === 1 ? 48 : 40}
                ring={data.closed && s.placement === 1 ? "var(--gold)" : ringOf(s.allocations)}
              />
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
            {msgs.map((m, i) => {
              const prev = i > 0 ? msgs[i - 1] : null;
              const grouped = prev != null && prev.playerId === m.playerId &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 180000;
              const p = byId.get(m.playerId);
              return (
                <div key={m.id} className={`msg${grouped ? " grouped" : ""}`}>
                  {grouped ? (
                    <span className="msg-spacer" />
                  ) : (
                    <Avatar
                      url={p?.avatarUrl ?? null}
                      name={m.displayName}
                      size={30}
                      ring={p ? ringOf(p.allocations) : "var(--line)"}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    {grouped ? null : (
                      <div className="name">
                        {m.displayName}
                        {p ? <span className="tiny"> · #{p.placement}</span> : null}
                      </div>
                    )}
                    <div className="body">{m.body}</div>
                  </div>
                </div>
              );
            })}
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
