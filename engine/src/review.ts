// Turns the stored review numbers into the one review signal the scorer uses. Pure, like the rest of src/.
//
// The signal comes from the skew of the reviews: how far apart the "runs small" and "runs large" shares are.
// The "true to size" share is left out on purpose. The scraper counts every review with no small or large
// comment as true to size, so that share is nearly always the largest, and "which share is largest" says
// nothing about which way the reviews lean.
import type { ScorerConfig } from "./config.ts";
import { TOPS } from "./config.ts";
import type { ReviewSignal, ReviewSummary } from "./types.ts";

// The "runs large" share minus the "runs small" share, in percentage points (-100 to 100).
// Negative = the reviews lean small. Positive = they lean large. 0 = balanced.
export function reviewSkew(summary: ReviewSummary): number {
  return summary.runsLargePct - summary.runsSmallPct;
}

//   null         = nothing to go on: no reviews, or fewer than cfg.reviewMinCount
//   runs_small   = the reviews lean small by cfg.reviewSkewMinPct points or more
//   runs_large   = the same, leaning large
//   true_to_size = enough reviews, and they do not lean either way
// recommend() only uses this to break a near-tie between two sizes. It never moves a clear winner.
export function reviewSignalFrom(summary: ReviewSummary | undefined, cfg: ScorerConfig = TOPS): ReviewSignal {
  if (!summary || summary.total < cfg.reviewMinCount) return null;
  const skew = reviewSkew(summary);
  if (skew <= -cfg.reviewSkewMinPct) return "runs_small";
  if (skew >= cfg.reviewSkewMinPct) return "runs_large";
  return "true_to_size";
}
