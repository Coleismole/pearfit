// Validation of owned shirts, candidates and measurements, on data that is already parsed. No file access and no
// import.meta, so it also runs inside the hosted API bundle. cli/load.ts reads the files and calls this.
// Every function throws an Error with a clear message on bad input.
import type { GarmentType, Measurements, OwnedShirt } from "../src/types.ts";
import { DIMS, GARMENT_TYPES } from "../src/types.ts";

// A flat pit-to-pit chest above this almost certainly means someone entered the full circumference.
const CIRCUMFERENCE_SUSPECT_CM = 80;

// `source` names where the data came from (a file path, or "wardrobe" for an API request) in error messages.
export function parseWardrobe(raw: unknown, source: string): OwnedShirt[] {
  if (!Array.isArray(raw)) fail(source, "expected a JSON array of shirts");
  const ids = new Set<string>();
  return raw.map((s: any, i: number) => {
    const where = `${source} [${i}]`;
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

// Missing is fine (the engine treats it as a tee). A value that is not a known type is a typo: fail loudly.
export function parseGarmentType(v: any, where: string): GarmentType | undefined {
  if (v === undefined || v === null) return undefined;
  if (!GARMENT_TYPES.includes(v)) fail(where, `garmentType must be one of ${GARMENT_TYPES.join(", ")}, got ${JSON.stringify(v)}`);
  return v;
}

export function parseMeasurements(m: any, where: string): Measurements {
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

export function fail(where: string, msg: string): never {
  throw new Error(`${where}: ${msg}`);
}
