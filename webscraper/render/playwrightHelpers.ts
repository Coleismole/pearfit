/** Playwright page helpers for the local render: clicks, stable evaluate, review counts, review iframes, guarded context. */
import type { Browser, Page } from 'playwright';
import { createRequestHostGuard } from '../publicUrl.ts';
import type { ProductHint } from '../sizeChart.ts';
import { REVIEW_CARD_SELECTOR, MAX_REVIEW_PAGES, MAX_REVIEWS } from './constants.ts';
import type { CapturedJson } from './types.ts';
import { embeddedWidgetHtml } from './jsonCapture.ts';
import { linkStaysOnProduct, isReviewWidgetFrame } from './decisions.ts';
import { startUrlAllowsPrivate } from './browser.ts';
import { SORT_NEWEST, CLICK_FRAME_LOAD_MORE } from './pageScripts.ts';

/** Clicks the first visible element matching a role + name pattern. Best effort. */
export async function clickFirst(page: Page, role: 'button' | 'link' | 'tab', name: RegExp): Promise<boolean> {
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

/**
 * What the product page says about its product (title and address), taken once while the product view is
 * showing. A chart is read against it, so a page that holds several tables (men's and women's, tops and
 * bottoms) gives the one for this product, even after a review click moved the browser elsewhere.
 */
export async function playwrightProductHint(page: Page): Promise<ProductHint> {
  return { url: page.url(), name: await page.title().catch(() => '') };
}

/**
 * page.evaluate that survives the page navigating under it (a locale or geo redirect, a consent reload):
 * "Execution context was destroyed". Waits for the new page to settle and runs the script again.
 */
export async function evaluateStable(page: Page, script: string): Promise<unknown> {
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

export async function countReviews(page: Page): Promise<number> {
  return page.locator(REVIEW_CARD_SELECTOR).count();
}

export async function hasReviews(page: Page): Promise<boolean> {
  return (await countReviews(page)) > 0;
}

/** Waits until more review cards than `before` are present, or the timeout passes. */
export async function waitForMoreReviews(page: Page, before: number, timeoutMs: number): Promise<boolean> {
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
export async function reviewFramePages(page: Page, stopAt: number): Promise<string[]> {
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
export function widgetPages(items: CapturedJson[]): string[] {
  return [...new Set(items.map((item) => embeddedWidgetHtml(item.body)).filter((html): html is string => html !== null))];
}

/** A fresh browser context whose every request, redirects included, is checked against the resolved address of its host. */
export async function newGuardedContext(browser: Browser, url: string) {
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

/**
 * Some sort menus (Material UI on Vuori) open only on a real pointer click, and a sign-up pop-up can sit
 * over them. Escape closes the pop-up; then the "Sort by" menu button is clicked and newest is picked.
 */
export async function sortNewestByRealClick(page: Page): Promise<string> {
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
