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
import { createRequestHostGuard, isBlockedHostname } from './publicUrl.ts';

/** Selectors that indicate review content has rendered. Kept in sync with server.ts. */
export const REVIEW_CARD_SELECTOR =
  '[data-review-card], .review-card, [itemprop="review"], .review-item, .yotpo-review, .jdgm-rev, .spr-review, .bv-content-review, .pr-review, .okeReviews-review, .stamped-review, [data-bv-show="reviews"] li, [class*="ReviewCard"], [class*="review-card"], li:has(> div > [data-testid="ITORating"]), li:has([class*="reviewUserInfo"])';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const NAV_TIMEOUT_MS = 45_000;
/** Whole render, including scrolling and paging. One page cannot hold the browser longer than this. */
export const RENDER_DEADLINE_MS = 120_000;
/** Time kept back at the end of a render for opening the size chart and serializing the page. */
const RENDER_TAIL_MS = 12_000;
const REVIEW_WAIT_MS = 10_000;
/** Most "load more" / "next page" clicks in one review widget. */
const MAX_REVIEW_PAGES = 60;
/** Stop paging once about this many reviews were seen; enough for fit statistics. */
const MAX_REVIEWS = 300;
/** Review JSON kept from one render: per response and in total. */
const MAX_CAPTURED_BODY_BYTES = 5_000_000;
const MAX_CAPTURED_TOTAL_BYTES = 30_000_000;

/** Containers of review widgets (vendor and first-party). Used to scroll them into view and to find their paging controls. */
export const REVIEW_WIDGET_SELECTOR = [
  '#yotpo-main-widget', '.yotpo-main-widget', '[class*="yotpo-reviews"]', '.yotpo-display-wrapper',
  '.okeReviews', '[data-oke-reviews-widget]', '[data-oke-widget]',
  '.jdgm-widget', '.jdgm-rev-widg', '#judgeme_product_reviews',
  '#stamped-main-widget', '.stamped-main-widget', '#stamped-reviews-widget',
  '[class*="junip"]', 'junip-product-reviews',
  '[data-bv-show="reviews"]', '#BVRRContainer', '[data-bv-show="review_highlights"]',
  '#pr-reviewdisplay', '.pr-review-display',
  '.kl_reviews', '[class*="kl_reviews"]', '#klaviyo-reviews-all',
  '.loox-reviews-default', '#looxReviews', '.reviews-io-widget', '#ReviewsWidget', '#full-page-widget',
  '#reviews', '#Reviews', '#product-reviews', '[id*="review" i]', '[class*="review" i]',
].join(', ');

export interface RenderedPage {
  html: string;
  status: number | null;
  finalUrl: string;
  reviewSelectorFound: boolean;
  /**
   * The page as serialized once it settled and was scrolled, before any review step.
   * A review click can navigate away from the product view (Uniqlo goes to /reviews) and take the
   * size chart with it, so the chart is read from here when the final html has none.
   */
  chartHtml: string | null;
  /** JSON (or JSONP) responses the page itself received that carry a rating field: review widget data. */
  jsonResponses: CapturedJson[];
}

export interface CapturedJson {
  url: string;
  body: string;
}

const RATING_FIELD = /"(rating|score|Rating|reviewRating|stars|starRating|star_rating|ratingValue|overallRating|rate)"\s*:/;
const JSONP = /^[\w$.]+\(\s*([\s\S]*?)\s*\)\s*;?\s*$/;

/** Keeps the review JSON a page receives, within size limits. Script bundles are not kept. */
export class JsonCapture {
  readonly items: CapturedJson[] = [];
  private bytes = 0;
  private readonly pending = new Set<Promise<void>>();
  /** Rough count of rating fields seen, used to stop paging once enough reviews loaded. */
  ratingFields = 0;

