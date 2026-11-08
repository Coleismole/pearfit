/**
 * Headless Chromium fallback for product pages whose reviews are loaded by JavaScript
 * (Bazaarvoice, Yotpo, PowerReviews, ...). It is NOT used to get around stores that refuse
 * automated requests (403/429): those are respected and reported.
 *
 * Renders the page, dismisses cookie banners, scrolls to trigger lazy-loaded review
 * widgets, opens the reviews section, clicks "load more" a few times, then returns the
 * rendered HTML (with open shadow roots inlined) for the normal cheerio extractor.
 *
 * Playwright is imported lazily so the server still starts when no browser is installed.
 */
import type { Browser, Page } from 'playwright';

/** Selectors that indicate review content has rendered. Kept in sync with server.ts. */
export const REVIEW_CARD_SELECTOR =
  '[data-review-card], .review-card, [itemprop="review"], .review-item, .yotpo-review, .jdgm-rev, .spr-review, .bv-content-review, .pr-review, .okeReviews-review, .stamped-review, [data-bv-show="reviews"] li, [class*="ReviewCard"], [class*="review-card"], li:has(> div > [data-testid="ITORating"]), li:has([class*="reviewUserInfo"])';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const NAV_TIMEOUT_MS = 45_000;
/** Whole render, including scrolling and load-more. One page cannot hold the browser longer than this. */
export const RENDER_DEADLINE_MS = 90_000;
const REVIEW_WAIT_MS = 10_000;
const MAX_LOAD_MORE_CLICKS = 5;
const MAX_INFINITE_SCROLL_ROUNDS = 10;
/** Stop paging once this many review cards are on the page; enough for fit statistics. */
const MAX_REVIEWS = 200;

export interface RenderedPage {
  html: string;
  status: number | null;
  finalUrl: string;
  reviewSelectorFound: boolean;
}

let browserPromise: Promise<Browser> | null = null;
let renderTail: Promise<void> = Promise.resolve();

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({
        headless: true,
        args: ['--no-sandbox'],
      });
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeHeadlessBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    await (await pending).close();
  } catch {
    // already closed
  }
}

/** Clicks the first visible element matching a role + name pattern. Best effort. */
async function clickFirst(page: Page, role: 'button' | 'link' | 'tab', name: RegExp): Promise<boolean> {
  const loc = page.getByRole(role, { name }).first();
  try {
    if (await loc.isVisible({ timeout: 500 })) {
      await loc.click({ timeout: 2000 });
      return true;
    }
  } catch {
    // not clickable; ignore
  }
  return false;
}

async function scrollThroughPage(page: Page): Promise<void> {
  // Passed as a string so the bundler cannot inject helpers that do not exist in the page.
  await page.evaluate(`(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.body.scrollHeight && y < 40000; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
  })()`);
}

const SERIALIZE_WITH_SHADOW_ROOTS = `(() => {
  const parts = [];
  const walk = (root) => {
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        parts.push(el.shadowRoot.innerHTML);
        walk(el.shadowRoot);
      }
    });
  };
  walk(document);
  const html = document.documentElement.outerHTML;
  if (parts.length === 0) return '<!DOCTYPE html>' + html;
  const dump = '<div data-shadow-root-dump>' + parts.join('\\n') + '</div>';
  const idx = html.lastIndexOf('</body>');
  return '<!DOCTYPE html>' + (idx === -1 ? html + dump : html.slice(0, idx) + dump + html.slice(idx));
})()`;

async function countReviews(page: Page): Promise<number> {
  return page.locator(REVIEW_CARD_SELECTOR).count();
}

async function hasReviews(page: Page): Promise<boolean> {
  return (await countReviews(page)) > 0;
}

/** Waits until more review cards than `before` are present, or the timeout passes. */
async function waitForMoreReviews(page: Page, before: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countReviews(page)) > before) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

export async function renderPageHtml(url: string): Promise<RenderedPage> {
  const run = renderTail.then(() => renderPageHtmlOnce(url));
  renderTail = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function renderPageHtmlOnce(url: string): Promise<RenderedPage> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
  });
  // Images, video and fonts are irrelevant to review text; skipping them makes renders faster.
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    return type === 'image' || type === 'media' || type === 'font' ? route.abort() : route.continue();
  });

  const page = await context.newPage();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    context.close().catch(() => {});
  }, RENDER_DEADLINE_MS);
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = response?.status() ?? null;
    if (status !== null && status >= 400) {
      return { html: '', status, finalUrl: page.url(), reviewSelectorFound: false };
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    await clickFirst(page, 'button', /^(accept( all)?( cookies)?|i accept|agree|allow all|got it|ok)$/i);

    await scrollThroughPage(page);

    // The full review list is often behind a tab or accordion, even when a few highlight
    // reviews are already visible. A link may navigate away, so only use it as a last resort.
    const reviewsBeforeOpening = await countReviews(page);
    const openedSection =
      (await clickFirst(page, 'tab', /reviews?/i)) ||
      (await clickFirst(page, 'button', /^(customer )?reviews?\b/i)) ||
      (!(await hasReviews(page)) && (await clickFirst(page, 'link', /^(read |see |customer )?(all )?reviews?\b/i)));
    if (openedSection) {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await waitForMoreReviews(page, reviewsBeforeOpening, REVIEW_WAIT_MS);
      await scrollThroughPage(page);
    }

    const reviewSelectorFound = await page
      .locator(REVIEW_CARD_SELECTOR)
      .first()
      .waitFor({ timeout: REVIEW_WAIT_MS, state: 'attached' })
      .then(() => true)
      .catch(() => false);

    if (reviewSelectorFound) {
      for (let i = 0; i < MAX_LOAD_MORE_CLICKS; i++) {
        const before = await countReviews(page);
        const clicked = await clickFirst(page, 'button', /^(load|show|see|view) more( reviews)?$/i);
        if (!clicked) break;
        if (!(await waitForMoreReviews(page, before, 5000))) break;
      }

      // Infinite scroll: keep scrolling to the bottom while new review cards keep appearing.
      for (let i = 0; i < MAX_INFINITE_SCROLL_ROUNDS; i++) {
        const before = await countReviews(page);
        if (before >= MAX_REVIEWS) break;
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        if (!(await waitForMoreReviews(page, before, 4000))) break;
      }
    }

    const html = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    return {
      html,
      status,
      finalUrl: page.url(),
      reviewSelectorFound,
    };
  } catch (err) {
    if (timedOut) {
      throw new Error(`Headless render timed out after ${RENDER_DEADLINE_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
  }
}
