// Shapes the app shares with the Pearfit API. They mirror engine/src/types.ts and engine/api/recommend-api.ts,
// which are the source of truth. app/ is its own package and cannot import engine/, so they are repeated here.
// The field names are fixed by the team (see AGENTS.md): do not rename them.

// How an owned shirt fits its wearer.
export type FitLabel = "great" | "tight" | "loose";
export const FIT_LABELS: readonly FitLabel[] = ["great", "tight", "loose"];

// Centimetres. chest_cm is pit-to-pit with the shirt laid flat (half the circumference).
export type Dim = "chest_cm" | "length_cm" | "sleeve_cm";
export const DIMS: readonly Dim[] = ["chest_cm", "length_cm", "sleeve_cm"];

// null = not measured. A missing measurement is never filled in.
export type Measurements = Record<Dim, number | null>;

export type GarmentType = "tee" | "tee_long_sleeve" | "polo" | "button_shirt" | "jacket" | "other";
export const GARMENT_TYPES: readonly GarmentType[] = ["tee", "tee_long_sleeve", "polo", "button_shirt", "jacket", "other"];
// A shirt with no garmentType is treated as this, the same as in the engine.
export const DEFAULT_GARMENT_TYPE: GarmentType = "tee";

// One shirt the person owns. Same shape as the files in engine/data/wardrobes/.
export interface OwnedShirt {
  id: string; // lowercase words joined by dashes, unique in the wardrobe
  label: FitLabel;
  measurements: Measurements;
  garmentType?: GarmentType; // missing = "tee"
  // Optional display details. The engine ignores them, and the app does not send them to the API.
  brand?: string;
  sku?: string;
  size?: string;
}

// One row of GET /api/candidates. `sizes` is listed smallest to largest.
export interface PickerCandidate {
  id: string; // the lowercased SKU
  name: string;
  garmentType: GarmentType;
  sizes: Record<string, Measurements>;
}

export type Confidence = "high" | "medium" | "low";

// The body of POST /api/recommend.
export interface RecommendRequest {
  wardrobe: OwnedShirt[];
  candidateId: string;
}

// One size of the catalog shirt against the wardrobe: the closest "great" shirt and how close it is.
export interface SizeMatch {
  size: string;
  matchPercent: number | null; // null = this size could not be compared with any great shirt
  fitsLike: string | null; // the id of that owned shirt
}

// One owned "great" shirt against the suggested size.
export interface SimilarShirt {
  shirtId: string;
  matchPercent: number;
}

// The answer of POST /api/recommend. With no recommendation, size, matchPercent and fitsLike are all null,
// `similar` is empty and `verdict` says why.
export interface RecommendResponse {
  size: string | null;
  confidence: Confidence;
  matchPercent: number | null; // 0 to 100: how close the suggested size is to the owned shirt in fitsLike
  fitsLike: string | null; // the id of that owned shirt
  verdict: string;
  notes: string[];
  garmentType: GarmentType;
  // Both are empty in an answer saved before the API sent them. The app then shows what it showed before.
  sizes: SizeMatch[]; // every size, smallest to largest
  similar: SimilarShirt[]; // great shirts against the suggested size, closest first
}

// A catalog shirt saved under "Planning to buy", with the last answer the API gave for it.
export interface PlannedItem {
  candidateId: string;
  name: string;
  garmentType: GarmentType;
  result: RecommendResponse;
  // The size chart row of the suggested size. null when there is no suggested size or the chart was not loaded.
  measurements: Measurements | null;
  savedAt: string; // ISO date
}
