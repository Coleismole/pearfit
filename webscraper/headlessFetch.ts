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
import type { Browser, Locator, Page } from 'playwright';
import {
  REVIEW_CARD_SELECTOR,
  NAV_TIMEOUT_MS,
  RENDER_TAIL_MS,
  REVIEW_WAIT_MS,
  MAX_REVIEW_PAGES,
  MAX_REVIEWS,
  MAX_LINKED_REVIEW_PAGES,
  REVIEW_WIDGET_SELECTOR,
} from './render/constants.ts';
import type { RenderedPage, CapturedJson } from './render/types.ts';
import { embeddedWidgetHtml, JsonCapture } from './render/jsonCapture.ts';
import { linkStaysOnProduct, navigationTimedOutAfterLoading, isReviewWidgetFrame } from './render/decisions.ts';
import { startUrlAllowsPrivate, renderBudgetMs, getBrowser, queueRender } from './render/browser.ts';
import {
  DEEP_QUERY,
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
  SORT_NEWEST,
  SERIALIZE_WITH_SHADOW_ROOTS,
  CLICK_FRAME_LOAD_MORE,
} from './render/pageScripts.ts';
import { createRequestHostGuard } from './publicUrl.ts';
import { GUIDE_LABEL, GUIDE_NAME, GUIDE_PATH, guideLinksFromHtml, parseSizeChartCached } from './pageHelpers.ts';
import type { ProductHint } from './sizeChart.ts';

export { REVIEW_CARD_SELECTOR, RENDER_DEADLINE_MS, REVIEW_WIDGET_SELECTOR } from './render/constants.ts';
export type { RenderedPage, CapturedJson } from './render/types.ts';
export { embeddedWidgetHtml, JsonCapture } from './render/jsonCapture.ts';
export { shouldUseHeadlessRender, linkStaysOnProduct, navigationTimedOutAfterLoading, isReviewWidgetFrame } from './render/decisions.ts';
export { closeHeadlessBrowser } from './render/browser.ts';

/** Clicks the first visible element matching a role + name pattern. Best effort. */
async function clickFirst(page: Page, role: 'button' | 'link' | 'tab', name: RegExp): Promise<boolean> {
  const loc = page.getByRole(role, { name }).first();
  try {
    if (await loc.isVisible({ timeout: 500 })) {
      if (role === 'link' && !linkStaysOnProduct(await loc.getAttribute('href', { timeout: 500 }), page.url())) return false;
      await loc.click({ timeout: 2000 });
      return true;
    }
  } catch {
    // not clickable; ignore
  }
  return false;
}

/** Labels of the controls that open a size guide: "Size Guide", "Size & Fit", "Find your size", "Measurements". */
export const SIZE_GUIDE_LABEL =
  /size\s*(guide|chart)|sizing\s*(guide|chart)|fit\s*guide|size\s*(&|and|\+)\s*fit|find\s*(your|my)\s*(size|fit)|size\s*(info|help)|how to measure|measurements?$/i;
/** A label that is nothing but a size guide name: safe to click as plain text (a DIV or SPAN with a handler). */
const SIZE_GUIDE_TEXT = /^\s*(size\s*(guide|chart)|sizing\s*(guide|chart)|fit\s*guide|size\s*(&|and|\+)\s*fit|find\s*(your|my)\s*size|size\s*info(rmation)?|size\s*help)\s*[+–—-]?\s*$/i;

async function clickLocator(loc: Locator): Promise<boolean> {
  try {
    if (!(await loc.isVisible({ timeout: 500 }))) return false;
  } catch {
    return false;
  }
  try {
    await loc.click({ timeout: 2000 });
    return true;
  } catch {
    // A pop-up or sticky bar sits over it: a scripted click reaches the control anyway.
    try {
      await loc.evaluate((el) => (el as HTMLElement).click());
      return true;
    } catch {
      return false;
    }
  }
}

