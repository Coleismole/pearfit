// Text for the numbers and enum values the app shows. Display only: nothing here decides a size.
import { round1 } from "./units.ts";
import type { Confidence, Dim, FitLabel, GarmentType } from "./types.ts";

export const DIM_LABELS: Record<Dim, string> = {
  chest_cm: "Chest width",
  length_cm: "Length",
  sleeve_cm: "Sleeve length",
};

// The words for a bigger and a smaller value. For the chest they are the engine's own ("looser", "tighter").
export const DIM_WORDS: Record<Dim, { more: string; less: string }> = {
  chest_cm: { more: "looser", less: "tighter" },
  length_cm: { more: "longer", less: "shorter" },
  sleeve_cm: { more: "longer", less: "shorter" },
};

// `one` and `many` are labels. `text` is the plural as it reads inside a sentence ("New tees are sized against…").
export const GARMENT_NAMES: Record<GarmentType, { one: string; many: string; text: string }> = {
  tee: { one: "Tee", many: "Tees", text: "tees" },
  tee_long_sleeve: { one: "Long-sleeve tee", many: "Long-sleeve tees", text: "long-sleeve tees" },
  polo: { one: "Polo", many: "Polos", text: "polos" },
  button_shirt: { one: "Button shirt", many: "Button shirts", text: "button shirts" },
  jacket: { one: "Jacket", many: "Jackets", text: "jackets" },
  other: { one: "Other", many: "Other", text: "shirts of this kind" },
};

export const FIT_NAMES: Record<FitLabel, { choice: string; badge: string }> = {
  great: { choice: "Great", badge: "Great fit" },
  tight: { choice: "Tight", badge: "Tight" },
  loose: { choice: "Loose", badge: "Loose" },
};

export const CONFIDENCE_NAMES: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export const NOT_MEASURED = "—";

// 54 -> "54 cm", 57.5 -> "57.5 cm", null -> "—"
export function formatCm(value: number | null): string {
  return value === null ? NOT_MEASURED : `${round1(value)} cm`;
}

// 67.6 -> "68%". null (no recommendation) -> "—"
export function formatPercent(value: number | null): string {
  return value === null ? NOT_MEASURED : `${Math.round(value)}%`;
}

// ["XS", "S", "M"] -> "XS to M"
export function sizeRange(sizes: readonly string[]): string {
  if (sizes.length === 0) return "No sizes";
  return sizes.length === 1 ? sizes[0] : `${sizes[0]} to ${sizes[sizes.length - 1]}`;
}

export function capitalize(text: string): string {
  return text === "" ? text : text[0].toUpperCase() + text.slice(1);
}

// 3 -> "3 shirts", 1 -> "1 shirt"
export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
