// Wardrobe rules: the same checks the API runs on a wardrobe (engine/cli/validate.ts parseWardrobe), plus the
// helpers that turn a typed name into an id. Pure functions, no storage and no network.
import { DEFAULT_GARMENT_TYPE, DIMS, FIT_LABELS, GARMENT_TYPES } from "./types.ts";
import type { FitLabel, GarmentType, Measurements, OwnedShirt } from "./types.ts";

// Lowercase words joined by single dashes: "blue-uniqlo-oxford".
export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// A flat pit-to-pit chest above this almost certainly means someone entered the full circumference.
// Same number as CIRCUMFERENCE_SUSPECT_CM in engine/cli/validate.ts.
export const CIRCUMFERENCE_SUSPECT_CM = 80;

// "Blue Uniqlo Oxford" -> "blue-uniqlo-oxford". Accents and apostrophes are dropped ("Men's café tee" ->
// "mens-cafe-tee"). A name with no letters or digits gives "", which is not a valid id.
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The engine writes an id as words in its verdict ("fits like your blue uniqlo oxford"). The app shows it the same way.
export function displayName(id: string): string {
  return id.replace(/-/g, " ");
}

export function garmentTypeOf(item: { garmentType?: GarmentType }): GarmentType {
  return item.garmentType ?? DEFAULT_GARMENT_TYPE;
}

export function hasAnyMeasurement(m: Measurements): boolean {
  return DIMS.some((dim) => m[dim] !== null);
}

// Builds a shirt with its keys in the order the team's wardrobe files use (id, label, garmentType,
// measurements), so an exported wardrobe reads like engine/data/wardrobes/*.json. Empty details are left out.
export function makeShirt(parts: {
  id: string;
  label: FitLabel;
  garmentType?: GarmentType;
  measurements: Measurements;
  brand?: string;
  sku?: string;
  size?: string;
}): OwnedShirt {
  const m = parts.measurements;
  const shirt: OwnedShirt = {
    id: parts.id,
    label: parts.label,
    ...(parts.garmentType ? { garmentType: parts.garmentType } : {}),
    measurements: { chest_cm: m.chest_cm, length_cm: m.length_cm, sleeve_cm: m.sleeve_cm },
  };
  for (const key of ["brand", "sku", "size"] as const) {
    const value = parts[key]?.trim();
    if (value) shirt[key] = value;
  }
  return shirt;
}

// Checks a wardrobe that came from outside the app (an imported file, or saved data). Throws an Error that names
// the shirt and the field. The rules are the API's: a wardrobe that passes here passes POST /api/recommend.
export function parseWardrobe(raw: unknown): OwnedShirt[] {
  if (!Array.isArray(raw)) throw new Error("The wardrobe must be a JSON array of shirts.");
  const ids = new Set<string>();
  return raw.map((entry: unknown, i: number) => {
    const where = `Shirt ${i + 1}`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${where}: must be an object.`);
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== "string" || !ID_PATTERN.test(s.id)) {
      throw new Error(`${where}: id must be lowercase words joined by dashes, got ${JSON.stringify(s.id)}.`);
    }
    if (ids.has(s.id)) throw new Error(`${where}: duplicate id "${s.id}".`);
    ids.add(s.id);
    if (!FIT_LABELS.includes(s.label as never)) {
      throw new Error(`${where} (${s.id}): label must be "great", "tight" or "loose", got ${JSON.stringify(s.label)}.`);
    }
    // Missing is fine (the engine treats it as a tee). A value that is not a known type is a typo: fail loudly.
    const hasType = s.garmentType !== undefined && s.garmentType !== null;
    if (hasType && !GARMENT_TYPES.includes(s.garmentType as never)) {
      throw new Error(
        `${where} (${s.id}): garmentType must be one of ${GARMENT_TYPES.join(", ")}, got ${JSON.stringify(s.garmentType)}.`,
      );
    }
    const text = (v: unknown) => (typeof v === "string" ? v : undefined);
    return makeShirt({
      id: s.id,
      label: s.label as FitLabel,
      garmentType: hasType ? (s.garmentType as GarmentType) : undefined,
      measurements: parseMeasurements(s.measurements, `${where} (${s.id})`),
      brand: text(s.brand),
      sku: text(s.sku),
      size: text(s.size),
    });
  });
}

// Each of the three measurements is a positive number or null. A missing one becomes null; nothing is filled in.
export function parseMeasurements(raw: unknown, where: string): Measurements {
  if (typeof raw !== "object" || raw === null) throw new Error(`${where}: measurements must be an object.`);
  const m = raw as Record<string, unknown>;
  const out = {} as Measurements;
  for (const dim of DIMS) {
    const v = m[dim];
    if (v === undefined || v === null) {
      out[dim] = null;
    } else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`${where}: ${dim} must be a positive number or null, got ${JSON.stringify(v)}.`);
    } else {
      out[dim] = v;
    }
  }
  return out;
}

// What POST /api/recommend needs from each shirt, in the shape of engine/data/wardrobes/person1.json.
// The optional display details (brand, sku, size) stay on the device.
export function toApiWardrobe(wardrobe: readonly OwnedShirt[]): OwnedShirt[] {
  return wardrobe.map((s) => makeShirt({ id: s.id, label: s.label, garmentType: s.garmentType, measurements: s.measurements }));
}
