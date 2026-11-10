// The pure parts of the weekly store check: choosing stores, judging one scrape against what was expected,
// and writing the report. The runner (starting the scraper, calling it) is in verify-stores.ts.
import { summarizeScrapeBody, shortError, type ScrapeOutcome } from './scraperClient.ts';

/** The fields of a verified-stores.json entry the check uses. */
export interface StoreToCheck {
  name: string;
  domain: string;
  url: string;
  platform: string | null;
  expected_min_reviews: number;
  has_size_chart: boolean;
}

/**
 * ok       enough reviews were read and the store did not refuse.
 * fewer    fewer than half the expected reviews (or no size chart, for a chart-only store).
 * refused  the store now refuses automated requests (HTTP 403, 406, 418, 429, 503, a bot check, an "access denied" page).
 * error    the scraper failed, or did not answer in time.
 * stale    the product page is gone (HTTP 404 or 410): the address needs replacing, the scraper did not break.
 * down     the store shows a maintenance page or answers 500, 502 or 504.
 */
export type Status = 'ok' | 'fewer' | 'refused' | 'error' | 'stale' | 'down';

/** These count toward the share of stores that regressed. stale and down are listed but do not. */
export const REGRESSION_STATUSES: readonly Status[] = ['fewer', 'refused', 'error'];

export const REVIEW_SHARE = 0.5;

export interface StoreResult {
  store: string;
  domain: string;
  url: string;
  platform: string;
  expectedMinReviews: number;
  /** Fewest reviews that pass: half of expectedMinReviews. */
  minAllowed: number;
  status: Status;
  regression: boolean;
  reviewsRead: number;
  reviewsStated: number | null;
  sizeChartRows: number;
  hasSizeChart: boolean;
  /** A size chart was read when the store was confirmed and none was read now. A warning only. */
  chartMissing: boolean;
  httpStatus: number;
  secs: number;
  attempts: number;
  detail: string;
}

const REFUSAL_STATUSES = new Set([403, 406, 418, 429, 503]);

/** A refusal: the status the store answered, or the scraper's words for a bot check or an access-denied page. */
export function isRefusal(httpStatus: number, message: string): boolean {
  if (REFUSAL_STATUSES.has(httpStatus)) return true;
  if (/returned HTTP (403|406|418|429|503)\b|headless browser got HTTP (403|406|418|429|503)\b/i.test(message)) return true;
  return /refuses automated|does not allow automated|block page|access (to this page )?(has been )?denied|bot check|client challenge/i.test(message);
}

/** Judges one scrape against what the list expects. */
export function classifyOutcome(entry: StoreToCheck, outcome: ScrapeOutcome): Omit<StoreResult, 'attempts'> {
  const summary = summarizeScrapeBody(outcome.body);
  const message = shortError(outcome.body?.error) ?? outcome.networkError ?? '';
  const minAllowed = entry.expected_min_reviews * REVIEW_SHARE;
  const base = {
    store: entry.name,
    domain: entry.domain,
    url: entry.url,
    platform: entry.platform ?? '',
    expectedMinReviews: entry.expected_min_reviews,
    minAllowed,
    reviewsRead: summary.reviewsRead,
    reviewsStated: summary.reviewsStated,
    sizeChartRows: summary.sizeChartRows,
    hasSizeChart: entry.has_size_chart,
    httpStatus: outcome.status,
    secs: outcome.secs,
  };
  const finish = (status: Status, detail: string, chartMissing = false) => ({
    ...base,
    status,
    regression: REGRESSION_STATUSES.includes(status),
    chartMissing,
    detail,
  });

  if (outcome.networkError) return finish('error', outcome.networkError);
  if (isRefusal(outcome.status, message)) return finish('refused', message || `HTTP ${outcome.status}`);
  if (/\bHTTP (404|410)\b/.test(message)) return finish('stale', message);
  if (/maintenance/i.test(message) || /\bHTTP (500|502|504)\b/.test(message)) return finish('down', message);

  if (entry.expected_min_reviews === 0) {
    // A chart-only store: it passes when its chart is still read.
    return summary.sizeChartRows > 0
      ? finish('ok', `${summary.sizeChartRows} size chart rows`)
      : finish('fewer', message || 'no size chart read');
  }
  if (summary.reviewsRead >= minAllowed && summary.reviewsRead > 0) {
    const chartMissing = entry.has_size_chart && summary.sizeChartRows === 0;
    return finish('ok', `${summary.reviewsRead} read${summary.reviewsStated !== null ? ` of ${summary.reviewsStated} stated` : ''}`, chartMissing);
  }
  if (outcome.status >= 500 && !outcome.body?.report) {
    return finish('error', `HTTP ${outcome.status}: ${(message || 'no reviews read')}`);
  }
  return finish('fewer', summary.reviewsRead === 0 ? (message || 'no reviews read') : `read ${summary.reviewsRead}, expected at least ${Math.ceil(minAllowed)}`);
}

/** Runs the tasks with at most `limit` at a time, keeping result order. */
export async function runPool<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- choosing stores ----

