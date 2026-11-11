/** Small pure decisions: whether to render, which links stay on the product, which errors and frames to accept. */

/**
 * Headless is for pages whose reviews are added by JavaScript.
 * A failed static fetch (including 404 and "could not reach") is reported as that failure.
 * A store that refused the request (403/418/429/503) is not retried in a browser.
 */
export function shouldUseHeadlessRender(input: {
  isRemoteUrl: boolean;
  renderMode: 'auto' | 'always' | 'never';
  staticFailed: boolean;
  reviewCount: number | null;
  /** The review count the page states. Fewer reviews found than this means the rest load by JavaScript. */
  reportedReviewCount?: number | null;
}): boolean {
  if (!input.isRemoteUrl || input.renderMode === 'never' || input.staticFailed) return false;
  if (input.renderMode === 'always') return true;
  if (input.reviewCount === null || input.reviewCount === 0) return true;
  // The page source already holds every review the store says it has.
  if (typeof input.reportedReviewCount === 'number' && input.reviewCount >= input.reportedReviewCount) return false;
  // Fewer than stated, or no stated total to check against: review widgets usually load the rest.
  return true;
}

/**
 * Whether following a link keeps the browser on the product: a hash, a query on the same page, or a
 * path under the product page's own path. A site-wide "Reviews" link in the header or footer
 * (/pages/reviews, every product's reviews) is not the product's review section.
 */
export function linkStaysOnProduct(href: string | null, pageUrl: string): boolean {
  if (!href || /^(#|javascript:)/i.test(href.trim())) return true;
  try {
    const page = new URL(pageUrl);
    const target = new URL(href, page);
    if (target.origin !== page.origin) return false;
    const base = page.pathname.replace(/\/$/, '');
    const path = target.pathname.replace(/\/$/, '');
    return path === base || path.startsWith(base + '/');
  } catch {
    return false;
  }
}

/** A navigation that timed out after the browser had already committed to a page (not a blank tab). */
export function navigationTimedOutAfterLoading(err: unknown, currentUrl: string): boolean {
  return err instanceof Error && /Timeout \d+ms exceeded/.test(err.message) && /^https?:/i.test(currentUrl);
}

/** Hosts whose review widgets render inside an iframe of their own (Loox). */
export function isReviewWidgetFrame(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'loox.io' && u.pathname.startsWith('/widget/');
  } catch {
    return false;
  }
}
