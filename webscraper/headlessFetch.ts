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
import type { Browser } from 'playwright';
import {
  REVIEW_CARD_SELECTOR,
  NAV_TIMEOUT_MS,
  RENDER_TAIL_MS,
  REVIEW_WAIT_MS,
  MAX_REVIEWS,
  MAX_LINKED_REVIEW_PAGES,
  REVIEW_WIDGET_SELECTOR,
} from './render/constants.ts';
import type { RenderedPage } from './render/types.ts';
import { JsonCapture } from './render/jsonCapture.ts';
import { navigationTimedOutAfterLoading } from './render/decisions.ts';
import { startUrlAllowsPrivate, renderBudgetMs, getBrowser, queueRender } from './render/browser.ts';
import {
  OPEN_RATING_SUMMARY,
  CLICK_NEXT_NUMBERED_PAGE,
  REVIEW_CARDS_MARKUP,
  OPEN_REVIEWS_HEADING,
  ALL_REVIEWS_LINK,
  NEXT_REVIEW_PAGE_LINK,
  SCROLL_TO_END,
  SCROLL_TO_BOTTOM,
  REVIEW_WIDGETS_INTO_VIEW,
  CLICK_NEXT_REVIEWS,
  SERIALIZE_WITH_SHADOW_ROOTS,
} from './render/pageScripts.ts';
import {
  SIZE_GUIDE_LABEL,
  SIZE_GUIDE_TEXT,
  VISIBLE_TABLES,
  type SizeGuideOps,
  openSizeGuideWith,
  openSizeGuide,
  GUIDE_LINKS,
  type GuidePageOps,
  fetchGuidePagesWith,
  fetchGuidePages,
  SIZE_GUIDE_CONTROL_IN_PAGE,
} from './render/sizeGuide.ts';
import { sortReviewsNewest, pageThroughReviews } from './render/paging.ts';
import {
  clickFirst,
  playwrightProductHint,
  evaluateStable,
  countReviews,
  hasReviews,
  waitForMoreReviews,
  reviewFramePages,
  widgetPages,
  newGuardedContext,
  sortNewestByRealClick,
} from './render/playwrightHelpers.ts';
import { createRequestHostGuard } from './publicUrl.ts';
import { parseSizeChartCached } from './pageHelpers.ts';
import type { ProductHint } from './sizeChart.ts';

export { REVIEW_CARD_SELECTOR, RENDER_DEADLINE_MS, REVIEW_WIDGET_SELECTOR } from './render/constants.ts';
export type { RenderedPage, CapturedJson } from './render/types.ts';
export { embeddedWidgetHtml, JsonCapture } from './render/jsonCapture.ts';
export { shouldUseHeadlessRender, linkStaysOnProduct, navigationTimedOutAfterLoading, isReviewWidgetFrame } from './render/decisions.ts';
export { closeHeadlessBrowser } from './render/browser.ts';
export { SIZE_GUIDE_LABEL, openSizeGuideWith, openSizeGuide, fetchGuidePagesWith, fetchGuidePages, fetchGuidePagesByHttp } from './render/sizeGuide.ts';
export type { SizeGuideOps, GuidePageOps, GuideFetchResult } from './render/sizeGuide.ts';
export { pageThroughReviews } from './render/paging.ts';

export async function renderPageHtml(url: string): Promise<RenderedPage> {
  return queueRender(() => renderPageHtmlOnce(url));
}

/** Whole chart-only render, including opening the guide and reading linked guide pages. */
export const CHART_RENDER_BUDGET_MS = 45_000;

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

