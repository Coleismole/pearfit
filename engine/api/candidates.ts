// GET /api/candidates. Built into website/api/candidates.js by scripts/build-api.mjs.
import { createCandidatesHandler } from "./handlers.ts";
import { createSupabaseCandidateSource } from "./supabase-candidates.ts";

export default createCandidatesHandler({ getCandidates: createSupabaseCandidateSource() });