/** In-page: how many tables are showing (open shadow roots included). A size guide that opened has one. */
const VISIBLE_TABLES = `(() => {
  let count = 0;
  const walk = (root) => {
    for (const t of root.querySelectorAll('table')) if (t.getClientRects().length > 0) count++;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  return count;
})()`;

/**
 * The controls that can open a size guide, most specific first. Links count only when they stay on the
 * page (a "#" or script address); a real address would leave the product, so those are read separately.
 */
function sizeGuideControls(page: Page): Locator[] {
  const inPage = 'a:not([href]), a[href^="#"], a[href^="javascript"]';
  return [
    page.getByRole('tab', { name: SIZE_GUIDE_LABEL }),
    page.getByRole('button', { name: SIZE_GUIDE_LABEL }),
    page.locator('summary').filter({ hasText: SIZE_GUIDE_LABEL }),
    page.locator(inPage).filter({ hasText: SIZE_GUIDE_LABEL }),
    page.locator('[aria-haspopup="dialog"], [aria-controls], [data-modal], [data-drawer], [data-toggle], [data-bs-toggle]').filter({ hasText: SIZE_GUIDE_LABEL }),
    page.getByText(SIZE_GUIDE_TEXT).locator('visible=true'),
  ];
}

/** The address without its #fragment: a guide that opens by changing the hash stays on the product page. */
function withoutHash(url: string): string {
  return url.split('#')[0];
}

/** Most controls tried in one group of size-guide controls. */
const GUIDE_CONTROLS_PER_GROUP = 3;
/** Number of control groups, most specific first (see sizeGuideControls and SIZE_GUIDE_CONTROL_IN_PAGE). */
const GUIDE_CONTROL_GROUPS = 6;

/**
 * What the size-guide steps need from a browser page. The Playwright page and the serverless Puppeteer page
 * each provide it (playwrightGuideOps, serverlessGuideOps), so both run the same routine.
 */
export interface SizeGuideOps {
  url(): string;
  /** How many controls the group (0 = most specific, up to GUIDE_CONTROL_GROUPS - 1) matches. */
  count(group: number): Promise<number>;
  /** Clicks control `index` of the group. False when it is not showing or cannot be clicked. */
  click(group: number, index: number): Promise<boolean>;
  /** A second try with a pointer click on the control the last click used, for controls that ignore a script click. */
  retryClick?(): Promise<boolean>;
  /** Tables showing on the page (open shadow roots included). */
  tables(): Promise<number>;
  serialize(): Promise<string>;
  escape(): Promise<void>;
  /** Goes back after a click that left the product page. */
  back(): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** The clock; Date.now unless a test supplies its own. */
  now?(): number;
}

/**
 * Opens the page's size guide and returns the page html once it holds a chart, or null. Controls are tried
 * one after another (an accordion named "Size & Fit" may hold only prose while a "Size Guide" button holds
 * the table); a try that shows no chart is closed again with Escape. Nothing here leaves the page, and no
 * try starts unless it fits before `until`.
 */
export async function openSizeGuideWith(ops: SizeGuideOps, until: number, maxTries = 4, hint?: ProductHint): Promise<string | null> {
  const now = ops.now ?? Date.now;
  let tries = 0;
  for (let group = 0; group < GUIDE_CONTROL_GROUPS; group++) {
    // The render has a hard deadline: no new try unless one fits in the time left.
    if (until - now() < 6_000) break;
    const count = Math.min(await ops.count(group).catch(() => 0), GUIDE_CONTROLS_PER_GROUP);
    for (let i = 0; i < count && tries < maxTries && until - now() > 6_000; i++) {
      const before = withoutHash(ops.url());
      const tablesBefore = await ops.tables().catch(() => 0);
      if (!(await ops.click(group, i).catch(() => false))) continue;
      tries += 1;
      // A drawer fills in after its animation or a fetch: wait until a table is showing, up to a few seconds.
      const waitForTable = async (ms: number) => {
        const settleBy = Math.min(now() + ms, until);
        do {
          await ops.sleep(400);
        } while (now() < settleBy && (await ops.tables().catch(() => 0)) <= tablesBefore);
      };
      await waitForTable(2500);
      if (withoutHash(ops.url()) !== before) {
        // The click left the product page. Come back; this control is not a same-page guide.
        await ops.back().catch(() => {});
        continue;
      }
      // The control ignored a script click: a pointer click on the same control gets one more try.
      if ((await ops.tables().catch(() => 0)) <= tablesBefore && ops.retryClick && until - now() > 8_000) {
        if (await ops.retryClick().catch(() => false)) await waitForTable(2000);
        if (withoutHash(ops.url()) !== before) {
          await ops.back().catch(() => {});
          continue;
        }
      }
      const html = await ops.serialize().catch(() => '');
      if (html && parseSizeChartCached(html, hint).length > 0) return html;
      await ops.escape().catch(() => {});
    }
    if (tries >= maxTries) break;
  }
  return null;
}

