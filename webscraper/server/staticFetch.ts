/** Plain HTTP fetch of a product page or size-guide page, with the same safeguards for both. */
import type { GuideFetchResult } from '../headlessFetch.ts';
import {
  registrableDomain,
  blockPageTitle,
  describeFetchFailure,
  isBotCheckRedirect,
  isRefusalStatus,
  blockPageText,
} from '../pageHelpers.ts';
import { blockedFetchTargetResolved } from '../publicUrl.ts';

/** Plain HTTP fetch. Returns the HTML, or a status + message describing the failure. */
export interface StaticFetchError {
  status: number;
  message: string;
  blocked: boolean;
  /** The request itself failed (reset, oversized headers). A browser may still load the page. */
  retryInBrowser?: boolean;
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const MAX_STATIC_HTML_BYTES = 10_000_000;

export async function fetchStaticHtml(
  url: string,
  options: { timeoutMs?: number; /** Refuse a redirect to another store (a size-guide page is read only on the product's own site). */ sameSite?: boolean } = {},
): Promise<{ html: string } | StaticFetchError> {
  const siteOf = (raw: string) => registrableDomain(new URL(raw).hostname);
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const blocked = await blockedFetchTargetResolved(current);
    if (blocked) return { status: 400, message: blocked, blocked: true };
    let response: Response;
    try {
      response = await fetch(current, {
        headers: FETCH_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      });
    } catch (fetchErr) {
      return describeFetchFailure(url, fetchErr);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location && isBotCheckRedirect(location)) {
        return { status: 400, message: `${url} sent the request to a bot check: the store refuses automated requests.`, blocked: true };
      }
      if (!location || hop === 5) {
        void response.body?.cancel().catch(() => {});
        return { status: 400, message: `Too many redirects while scraping ${url}.`, blocked: false };
      }
      void response.body?.cancel().catch(() => {});
      try {
        current = new URL(location, current).toString();
      } catch {
        return { status: 400, message: `${url} redirected to an invalid address.`, blocked: false };
      }
      if (options.sameSite && siteOf(current) !== siteOf(url)) {
        return { status: 400, message: `${url} redirected to another site (${new URL(current).host}).`, blocked: false };
      }
      continue;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      // 418 is what some stores (Under Armour) answer an automated request with; it is a refusal too.
      const refused = isRefusalStatus(response.status);
      return {
        status: 400,
        message: refused
          ? `${url} returned HTTP ${response.status}: the store refuses automated requests.`
          : `Remote server returned HTTP ${response.status} when scraping ${url}.`,
        blocked: refused,
      };
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_STATIC_HTML_BYTES) {
      void response.body?.cancel().catch(() => {});
      return { status: 400, message: `${url} is larger than the ${MAX_STATIC_HTML_BYTES / 1_000_000} MB the scraper reads.`, blocked: false };
    }
    const html = (await response.text()).slice(0, MAX_STATIC_HTML_BYTES);
    // A bot check served with HTTP 200 ("Just a moment...") is a refusal too, not a product page.
    const blockedBy = blockPageTitle(html);
    if (blockedBy) {
      return { status: 400, message: `${url} showed a block page ("${blockedBy}"): the store refuses automated requests.`, blocked: true };
    }
    const shortPage = blockPageText(html);
    if (shortPage === 'refused') {
      return { status: 400, message: `${url} says it does not allow automated traffic: the store refuses automated requests.`, blocked: true };
    }
    if (shortPage === 'maintenance') {
      return { status: 400, message: `${url} is showing a maintenance page. The store's site is down; try again later.`, blocked: false };
    }
    return { html };
  }
  return { status: 400, message: `Too many redirects while scraping ${url}.`, blocked: false };
}

/**
 * One size-guide page by plain fetch, under the same safeguards as the product page (public addresses only,
 * size cap, block pages), on the same site only. A refusal is reported as one so that no other guide is tried.
 */
export async function fetchGuidePage(href: string, timeoutMs: number): Promise<GuideFetchResult> {
  const result = await fetchStaticHtml(href, { timeoutMs, sameSite: true });
  if (!('html' in result) && process.env.SCRAPER_DEBUG) console.error(`[guides] ${href}: ${result.message}`);
  return 'html' in result ? { html: result.html } : { refused: result.blocked };
}
