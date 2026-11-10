// Request validation and response shaping for the API. Pure: no I/O, no network, so it is tested directly.
import { garmentTypeOf } from "../src/recommend.ts";
import type { Candidate, Confidence, GarmentType, Measurements, OwnedShirt, Recommendation } from "../src/types.ts";
import { parseWardrobe } from "../cli/validate.ts";
import { MAX_WARDROBE_SHIRTS, PICKER_GARMENT_TYPES } from "./config.ts";

export type RecommendRequest = { wardrobe: OwnedShirt[]; candidateId: string };
export type Validation = ({ ok: true } & RecommendRequest) | { ok: false; error: string };

const MAX_CANDIDATE_ID_LENGTH = 100;

// The wardrobe goes through the same validation as the wardrobe files (cli/load.ts parseWardrobe).
export function validateRecommendRequest(body: unknown): Validation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object like {"wardrobe": [...], "candidateId": "..."}.' };
  }
  const { wardrobe, candidateId } = body as Record<string, unknown>;

  if (typeof candidateId !== "string" || candidateId.trim() === "" || candidateId.length > MAX_CANDIDATE_ID_LENGTH) {
    return { ok: false, error: `"candidateId" must be a non-empty string of at most ${MAX_CANDIDATE_ID_LENGTH} characters.` };
  }
  if (!Array.isArray(wardrobe) || wardrobe.length === 0) {
    return { ok: false, error: '"wardrobe" must be a non-empty array of owned shirts.' };
  }
  if (wardrobe.length > MAX_WARDROBE_SHIRTS) {
    return { ok: false, error: `"wardrobe" has ${wardrobe.length} shirts; the limit is ${MAX_WARDROBE_SHIRTS}.` };
  }
  try {
    return { ok: true, wardrobe: parseWardrobe(wardrobe, "wardrobe"), candidateId: candidateId.trim() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface RecommendResponse {
  size: string | null;
  confidence: Confidence;
  matchPercent: number | null; // the best owned shirt's match for the recommended size
  fitsLike: string | null; // that owned shirt's id
  verdict: string;
  notes: string[];
  garmentType: GarmentType;
}

// Nothing is invented: with no recommendation, size, matchPercent and fitsLike are null.
export function toRecommendResponse(rec: Recommendation, candidate: Candidate): RecommendResponse {
  const best = rec.size === null ? undefined : rec.ranking[0];
  return {
    size: rec.size,
    confidence: rec.confidence,
    matchPercent: best ? best.matchPct : null,
    fitsLike: best ? best.shirtId : null,
    verdict: rec.verdict,
    notes: rec.notes,
    garmentType: garmentTypeOf(candidate),
  };
}

export interface PickerCandidate {
  id: string;
  name: string;
  garmentType: GarmentType;
  sizes: Record<string, Measurements>;
}

const hasAnyMeasurement = (m: Measurements) => m.chest_cm !== null || m.length_cm !== null || m.sleeve_cm !== null;

// Only candidates the engine can size: a type we compare (PICKER_GARMENT_TYPES) and at least one measurement on
// some size. A candidate whose chart is all nulls can never get a recommendation, so it is not offered.
export function toPickerCandidates(candidates: Candidate[]): PickerCandidate[] {
  return candidates
    .filter((c) => PICKER_GARMENT_TYPES.includes(garmentTypeOf(c)) && Object.values(c.sizes).some(hasAnyMeasurement))
    .map((c) => ({ id: c.id, name: c.name, garmentType: garmentTypeOf(c), sizes: c.sizes }));
}
