// GET /api/candidates. Built into website/api/candidates.js by scripts/build-api.mjs.
import { createCandidatesHandler } from "./handlers.ts";
import { reportError, withSentry } from "./sentry.ts";
import { createSupabaseCandidateSource } from "./supabase-candidates.ts";

export default withSentry(createCandidatesHandler({ getCandidates: createSupabaseCandidateSource(), onError: reportError }));
