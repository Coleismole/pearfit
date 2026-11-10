// Keeps one loaded value in memory for `ttlMs`. Concurrent callers during a load share the same request.
// A failed load is not cached, so the next call tries again. `now` is injectable for tests.
export function createCache<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let value: T | undefined;
  let loadedAt = 0;
  let inFlight: Promise<T> | null = null;

  return async () => {
    if (value !== undefined && now() - loadedAt < ttlMs) return value;
    if (inFlight) return inFlight;
    inFlight = load()
      .then((fresh) => {
        value = fresh;
        loadedAt = now();
        return fresh;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
