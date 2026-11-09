/**
 * What the scraper app tells PostHog. Pure functions, so what leaves the browser can be tested.
 *
 * Privacy rule: send the store's hostname and counts, never review text, reviewer names, a full product
 * URL, pasted HTML or an error message (those can hold a URL or a shopper's words).
 */

export type ScrapeMode = 'url' | 'paste';

export type ScrapeFailureReason = 'refused' | 'no_reviews' | 'other';

/** "https://www.uniqlo.com/ca/en/products/E1" -> "uniqlo.com". Not a URL (or not http) -> null. */
export function storeHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Why a scrape failed, from the server's message. The message itself is not sent. */
export function failureReason(message: string | null | undefined): ScrapeFailureReason {
  const text = message ?? '';
  if (/refuses automated requests|block page/i.test(text)) return 'refused';
  if (/no reviews found/i.test(text)) return 'no_reviews';
  return 'other';
}

interface ScrapeResponseShape {
  report?: {
    totalReviews?: unknown;
    scraperTelemetry?: { reportedReviewCount?: unknown; reviewSources?: unknown };
  };
  sizeChart?: unknown;
  keptStoredReviews?: unknown;
  committedToDb?: unknown;
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function scrapeCompletedProperties(
  mode: ScrapeMode,
  url: string | null,
  data: ScrapeResponseShape,
  durationMs: number,
): Record<string, string | number | boolean | null> {
  const telemetry = data.report?.scraperTelemetry;
  return {
    mode,
    host: mode === 'url' ? storeHost(url) : null,
    reviews_read: count(data.report?.totalReviews),
    reviews_stated: count(telemetry?.reportedReviewCount),
    review_source_count: Array.isArray(telemetry?.reviewSources) ? telemetry.reviewSources.length : null,
    size_chart_rows: Array.isArray(data.sizeChart) ? data.sizeChart.length : 0,
    kept_stored_reviews: data.keptStoredReviews === true,
    committed: data.committedToDb === true,
    duration_ms: Math.max(0, Math.round(durationMs)),
  };
}

export function scrapeFailedProperties(
  mode: ScrapeMode,
  url: string | null,
  message: string | null | undefined,
  durationMs: number,
): Record<string, string | number | null> {
  return {
    mode,
    host: mode === 'url' ? storeHost(url) : null,
    reason: failureReason(message),
    duration_ms: Math.max(0, Math.round(durationMs)),
  };
}
