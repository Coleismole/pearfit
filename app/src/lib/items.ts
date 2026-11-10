// One shape for everything the wardrobe screens list: shirts the person owns and catalog shirts they plan to buy.
import { FIT_NAMES, GARMENT_NAMES, capitalize, formatPercent } from "./format.ts";
import type { GarmentType, Measurements, OwnedShirt, PickerCandidate, PlannedItem, RecommendResponse } from "./types.ts";
import { displayName, garmentTypeOf } from "./wardrobe.ts";

export type EntryKind = "owned" | "planned";

export interface WardrobeEntry {
  ref: string; // "owned:blue-tee" or "planned:e465187-000". Used in links.
  kind: EntryKind;
  key: string; // the shirt id, or the candidate id
  title: string;
  detail: string; // "Tee · Size M · UNIQLO"
  badge: string; // "Great fit", "68% match", "No size yet"
  status: string; // "You own · Great fit", "Planning to buy"
  garmentType: GarmentType;
  // What the compare screens put side by side. For a planned shirt this is the chart row of the suggested size,
  // and null when there is no suggested size.
  measurements: Measurements | null;
}

export function ownedEntry(shirt: OwnedShirt): WardrobeEntry {
  const type = garmentTypeOf(shirt);
  const parts = [GARMENT_NAMES[type].one, shirt.size ? `Size ${shirt.size}` : null, shirt.brand ?? null];
  return {
    ref: `owned:${shirt.id}`,
    kind: "owned",
    key: shirt.id,
    title: capitalize(displayName(shirt.id)),
    detail: parts.filter(Boolean).join(" · "),
    badge: FIT_NAMES[shirt.label].badge,
    status: `You own · ${FIT_NAMES[shirt.label].badge}`,
    garmentType: type,
    measurements: shirt.measurements,
  };
}

export function plannedEntry(item: PlannedItem): WardrobeEntry {
  const size = item.result.size;
  return {
    ref: `planned:${item.candidateId}`,
    kind: "planned",
    key: item.candidateId,
    title: item.name,
    detail: `${GARMENT_NAMES[item.garmentType].one} · ${size === null ? "No size yet" : `Suggested size ${size}`}`,
    badge: size === null ? "No size yet" : `${formatPercent(item.result.matchPercent)} match`,
    status: "Planning to buy",
    garmentType: item.garmentType,
    measurements: size === null ? null : item.measurements,
  };
}

// What is kept under "Planning to buy" for a catalog shirt: the API's answer, and the chart row of the suggested
// size. `candidate` is the catalog row when the catalog is loaded. `previous` is the copy saved earlier, if any.
export function plannedFrom(parts: {
  candidateId: string;
  name: string;
  result: RecommendResponse;
  candidate: PickerCandidate | undefined;
  previous: PlannedItem | undefined;
  now: Date;
}): PlannedItem {
  const { candidateId, name, result, candidate, previous, now } = parts;
  let measurements: Measurements | null = null;
  if (result.size !== null) {
    if (candidate) measurements = candidate.sizes[result.size] ?? null;
    // The catalog is not loaded: keep the row saved earlier, as long as it is for the same size.
    else if (previous && previous.result.size === result.size) measurements = previous.measurements;
  }
  return { candidateId, name, garmentType: result.garmentType, result, measurements, savedAt: now.toISOString() };
}

// "owned:blue-tee" -> the entry, or null when it is no longer in the wardrobe.
export function findEntry(ref: string, wardrobe: readonly OwnedShirt[], planned: readonly PlannedItem[]): WardrobeEntry | null {
  const cut = ref.indexOf(":");
  const kind = ref.slice(0, cut);
  const key = ref.slice(cut + 1);
  if (kind === "owned") {
    const shirt = wardrobe.find((s) => s.id === key);
    return shirt ? ownedEntry(shirt) : null;
  }
  if (kind === "planned") {
    const item = planned.find((p) => p.candidateId === key);
    return item ? plannedEntry(item) : null;
  }
  return null;
}

// Everything else of the same garment type that has measurements to put next to `entry`. Owned shirts first.
export function comparableEntries(
  entry: WardrobeEntry,
  wardrobe: readonly OwnedShirt[],
  planned: readonly PlannedItem[],
): WardrobeEntry[] {
  return [...wardrobe.map(ownedEntry), ...planned.map(plannedEntry)].filter(
    (other) => other.ref !== entry.ref && other.garmentType === entry.garmentType && other.measurements !== null,
  );
}
