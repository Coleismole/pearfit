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
import type { Browser, Page } from 'playwright';
import { createRequestHostGuard, isBlockedHostname } from './publicUrl.ts';
import { extractReviewsFromJson, parseJsonBody, reviewIdentity } from './reviewJson.ts';
import { parseSizeChart } from './sizeChart.ts';

/** Selectors that indicate review content has rendered. Kept in sync with server.ts. */
export const REVIEW_CARD_SELECTOR =
  '[data-review-card], .review-card, [itemprop="review"], .review-item, .yotpo-review, .jdgm-rev, .spr-review, .bv-content-review, .pr-review, .okeReviews-review, .oke-w-review, .stamped-review, [data-bv-show="reviews"] li, [class*="ReviewCard"], [class*="review-card"], li:has(> div > [data-testid="ITORating"]), li:has([class*="reviewUserInfo"])';

/**
 * The browser keeps its own user agent. A desktop-Chrome string on headless Linux contradicts what the
 * browser reports elsewhere, and some stores answer that with an error page (Roots: HTTP 502).
 */

const NAV_TIMEOUT_MS = 45_000;
/** Whole render, including scrolling and paging. One page cannot hold the browser longer than this. */
export const RENDER_DEADLINE_MS = 120_000;
/**
 * Time kept back at the end of a render for opening the size chart and serializing the page. A page of
 * several megabytes (Duer: 3 MB) takes seconds to serialize; running into the hard deadline loses
 * everything the render recorded.
 */
