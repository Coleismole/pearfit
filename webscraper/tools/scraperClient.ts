// Small client for the local scraper server (webscraper/server.ts), shared by the tools in this folder.
// Nothing here reaches a store: it only talks to the scraper on this machine, which does the fetching.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The part of the POST /api/scrape request the tools use. */
export interface ScrapeRequest {
  url?: string;
  rawHtml?: string;
  sku?: string;
  commitToDb?: boolean;
  render?: 'auto' | 'always' | 'never';
}

/** The part of the POST /api/scrape answer the tools read. Every field may be missing on an error. */
export interface ScrapeResponseBody {
  error?: string;
  report?: {
    name?: string;
    brand?: string;
    sku?: string;
    sourceUrl?: string;
    totalReviews?: number;
    overallAvgRating?: number;
    reviews?: { normalizedSize?: string | null; declaredFitTag?: string | null }[];
    scraperTelemetry?: { reportedReviewCount?: number | null; reviewSources?: string[] };
  };
  sizeChart?: unknown[];
  committedToDb?: boolean;
  supabase?: { ok?: boolean; skipped?: boolean; reason?: string; error?: string } | null;
}

export interface ScrapeOutcome {
  /** HTTP status, or 0 when the request never got an answer. */
  status: number;
  secs: number;
  body: ScrapeResponseBody | null;
  /** Set when the request failed before an answer (connection refused, client timeout). */
  networkError: string | null;
}

/** What the tools show for one scraped page. */
export interface ScrapeSummary {
  product: string;
  brand: string;
  sku: string;
  reviewsRead: number;
  /** The review total the store states, or null when the page states none. */
  reviewsStated: number | null;
  /** Reviews with a size the scraper could normalise. */
  withSize: number;
  /** Reviews that carry the store's own fit answer ("runs small" and so on). */
  withFit: number;
  sizeChartRows: number;
  reviewSources: string[];
  avgRating: number | null;
}

export function summarizeScrapeBody(body: ScrapeResponseBody | null): ScrapeSummary {
  const report = body?.report;
  const reviews = report?.reviews ?? [];
  const stated = report?.scraperTelemetry?.reportedReviewCount;
  return {
    product: report?.name ?? '',
    brand: report?.brand ?? '',
    sku: report?.sku ?? '',
    reviewsRead: report?.totalReviews ?? reviews.length,
    reviewsStated: typeof stated === 'number' ? stated : null,
    withSize: reviews.filter((r) => r.normalizedSize).length,
    withFit: reviews.filter((r) => r.declaredFitTag).length,
    sizeChartRows: Array.isArray(body?.sizeChart) ? body.sizeChart.length : 0,
    reviewSources: report?.scraperTelemetry?.reviewSources ?? [],
    avgRating: typeof report?.overallAvgRating === 'number' ? report.overallAvgRating : null,
  };
}

/** The server's error text ends with a hint about pasting HTML, which makes no sense for these tools. */
export function shortError(message: string | undefined | null): string | null {
  if (!message) return null;
  const cut = message.indexOf(' If the reviews show in your own browser');
  const text = (cut >= 0 ? message.slice(0, cut) : message).replace(/\s+/g, ' ').trim();
  return text || null;
}

export async function postScrape(baseUrl: string, request: ScrapeRequest, timeoutMs: number): Promise<ScrapeOutcome> {
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started) / 100) / 10;
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/scrape`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.json().catch(() => null)) as ScrapeResponseBody | null;
    return { status: response.status, secs: secs(), body, networkError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      status: 0,
      secs: secs(),
      body: null,
      networkError: timedOut ? `no answer from the scraper within ${Math.round(timeoutMs / 1000)} s` : message,
    };
  }
}

/** The scraper answers this cheap route as soon as it listens. */
export async function serverIsUp(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/posthog-config`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

export function webscraperDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export interface StartedScraper {
  baseUrl: string;
  stop: () => Promise<void>;
}

export interface StartScraperOptions {
  port?: number;
  /** How long to wait for the server to listen. */
  startTimeoutMs?: number;
  /**
   * Blank the Supabase variables so this server cannot reach the shared store at all, whatever a request
   * says. Tools that only read pass true; a tool whose user asked to commit passes false.
   */
  blockSharedStore?: boolean;
}

/**
 * Starts webscraper/server.ts as a child process (production mode: the API only, no dev front end) and waits
 * until it listens. stop() ends it.
 */
export async function startScraperServer(options: StartScraperOptions = {}): Promise<StartedScraper> {
  const port = options.port ?? (await freePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), NODE_ENV: 'production' };
  if (options.blockSharedStore !== false) {
    // An empty value counts as set, so the server's .env loading does not fill these in again.
    env.SUPABASE_URL = '';
    env.SUPABASE_PUBLISHABLE_KEY = '';
    env.SUPABASE_SECRET_KEY = '';
  }
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: webscraperDir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const keep = (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-4000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  const stop = async () => {
    if (exited) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 10_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const deadline = Date.now() + (options.startTimeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The scraper stopped while starting.\n${log.trim()}`);
    if (await serverIsUp(baseUrl, 1000)) return { baseUrl, stop };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await stop();
  throw new Error(`The scraper did not listen on port ${port} in time.\n${log.trim()}`);
}