export interface SelectOptions {
  /** Domains (or part of a domain) to keep, for example "gap.com". */
  only?: string[];
  /** Keep this many stores, spread evenly through the list. */
  sample?: number;
  /** Keep the first this many (after only and sample). */
  limit?: number;
}

export function selectStores<T extends { domain: string }>(stores: T[], options: SelectOptions = {}): T[] {
  let chosen = stores;
  const only = (options.only ?? []).map((value) => value.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
  if (only.length > 0) chosen = chosen.filter((entry) => only.some((value) => entry.domain.toLowerCase().includes(value)));
  if (options.sample && options.sample > 0 && options.sample < chosen.length) {
    const step = chosen.length / options.sample;
    chosen = Array.from({ length: options.sample }, (_, i) => chosen[Math.floor(i * step)]!);
  }
  if (options.limit && options.limit > 0) chosen = chosen.slice(0, options.limit);
  return chosen;
}

// ---- the report ----

export interface ReportTotals {
  checked: number;
  ok: number;
  fewer: number;
  refused: number;
  error: number;
  stale: number;
  down: number;
  regressed: number;
  /** regressed / checked, 0 when nothing was checked. */
  regressionRate: number;
  chartMissing: number;
}

export interface VerifyReport {
  generatedAt: string;
  threshold: number;
  totals: ReportTotals;
  /** False when regressionRate is above the threshold. */
  passed: boolean;
  /** Stores left unchecked because the time budget ran out. */
  notChecked: number;
  results: StoreResult[];
}

export function summarizeResults(results: StoreResult[]): ReportTotals {
  const count = (status: Status) => results.filter((r) => r.status === status).length;
  const regressed = results.filter((r) => r.regression).length;
  return {
    checked: results.length,
    ok: count('ok'),
    fewer: count('fewer'),
    refused: count('refused'),
    error: count('error'),
    stale: count('stale'),
    down: count('down'),
    regressed,
    regressionRate: results.length === 0 ? 0 : regressed / results.length,
    chartMissing: results.filter((r) => r.chartMissing).length,
  };
}

export function buildReport(results: StoreResult[], threshold: number, now = new Date(), notChecked = 0): VerifyReport {
  const totals = summarizeResults(results);
  return { generatedAt: now.toISOString(), threshold, totals, passed: totals.regressionRate <= threshold, notChecked, results };
}

function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function table(headers: string[], rows: string[][]): string[] {
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)];
}

export function renderMarkdownReport(report: VerifyReport): string {
  const { totals } = report;
  const lines: string[] = [
    '# Store verification',
    '',
    `Run ${report.generatedAt}. ${totals.checked} stores checked: **${totals.ok} ok**, ${totals.fewer} fewer reviews than expected, ` +
      `${totals.refused} now refused, ${totals.error} errors, ${totals.stale} stale product pages, ${totals.down} down.`,
    '',
    `Regressed (fewer + refused + errors): **${totals.regressed}** = ${percent(totals.regressionRate)} of the stores checked. ` +
      `The run fails above ${percent(report.threshold)}: **${report.passed ? 'passed' : 'FAILED'}**.`,
    '',
  ];
  if (report.notChecked > 0) lines.push(`${report.notChecked} stores were not checked: the time budget ran out.`, '');
  const regressed = report.results.filter((r) => r.regression);
  if (regressed.length > 0) {
    lines.push('## Regressed', '');
    lines.push(
      ...table(
        ['Store', 'Domain', 'Status', 'Read', 'Expected at least', 'Detail'],
        regressed.map((r) => [r.store, r.domain, r.status, String(r.reviewsRead), String(Math.ceil(r.minAllowed)), r.detail]),
      ),
      '',
    );
  }
  const stale = report.results.filter((r) => r.status === 'stale');
  if (stale.length > 0) {
    lines.push('## Product page gone (replace the address in verified-stores.json)', '');
    lines.push(...table(['Store', 'URL', 'Detail'], stale.map((r) => [r.store, r.url, r.detail])), '');
  }
  const down = report.results.filter((r) => r.status === 'down');
  if (down.length > 0) {
    lines.push('## Store down or in maintenance', '');
    lines.push(...table(['Store', 'Detail'], down.map((r) => [r.store, r.detail])), '');
  }
  const chart = report.results.filter((r) => r.chartMissing);
  if (chart.length > 0) {
    lines.push('## Size chart no longer read (warning, not counted)', '');
    lines.push(...table(['Store', 'URL'], chart.map((r) => [r.store, r.url])), '');
  }
  lines.push('<details><summary>All stores</summary>', '');
  lines.push(
    ...table(
      ['Store', 'Domain', 'Status', 'Read / stated', 'Expected', 'Chart rows', 'Secs', 'Tries', 'Detail'],
      report.results.map((r) => [
        r.store,
        r.domain,
        r.status,
        `${r.reviewsRead} / ${r.reviewsStated ?? 'not stated'}`,
        String(r.expectedMinReviews),
        String(r.sizeChartRows),
        String(Math.round(r.secs)),
        String(r.attempts),
        r.detail,
      ]),
    ),
    '',
    '</details>',
    '',
  );
  return lines.join('\n');
}
