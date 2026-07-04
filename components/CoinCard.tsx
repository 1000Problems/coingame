"use client";

// Coin info pop-up (TASK-coingame-09): brand-color header, live price, intro,
// and a rotating "Did you know?" fact. Closes on ×, backdrop, or Escape.

import { useEffect, useState } from "react";
import { COIN_INFO } from "@/lib/coininfo";
import { priceLabel } from "@/lib/format";
import { chipTextColor } from "@/lib/colors";

export default function CoinCard({
  symbol, color, price, pct, pctFromStart, onClose,
}: {
  symbol: string;
  color: string;
  price?: number;
  pct?: number;
  pctFromStart?: number; // ± vs the 00:00 snapshot, only once the ride is on
  onClose: () => void;
}) {
  const info = COIN_INFO[symbol];
  const [factIdx, setFactIdx] = useState(() =>
    info ? Math.floor(Math.random() * info.facts.length) : 0,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!info) return null;

  return (
    <div className="cardveil" onClick={onClose} role="presentation">
      <div className="coincard" role="dialog" aria-modal="true" aria-label={`About ${symbol}`} onClick={(e) => e.stopPropagation()}>
        <div className="coincard-head" style={{ background: color, color: chipTextColor(color) }}>
          <span className="coincard-sym">{symbol}</span>
          {price !== undefined ? (
            <span className="coincard-px">
              {priceLabel(price)}
              {pct !== undefined ? (
                <span className="coincard-pct"> {pct >= 0 ? "+" : ""}{pct.toFixed(2)}% 24h</span>
              ) : null}
              {pctFromStart !== undefined ? (
                <span className="coincard-pct"> · {pctFromStart >= 0 ? "+" : ""}{pctFromStart.toFixed(2)}% since start</span>
              ) : null}
            </span>
          ) : null}
          <button className="coincard-x" style={{ color: chipTextColor(color) }} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="coincard-body">
          <p className="coincard-intro">{info.intro}</p>
          <div className="coincard-fact">
            <span className="coincard-factlabel">Did you know?</span>
            <p>{info.facts[factIdx]}</p>
          </div>
          <button
            className="coincard-next"
            onClick={() => setFactIdx((i) => (i + 1) % info.facts.length)}
          >
            Next fact ({factIdx + 1}/{info.facts.length})
          </button>
        </div>
      </div>
    </div>
  );
}
