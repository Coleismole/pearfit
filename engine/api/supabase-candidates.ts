// The real candidate source for the deployed functions: Supabase, read with the publishable key only, cached.
import type { Candidate } from "../src/types.ts";
import { loadCandidatesFromSupabase } from "../cli/candidate-source.ts";
import { createCache } from "./cache.ts";
import { CANDIDATE_CACHE_MS } from "./config.ts";

// Only these two variables are passed on, so a SUPABASE_SECRET_KEY set on the project is never used for reads.
export function createSupabaseCandidateSource(env: NodeJS.ProcessEnv = process.env): () => Promise<Candidate[]> {
  return createCache(
    () => loadCandidatesFromSupabase({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY }),
    CANDIDATE_CACHE_MS,
  );
}
