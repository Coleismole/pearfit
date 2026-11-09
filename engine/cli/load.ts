// File loading and validation. Kept outside src/ so the engine itself stays free of I/O.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Candidate, EvalCase, GarmentType, Measurements, OwnedShirt } from "../src/types.ts";
import { DIMS, GARMENT_TYPES } from "../src/types.ts";

export const DATA_DIR = join(import.meta.dirname, "..", "data");

// A flat pit-to-pit chest above this almost certainly means someone entered the full circumference.
const CIRCUMFERENCE_SUSPECT_CM = 80;

export function loadWardrobe(owner: string, dataDir = DATA_DIR): OwnedShirt[] {
  const file = join(dataDir, "wardrobes", `${owner}.json`);
  const raw = readJson(file);
  if (!Array.isArray(raw)) fail(file, "expected a JSON array of shirts");
  const ids = new Set<string>();
  return raw.map((s: any, i: number) => {
    const where = `${file} [${i}]`;
    if (typeof s?.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) {
      fail(where, `id must be lowercase-with-dashes, got ${JSON.stringify(s?.id)}`);
    }
    if (ids.has(s.id)) fail(where, `duplicate id "${s.id}"`);
    ids.add(s.id);
    if (!["great", "tight", "loose"].includes(s.label)) {
      fail(where, `label must be "great", "tight" or "loose", got ${JSON.stringify(s.label)}`);
    }
    const garmentType = parseGarmentType(s.garmentType, `${where} ${s.id}`);
    return {
      id: s.id,
      label: s.label,
      measurements: parseMeasurements(s.measurements, `${where} ${s.id}`),
      ...(garmentType ? { garmentType } : {}),
    };
  });
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
    return {
      id: c.id,
      name: typeof c.name === "string" ? c.name : c.id,
      review: c.review ?? null,
      sizes,
      ...(garmentType ? { garmentType } : {}),
    };
  });
}

export function loadCases(dataDir = DATA_DIR, file?: string): EvalCase[] {
  file = file ? resolve(file) : join(dataDir, "cases.json");
  const raw = readJson(file);
  if (!Array.isArray(raw)) fail(file, "expected a JSON array of cases");
  return raw;
}

// Missing is fine (the engine treats it as a tee). A value that is not a known type is a typo: fail loudly.
function parseGarmentType(v: any, where: string): GarmentType | undefined {
  if (v === undefined || v === null) return undefined;
  if (!GARMENT_TYPES.includes(v)) fail(where, `garmentType must be one of ${GARMENT_TYPES.join(", ")}, got ${JSON.stringify(v)}`);
  return v;
}

function parseMeasurements(m: any, where: string): Measurements {
  if (typeof m !== "object" || m === null) fail(where, "measurements must be an object");
  const out = {} as Measurements;
  for (const dim of DIMS) {
    const v = m[dim];
    if (v === undefined || v === null) {
      out[dim] = null;
    } else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      fail(where, `${dim} must be a positive number or null, got ${JSON.stringify(v)}`);
    } else {
      out[dim] = v;
    }
  }
  const chest = out.chest_cm;
  if (chest !== null && chest > CIRCUMFERENCE_SUSPECT_CM) {
    console.warn(`WARNING ${where}: chest_cm ${chest} looks like a full circumference. Use pit-to-pit flat (half).`);
  }
  for (const key of Object.keys(m)) {
    if (!DIMS.includes(key as any)) console.warn(`WARNING ${where}: unknown measurement "${key}" ignored.`);
  }
  return out;
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(file, (e as Error).message);
  }
}

function fail(where: string, msg: string): never {
  throw new Error(`${where}: ${msg}`);
}
