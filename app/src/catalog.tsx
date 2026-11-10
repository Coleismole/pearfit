// The catalog: the list from GET /api/candidates, loaded once when the app starts and shared by every screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { API_BASE_URL } from "./config.ts";
import { ApiError, getCandidates } from "./lib/api.ts";
import type { PickerCandidate } from "./lib/types.ts";

export type CatalogState =
  | { status: "loading" }
  | { status: "ready"; candidates: PickerCandidate[] }
  | { status: "error"; error: ApiError };

interface Catalog {
  state: CatalogState;
  reload(): void;
  // The candidate with this id, or undefined while the list is loading, after it failed, or when it is not listed.
  find(id: string): PickerCandidate | undefined;
}

const CatalogContext = createContext<Catalog | null>(null);

export function asApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError("network", "Could not reach the Pearfit API.");
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getCandidates(API_BASE_URL, { signal: controller.signal })
      .then((candidates) => setState({ status: "ready", candidates }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", error: asApiError(e) });
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const catalog = useMemo<Catalog>(
    () => ({
      state,
      reload,
      find: (id) => (state.status === "ready" ? state.candidates.find((c) => c.id === id) : undefined),
    }),
    [state, reload],
  );

  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): Catalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return catalog;
}
