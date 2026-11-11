/**
 * Headless Chromium fallback for product pages whose reviews are loaded by JavaScript
 * (Bazaarvoice, Yotpo, PowerReviews, ...). It is NOT used to get around stores that refuse
 * automated requests (403/418/429/503): those are respected and reported.
 *
 * Renders the page, dismisses cookie banners, scrolls to trigger lazy-loaded review
 * widgets, opens the reviews section, clicks "load more" a few times, then returns the
 * rendered HTML (with open shadow roots inlined) for the normal cheerio extractor.
 *
 * Playwright is imported lazily so the server still starts when no browser is installed.
 */
import type { RenderedPage } from './render/types.ts';
import { queueRender } from './render/browser.ts';
import { renderChartOnlyWithPlaywright, renderWithPlaywright } from './render/playwrightRender.ts';
import { renderWithServerlessChromium } from './render/serverlessRender.ts';

export { REVIEW_CARD_SELECTOR, RENDER_DEADLINE_MS, REVIEW_WIDGET_SELECTOR } from './render/constants.ts';
export type { RenderedPage, CapturedJson } from './render/types.ts';
export { embeddedWidgetHtml, JsonCapture } from './render/jsonCapture.ts';
export { shouldUseHeadlessRender, linkStaysOnProduct, navigationTimedOutAfterLoading, isReviewWidgetFrame } from './render/decisions.ts';
export { closeHeadlessBrowser } from './render/browser.ts';
export { SIZE_GUIDE_LABEL, openSizeGuideWith, openSizeGuide, fetchGuidePagesWith, fetchGuidePages, fetchGuidePagesByHttp } from './render/sizeGuide.ts';
export type { SizeGuideOps, GuidePageOps, GuideFetchResult } from './render/sizeGuide.ts';
export { pageThroughReviews } from './render/paging.ts';
export { CHART_RENDER_BUDGET_MS } from './render/playwrightRender.ts';
export { serverlessGuideOps, serverlessGuidePageOps, renderWithServerlessBrowser } from './render/serverlessRender.ts';
export type { ServerlessPage, ServerlessBrowser } from './render/serverlessRender.ts';

export async function renderPageHtml(url: string): Promise<RenderedPage> {
  return queueRender(() => renderPageHtmlOnce(url));
}

/**
 * A short render for the size chart alone, for a page whose reviews were all in its source (so no full render
 * ran) and whose chart is not in the source either. It loads the page, opens the size guide and reads linked
 * guide pages; it never touches the review widget. Playwright only: the hosted function has no time for it.
 */
export async function renderChartOnly(url: string): Promise<RenderedPage> {
  if (process.env.VERCEL) throw new Error('A chart-only render is not available on the hosted function.');
  return queueRender(() => renderChartOnlyWithPlaywright(url));
}

async function renderPageHtmlOnce(url: string): Promise<RenderedPage> {
  if (process.env.VERCEL) return renderWithServerlessChromium(url);
  return renderWithPlaywright(url);
}
