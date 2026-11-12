// File loading and validation. Kept outside src/ so the engine itself stays free of I/O.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Candidate, EvalCase, Measurements, OwnedShirt, ReviewSummary } from "../src/types.ts";
import { fail, parseGarmentType, parseMeasurements, parseWardrobe } from "./validate.ts";

export const DATA_DIR = join(import.meta.dirname, "..", "data");

export function loadWardrobe(owner: string, dataDir = DATA_DIR): OwnedShirt[] {
  const file = join(dataDir, "wardrobes", `${owner}.json`);
  return parseWardrobe(readJson(file), file);
}

export function listOwners(dataDir = DATA_DIR): string[] {
  return readdirSync(join(dataDir, "wardrobes"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));
}

// `file` overrides data/candidates.json, e.g. the exporter's candidates.generated.json. Read-only: nothing here writes.
export function loadCandidates(dataDir = DATA_DIR, file?: string): Candidate[] {
  file = file ? resolve(file) : join(dataDir, "candidates.json");
  const raw = readJson(file);
  if (!Array.isArray(raw)) fail(file, "expected a JSON array of candidates");
  return raw.map((c: any, i: number) => {
    const where = `${file} [${i}]`;
    if (typeof c?.id !== "string") fail(where, "missing id");
    if (![null, undefined, "runs_small", "true_to_size", "runs_large"].includes(c.review)) {
      fail(where, `review must be "runs_small", "true_to_size", "runs_large" or null, got ${JSON.stringify(c.review)}`);
    }
    if (typeof c.sizes !== "object" || c.sizes === null || Object.keys(c.sizes).length === 0) {
      fail(where, "sizes must be an object like { \"S\": {...}, \"M\": {...} }, smallest to largest");
    }
    const sizes: Record<string, Measurements> = {};
    for (const [size, m] of Object.entries(c.sizes)) sizes[size] = parseMeasurements(m, `${where} ${c.id} size ${size}`);
    const garmentType = parseGarmentType(c.garmentType, `${where} ${c.id}`);
    const reviewSummary = parseReviewSummary(c.reviewSummary, `${where} ${c.id}`);
    return {
      id: c.id,
      name: typeof c.name === "string" ? c.name : c.id,
      review: c.review ?? null,
      sizes,
      ...(garmentType ? { garmentType } : {}),
      ...(reviewSummary ? { reviewSummary } : {}),
    };
  });
}

// Optional. When it is there, all four numbers must be: a half-filled summary is a broken export.
function parseReviewSummary(v: any, where: string): ReviewSummary | undefined {
  if (v === undefined || v === null) return undefined;
  const keys = ["total", "runsSmallPct", "trueToSizePct", "runsLargePct"] as const;
  for (const key of keys) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key]) || v[key] < 0) {
      fail(where, `reviewSummary.${key} must be a number of 0 or more, got ${JSON.stringify(v[key])}`);
    }
  }
  return { total: v.total, runsSmallPct: v.runsSmallPct, trueToSizePct: v.trueToSizePct, runsLargePct: v.runsLargePct };
}

export function loadCases(dataDir = DATA_DIR, file?: string): EvalCase[] {
  file = file ? resolve(file) : join(dataDir, "cases.json");
  const raw = readJson(file);
  if (!Array.isArray(raw)) fail(file, "expected a JSON array of cases");
  return raw;
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(file, (e as Error).message);
  }
}
