// Settings for the API layer. Everything tunable lives here, none of it in the handlers.
import type { GarmentType } from "../src/types.ts";

// How long the candidate list stays in memory before it is read from Supabase again.
export const CANDIDATE_CACHE_MS = 5 * 60 * 1000;

// A wardrobe bigger than this is rejected, so one request cannot make the engine score thousands of shirts.
export const MAX_WARDROBE_SHIRTS = 200;

// GET /candidates only lists these garment types: we only compare tee to tee for now. Add a type here once a
// wardrobe can hold it (owned shirts need a matching garmentType) and the picker should offer it.
export const PICKER_GARMENT_TYPES: readonly GarmentType[] = ["tee"];

// Browsers may call the API from these origins only. Exact matches: "https://pearfit.app.evil.com" does not pass.
export const ALLOWED_ORIGINS: readonly RegExp[] = [
  /^https:\/\/(www\.)?pearfit\.app$/,
  /^http:\/\/localhost(:\d{1,5})?$/,
];
