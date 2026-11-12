import { REVIEW_SIGNAL, type ReviewSignalConfig } from "./config.ts";
import type { ReviewSignal } from "./types.ts";

// Turns the stored review shares into a tie-break signal. true_to_size is never returned and its share is never
// read: the scraper files every review without a fit cue under it, so it is the default bucket, not evidence.
// A signal needs enough reviews and a clear lead of runs_small over runs_large (or the reverse). Otherwise null.
export function reviewSignalFromShares(
  total: number,
  runsSmallPct: number,
  runsLargePct: number,
  cfg: ReviewSignalConfig = REVIEW_SIGNAL,
): ReviewSignal {
  if (total < cfg.minReviews) return null;
  const lead = runsSmallPct - runsLargePct;
  if (lead >= cfg.marginPct) return "runs_small";
  if (-lead >= cfg.marginPct) return "runs_large";
  return null;
}