/** Opens the size guide of a Playwright page. */
export async function openSizeGuide(page: Page, until = Date.now() + 20_000, maxTries = 4, hint?: ProductHint): Promise<string | null> {
  return openSizeGuideWith(playwrightGuideOps(page), until, maxTries, hint);
}

/**
 * What the product page says about its product (title and address), taken once while the product view is
 * showing. A chart is read against it, so a page that holds several tables (men's and women's, tops and
 * bottoms) gives the one for this product, even after a review click moved the browser elsewhere.
 */
async function playwrightProductHint(page: Page): Promise<ProductHint> {
  return { url: page.url(), name: await page.title().catch(() => '') };
}

function playwrightGuideOps(page: Page): SizeGuideOps {
  const groups = sizeGuideControls(page);
  return {
    url: () => page.url(),
    count: (group) => groups[group].count(),
    click: (group, index) => clickLocator(groups[group].nth(index)),
    tables: () => page.evaluate(VISIBLE_TABLES) as Promise<number>,
    serialize: () => page.evaluate(SERIALIZE_WITH_SHADOW_ROOTS) as Promise<string>,
    escape: () => page.keyboard.press('Escape'),
    back: async () => {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 });
    },
    sleep: (ms) => page.waitForTimeout(ms),
  };
}

/**
 * Addresses of size guides that are pages of their own ("/pages/size-chart"): same-site links whose text or
 * path says size guide. Product, collection and cart addresses are left out, as are links back to this page.
 */
const GUIDE_LINKS = `(() => {
  const labelRe = new RegExp(${JSON.stringify(GUIDE_LABEL.source)}, 'i');
  const pathRe = new RegExp(${JSON.stringify(GUIDE_PATH.source)}, 'i');
  const sizeRe = new RegExp(${JSON.stringify(GUIDE_NAME.source)}, 'i');
  const site = (h) => h.replace(/^www\\./, '');
  const found = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) continue;
    let u;
    try { u = new URL(raw, location.href); } catch { continue; }
    if (site(u.host) !== site(location.host) || u.pathname === location.pathname) continue;
    if (/^\\/([a-z]{2}(-[a-z]{2})?\\/)?(products|collections|cart|account|search)\\b/i.test(u.pathname)) continue;
    if (/[?&](prefn1|prefv1|filter|sort|variant)=/i.test(u.search)) continue;
    const label = (a.getAttribute('aria-label') || a.textContent || '').replace(/\\s+/g, ' ').trim();
    const byLabel = label.length < 60 && labelRe.test(label);
    if (!byLabel && !pathRe.test(u.pathname)) continue;
    // A page named size chart / size guide beats a "fit guide" (which usually describes cuts, not measurements).
    const score = (sizeRe.test(label) ? 2 : 0) + (sizeRe.test(u.pathname) ? 2 : 0) + (byLabel ? 1 : 0);
    const key = u.origin + u.pathname;
    if (!found.has(key) || found.get(key).score < score) found.set(key, { href: u.href, score });
  }
  return [...found.values()].sort((x, y) => y.score - x.score).map((x) => x.href).slice(0, 3);
})()`;

/** Most size-guide pages read for one product. */
const MAX_GUIDE_PAGES = 2;

