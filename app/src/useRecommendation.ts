// Asks POST /api/recommend what size of one catalog shirt suits the current wardrobe.
import { useEffect, useMemo, useState } from "react";
import { asApiError } from "./catalog.tsx";
import { API_BASE_URL } from "./config.ts";
import { postRecommend } from "./lib/api.ts";
import type { ApiError } from "./lib/api.ts";
import type { RecommendResponse } from "./lib/types.ts";
import { toApiWardrobe } from "./lib/wardrobe.ts";
import { useStore } from "./store.tsx";

export type RecommendationState =
  | { status: "no-wardrobe" } // the API needs at least one owned shirt, so no request is made
  | { status: "loading" }
  | { status: "ready"; result: RecommendResponse }
  | { status: "error"; error: ApiError };

// Answers already received in this visit, keyed by the exact request. Going from the analysis to the compare
// screen and back then needs no second request. A reload of the page starts empty.
const answers = new Map<string, RecommendResponse>();
const MAX_ANSWERS = 50;

function remember(key: string, result: RecommendResponse): void {
  answers.delete(key);
  answers.set(key, result);
  // Maps keep insertion order, so the first key is the oldest answer.
  if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value!);
}

export function useRecommendation(candidateId: string): { state: RecommendationState; reload(): void } {
  const { wardrobe } = useStore();
  const body = useMemo(() => toApiWardrobe(wardrobe), [wardrobe]);
  const key = `${candidateId}\n${JSON.stringify(body)}`;
  const [failure, setFailure] = useState<{ key: string; error: ApiError } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Only used to render again once an answer has been put in `answers`.
  const [, setArrived] = useState(0);

  useEffect(() => {
    if (body.length === 0 || answers.has(key)) return;
    const controller = new AbortController();
    postRecommend(API_BASE_URL, { wardrobe: body, candidateId }, { signal: controller.signal })
      .then((result) => {
        remember(key, result);
        setArrived((n) => n + 1);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setFailure({ key, error: asApiError(e) });
      });
    return () => controller.abort();
    // `key` is built from `body` and `candidateId`, so it stands for both in the dependency list.
  }, [key, attempt]);

  function reload() {
    answers.delete(key);
    setFailure(null);
    setAttempt((n) => n + 1);
  }

  const answer = answers.get(key);
  let state: RecommendationState;
  if (body.length === 0) state = { status: "no-wardrobe" };
  else if (answer) state = { status: "ready", result: answer };
  else if (failure?.key === key) state = { status: "error", error: failure.error };
  else state = { status: "loading" };
  return { state, reload };
}
