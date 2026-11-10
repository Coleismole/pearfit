// Saves the wardrobe and the planned list on the device. There are no accounts yet, so nothing is stored on a
// server: the wardrobe only leaves the browser inside a POST /api/recommend request.
import { parseRecommendResponse } from "./api.ts";
import { DIMS, GARMENT_TYPES } from "./types.ts";
import type { Measurements, OwnedShirt, PlannedItem } from "./types.ts";
import { parseWardrobe } from "./wardrobe.ts";

// The part of localStorage the app uses. Tests pass a plain object.
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEYS = {
  wardrobe: "pearfit.wardrobe.v1",
  planned: "pearfit.planned.v1",
  onboarded: "pearfit.onboarded.v1",
} as const;

// Storage can be missing or refuse to work (private browsing, blocked cookies). The app then runs from memory.
function read(store: KeyValueStore | null, key: string): unknown {
  try {
    const text = store?.getItem(key) ?? null;
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function write(store: KeyValueStore | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: the value stays in memory for this visit.
  }
}

// Saved data that no longer passes the wardrobe rules is ignored rather than half-used.
export function loadWardrobe(store: KeyValueStore | null): OwnedShirt[] {
  const raw = read(store, STORAGE_KEYS.wardrobe);
  if (raw === null) return [];
  try {
    return parseWardrobe(raw);
  } catch {
    return [];
  }
}

export function saveWardrobe(store: KeyValueStore | null, wardrobe: readonly OwnedShirt[]): void {
  write(store, STORAGE_KEYS.wardrobe, wardrobe);
}

function parsePlannedItem(raw: unknown): PlannedItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.candidateId !== "string" || typeof p.name !== "string" || typeof p.savedAt !== "string") return null;
  if (!GARMENT_TYPES.includes(p.garmentType as never)) return null;
  try {
    return {
      candidateId: p.candidateId,
      name: p.name,
      garmentType: p.garmentType as PlannedItem["garmentType"],
      result: parseRecommendResponse(p.result),
      measurements: parseSavedMeasurements(p.measurements),
      savedAt: p.savedAt,
    };
  } catch {
    return null;
  }
}

function parseSavedMeasurements(raw: unknown): Measurements | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const out = {} as Measurements;
  for (const dim of DIMS) {
    const v = m[dim];
    out[dim] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return out;
}

export function loadPlanned(store: KeyValueStore | null): PlannedItem[] {
  const raw = read(store, STORAGE_KEYS.planned);
  if (!Array.isArray(raw)) return [];
  return raw.map(parsePlannedItem).filter((p): p is PlannedItem => p !== null);
}

export function savePlanned(store: KeyValueStore | null, planned: readonly PlannedItem[]): void {
  write(store, STORAGE_KEYS.planned, planned);
}

export function loadOnboarded(store: KeyValueStore | null): boolean {
  return read(store, STORAGE_KEYS.onboarded) === true;
}

export function saveOnboarded(store: KeyValueStore | null, done: boolean): void {
  write(store, STORAGE_KEYS.onboarded, done);
}
