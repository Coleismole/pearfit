import type { ScorerConfig } from "./config.ts";
import { TOPS } from "./config.ts";
import type { Dim, Ease, Recommendation, ShirtMatch } from "./types.ts";
import { DIMS } from "./types.ts";
import { distance, round } from "./score.ts";

// Why the engine's pick differed from the size the person knows fits.
//   measurements:       the chosen size really was closer to the wardrobe than the correct size
//   tie_break:          measurements did not prefer the chosen size; it won a near-tie (review signal or size order)
//   correct_unscorable: the correct size shares no measurement with any great shirt, so it could never win
//   no_pick:            the engine recommended nothing
export type MissCause = "measurements" | "tie_break" | "correct_unscorable" | "no_pick";

// One dimension of the chosen-vs-correct comparison. Each size is compared against its own closest great
// shirt. A share is that dimension's part of the size's distance (cm), so the shares of a size add up to its
// distance. swing = correctShare - chosenShare: positive means this dimension made the correct size look worse
// than the chosen one (it pushed toward the wrong pick); negative means it favoured the correct size.
export interface DimGap {
  dim: Dim;
  chosenEase: number | null; // null = dimension not compared (missing on either shirt)
  correctEase: number | null;
  chosenShare: number;
  correctShare: number;
  swing: number;
}

export interface MissAnalysis {
  cause: MissCause;
  chosenSize: string | null;
  correctSize: string;
  sizesOff: number | null;
  direction: "too_small" | "too_large" | null; // what the chosen size was, relative to the correct one
  chosenShirtId: string | null;
  correctShirtId: string | null;
  chosenDistance: number | null; // cm, 2 decimals
  correctDistance: number | null;
  margin: number | null; // correctDistance - chosenDistance. Positive = measurements preferred the chosen size.
  gaps: DimGap[]; // one per dimension, in DIMS order. Empty when either size could not be scored.
  driver: Dim | null; // dimension with the largest positive swing, only when cause is "measurements"
}

// Returns null when the engine picked the correct size.
export function analyzeMiss(r: Recommendation, correctSize: string, cfg: ScorerConfig = TOPS): MissAnalysis | null {
  if (r.size === correctSize) return null;
  const order = r.sizes.map((s) => s.size);
  const correctIdx = order.indexOf(correctSize);
  if (correctIdx === -1) throw new Error(`${r.candidateId} has no size "${correctSize}"`);

  const chosenIdx = r.size === null ? -1 : order.indexOf(r.size);
  const chosen: ShirtMatch | undefined = r.sizes[chosenIdx]?.matches[0];
  const correct: ShirtMatch | undefined = r.sizes[correctIdx].matches[0];

  const result: MissAnalysis = {
    cause: "no_pick",
    chosenSize: r.size,
    correctSize,
    sizesOff: r.size === null ? null : Math.abs(chosenIdx - correctIdx),
    direction: r.size === null ? null : chosenIdx < correctIdx ? "too_small" : "too_large",
    chosenShirtId: chosen?.shirtId ?? null,
    correctShirtId: correct?.shirtId ?? null,
    chosenDistance: null,
    correctDistance: null,
    margin: null,
    gaps: [],
    driver: null,
  };
  if (r.size === null) return result;
  if (!chosen || !correct) {
    if (chosen) result.chosenDistance = round(distance(chosen.ease, cfg.weights)!, 2);
    return { ...result, cause: "correct_unscorable" };
  }

  const chosenDist = distance(chosen.ease, cfg.weights)!;
  const correctDist = distance(correct.ease, cfg.weights)!;
  const gaps: DimGap[] = DIMS.map((dim) => {
    const chosenShare = share(chosen.ease, dim, cfg);
    const correctShare = share(correct.ease, dim, cfg);
    return {
      dim,
      chosenEase: easeOrNull(chosen.ease, dim),
      correctEase: easeOrNull(correct.ease, dim),
      chosenShare: round(chosenShare, 2),
      correctShare: round(correctShare, 2),
      swing: round(correctShare - chosenShare, 2),
    };
  });

  const cause: MissCause = correctDist - chosenDist > 0 ? "measurements" : "tie_break";
  let driver: Dim | null = null;
  if (cause === "measurements") {
    const top = gaps.reduce((a, b) => (b.swing > a.swing ? b : a));
    driver = top.dim;
  }
  return {
    ...result,
    cause,
    chosenDistance: round(chosenDist, 2),
    correctDistance: round(correctDist, 2),
    margin: round(correctDist - chosenDist, 2),
    gaps,
    driver,
  };
}

// This dimension's part of the weighted mean distance. Divides by the weights present on this comparison,
// the same way distance() does, so the shares of one size sum to its distance.
function share(ease: Ease, dim: Dim, cfg: ScorerConfig): number {
  const e = ease[dim];
  if (e === undefined) return 0;
  let totalWeight = 0;
  for (const d of DIMS) if (ease[d] !== undefined) totalWeight += cfg.weights[d];
  return (cfg.weights[dim] * Math.abs(e)) / totalWeight;
}

function easeOrNull(ease: Ease, dim: Dim): number | null {
  const e = ease[dim];
  return e === undefined ? null : round(e, 2);
}
