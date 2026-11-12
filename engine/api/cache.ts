// Keeps one loaded value in memory for `ttlMs`. Concurrent callers during a load share the same request.
// A failed load is not cached, so the next call tries again. `now` is injectable for tests.
//
// With `stale`, a failed reload is answered with the last good value instead of an error, for up to `maxStaleMs`
// after that value was loaded. The failure goes to `onError`, and the next reload waits `retryMs`, so a source
// that is down is not asked again on every request. With nothing loaded yet, or a value older than `maxStaleMs`,
// the failure is thrown as before.
export interface StaleOptions {
  maxStaleMs: number;
  retryMs: number;
  onError?: (error: unknown) => void;
}

export function createCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
  stale?: StaleOptions,
): () => Promise<T> {
  let value: T | undefined;
  let loadedAt = 0;
  let retryAt = 0; // while now() is before this, a stale value is served without another load
  let inFlight: Promise<T> | null = null;

  return async () => {
    if (value !== undefined && (now() - loadedAt < ttlMs || now() < retryAt)) return value;
    if (inFlight) return inFlight;
    inFlight = load()
      .then((fresh) => {
        value = fresh;
        loadedAt = now();
        retryAt = 0;
        return fresh;
      })
      .catch((error: unknown) => {
        if (stale && value !== undefined && now() - loadedAt < stale.maxStaleMs) {
          retryAt = now() + stale.retryMs;
          stale.onError?.(error);
          return value;
        }
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