const RENDER_TAIL_MS = 25_000;
const REVIEW_WAIT_MS = 10_000;
/** Most "load more" / "next page" clicks in one review widget. */
const MAX_REVIEW_PAGES = 60;
/** Stop paging once about this many reviews were seen; enough for fit statistics. */
const MAX_REVIEWS = 300;
/** Most review pages followed by link (/…/page/N). */
const MAX_LINKED_REVIEW_PAGES = 15;
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
  '[data-bv-show]', '#BVRRContainer', '[class*="bv-rnr"]', '[class*="bv_main"]', '[class*="bv-pagination"]', '[data-bv-v]',
  '#pr-reviewdisplay', '.pr-review-display',
  '.kl_reviews', '[class*="kl_reviews"]', '#klaviyo-reviews-all',
  '.loox-reviews-default', '#looxReviews', '.reviews-io-widget', '#ReviewsWidget', '#full-page-widget',
  '#reviews', '#Reviews', '#product-reviews', '[id*="review" i]:not([id*="preview" i])', '[class*="review" i]:not([class*="preview" i])',
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
  /**
   * Earlier pages of a review list that pages by link (Zappos /product/review/<id>/page/2), oldest first.
   * `html` is the last page. Each holds its own reviews.
   */
  extraHtml?: string[];
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

  private readonly counted = new Set<string>();
  private countedItems = 0;

  private statedTotal: number | null = null;
  private statedTotalFrom = 0;

  /** Distinct reviews in the JSON kept so far (by id, else by the start of the text). */
  reviewCount(): number {
    for (; this.countedItems < this.items.length; this.countedItems++) {
      const set = extractReviewsFromJson(parseJsonBody(this.items[this.countedItems].body));
      for (const r of set.reviews) this.counted.add(reviewIdentity(r));
      // The total stated beside the largest review list: a recommendations response can carry its own totals.
      if (set.reportedTotal !== null && set.reviews.length >= this.statedTotalFrom) {
        this.statedTotal = set.reportedTotal;
        this.statedTotalFrom = set.reviews.length;
      }
    }
    return this.counted.size;
  }

  /** The largest product review total the kept JSON states, or null. */
  reportedTotal(): number | null {
    this.reviewCount();
    return this.statedTotal;
  }

  async settle(timeoutMs = 3000): Promise<void> {
    await Promise.race([Promise.all([...this.pending]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}

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

/**
 * In-page helper: querySelectorAll that also searches open shadow roots (Bazaarvoice's newer
 * review app renders inside one). Prepended to the in-page scripts below.
 */
const DEEP_QUERY = `const deepAll = (selector, root = document) => {
  const out = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll(selector, el.shadowRoot));
  return out;
};`;

/**
 * Clicks the rating summary near the product title ("4.1 out of 5 (84)", "84 reviews") when it is a
 * same-page control. On many stores it opens the review section (Arc'teryx loads Bazaarvoice from it).
 */
const OPEN_RATING_SUMMARY = `(() => {
  ${DEEP_QUERY}
  for (const el of deepAll('a, button, [role="button"]')) {
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (label.length > 90 || !/out of 5[^a-z]*\\(?\\d|out of 5\\b.*\\b\\d[\\d,]* (reviews?|ratings?)\\b|\\(\\d[\\d,]*\\)|^\\d[\\d,]* (reviews?|ratings?)\\b/i.test(label)) continue;
    const href = el.getAttribute('href') || '';
    if (el.tagName === 'A' && href && !/^(#|javascript:)/i.test(href)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    el.click();
    return label.slice(0, 40);
  }
  return '';
})()`;

/**
 * The address of this product's own review page ("See Reviews" → /t/product/reviews): a link whose path
 * extends the product page's path. Never another product or section of the site.
 */
const ALL_REVIEWS_LINK = `(() => {
  ${DEEP_QUERY}
  const base = location.pathname.replace(/\\/$/, '');
  for (const el of deepAll('a[href]')) {
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!/^(see|view|read|show)( all)?( \\d[\\d,]*)? reviews?\\b|^all reviews\\b/i.test(label)) continue;
    try {
      const target = new URL(el.getAttribute('href'), location.href);
      if (target.origin === location.origin && target.pathname.startsWith(base + '/') && /review/i.test(target.pathname)) return target.href;
    } catch (e) {}
  }
  return '';
})()`;

/**
 * The next page of a review list that pages by link: /…/page/3 after /…/page/2, or ?page=3. Only on a
 * review page (its path names reviews), only within the same list, never another product or a search.
 */
const NEXT_REVIEW_PAGE_LINK = `(() => {
  if (!/review/i.test(location.pathname)) return '';
  const pageOf = (u) => Number((u.pathname.match(/\\/page\\/(\\d+)\\/?$/) || [])[1] || (u.search.match(/[?&](?:page|pg)=(\\d+)/) || [])[1] || 1);
  const base = location.pathname.replace(/\\/page\\/\\d+\\/?$/, '').replace(/\\/$/, '');
  // The other query parameters (a star filter, another sort) must match, or the link is another list.
  const otherParams = (u) => {
    const params = new URLSearchParams(u.search);
    params.delete('page');
    params.delete('pg');
    params.sort();
    return params.toString();
  };
  const here = new URL(location.href);
  const current = pageOf(here);
  for (const a of document.querySelectorAll('a[href]')) {
    let target;
    try { target = new URL(a.getAttribute('href'), location.href); } catch (e) { continue; }
    if (target.origin !== location.origin) continue;
    const samePath = target.pathname.replace(/\\/page\\/\\d+\\/?$/, '').replace(/\\/$/, '') === base;
    if (samePath && otherParams(target) === otherParams(here) && pageOf(target) === current + 1) return target.href;
  }
  return '';
})()`;

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
  ${DEEP_QUERY}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = [];
  for (const el of deepAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)})) {
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
const CLICK_NEXT_REVIEWS = `((skip) => {
  ${DEEP_QUERY}
  // "Read more" expands one review's text; it never loads more reviews.
  const MORE = /^(load|show|see|view) (more|all|\\d+ more)( reviews?)?$|^more reviews$/i;
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
  for (const box of deepAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)})) {
    for (const el of deepAll('button, a, [role="button"], [role="link"]', box)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const aria = el.getAttribute('aria-label') || '';
      // Decoration around the words: "+ Load More Reviews", "Load More Reviews (73 remaining)".
      const label = (aria || el.textContent || el.getAttribute('title') || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .replace(/^[^a-z0-9›»→>]+/i, '')
        // Only a count of what is left: "See all (12)" (customer photos) must not become "See all".
        .replace(/\\s*\\(\\d[\\d,]* (remaining|more|left)\\)$/i, '');
      if (/about this review|this review'?s? (text|content)/i.test(aria)) continue;
      const isMore = MORE.test(label);
      const isNext = NEXT.test(label) || /next (page|reviews?)/i.test(aria) || (/(^|[-_ ])next([-_ ]|$)/i.test(String(el.className || '')) && label.length <= 3);
      if (!isMore && !isNext) continue;
      if (el.tagName === 'A') {
        // Same-page links only: "#…", "javascript:…", "?…" (Okendo's ?okeReviewsNextUrl=…), or this page's
        // own path with other parameters (Bazaarvoice's "Next Reviews" links to ?bvstate=pg:2).
        const href = el.getAttribute('href') || '';
        if (href && !/^(#|javascript:|\\?)/i.test(href)) {
          let same = false;
          try {
            const target = new URL(href, location.href);
            same = target.origin === location.origin && target.pathname === location.pathname;
          } catch (e) {}
          if (!same) continue;
        }
      }
      // A "next" beside numbered page buttons is the review list's pager, not a picture slider.
      const pager = isNext && el.parentElement && [...el.parentElement.querySelectorAll('button, a, [role="button"]')]
        .some((b) => /^(page )?\\d+$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
      // Other arrows inside a photo carousel or slider are not review paging.
      if (isNext && !isMore && !pager && el.closest('[class*="carousel" i], [class*="slider" i], [class*="swiper" i], [class*="slick" i], [class*="gallery" i], [class*="media" i]')) continue;
      if (!visible(el) || disabled(el)) continue;
      found.push({ el, isMore, label, rank: isMore ? 3 : pager ? 2 : 1 });
    }
  }
  // Fallback: a "load more reviews" button that sits outside the widget (buttons only, never links).
  if (found.length === 0) {
    for (const el of deepAll('button, [role="button"]')) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (/^(load|show|see|view) more( reviews?)?$/i.test(label) && visible(el) && !disabled(el)) {
        found.push({ el, isMore: true, label, rank: 3 });
        break;
      }
    }
  }
  // A control that loaded nothing last time is skipped, so the next candidate gets a turn.
  const pick = found.filter((f) => !skip.includes(f.label.slice(0, 40) || 'next')).sort((a, b) => b.rank - a.rank)[0];
  if (!pick) return '';
  // Mark it, so a real pointer click can be sent to the same control if this script click does nothing.
  for (const el of deepAll('[data-pearfit-paging]')) el.removeAttribute('data-pearfit-paging');
  pick.el.setAttribute('data-pearfit-paging', '1');
  pick.el.scrollIntoView({ block: 'center' });
  pick.el.click();
  return pick.label.slice(0, 40) || 'next';
})`;

/**
 * Sorts a review widget by newest first, when it offers that. Widgets often open on "most helpful"
 * or "highest rated", so the first pages are a biased sample. Returns what it did, or ''.
 * Step "select": a <select> with a newest option. Step "open": clicks a "Sort" control; step
 * "pick" (run after a short wait) clicks the newest option of the menu it opened.
 */
const SORT_NEWEST = `((step) => {
  ${DEEP_QUERY}
  const NEWEST = /^(sort( by)?:?\\s*)?(most recent|newest( first| to oldest)?|date,? newest( first)?|date \\(newest\\)|recent|latest)$/i;
  const boxes = deepAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)});
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const text = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
  if (step === 'select') {
    for (const box of boxes) {
      for (const select of deepAll('select', box)) {
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
      for (const el of deepAll('button, [role="button"], [role="combobox"], [aria-haspopup]', box)) {
        if (/^sort\\b|sort by/i.test(text(el)) && visible(el)) { el.click(); return 'open:' + text(el).slice(0, 30); }
      }
    }
    return '';
  }
  for (const el of deepAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, a[href^="#"], a:not([href])')) {
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
    let chartHtml = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;

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

    // Still no review data: the rating summary near the title often opens the review section.
    if (capture.reviewCount() === 0 && (await page.evaluate(OPEN_RATING_SUMMARY))) {
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
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
      await clickFirst(page, 'tab', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide/i);
      await clickFirst(page, 'button', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide|size\s*&\s*fit/i);
      // Keep the earlier snapshot unless this one holds a chart (the view may already show reviews only).
      const withGuide = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
      if (parseSizeChart(withGuide).length > 0) chartHtml = withGuide;
      if (process.env.SCRAPER_DEBUG) console.error(`[render] following review page ${reviewPage}`);
      // Navigation may not run past the paging stop, so a slow review page cannot hit the hard deadline.
      await page
        .goto(reviewPage, { waitUntil: 'domcontentloaded', timeout: Math.min(NAV_TIMEOUT_MS, timeLeft - 10_000) })
        .catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.evaluate(REVIEW_WIDGETS_INTO_VIEW).catch(() => {});
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
      extraHtml.push((await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string);
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

    // A size chart is often behind a button. Buttons and tabs only: a link can leave the page.
    await clickFirst(page, 'tab', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide/i);
    await clickFirst(page, 'button', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide|size\s*&\s*fit/i);
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
    await capture.settle(2000);

    const html = (await page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
    return {
      html,
      status,
      finalUrl: page.url(),
      reviewSelectorFound,
      chartHtml,
      jsonResponses: capture.items,
      extraHtml,
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

/**
 * Some sort menus (Material UI on Vuori) open only on a real pointer click, and a sign-up pop-up can sit
 * over them. Escape closes the pop-up; then the "Sort by" menu button is clicked and newest is picked.
 */
async function sortNewestByRealClick(page: Page): Promise<string> {
  const button = page
    .locator('[aria-haspopup="menu"], [aria-haspopup="listbox"], [aria-haspopup="true"], [role="combobox"]')
    .filter({ hasText: /^\s*sort\b/i })
    .or(page.locator('[aria-haspopup][aria-label^="sort" i]'))
    .first();
  try {
    if (!(await button.isVisible({ timeout: 500 }))) return '';
    await page.keyboard.press('Escape');
    await button.scrollIntoViewIfNeeded({ timeout: 2000 });
    await button.click({ timeout: 3000 });
    await page.waitForTimeout(600);
    return ((await page.evaluate(`${SORT_NEWEST}('pick')`)) as string) || '';
  } catch {
    return '';
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
  /** Clicks a paging control whose label is not in `skip`; returns its label, or '' when none is left. */
  click: (skip: string[]) => Promise<string>;
  /**
   * Reviews read from JSON and review cards on the page, counted separately: a click made progress when
   * either grew. (A pager can replace the cards while the JSON grows; the first JSON page can hold fewer
   * reviews than the cards the page rendered.)
   */
  progress: () => Promise<{ json: number; cards: number }>;
  enough: () => Promise<boolean>;
  settle: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Scrolls to the end of the page; returns 'scroll'. */
  scroll?: () => Promise<string>;
  /**
   * Sends a real pointer click to the control the last click marked. Some stores (L.L.Bean) ignore a
   * script click on their "load more" button and answer only a real one.
   */
  realClick?: () => Promise<boolean>;
  stopAt: number;
}): Promise<number> {
  let pages = 0;
  let idle = 0;
  const skip = new Set<string>();
  const needsRealClick = new Set<string>();
  const fruitless = new Map<string, number>();
  if (process.env.SCRAPER_DEBUG) console.error(`[paging] start: msLeft=${ops.stopAt - Date.now()} enough=${await ops.enough()}`);
  for (let i = 0; i < MAX_REVIEW_PAGES && Date.now() < ops.stopAt; i++) {
    if (await ops.enough()) break;
    const before = await ops.progress();
    // No control left: infinite-scroll lists load the next reviews when the end comes into view.
    const clicked = (await ops.click([...skip])) || (ops.scroll ? await ops.scroll() : '');
    if (process.env.SCRAPER_DEBUG) console.error(`[paging] ${i}: clicked=${JSON.stringify(clicked)} json=${before.json} cards=${before.cards}`);
    if (!clicked) break;
    const waitForGrowth = async () => {
      const until = Math.min(Date.now() + 5000, ops.stopAt);
      while (Date.now() < until) {
        await ops.sleep(300);
        await ops.settle();
        const now = await ops.progress();
        if (now.json > before.json || now.cards > before.cards) return true;
      }
      return false;
    };
    // The real-click retry is for "load more" controls only: a second click on a slow "next" pager would
    // skip a page.
    const loadsMore = /more/i.test(clicked);
    let grew = false;
    if (loadsMore && needsRealClick.has(clicked) && ops.realClick) {
      grew = (await ops.realClick()) && (await waitForGrowth());
    } else {
      grew = await waitForGrowth();
      if (!grew && loadsMore && ops.realClick && (await ops.realClick())) {
        grew = await waitForGrowth();
        if (grew) needsRealClick.add(clicked);
      }
    }
    if (grew) {
      pages++;
      idle = 0;
    } else {
      // That control loaded nothing. After a second try (a response can just be slow) the next candidate
      // gets a turn. Stop after three fruitless clicks in a row.
      if (clicked !== 'scroll') {
        const misses = (fruitless.get(clicked) ?? 0) + 1;
        fruitless.set(clicked, misses);
        if (misses >= 2) skip.add(clicked);
      }
      if (++idle >= 3) break;
    }
  }
  return pages;
}

interface ServerlessPage {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null>;
  url(): string;
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

    await clickRole('tab', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide/i);
    await clickRole('button', /size\s*(guide|chart)|sizing\s*chart|fit\s*guide|size\s*&\s*fit/i);
    await sleep(500);
    await capture.settle(2000);

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