/** What reading linked size-guide pages needs from a browser page. */
export interface GuidePageOps {
  /** Addresses of the guides the product page links to, best first. */
  links(): Promise<string[]>;
  /** Loads one address in a tab of its own and returns the page html, or null when it will not load. */
  load(href: string, timeoutMs: number): Promise<string | null>;
  /** The clock; Date.now unless a test supplies its own. */
  now?(): number;
}

/** Reads the size guides the product page links to, one after another. Stops at the time limit. */
export async function fetchGuidePagesWith(ops: GuidePageOps, until: number): Promise<string[]> {
  const now = ops.now ?? Date.now;
  const pages: string[] = [];
  const links = (await ops.links().catch(() => [])) ?? [];
  for (const href of links.slice(0, MAX_GUIDE_PAGES)) {
    const left = until - now();
    if (left < 8_000) break;
    const html = await ops.load(href, Math.min(15_000, left - 3_000)).catch(() => null);
    // A guide that will not load is skipped.
    if (html) pages.push(html);
  }
  return pages;
}

/**
 * Loads the size guides the product page links to, in a second tab of the same context (so the request
 * guard still applies), and returns each page's html. Stops at the time limit.
 */
export async function fetchGuidePages(page: Page, until: number): Promise<string[]> {
  return fetchGuidePagesWith(
    {
      links: async () => ((await page.evaluate(GUIDE_LINKS)) as string[]) ?? [],
      load: async (href, timeoutMs) => {
        const guide = await page.context().newPage();
        try {
          await guide.goto(href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
          await guide.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
          return (await guide.evaluate(SERIALIZE_WITH_SHADOW_ROOTS)) as string;
        } finally {
          await guide.close().catch(() => {});
        }
      },
    },
    until,
  );
}

/** The answer to one plain fetch of a guide page: its html, or whether the store refused the request. */
export type GuideFetchResult = { html: string } | { refused: boolean };

/**
 * Reads the size guides a product page links to by plain fetch, with no browser: for a page whose reviews
 * needed no render, so its size guide was never opened. Same rules as the browser path (same site, best two
 * links, stops at the time limit). A refusal ends it: the store said no, and no other guide is tried.
 */
export async function fetchGuidePagesByHttp(
  html: string,
  pageUrl: string,
  fetchPage: (href: string, timeoutMs: number) => Promise<GuideFetchResult>,
  until = Date.now() + 30_000,
): Promise<string[]> {
  let refused = false;
  return fetchGuidePagesWith(
    {
      links: async () => guideLinksFromHtml(html, pageUrl),
      load: async (href, timeoutMs) => {
        if (refused) return null;
        const result = await fetchPage(href, timeoutMs);
        if ('html' in result) return result.html;
        if (result.refused) refused = true;
        return null;
      },
    },
    until,
  );
}

/**
 * In-page, for pages without locators (Puppeteer): the size-guide controls of one group. The groups are the
 * ones sizeGuideControls lists for Playwright, in the same order. Called as (group, index, act, labelSource,
 * textSource). act "count" returns how many are showing; act "click" marks control `index` with
 * data-pearfit-guide (so a pointer click can be sent to it) and clicks it, pointer events included.
 */
const SIZE_GUIDE_CONTROL_IN_PAGE = `((group, index, act, labelSource, textSource) => {
  ${DEEP_QUERY}
  const label = new RegExp(labelSource, 'i');
  const plain = new RegExp(textSource, 'i');
  const flat = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const nameOf = (el) => flat(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.value);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const st = window.getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const roleOf = (el) => {
    const explicit = (el.getAttribute('role') || '').split(/\\s+/)[0];
    if (explicit) return explicit;
    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type))) return 'button';
    if (el.tagName === 'A' && el.hasAttribute('href')) return 'link';
    return '';
  };
  const byRole = (role) => deepAll('button, a, input, [role]').filter((el) => roleOf(el) === role && label.test(nameOf(el)));
  const byText = (selector) => deepAll(selector).filter((el) => label.test(flat(el.textContent)));
  // A label that is nothing but a size guide name, on the element that holds the text (a DIV or SPAN with a handler).
  const plainText = () => {
    const roots = [document, ...deepAll('*').filter((el) => el.shadowRoot).map((el) => el.shadowRoot)];
    const out = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(parent.tagName) && plain.test(flat(node.data))) out.push(parent);
      }
    }
    return out;
  };
  const groups = [
    () => byRole('tab'),
    () => byRole('button'),
    () => byText('summary'),
    () => byText('a:not([href]), a[href^="#"], a[href^="javascript"]'),
    () => byText('[aria-haspopup="dialog"], [aria-controls], [data-modal], [data-drawer], [data-toggle], [data-bs-toggle]'),
    plainText,
  ];
  const found = [...new Set(groups[group]())].filter(visible);
  if (act === 'count') return found.length;
  const el = found[index];
  if (!el) return false;
  for (const old of deepAll('[data-pearfit-guide]')) old.removeAttribute('data-pearfit-guide');
  el.setAttribute('data-pearfit-guide', '1');
  el.scrollIntoView({ block: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window }));
  }
  el.click();
  return true;
})`;

/**
 * page.evaluate that survives the page navigating under it (a locale or geo redirect, a consent reload):
 * "Execution context was destroyed". Waits for the new page to settle and runs the script again.
 */
async function evaluateStable(page: Page, script: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(script);
    } catch (error) {
      if (attempt >= 2 || !/execution context was destroyed|navigation/i.test(String(error))) throw error;
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    }
  }
}

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

