// POST /api/recommend. Built into website/api/recommend.js by scripts/build-api.mjs.
import { createRecommendHandler } from "./handlers.ts";
import { reportError, withSentry } from "./sentry.ts";
import { createSupabaseCandidateSource } from "./supabase-candidates.ts";

export default withSentry(createRecommendHandler({ getCandidates: createSupabaseCandidateSource(process.env, reportError), onError: reportError }));
