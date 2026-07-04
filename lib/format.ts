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

export function priceLabel(p: number): string {
  return `$${p.toFixed(2)}`;
}
