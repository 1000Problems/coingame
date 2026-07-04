// Money from integer cents, everywhere. No floats in stored values.

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const d = Math.floor(abs / 100);
  const c = abs % 100;
  return `${sign}$${d.toLocaleString("en-US")}.${String(c).padStart(2, "0")}`;
}

export function pctLabel(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/**
 * Coin prices span $61,800 (BTC) to sub-cent memes — decimals are dynamic:
 * >= $1 → 2dp with thousands separators; < $1 → 4 significant digits
 * ($0.07570, $0.000004325). Chip math never touches this — display only.
 */
export function priceLabel(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "$0.00";
  if (p >= 1) {
    return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const decimals = Math.min(12, 3 - Math.floor(Math.log10(p)));
  return `$${p.toFixed(decimals)}`;
}
