// Game clock (TASK-coingame-12). Display-only, computed from the wall clock —
// no stored state, same philosophy as phaseOf. Before the start gun: countdown
// to 00:00 ET. While riding: countdown to the 16:00 ET finish. After: "Ended".
"use client";

import { useEffect, useState } from "react";

function fmt(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function GameTimer({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  // Empty until the first client tick — server and first client render match.
  const [label, setLabel] = useState("");

  useEffect(() => {
    const start = new Date(startsAt).getTime();
    const end = new Date(endsAt).getTime();
    const tick = () => {
      const now = Date.now();
      if (now >= end) { setLabel("Ended"); return; }
      if (now >= start) { setLabel(`Ends in ${fmt(end - now)}`); return; }
      setLabel(`Starts in ${fmt(start - now)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startsAt, endsAt]);

  return <span className="gametimer">{label}</span>;
}
