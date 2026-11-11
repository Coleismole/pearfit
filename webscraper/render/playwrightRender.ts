/** The local render on Playwright: the full render and the short size-chart-only render. */
import type { Browser } from 'playwright';
import { parseSizeChartCached } from '../pageHelpers.ts';
import {
  REVIEW_CARD_SELECTOR,
  NAV_TIMEOUT_MS,
  RENDER_TAIL_MS,
  REVIEW_WAIT_MS,
  MAX_REVIEWS,
  MAX_LINKED_REVIEW_PAGES,
  REVIEW_WIDGET_SELECTOR,
} from './constants.ts';
import type { RenderedPage } from './types.ts';
import { JsonCapture } from './jsonCapture.ts';
import { navigationTimedOutAfterLoading } from './decisions.ts';
import { renderBudgetMs, getBrowser } from './browser.ts';
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
} from './pageScripts.ts';
import { openSizeGuide, fetchGuidePages } from './sizeGuide.ts';
import { sortReviewsNewest, pageThroughReviews } from './paging.ts';
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
} from './playwrightHelpers.ts';

/** Whole chart-only render, including opening the guide and reading linked guide pages. */
export const CHART_RENDER_BUDGET_MS = 45_000;

export async function renderChartOnlyWithPlaywright(url: string): Promise<RenderedPage> {
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

export async function renderWithPlaywright(url: string): Promise<RenderedPage> {
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