  offer(url: string, status: number, contentType: string, read: () => Promise<string>): void {
    if (status < 200 || status >= 300) return;
    const isJson = /json/i.test(contentType);
    const maybeJsonp = /javascript|text\/plain/i.test(contentType) && /review|rating|ugc|bazaarvoice|batch/i.test(url);
    if (!isJson && !maybeJsonp) return;
    const job = read()
      .then((raw) => this.add(url, raw))
      .catch(() => {})
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  add(url: string, raw: string): void {
    if (raw.length > MAX_CAPTURED_BODY_BYTES || this.bytes + raw.length > MAX_CAPTURED_TOTAL_BYTES) return;
    let body = raw.trim();
    const wrapped = body[0] !== '{' && body[0] !== '[' ? JSONP.exec(body) : null;
    if (wrapped) body = wrapped[1];
    if (body[0] !== '{' && body[0] !== '[') return;
    if (!RATING_FIELD.test(body)) return;
    this.items.push({ url, body });
    this.bytes += body.length;
    this.ratingFields += (body.match(new RegExp(RATING_FIELD.source, 'g')) ?? []).length;
  }

  async settle(timeoutMs = 3000): Promise<void> {
    await Promise.race([Promise.all([...this.pending]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}

/**
 * Headless is for pages whose reviews are added by JavaScript.
 * A failed static fetch (including 404 and "could not reach") is reported as that failure.
 * A store that refused the request (403/429/503) is not retried in a browser.
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

let browserPromise: Promise<{ close(): Promise<void> }> | null = null;
let renderTail: Promise<void> = Promise.resolve();

/** Chromium pack for Vercel. The full Playwright browser does not fit in that function. */
const SERVERLESS_CHROMIUM_PACK =
  'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar';

/** A test page on localhost may load private hosts. A public product page may not. */
function startUrlAllowsPrivate(raw: string): boolean {
  try {
    return isBlockedHostname(new URL(raw).hostname);
  } catch {
    return false;
  }
}


function renderBudgetMs(): number {
  // The hosted function is capped at 60s, including the Chromium download on a cold start.
  return process.env.VERCEL ? 50_000 : RENDER_DEADLINE_MS;
}

async function getBrowser(): Promise<{ close(): Promise<void> }> {
  if (!browserPromise) {
    browserPromise = (process.env.VERCEL ? launchServerlessBrowser() : launchPlaywrightBrowser()).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

async function launchPlaywrightBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });
}

async function launchServerlessBrowser(): Promise<{ close(): Promise<void> }> {
  const chromiumMod = await import('@sparticuz/chromium-min');
  const puppeteerMod = await import('puppeteer-core');
  const chromium = chromiumMod.default ?? chromiumMod;
  const puppeteer = puppeteerMod.default ?? puppeteerMod;
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(SERVERLESS_CHROMIUM_PACK),
    headless: true,
    defaultViewport: { width: 1366, height: 900 },
  });
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

/** Scrolls down until the page stops growing (lazy sections load as they come into view). */
const SCROLL_TO_END = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  let stable = 0;
  let lastHeight = 0;
  const started = Date.now();
  while (y < 80000 && Date.now() - started < 15000) {
    y += step;
    window.scrollTo(0, y);
    await sleep(120);
    const height = document.documentElement.scrollHeight;
    if (y + window.innerHeight >= height) {
      stable = height === lastHeight ? stable + 1 : 0;
      lastHeight = height;
      if (stable >= 3) break;
      await sleep(400);
    }
  }
})()`;

const SCROLL_TO_BOTTOM = `(() => { window.scrollTo(0, document.documentElement.scrollHeight); return 'scroll'; })()`;

/** Brings each review widget into view so widgets that load on visibility start loading. */
const REVIEW_WIDGETS_INTO_VIEW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = [];
  for (const el of document.querySelectorAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)})) {
    if (seen.some((s) => s.contains(el))) continue;
    seen.push(el);
    el.scrollIntoView({ block: 'center' });
    await sleep(350);
    if (seen.length >= 12) break;
  }
  return seen.length;
})()`;

/**
 * Clicks one "load more" or "next page" control inside a review widget. Never a link that would
 * leave the page. Returns the control's label, or '' when there is none.
 */
const CLICK_NEXT_REVIEWS = `(() => {
  const MORE = /^(load|show|see|view|read) (more|all|\\d+ more)( reviews?)?$|^more reviews$/i;
  const NEXT = /^(next|next page|next reviews?|›|»|→|>|go to next page)$/i;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const disabled = (el) =>
    el.disabled || el.getAttribute('aria-disabled') === 'true' || /(^|\\s)(is-)?disabled(\\s|$)/.test(String(el.className || ''));
  const seen = new Set();
  const found = [];
  for (const box of document.querySelectorAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)})) {
    for (const el of box.querySelectorAll('button, a, [role="button"], [role="link"]')) {
      if (seen.has(el)) continue;
      seen.add(el);
      const aria = el.getAttribute('aria-label') || '';
      const label = (aria || el.textContent || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
      const isMore = MORE.test(label);
      const isNext = NEXT.test(label) || /next (page|reviews?)/i.test(aria) || (/(^|[-_ ])next([-_ ]|$)/i.test(String(el.className || '')) && label.length <= 3);
      if (!isMore && !isNext) continue;
      if (el.tagName === 'A') {
        // Same-page links only: "#…", "javascript:…", or "?…" (Okendo's "Show more reviews" is ?okeReviewsNextUrl=…).
        const href = el.getAttribute('href') || '';
        if (href && !/^(#|javascript:|\\?)/i.test(href)) continue;
      }
      // Arrows of a photo carousel or slider are not review paging.
      if (isNext && !isMore && el.closest('[class*="carousel" i], [class*="slider" i], [class*="swiper" i], [class*="slick" i], [class*="gallery" i], [class*="media" i]')) continue;
      if (!visible(el) || disabled(el)) continue;
      found.push({ el, isMore, label });
    }
  }
  // Fallback: a "load more reviews" button that sits outside the widget (buttons only, never links).
  if (found.length === 0) {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (/^(load|show|see|view) more( reviews?)?$/i.test(label) && visible(el) && !disabled(el)) {
        found.push({ el, isMore: true, label });
        break;
      }
    }
  }
  const pick = found.find((f) => f.isMore) || found[0];
  if (!pick) return '';
  pick.el.scrollIntoView({ block: 'center' });
  pick.el.click();
  return pick.label.slice(0, 40) || 'next';
})()`;

/**
 * Sorts a review widget by newest first, when it offers that. Widgets often open on "most helpful"
 * or "highest rated", so the first pages are a biased sample. Returns what it did, or ''.
 * Step "select": a <select> with a newest option. Step "open": clicks a "Sort" control; step
 * "pick" (run after a short wait) clicks the newest option of the menu it opened.
 */
const SORT_NEWEST = `((step) => {
  const NEWEST = /^(sort( by)?:?\\s*)?(most recent|newest( first)?|date,? newest|recent|latest)$/i;
  const boxes = [...document.querySelectorAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)})];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const text = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
  if (step === 'select') {
    for (const box of boxes) {
      for (const select of box.querySelectorAll('select')) {
        const option = [...select.options].find((o) => NEWEST.test(o.textContent.trim()));
        if (!option || select.value === option.value) continue;
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return 'select:' + option.textContent.trim();
      }
    }
    return '';
  }
  if (step === 'open') {
    for (const box of boxes) {
      for (const el of box.querySelectorAll('button, [role="button"], [role="combobox"], [aria-haspopup]')) {
        if (/^sort\\b|sort by/i.test(text(el)) && visible(el)) { el.click(); return 'open:' + text(el).slice(0, 30); }
      }
    }
    return '';
  }
  for (const el of document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, a[href^="#"], a:not([href])')) {
    if (NEWEST.test(text(el)) && visible(el) && el.getAttribute('aria-selected') !== 'true') { el.click(); return 'pick:' + text(el); }
  }
  return '';
})`;

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
  if (process.env.VERCEL) return renderWithServerlessChromium(url);
  return renderWithPlaywright(url);
}

