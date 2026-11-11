/** Opening a size guide and reading linked size-guide pages: the shared routines and their Playwright and HTTP wiring. */
import type { Locator, Page } from 'playwright';
import { GUIDE_LABEL, GUIDE_NAME, GUIDE_PATH, guideLinksFromHtml, parseSizeChartCached } from '../pageHelpers.ts';
import type { ProductHint } from '../sizeChart.ts';
import { DEEP_QUERY, SERIALIZE_WITH_SHADOW_ROOTS } from './pageScripts.ts';

/** Labels of the controls that open a size guide: "Size Guide", "Size & Fit", "Find your size", "Measurements". */
export const SIZE_GUIDE_LABEL =
  /size\s*(guide|chart)|sizing\s*(guide|chart)|fit\s*guide|size\s*(&|and|\+)\s*fit|find\s*(your|my)\s*(size|fit)|size\s*(info|help)|how to measure|measurements?$/i;
/** A label that is nothing but a size guide name: safe to click as plain text (a DIV or SPAN with a handler). */
export const SIZE_GUIDE_TEXT = /^\s*(size\s*(guide|chart)|sizing\s*(guide|chart)|fit\s*guide|size\s*(&|and|\+)\s*fit|find\s*(your|my)\s*size|size\s*info(rmation)?|size\s*help)\s*[+–—-]?\s*$/i;

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
export const VISIBLE_TABLES = `(() => {
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
export const GUIDE_LINKS = `(() => {
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
export const SIZE_GUIDE_CONTROL_IN_PAGE = `((group, index, act, labelSource, textSource) => {
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
