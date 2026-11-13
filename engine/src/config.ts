import type { Dim, GarmentType } from "./types.ts";

// Every tunable number lives here. Starting values are educated guesses; tune them against eval results.
export interface ScorerConfig {
  weights: Record<Dim, number>; // how much each measurement matters
  matchScaleCm: number; // matchPct = 100 * exp(-distance / matchScaleCm)
  highBelowCm: number; // distance under this = high confidence band
  mediumBelowCm: number; // distance under this = medium band, otherwise low
  tieMarginCm: number; // two sizes closer than this count as a near-tie
  guardChestCm: number; // pick within this chest distance of a tight/loose shirt triggers a warning
  gapWordingCm: number; // gaps smaller than this are not mentioned in the verdict
  reviewMinCount: number; // with fewer reviews than this there is no review signal
  reviewSkewMinPct: number; // "runs small" and "runs large" shares this many points apart = the reviews lean (src/review.ts)
}

export const TOPS: ScorerConfig = {
  // Chest makes or breaks a shirt; length and sleeve are more forgiving.
  weights: { chest_cm: 1.0, length_cm: 0.4, sleeve_cm: 0.3 },
  matchScaleCm: 3,
  highBelowCm: 1.5,
  mediumBelowCm: 3,
  tieMarginCm: 0.5,
  guardChestCm: 1,
  gapWordingCm: 0.5,
  // Starting values: the same two numbers the fit guide pages use to say a product leans small or large
  // (MIN_REVIEWS and LEAN_MARGIN_PCT in website/scripts/build-fit-pages.mjs).
  reviewMinCount: 10,
  reviewSkewMinPct: 10,
};

// A candidate or owned shirt with no garmentType is treated as this. Only the same type is compared with the same type.
export const DEFAULT_GARMENT_TYPE: GarmentType = "tee";
