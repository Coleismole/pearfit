// Side-by-side numbers for the compare screens. Plain subtraction for display: the size decision and the match
// percentage come from the API, never from here.
import { DIM_LABELS, DIM_WORDS } from "./format.ts";
import { round1 } from "./units.ts";
import { DIMS } from "./types.ts";
import type { Dim, Measurements } from "./types.ts";

export interface CompareRow {
  dim: Dim;
  a: number | null;
  b: number | null;
  // b minus a in cm, 1 decimal. null when either side is not measured: a missing value is never treated as 0.
  diff: number | null;
}

export function compareRows(a: Measurements, b: Measurements): CompareRow[] {
  return DIMS.map((dim) => {
    const av = a[dim];
    const bv = b[dim];
    return { dim, a: av, b: bv, diff: av === null || bv === null ? null : round1(bv - av) };
  });
}

// "+2 cm", "−1.5 cm", "Same". With `words`, the direction is spelled out: "+2 cm looser".
export function diffText(row: CompareRow, words = false): string {
  if (row.diff === null) return "Not measured";
  if (row.diff === 0) return "Same";
  const amount = `${row.diff > 0 ? "+" : "−"}${Math.abs(row.diff)} cm`;
  if (!words) return amount;
  return `${amount} ${row.diff > 0 ? DIM_WORDS[row.dim].more : DIM_WORDS[row.dim].less}`;
}

// One factual sentence about the rows, for the wardrobe compare screen. `bName` is what the B side is called.
export function biggestDifference(rows: readonly CompareRow[], bName = "B", aName = "A"): string {
  const measured = rows.filter((r) => r.diff !== null);
  if (measured.length === 0) return "These two have no measurement in common, so there is nothing to compare.";
  const top = measured.reduce((best, r) => (Math.abs(r.diff!) > Math.abs(best.diff!) ? r : best));
  if (top.diff === 0) {
    return measured.length === 1
      ? `${DIM_LABELS[top.dim]} is the same on both. It is the only measurement they share.`
      : "Every measurement they share is the same.";
  }
  const word = top.diff! > 0 ? DIM_WORDS[top.dim].more : DIM_WORDS[top.dim].less;
  return `Biggest difference: ${DIM_LABELS[top.dim].toLowerCase()}. ${bName} is ${Math.abs(top.diff!)} cm ${word} than ${aName}.`;
}
