// POST /api/recommend. Built into website/api/recommend.js by scripts/build-api.mjs.
import { createRecommendHandler } from "./handlers.ts";
import { createSupabaseCandidateSource } from "./supabase-candidates.ts";

export default createRecommendHandler({ getCandidates: createSupabaseCandidateSource() });
