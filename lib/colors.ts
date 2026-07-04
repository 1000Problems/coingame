// Per-coin display colors. The source of truth is coingame_coin.color (seeded
// brand colors); these helpers only decide what goes ON TOP of a color.
// Safe in client components — pure string math, no DB.

export const FALLBACK_COIN_COLOR = "#8b909c";

/** Readable text color (near-black or near-white) for a hex background. */
export function chipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Perceived luminance (ITU-R BT.601) — cheap and good enough for chips.
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 150 ? "#1f2328" : "#ffffff";
}
