// The Pearfit API client. These are the only two network calls the app makes:
//   GET  {base}/api/candidates  -> [{ id, name, garmentType, sizes }]
//   POST {base}/api/recommend   -> { size, confidence, matchPercent, fitsLike, verdict, notes, garmentType, sizes, similar }
// The base URL is passed in (it comes from src/config.ts), and so is fetch, which keeps this file testable.
import { DIMS, GARMENT_TYPES } from "./types.ts";
import type { Confidence, GarmentType, Measurements, PickerCandidate, RecommendRequest, RecommendResponse, SimilarShirt, SizeMatch } from "./types.ts";

// network: no answer at all (offline, or the browser blocked the call because of CORS)
// http:    the API answered with an error status
// invalid: the API answered 200 with something that is not the agreed shape
export type ApiErrorKind = "network" | "http" | "invalid";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

export interface CallOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export async function getCandidates(baseUrl: string, options: CallOptions = {}): Promise<PickerCandidate[]> {
  return parseCandidates(await call(`${baseUrl}/api/candidates`, { method: "GET" }, options));
}

export async function postRecommend(
  baseUrl: string,
  request: RecommendRequest,
  options: CallOptions = {},
): Promise<RecommendResponse> {
  // Content-Type is the only header the API's CORS rules allow on this call. Do not add others.
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) };
  return parseRecommendResponse(await call(`${baseUrl}/api/recommend`, init, options));
}

async function call(url: string, init: RequestInit, { fetchFn = fetch, signal }: CallOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal });
  } catch (e) {
    if (signal?.aborted) throw e; // the caller cancelled the request: not a failure to report
    throw new ApiError("network", "Could not reach the Pearfit API.");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    // The API explains every error as { "error": "..." }.
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `The Pearfit API answered with HTTP ${res.status}.`;
    throw new ApiError("http", message, res.status);
  }
  return body;
}

function invalid(what: string): never {
  throw new ApiError("invalid", `The Pearfit API sent an answer this app does not understand (${what}).`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A garment type this version of the app does not know yet is shown as "other".
function parseGarmentType(v: unknown): GarmentType {
  return GARMENT_TYPES.includes(v as GarmentType) ? (v as GarmentType) : "other";
}

// A measurement that is missing or not a number stays null. Nothing is invented.
function parseChartRow(v: unknown): Measurements {
  const row = isRecord(v) ? v : {};
  const out = {} as Measurements;
  for (const dim of DIMS) {
    const n = row[dim];
    out[dim] = typeof n === "number" && Number.isFinite(n) ? n : null;
  }
  return out;
}

export function parseCandidates(raw: unknown): PickerCandidate[] {
  if (!Array.isArray(raw)) invalid("the candidate list is not an array");
  return raw.map((entry: unknown, i: number) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || !isRecord(entry.sizes)) {
      invalid(`candidate ${i + 1} has no id, name or sizes`);
    }
    const sizes: Record<string, Measurements> = {};
    for (const [size, row] of Object.entries(entry.sizes)) sizes[size] = parseChartRow(row);
    return { id: entry.id, name: entry.name, garmentType: parseGarmentType(entry.garmentType), sizes };
  });
}

const isPercent = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// `sizes` and `similar` are missing from answers saved on the device before the API sent them: that reads as an
// empty list. A list that is there but has the wrong shape is an error like any other field.
function parseSizes(raw: unknown): SizeMatch[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) invalid("sizes");
  return raw.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.size !== "string") invalid("sizes");
    const { size, matchPercent, fitsLike } = entry;
    if (matchPercent !== null && !isPercent(matchPercent)) invalid("sizes");
    if (fitsLike !== null && typeof fitsLike !== "string") invalid("sizes");
    return { size, matchPercent, fitsLike };
  });
}

function parseSimilar(raw: unknown): SimilarShirt[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) invalid("similar");
  return raw.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.shirtId !== "string" || !isPercent(entry.matchPercent)) invalid("similar");
    return { shirtId: entry.shirtId, matchPercent: entry.matchPercent };
  });
}

const CONFIDENCE_LEVELS: readonly Confidence[] = ["high", "medium", "low"];

export function parseRecommendResponse(raw: unknown): RecommendResponse {
  if (!isRecord(raw)) invalid("the recommendation is not an object");
  const { size, confidence, matchPercent, fitsLike, verdict, notes } = raw;
  if (size !== null && typeof size !== "string") invalid("size");
  if (!CONFIDENCE_LEVELS.includes(confidence as Confidence)) invalid("confidence");
  if (matchPercent !== null && (typeof matchPercent !== "number" || !Number.isFinite(matchPercent))) invalid("matchPercent");
  if (fitsLike !== null && typeof fitsLike !== "string") invalid("fitsLike");
  if (typeof verdict !== "string") invalid("verdict");
  if (!Array.isArray(notes) || notes.some((n) => typeof n !== "string")) invalid("notes");
  return {
    size,
    confidence: confidence as Confidence,
    matchPercent,
    fitsLike,
    verdict,
    notes: notes as string[],
    garmentType: parseGarmentType(raw.garmentType),
    sizes: parseSizes(raw.sizes),
    similar: parseSimilar(raw.similar),
  };
}
