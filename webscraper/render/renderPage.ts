/** The render entry points: one render at a time, local or serverless by environment. */
import type { RenderedPage } from './types.ts';
import { queueRender } from './browser.ts';
import { renderChartOnlyWithPlaywright, renderWithPlaywright } from './playwrightRender.ts';
import { renderWithServerlessChromium } from './serverlessRender.ts';

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