async function renderChartOnlyWithPlaywright(url: string): Promise<RenderedPage> {
  const browser = (await getBrowser()) as Browser;
  const context = await newGuardedContext(browser, url);
  const page = await context.newPage();
  // Only the size-chart JSON is kept from this render (see JsonCapture.chartPages).
  const capture = new JsonCapture();
  page.on('response', (response) => {
    capture.offer(response.url(), response.status(), response.headers()['content-type'] ?? '', () => response.text());
  });
  const startedAt = Date.now();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    context.close().catch(() => {});
  }, CHART_RENDER_BUDGET_MS);
  try {
    const response = await page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      .catch((err: unknown) => {
        if (navigationTimedOutAfterLoading(err, page.url())) return null;
        throw err;
      });
    const status = response?.status() ?? null;
    if (status !== null && status >= 400) {
      return { html: '', status, finalUrl: page.url(), reviewSelectorFound: false, chartHtml: null, jsonResponses: [] };
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await clickFirst(page, 'button', /^(accept( all)?( cookies)?|i accept|agree|allow all|got it|ok)$/i);
    const snapshot = (await evaluateStable(page, SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    const hint = await playwrightProductHint(page);
    const chartHtml = parseSizeChartCached(snapshot, hint).length > 0 ? snapshot : ((await openSizeGuide(page, startedAt + CHART_RENDER_BUDGET_MS - 17_000, 4, hint)) ?? snapshot);
    const html = (await evaluateStable(page, SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    const guidePages =
      parseSizeChartCached(chartHtml, hint).length === 0 && parseSizeChartCached(html, hint).length === 0
        ? await fetchGuidePages(page, startedAt + CHART_RENDER_BUDGET_MS - 4_000)
        : [];
    await capture.settle(1000);
    return { html, status, finalUrl: page.url(), reviewSelectorFound: false, chartHtml, jsonResponses: [], chartJson: capture.chartPages(), guidePages };
  } catch (err) {
    if (timedOut) throw new Error(`Headless chart render timed out after ${CHART_RENDER_BUDGET_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
  }
}

async function renderWithPlaywright(url: string): Promise<RenderedPage> {
  const browser = (await getBrowser()) as Browser;
  const context = await newGuardedContext(browser, url);

  const page = await context.newPage();
  const capture = new JsonCapture();
  page.on('response', (response) => {
    capture.offer(response.url(), response.status(), response.headers()['content-type'] ?? '', () => response.text());
  });
  const startedAt = Date.now();
  const stopPagingAt = startedAt + renderBudgetMs() - RENDER_TAIL_MS;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    context.close().catch(() => {});
  }, renderBudgetMs());
  try {
    const response = await page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      .catch((err: unknown) => {
        // A page that shows up but never finishes parsing (Soffe: DOMContentLoaded never fires) is still read.
        if (navigationTimedOutAfterLoading(err, page.url())) return null;
        throw err;
      });
    const status = response?.status() ?? null;
    if (status !== null && status >= 400) {
      return { html: '', status, finalUrl: page.url(), reviewSelectorFound: false, chartHtml: null, jsonResponses: [] };
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    await clickFirst(page, 'button', /^(accept( all)?( cookies)?|i accept|agree|allow all|got it|ok)$/i);

    await evaluateStable(page, SCROLL_TO_END);

    // Snapshot before touching reviews: a review click may leave the product view.
    let chartHtml = (await evaluateStable(page, SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    const hint = await playwrightProductHint(page);

    // The full review list is often behind a tab or accordion, even when a few highlight
    // reviews are already visible. A link may navigate away, so only use it as a last resort.
    const reviewsBeforeOpening = await countReviews(page);
    const openedSection =
      (await clickFirst(page, 'tab', /reviews?/i)) ||
      (await clickFirst(page, 'button', /^(customer )?reviews?\b/i)) ||
      (!(await hasReviews(page)) &&
        capture.ratingFields === 0 &&
        (await clickFirst(page, 'link', /^(read |see |customer )?(all )?reviews?\b/i)));
    if (openedSection) {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await waitForMoreReviews(page, reviewsBeforeOpening, REVIEW_WAIT_MS);
    } else if (await evaluateStable(page, OPEN_REVIEWS_HEADING)) {
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }

    // Still no review data: the rating summary near the title often opens the review section.
    if (capture.reviewCount() === 0 && (await evaluateStable(page, OPEN_RATING_SUMMARY))) {
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    }

    // Widgets that load when they come into view (Okendo, Junip, Bazaarvoice) need to be seen.
    await evaluateStable(page, REVIEW_WIDGETS_INTO_VIEW);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await capture.settle();

    const reviewSelectorFound =
      capture.ratingFields > 0 ||
      (await page
        .locator(REVIEW_CARD_SELECTOR)
        .first()
        .waitFor({ timeout: REVIEW_WAIT_MS, state: 'attached' })
        .then(() => true)
        .catch(() => false));
    // A review widget whose first reviews came embedded in the page (Okendo) still pages by JavaScript.
    const hasReviewWidget = (await page.locator(REVIEW_WIDGET_SELECTOR).count()) > 0;

    const pagingOps: Parameters<typeof pageThroughReviews>[0] = {
      click: (skip) => page.evaluate(`${CLICK_NEXT_REVIEWS}(${JSON.stringify(skip)})`) as Promise<string>,
      progress: async () => ({ json: capture.reviewCount(), cards: await countReviews(page) }),
      enough: async () => (capture.reviewCount() > 0 ? capture.reviewCount() : await countReviews(page)) >= MAX_REVIEWS,
      settle: () => capture.settle(1500),
      sleep: (ms) => page.waitForTimeout(ms),
      scroll: () => page.evaluate(SCROLL_TO_BOTTOM) as Promise<string>,
      realClick: async () => {
        try {
          const control = page.locator('[data-pearfit-paging="1"]').first();
          // A link with an address would load a page and lose what this one rendered; buttons only.
          const isLink = await control.evaluate(
            (el) => el.tagName === 'A' && !!el.getAttribute('href') && !/^(#|javascript:)/i.test(el.getAttribute('href') || ''),
          );
          if (isLink) return false;
          await control.scrollIntoViewIfNeeded({ timeout: 2000 });
          try {
            await control.click({ timeout: 3000 });
          } catch {
            // Something sits over the control (a sign-up pop-up): Escape closes it, then one more try.
            // Escape is not pressed first, so a review drawer that the click reaches stays open.
            await page.keyboard.press('Escape');
            await control.click({ timeout: 3000 });
          }
          return true;
        } catch {
          return false;
        }
      },
      stopAt: stopPagingAt,
    };
    if (process.env.SCRAPER_DEBUG) console.error(`[render] reviewSelectorFound=${reviewSelectorFound} hasReviewWidget=${hasReviewWidget} json=${capture.items.length}`);
    if (reviewSelectorFound || hasReviewWidget) {
      let sorted = await sortReviewsNewest((script) => page.evaluate(script), (ms) => page.waitForTimeout(ms));
      if (!sorted) sorted = await sortNewestByRealClick(page);
      if (process.env.SCRAPER_DEBUG) console.error(`[render] sort=${JSON.stringify(sorted)}`);
      if (sorted) {
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        await capture.settle();
      }
      await pageThroughReviews(pagingOps);
    }

    // The product page shows only some reviews and links to its own review page (Nike: /t/product/reviews).
    // Follow it when fewer reviews were read than the store states and enough time is left, and page
    // through there. The size guide is opened first, while the product page is still showing.
    const stated = capture.reportedTotal();
    const reviewPage = (await page.evaluate(ALL_REVIEWS_LINK)) as string;
    const timeLeft = stopPagingAt - Date.now();
    if (reviewPage && stated !== null && capture.reviewCount() < stated && timeLeft > 25_000) {
      // Keep the earlier snapshot unless the opened guide holds a chart (the view may already show reviews only).
      if (parseSizeChartCached(chartHtml, hint).length === 0) chartHtml = (await openSizeGuide(page, Date.now() + 10_000, 4, hint)) ?? chartHtml;
      if (process.env.SCRAPER_DEBUG) console.error(`[render] following review page ${reviewPage}`);
      // Navigation may not run past the paging stop, so a slow review page cannot hit the hard deadline.
      await page
        .goto(reviewPage, { waitUntil: 'domcontentloaded', timeout: Math.min(NAV_TIMEOUT_MS, timeLeft - 10_000) })
        .catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await evaluateStable(page, REVIEW_WIDGETS_INTO_VIEW).catch(() => {});
      await capture.settle();
      await pageThroughReviews(pagingOps);
    }

    // A review list that pages by link (Zappos): keep each page, then load the next, while time is left.
    // Review cards on the pages kept so far count toward the same cap as the other paging.
    const extraHtml: string[] = [];
    let cardsKept = 0;
    for (let i = 0; i < MAX_LINKED_REVIEW_PAGES && stopPagingAt - Date.now() > 8_000; i++) {
      const known = capture.reportedTotal();
      if (known !== null && capture.reviewCount() >= known) break;
      const cardsHere = await countReviews(page).catch(() => 0);
      if (capture.reviewCount() + cardsKept + cardsHere >= MAX_REVIEWS) break;
      const next = (await page.evaluate(NEXT_REVIEW_PAGE_LINK)) as string;
      if (!next) break;
      if (process.env.SCRAPER_DEBUG) console.error(`[render] review page link ${next}`);
      const here = page.url();
      extraHtml.push((await evaluateStable(page, SERIALIZE_WITH_SHADOW_ROOTS)) as string);
      cardsKept += cardsHere;
      const moved = await page
        .goto(next, { waitUntil: 'domcontentloaded', timeout: Math.max(3_000, Math.min(NAV_TIMEOUT_MS, stopPagingAt - Date.now() - 3_000)) })
        .then(() => true, () => false);
      if (!moved) {
        // Still on this page: the final snapshot holds it, so drop the copy. If the browser had already
        // moved on, the copy is the only record of this page's reviews and stays.
        if (page.url() === here) extraHtml.pop();
        break;
      }
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await capture.settle(1500);
    }

    // A numbered pager that replaces the cards: keep each page's cards, then click the next number.
    let cardsOnPages = 0;
    for (let i = 0; i < MAX_LINKED_REVIEW_PAGES && stopPagingAt - Date.now() > 8_000; i++) {
      const cardsHere = await countReviews(page).catch(() => 0);
      if (cardsHere === 0 || cardsOnPages + cardsHere >= MAX_REVIEWS) break;
      const first = (await evaluateStable(page, REVIEW_CARDS_MARKUP)) as string;
      const clicked = (await evaluateStable(page, CLICK_NEXT_NUMBERED_PAGE)) as string;
      if (!clicked) break;
      if (process.env.SCRAPER_DEBUG) console.error(`[render] numbered pager ${clicked}`);
      extraHtml.push(first);
      cardsOnPages += cardsHere;
      // Wait for the cards to change (they are replaced, not added to).
      const changeUntil = Math.min(Date.now() + 6000, stopPagingAt);
      while (Date.now() < changeUntil) {
        await page.waitForTimeout(300);
        if (((await evaluateStable(page, REVIEW_CARDS_MARKUP)) as string) !== first) break;
      }
    }

    // A size chart is often behind a button, tab, accordion or drawer. Only controls that stay on the page
    // are clicked; a chart already in the snapshot needs no click.
    if (parseSizeChartCached(chartHtml, hint).length === 0) {
      chartHtml = (await openSizeGuide(page, startedAt + renderBudgetMs() - 18_000, 4, hint)) ?? chartHtml;
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
    }
    await capture.settle(2000);

    const framePages = await reviewFramePages(page, stopPagingAt);
    const html = (await evaluateStable(page, SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    // Still no chart: the guide may be a page of its own. Read the pages the product page links to.
    const guidePages =
      parseSizeChartCached(chartHtml, hint).length === 0 && parseSizeChartCached(html, hint).length === 0
        ? await fetchGuidePages(page, startedAt + renderBudgetMs() - 8_000)
        : [];
    return {
      html,
      status,
      finalUrl: page.url(),
      reviewSelectorFound,
      chartHtml,
      jsonResponses: capture.items,
      chartJson: capture.chartPages(),
      extraHtml: [...extraHtml, ...widgetPages(capture.items), ...framePages],
      guidePages,
    };
  } catch (err) {
    if (timedOut) {
      throw new Error(`Headless render timed out after ${renderBudgetMs() / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
  }
}

/** The part of a Puppeteer page the serverless render uses. */
export interface ServerlessPage {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null>;
  goBack(opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  url(): string;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (req: { url(): string; resourceType(): string; abort(): Promise<void>; continue(): Promise<void> }) => void): void;
  on(event: 'response', handler: (res: { url(): string; status(): number; headers(): Record<string, string>; text(): Promise<string> }) => void): void;
  evaluate(pageFunction: string): Promise<unknown>;
  /** A real pointer click on the first element matching the selector (a "pierce/" selector reaches open shadow roots). */
  click(selector: string): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  waitForNetworkIdle(opts: { timeout: number }): Promise<void>;
  waitForSelector(selector: string, opts: { timeout: number }): Promise<unknown>;
  close(): Promise<void>;
}

/** The part of a Puppeteer browser the serverless render uses. */
export interface ServerlessBrowser {
  newPage(): Promise<ServerlessPage>;
}

/**
 * Refuses images, media and fonts, and every request whose host resolves to a private address (unless the
 * page being read is itself on localhost). Set on every page the render opens, guide tabs included.
 */
async function guardServerlessPage(page: ServerlessPage, allowPrivate: boolean, hostIsBlocked: (url: string) => Promise<boolean>): Promise<void> {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      void req.abort();
      return;
    }
    if (allowPrivate) {
      void req.continue();
      return;
    }
    void hostIsBlocked(req.url()).then(
      (blocked) => (blocked ? req.abort() : req.continue()),
      () => req.abort(),
    );
  });
}

/**
 * The size-guide steps on a Puppeteer page. It has no locators, so the controls are found by an in-page
 * script that lists the same groups as sizeGuideControls (SIZE_GUIDE_CONTROL_IN_PAGE). A script click is
 * tried first (it reaches a control a sticky bar covers); a pointer click on the same control is the retry.
 */
export function serverlessGuideOps(page: ServerlessPage, sleep: (ms: number) => Promise<void>): SizeGuideOps {
  const control = (group: number, index: number, act: 'count' | 'click') =>
    page.evaluate(
      `${SIZE_GUIDE_CONTROL_IN_PAGE}(${group}, ${index}, ${JSON.stringify(act)}, ${JSON.stringify(SIZE_GUIDE_LABEL.source)}, ${JSON.stringify(SIZE_GUIDE_TEXT.source)})`,
    );
  return {
    url: () => page.url(),
    count: async (group) => Number(await control(group, 0, 'count')) || 0,
    click: async (group, index) => (await control(group, index, 'click')) === true,
    retryClick: async () => {
      await page.click('pierce/[data-pearfit-guide="1"]');
      return true;
    },
    tables: async () => Number(await page.evaluate(VISIBLE_TABLES)) || 0,
    serialize: async () => (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string,
    escape: () => page.keyboard.press('Escape'),
    back: async () => {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 });
    },
    sleep,
  };
}

/** Linked size-guide pages on a Puppeteer page, each loaded in a tab of its own that carries the request guard. */
export function serverlessGuidePageOps(page: ServerlessPage, openGuardedTab: () => Promise<ServerlessPage>): GuidePageOps {
  return {
    links: async () => ((await page.evaluate(GUIDE_LINKS)) as string[]) ?? [],
    load: async (href, timeoutMs) => {
      const guide = await openGuardedTab();
      try {
        await guide.goto(href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await guide.waitForNetworkIdle({ timeout: 3_000 }).catch(() => {});
        return (await guide.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
      } finally {
        await guide.close().catch(() => {});
      }
    },
  };
}

const CLICK_ROLE_IN_PAGE = `(role, source, flags) => {
  const re = new RegExp(source, flags);
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (el.tagName === 'BUTTON') return 'button';
    if (el.tagName === 'A') return 'link';
    return '';
  };
  for (const el of document.querySelectorAll('button, a, [role]')) {
    if (roleOf(el) !== role) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!re.test(label)) continue;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.visibility === 'hidden' || style.display === 'none' || rect.width === 0 || rect.height === 0) continue;
    el.click();
    return true;
  }
  return false;
}`;

async function renderWithServerlessChromium(url: string): Promise<RenderedPage> {
  return renderWithServerlessBrowser((await getBrowser()) as unknown as ServerlessBrowser, url);
}

/** The serverless render on a Puppeteer browser. Exported so a test can run it on a local Chromium. */
export async function renderWithServerlessBrowser(browser: ServerlessBrowser, url: string): Promise<RenderedPage> {
  const page = await browser.newPage();
  const allowPrivate = startUrlAllowsPrivate(url);
  const hostIsBlocked = createRequestHostGuard();
  await guardServerlessPage(page, allowPrivate, hostIsBlocked);

  const capture = new JsonCapture();
  page.on('response', (res) => {
    capture.offer(res.url(), res.status(), res.headers()['content-type'] ?? '', () => res.text());
  });
  const startedAt = Date.now();
  const stopPagingAt = startedAt + renderBudgetMs() - RENDER_TAIL_MS;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    page.evaluate('window.stop()').catch(() => {});
  }, renderBudgetMs());
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const countReviews = () => page.evaluate(`document.querySelectorAll(${JSON.stringify(REVIEW_CARD_SELECTOR)}).length`) as Promise<number>;
  const clickRole = (role: 'button' | 'link' | 'tab', name: RegExp) =>
    page.evaluate(`(${CLICK_ROLE_IN_PAGE})(${JSON.stringify(role)}, ${JSON.stringify(name.source)}, ${JSON.stringify(name.flags)})`) as Promise<boolean>;
  const waitForMore = async (before: number, timeoutMs: number) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if ((await countReviews()) > before) return true;
      await sleep(250);
    }
    return false;
  };

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = response?.status() ?? null;
    if (status !== null && status >= 400) {
      return { html: '', status, finalUrl: page.url(), reviewSelectorFound: false, chartHtml: null, jsonResponses: [] };
    }
    await page.waitForNetworkIdle({ timeout: 8000 }).catch(() => {});
    await clickRole('button', /^(accept( all)?( cookies)?|i accept|agree|allow all|got it|ok)$/i);
    await page.evaluate(SCROLL_TO_END);

    // Snapshot before touching reviews: a review click may leave the product view.
    const chartHtml = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    const hint: ProductHint = { url: page.url(), name: String((await page.evaluate('document.title').catch(() => '')) ?? '') };

    const reviewsBeforeOpening = await countReviews();
    const openedSection =
      (await clickRole('tab', /reviews?/i)) ||
      (await clickRole('button', /^(customer )?reviews?\b/i)) ||
      ((await countReviews()) === 0 &&
        capture.ratingFields === 0 &&
        (await clickRole('link', /^(read |see |customer )?(all )?reviews?\b/i)));
    if (openedSection) {
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
      await waitForMore(reviewsBeforeOpening, REVIEW_WAIT_MS);
    }

    if (capture.reviewCount() === 0 && (await page.evaluate(OPEN_RATING_SUMMARY))) {
      await page.waitForNetworkIdle({ timeout: 6000 }).catch(() => {});
    }
    await page.evaluate(REVIEW_WIDGETS_INTO_VIEW);
    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    await capture.settle();

    const reviewSelectorFound =
      capture.ratingFields > 0 ||
      (await page
        .waitForSelector(REVIEW_CARD_SELECTOR, { timeout: REVIEW_WAIT_MS })
        .then(() => true)
        .catch(() => false));
    const hasReviewWidget = ((await page.evaluate(`document.querySelectorAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)}).length`)) as number) > 0;

    if (reviewSelectorFound || hasReviewWidget) {
      if (await sortReviewsNewest((script) => page.evaluate(script), sleep)) {
        await page.waitForNetworkIdle({ timeout: 4000 }).catch(() => {});
        await capture.settle();
      }
      await pageThroughReviews({
        click: (skip) => page.evaluate(`${CLICK_NEXT_REVIEWS}(${JSON.stringify(skip)})`) as Promise<string>,
        progress: async () => ({ json: capture.reviewCount(), cards: await countReviews() }),
        enough: async () => (capture.reviewCount() > 0 ? capture.reviewCount() : await countReviews()) >= MAX_REVIEWS,
        settle: () => capture.settle(1500),
        sleep,
        scroll: () => page.evaluate(SCROLL_TO_BOTTOM) as Promise<string>,
        stopAt: stopPagingAt,
      });
    }

    // A size chart is often behind a button, tab, accordion or drawer. Same steps as the Playwright render: only
    // controls that stay on the page are clicked, and a chart already in the snapshot needs no click.
    let guideHtml: string | null = null;
    if (parseSizeChartCached(chartHtml, hint).length === 0) {
      guideHtml = await openSizeGuideWith(serverlessGuideOps(page, sleep), startedAt + renderBudgetMs() - 18_000, 4, hint);
      await page.waitForNetworkIdle({ timeout: 2000 }).catch(() => {});
    }
    await capture.settle(2000);

    const html = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    // Still no chart: the guide may be a page of its own. Read the pages the product page links to.
    const guidePages =
      !guideHtml && parseSizeChartCached(chartHtml, hint).length === 0 && parseSizeChartCached(html, hint).length === 0
        ? await fetchGuidePagesWith(
            serverlessGuidePageOps(page, async () => {
              const tab = await browser.newPage();
              await guardServerlessPage(tab, allowPrivate, hostIsBlocked);
              return tab;
            }),
            startedAt + renderBudgetMs() - 8_000,
          )
        : [];
    return {
      html,
      status,
      finalUrl: page.url(),
      reviewSelectorFound,
      chartHtml: guideHtml ?? chartHtml,
      jsonResponses: capture.items,
      chartJson: capture.chartPages(),
      guidePages,
    };
  } catch (err) {
    if (timedOut) throw new Error(`Headless render timed out after ${renderBudgetMs() / 1000}s`);
    throw err;
  } finally {
    clearTimeout(deadline);
    await page.close().catch(() => {});
  }
}