async function renderWithPlaywright(url: string): Promise<RenderedPage> {
  const browser = (await getBrowser()) as Browser;
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
  });
  const allowPrivate = startUrlAllowsPrivate(url);
  const hostIsBlocked = createRequestHostGuard();
  // Images, video and fonts are irrelevant to review text; skipping them makes renders faster.
  // Every other request, redirects included, is checked against the resolved address of its host.
  await context.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    if (!allowPrivate && (await hostIsBlocked(route.request().url()))) return route.abort();
    return route.continue();
  });

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
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = response?.status() ?? null;
    if (status !== null && status >= 400) {
      return { html: '', status, finalUrl: page.url(), reviewSelectorFound: false, chartHtml: null, jsonResponses: [] };
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    await clickFirst(page, 'button', /^(accept( all)?( cookies)?|i accept|agree|allow all|got it|ok)$/i);

    await page.evaluate(SCROLL_TO_END);

    // Snapshot before touching reviews: a review click may leave the product view.
    const chartHtml = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;

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
    }

    // Widgets that load when they come into view (Okendo, Junip, Bazaarvoice) need to be seen.
    await page.evaluate(REVIEW_WIDGETS_INTO_VIEW);
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

    if (reviewSelectorFound) {
      if (await sortReviewsNewest((script) => page.evaluate(script), (ms) => page.waitForTimeout(ms))) {
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        await capture.settle();
      }
      await pageThroughReviews({
        click: () => page.evaluate(CLICK_NEXT_REVIEWS) as Promise<string>,
        progress: async () => capture.items.length + (await countReviews(page)),
        enough: async () => Math.max(capture.ratingFields, await countReviews(page)) >= MAX_REVIEWS,
        settle: () => capture.settle(1500),
        sleep: (ms) => page.waitForTimeout(ms),
        scroll: () => page.evaluate(SCROLL_TO_BOTTOM) as Promise<string>,
        stopAt: stopPagingAt,
      });
    }

    // A size chart is often behind a button. Buttons and tabs only: a link can leave the page.
    await clickFirst(page, 'tab', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide/i);
    await clickFirst(page, 'button', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide|size\s*&\s*fit/i);
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await capture.settle();

    const html = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    return {
      html,
      status,
      finalUrl: page.url(),
      reviewSelectorFound,
      chartHtml,
      jsonResponses: capture.items,
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

/** Switches the review widget to newest first when it can. Best effort; returns what it did. */
async function sortReviewsNewest(evaluate: (script: string) => Promise<unknown>, sleep: (ms: number) => Promise<void>): Promise<string> {
  const viaSelect = (await evaluate(`${SORT_NEWEST}('select')`)) as string;
  if (viaSelect) return viaSelect;
  const opened = (await evaluate(`${SORT_NEWEST}('open')`)) as string;
  if (!opened) return '';
  await sleep(600);
  const picked = (await evaluate(`${SORT_NEWEST}('pick')`)) as string;
  return picked ? `${opened} ${picked}` : '';
}

/**
 * Clicks "load more" / "next page" in the review widget until no new reviews arrive twice in a row,
 * enough reviews were seen, or time runs out.
 */
export async function pageThroughReviews(ops: {
  click: () => Promise<string>;
  progress: () => Promise<number>;
  enough: () => Promise<boolean>;
  settle: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Scrolls to the end of the page; returns 'scroll'. */
  scroll?: () => Promise<string>;
  stopAt: number;
}): Promise<number> {
  let pages = 0;
  let idle = 0;
  for (let i = 0; i < MAX_REVIEW_PAGES && Date.now() < ops.stopAt; i++) {
    if (await ops.enough()) break;
    const before = await ops.progress();
    // No control left: infinite-scroll lists load the next reviews when the end comes into view.
    const clicked = (await ops.click()) || (ops.scroll ? await ops.scroll() : '');
    if (!clicked) break;
    let grew = false;
    const until = Math.min(Date.now() + 5000, ops.stopAt);
    while (Date.now() < until) {
      await ops.sleep(300);
      await ops.settle();
      if ((await ops.progress()) > before) {
        grew = true;
        break;
      }
    }
    if (grew) {
      pages++;
      idle = 0;
    } else if (++idle >= 2) {
      break;
    }
  }
  return pages;
}

interface ServerlessPage {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null>;
  url(): string;
  setUserAgent(ua: string): Promise<void>;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (req: { url(): string; resourceType(): string; abort(): Promise<void>; continue(): Promise<void> }) => void): void;
  on(event: 'response', handler: (res: { url(): string; status(): number; headers(): Record<string, string>; text(): Promise<string> }) => void): void;
  evaluate(pageFunction: string): Promise<unknown>;
  waitForNetworkIdle(opts: { timeout: number }): Promise<void>;
  waitForSelector(selector: string, opts: { timeout: number }): Promise<unknown>;
  close(): Promise<void>;
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
  const browser = (await getBrowser()) as unknown as { newPage(): Promise<ServerlessPage> };
  const page = await browser.newPage();
  const allowPrivate = startUrlAllowsPrivate(url);
  const hostIsBlocked = createRequestHostGuard();
  await page.setUserAgent(USER_AGENT);
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

  const capture = new JsonCapture();
  page.on('response', (res) => {
    capture.offer(res.url(), res.status(), res.headers()['content-type'] ?? '', () => res.text());
  });
  const stopPagingAt = Date.now() + renderBudgetMs() - RENDER_TAIL_MS;
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

    await page.evaluate(REVIEW_WIDGETS_INTO_VIEW);
    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    await capture.settle();

    const reviewSelectorFound =
      capture.ratingFields > 0 ||
      (await page
        .waitForSelector(REVIEW_CARD_SELECTOR, { timeout: REVIEW_WAIT_MS })
        .then(() => true)
        .catch(() => false));

    if (reviewSelectorFound) {
      if (await sortReviewsNewest((script) => page.evaluate(script), sleep)) {
        await page.waitForNetworkIdle({ timeout: 4000 }).catch(() => {});
        await capture.settle();
      }
      await pageThroughReviews({
        click: () => page.evaluate(CLICK_NEXT_REVIEWS) as Promise<string>,
        progress: async () => capture.items.length + (await countReviews()),
        enough: async () => Math.max(capture.ratingFields, await countReviews()) >= MAX_REVIEWS,
        settle: () => capture.settle(1500),
        sleep,
        scroll: () => page.evaluate(SCROLL_TO_BOTTOM) as Promise<string>,
        stopAt: stopPagingAt,
      });
    }

    await clickRole('tab', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide/i);
    await clickRole('button', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide|size\s*&\s*fit/i);
    await sleep(500);
    await capture.settle();

    const html = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    return { html, status, finalUrl: page.url(), reviewSelectorFound, chartHtml, jsonResponses: capture.items };
  } catch (err) {
    if (timedOut) throw new Error(`Headless render timed out after ${renderBudgetMs() / 1000}s`);
    throw err;
  } finally {
    clearTimeout(deadline);
    await page.close().catch(() => {});
  }
}
