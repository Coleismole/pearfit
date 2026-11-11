/** The review and size-chart JSON a page receives during a render, kept within size limits. */
import { extractReviewsFromJson, parseJsonBody, reviewIdentity } from '../reviewJson.ts';
import { MAX_CAPTURED_BODY_BYTES, MAX_CAPTURED_TOTAL_BYTES } from './constants.ts';
import type { CapturedJson } from './types.ts';

/**
 * Stamped answers a review request with JSON whose `widget` field holds the rendered review cards as HTML.
 * Returns that HTML, or null for any other body.
 */
export function embeddedWidgetHtml(body: string): string | null {
  const value = parseJsonBody(body);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const widget = (value as Record<string, unknown>).widget;
  return typeof widget === 'string' && /class="stamped-review[ "]/.test(widget) ? widget : null;
}

/** Table markup inside a JSON string: raw, or with the angle bracket escaped as \\u003c. */
const TABLE_MARKUP = /(?:<|\\u003c)table\b/i;
const SIZE_CHART_WORDS = /size[-_ ]?(?:chart|guide)|sizing[-_ ]?(?:chart|guide)/i;
/** Most chart-bearing JSON bodies kept from one render. */
const MAX_CHART_BODIES = 4;

/** Every string in a JSON value that holds a table. */
function htmlWithTables(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 12 || value === null) return found;
  if (typeof value === 'string') {
    if (/<table\b/i.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) htmlWithTables(item, found, depth + 1);
  } else if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) htmlWithTables(item, found, depth + 1);
  }
  return found;
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
    // A size chart some stores send as HTML inside JSON. It has no rating field, so it is kept on its own.
    if (this.chartBodies.length < MAX_CHART_BODIES && TABLE_MARKUP.test(body) && (SIZE_CHART_WORDS.test(url) || SIZE_CHART_WORDS.test(body))) {
      this.chartBodies.push(body);
      this.bytes += body.length;
    }
    if (!RATING_FIELD.test(body)) return;
    this.items.push({ url, body });
    this.bytes += body.length;
    this.ratingFields += (body.match(new RegExp(RATING_FIELD.source, 'g')) ?? []).length;
  }

  private readonly chartBodies: string[] = [];

  /**
   * The HTML tables found in the size-chart JSON the page received, one fragment each. Where such a table
   * gives only body measurements the chart parser reads nothing from it, so the dimension stays null.
   */
  chartPages(): string[] {
    const pages = this.chartBodies.flatMap((body) => htmlWithTables(parseJsonBody(body)));
    return [...new Set(pages)].map((html) => `<div>${html}</div>`);
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
      // Reviews that arrive as HTML in the JSON (Stamped) count by review id, so paging that replaces
      // the cards on the page still shows progress.
      const widget = embeddedWidgetHtml(this.items[this.countedItems].body);
      if (widget) for (const m of widget.matchAll(/data-review-id="(\d+)"/g)) this.counted.add(`html:${m[1]}`);
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
