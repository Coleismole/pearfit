import type { ScorerConfig } from "./config.ts";
import { DEFAULT_GARMENT_TYPE, TOPS } from "./config.ts";
import type {
  Candidate,
  Confidence,
  Dim,
  Ease,
  GarmentType,
  OwnedShirt,
  Recommendation,
  ShirtMatch,
  SizeResult,
} from "./types.ts";
import { DIMS, GARMENT_LABELS } from "./types.ts";
import { distance, easeVector, matchPct, round } from "./score.ts";

const LEVELS: Confidence[] = ["high", "medium", "low"];

export function garmentTypeOf(item: { garmentType?: GarmentType }): GarmentType {
  return item.garmentType ?? DEFAULT_GARMENT_TYPE;
}

export function recommend(
  wardrobe: OwnedShirt[],
  candidate: Candidate,
  cfg: ScorerConfig = TOPS,
): Recommendation {
  const sizeOrder = Object.keys(candidate.sizes);
  // Like is only compared with like: a polo is never sized against a tee.
  const type = garmentTypeOf(candidate);
  const comparable = wardrobe.filter((s) => garmentTypeOf(s) === type);
  const greats = comparable.filter((s) => s.label === "great");

  const sizes: SizeResult[] = sizeOrder.map((size) => ({
    size,
    matches: scoreSize(candidate.sizes[size], greats, cfg),
  }));

  const base = { candidateId: candidate.id, sizes };
  if (comparable.length === 0) {
    return { ...base, size: null, confidence: "low", ranking: [], notes: [],
      verdict: `No comparable shirts in your wardrobe. This is ${GARMENT_LABELS[type]}, and your wardrobe has none.` };
  }
  if (greats.length === 0) {
    return { ...base, size: null, confidence: "low", ranking: [], notes: [],
      verdict: "No shirts labelled great in this wardrobe, so there is nothing to compare against." };
  }

  const scored = sizes
    .filter((s) => s.matches.length > 0)
    .sort((a, b) => a.matches[0].distance - b.matches[0].distance);
  if (scored.length === 0) {
    return { ...base, size: null, confidence: "low", ranking: [], notes: [],
      verdict: "No measurements overlap between this shirt and your wardrobe." };
  }

  const notes: string[] = [];
  let downgrades = 0;
  let pick = scored[0];

  // Review signal only decides near-ties; it never overrides a clear measurement winner.
  const runnerUp = scored[1];
  if (runnerUp && runnerUp.matches[0].distance - pick.matches[0].distance < cfg.tieMarginCm) {
    const pickIdx = sizeOrder.indexOf(pick.size);
    const runIdx = sizeOrder.indexOf(runnerUp.size);
    const larger = pickIdx > runIdx ? pick : runnerUp;
    const smaller = pickIdx > runIdx ? runnerUp : pick;
    if (candidate.review === "runs_small") {
      pick = larger;
      notes.push(`${smaller.size} and ${larger.size} are nearly tied; reviews say it runs small, so ${larger.size}.`);
    } else if (candidate.review === "runs_large") {
      pick = smaller;
      notes.push(`${smaller.size} and ${larger.size} are nearly tied; reviews say it runs large, so ${smaller.size}.`);
    } else {
      notes.push(`${pick.size} and ${runnerUp.size} are nearly tied and there is no review signal to break it.`);
    }
    downgrades++;
  }

  const best = pick.matches[0];
  const pickMeasurements = candidate.sizes[pick.size];

  if (best.ease.chest_cm === undefined) {
    notes.push("Chest is missing on this shirt or your closest match, so the comparison is weaker.");
    downgrades++;
  }

  // Guard: landing on top of a shirt the person already said doesn't fit is a red flag.
  for (const shirt of comparable) {
    if (shirt.label === "great") continue;
    const c = pickMeasurements.chest_cm;
    const r = shirt.measurements.chest_cm;
    if (c !== null && r !== null && Math.abs(c - r) <= cfg.guardChestCm) {
      notes.push(`Chest is within ${cfg.guardChestCm}cm of your ${displayName(shirt.id)}, which you marked ${shirt.label}.`);
      downgrades++;
      break;
    }
  }

  const band = best.distance < cfg.highBelowCm ? 0 : best.distance < cfg.mediumBelowCm ? 1 : 2;
  const confidence = LEVELS[Math.min(band + downgrades, 2)];

  return {
    ...base,
    size: pick.size,
    confidence,
    verdict: verdict(pick.size, best, band, cfg),
    notes,
    ranking: pick.matches,
  };
}

function scoreSize(m: Candidate["sizes"][string], greats: OwnedShirt[], cfg: ScorerConfig): ShirtMatch[] {
  const matches: ShirtMatch[] = [];
  for (const shirt of greats) {
    const ease = easeVector(m, shirt.measurements);
    const d = distance(ease, cfg.weights);
    if (d === null) continue;
    matches.push({ shirtId: shirt.id, distance: round(d, 2), matchPct: matchPct(d, cfg.matchScaleCm), ease });
  }
  return matches.sort((a, b) => a.distance - b.distance);
}

function verdict(size: string, best: ShirtMatch, band: number, cfg: ScorerConfig): string {
  const name = displayName(best.shirtId);
  if (band === 0) return `Get the ${size}, fits like your ${name}.`;
  const gap = describeGap(best.ease, cfg);
  if (band === 1) return `Get the ${size}, closest to your ${name}${gap ? `, ${gap}` : ""}.`;
  return `No close match in your wardrobe. Nearest is the ${size} vs your ${name} (${best.matchPct}% match${gap ? `, ${gap}` : ""}).`;
}

// Describes the gap that matters most (largest weighted difference), e.g. "2.0cm looser in the chest".
function describeGap(ease: Ease, cfg: ScorerConfig): string {
  let worst: Dim | null = null;
  for (const dim of DIMS) {
    const e = ease[dim];
    if (e === undefined || Math.abs(e) < cfg.gapWordingCm) continue;
    if (worst === null || cfg.weights[dim] * Math.abs(e) > cfg.weights[worst] * Math.abs(ease[worst]!)) worst = dim;
  }
  if (worst === null) return "";
  const e = ease[worst]!;
  const cm = `${Math.abs(e).toFixed(1)}cm`;
  if (worst === "chest_cm") return `${cm} ${e > 0 ? "looser" : "tighter"} in the chest`;
  if (worst === "length_cm") return `${cm} ${e > 0 ? "longer" : "shorter"}`;
  return `${cm} ${e > 0 ? "longer" : "shorter"} in the sleeve`;
}

export function displayName(id: string): string {
  return id.replace(/-/g, " ");
}