/**
 * Review widgets that live in an iframe: pages the widget through its own "Show more reviews" button, then
 * returns the frame's markup. Capped at MAX_REVIEWS cards and the paging deadline.
 */
async function reviewFramePages(page: Page, stopAt: number): Promise<string[]> {
  const pages: string[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || !isReviewWidgetFrame(frame.url())) continue;
    // The widget drops cards that scroll out of view, so the cards are collected after every click.
    const seen = new Set<string>();
    const collect = async () => {
      const cards = (await frame.evaluate(
        `(() => { const all = [...document.querySelectorAll(${JSON.stringify(REVIEW_CARD_SELECTOR)})]; return all.filter((el) => !all.some((o) => o !== el && el.contains(o))).map((el) => el.outerHTML); })()`,
      )) as string[];
      for (const card of cards) seen.add(card);
    };
    try {
      await collect();
      for (let i = 0; i < MAX_REVIEW_PAGES && Date.now() < stopAt && seen.size < MAX_REVIEWS; i++) {
        const clicked = (await frame.evaluate(CLICK_FRAME_LOAD_MORE)) as string;
        if (process.env.SCRAPER_DEBUG) console.error(`[frame] ${i}: cards=${seen.size} clicked=${JSON.stringify(clicked)}`);
        if (!clicked) break;
        const before = seen.size;
        const until = Math.min(Date.now() + 4000, stopAt);
        while (Date.now() < until && seen.size <= before) {
          await page.waitForTimeout(250);
          await collect();
        }
      }
      await collect();
    } catch {
      // the frame went away; keep what was collected
    }
    if (seen.size > 0) pages.push(`<div>${[...seen].join('')}</div>`);
  }
  return pages;
}

/** Review cards that came as HTML inside JSON responses, one entry per distinct response. */
function widgetPages(items: CapturedJson[]): string[] {
  return [...new Set(items.map((item) => embeddedWidgetHtml(item.body)).filter((html): html is string => html !== null))];
}

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

/** A fresh browser context whose every request, redirects included, is checked against the resolved address of its host. */
async function newGuardedContext(browser: Browser, url: string) {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
  });
  const allowPrivate = startUrlAllowsPrivate(url);
  const hostIsBlocked = createRequestHostGuard();
  // Images, video and fonts are irrelevant to review text; skipping them makes renders faster.
  await context.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    if (!allowPrivate && (await hostIsBlocked(route.request().url()))) return route.abort();
    return route.continue();
  });
  return context;
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
