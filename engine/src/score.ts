import type { Dim, Ease, Measurements } from "./types.ts";
import { DIMS } from "./types.ts";

// candidate - reference for each dimension measured on both shirts.
export function easeVector(candidate: Measurements, reference: Measurements): Ease {
  const ease: Ease = {};
  for (const dim of DIMS) {
    const c = candidate[dim];
    const r = reference[dim];
    if (c !== null && r !== null) ease[dim] = c - r;
  }
  return ease;
}

// Weighted mean of absolute ease. Divides by the weights actually present, so a missing
// measurement never makes a shirt look closer. Returns null when nothing is comparable.
export function distance(ease: Ease, weights: Record<Dim, number>): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const dim of DIMS) {
    const e = ease[dim];
    if (e === undefined) continue;
    weighted += weights[dim] * Math.abs(e);
    totalWeight += weights[dim];
  }
  return totalWeight === 0 ? null : weighted / totalWeight;
}

export function matchPct(dist: number, scaleCm: number): number {
  return round(100 * Math.exp(-dist / scaleCm), 1);
}

export function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
