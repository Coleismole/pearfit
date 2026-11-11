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
 *
 * This file is the public entry point: it re-exports what the modules under render/ provide.
 *   render/constants.ts         selectors and limits
 *   render/types.ts             RenderedPage, CapturedJson
 *   render/jsonCapture.ts       JsonCapture and the widget / chart JSON helpers
 *   render/decisions.ts         shouldUseHeadlessRender, linkStaysOnProduct and other small decisions
 *   render/browser.ts           the shared browser and the render queue
 *   render/pageScripts.ts       scripts that run inside the page
 *   render/sizeGuide.ts         opening size guides, reading linked guide pages
 *   render/paging.ts            sorting reviews and paging through them
 *   render/playwrightHelpers.ts helpers for the local render
 *   render/playwrightRender.ts  the local Playwright render
 *   render/serverlessRender.ts  the serverless Puppeteer render
 *   render/renderPage.ts        renderPageHtml and renderChartOnly
 */

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
export { renderPageHtml, renderChartOnly } from './render/renderPage.ts';
