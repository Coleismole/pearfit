/** The shared browser (Playwright locally, Chromium + Puppeteer on Vercel) and the one-render-at-a-time queue. */
import type { Browser } from 'playwright';
import { isBlockedHostname } from '../publicUrl.ts';
import { RENDER_DEADLINE_MS } from './constants.ts';

let browserPromise: Promise<{ close(): Promise<void> }> | null = null;
let renderTail: Promise<void> = Promise.resolve();

/** Chromium pack for Vercel. The full Playwright browser does not fit in that function. */
const SERVERLESS_CHROMIUM_PACK =
  'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar';

/** A test page on localhost may load private hosts. A public product page may not. */
export function startUrlAllowsPrivate(raw: string): boolean {
  try {
    return isBlockedHostname(new URL(raw).hostname);
  } catch {
    return false;
  }
}


export function renderBudgetMs(): number {
  // The hosted function is capped at 60s, including the Chromium download on a cold start.
  return process.env.VERCEL ? 50_000 : RENDER_DEADLINE_MS;
}

export async function getBrowser(): Promise<{ close(): Promise<void> }> {
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

/** One render at a time: the browser is shared and a page of several megabytes needs the memory. */
export function queueRender<T>(job: () => Promise<T>): Promise<T> {
  const run = renderTail.then(job);
  renderTail = run.then(
    () => {},
    () => {},
  );
  return run;
}
