// Shapes for the Pilot 1 scorer. OwnedShirt matches the team's agreed JSON format exactly.

export type FitLabel = "great" | "tight" | "loose";

// Canonical physical meaning of each measurement, in cm:
//   chest_cm:  pit-to-pit measured flat (half the garment circumference)
//   length_cm: highest point of the shoulder straight down to the bottom hem, laid flat
//   sleeve_cm: from the shoulder seam to the end of the sleeve
// Every source (scan, scraper, each brand's chart) must convert INTO these definitions before storing.
// Never store a raw brand number in a different convention — a circumference would be 2x wrong.
export type Dim = "chest_cm" | "length_cm" | "sleeve_cm";
export const DIMS: readonly Dim[] = ["chest_cm", "length_cm", "sleeve_cm"];

// null = not measured.
export type Measurements = Record<Dim, number | null>;

export interface OwnedShirt {
  id: string;
  label: FitLabel;
  measurements: Measurements;
  // Optional metadata from scanning the tag — used for chart lookup, joining to the scraper DB by sku,
  // and display. The engine ignores these.
  brand?: string;
  sku?: string;
  size?: string;
}

export type ReviewSignal = "runs_small" | "true_to_size" | "runs_large" | null;

// A shirt someone is thinking of buying. `sizes` must be listed smallest to largest.
export interface Candidate {
  id: string;
  name: string;
  review: ReviewSignal;
  sizes: Record<string, Measurements>;
}

// Per-dimension difference, candidate minus owned shirt. Only dims present on both.
export type Ease = Partial<Record<Dim, number>>;

export interface ShirtMatch {
  shirtId: string;
  distance: number; // weighted mean absolute ease, cm. Lower = closer.
  matchPct: number; // 0 to 100
  ease: Ease;
}

export interface SizeResult {
  size: string;
  matches: ShirtMatch[]; // owned "great" shirts, closest first
}

export type Confidence = "high" | "medium" | "low";

export interface Recommendation {
  candidateId: string;
  size: string | null;
  confidence: Confidence;
  verdict: string;
  notes: string[]; // why confidence dropped, tie-breaks, guard warnings
  ranking: ShirtMatch[]; // owned shirts vs the recommended size, closest first
  sizes: SizeResult[]; // every size, in the candidate's order
}

export interface EvalCase {
  owner: string;
  candidate: string;
  correctSize?: string; // the size the person knows fits them
  closestShirt?: string; // the owned shirt the person thinks it feels most like
  holdout?: boolean; // keep out of tuning; report separately
}
