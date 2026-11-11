/**
 * Pure helpers for pulling review fields out of rendered review-card markup.
 * No I/O; used by server.ts and unit-tested in pageHelpers.test.ts.
 */
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { parseGuidePageChart, parseSizeChart, type ProductHint, type SizeChartRow } from './sizeChart.ts';

export type CheerioNode = ReturnType<ReturnType<typeof cheerio.load>>;

export const LABEL_LINE = /^([A-Za-z][A-Za-z ]{1,30}):\s*(.+)$/;

/** Text of every leaf element in a card (elements without element children). */
export function leafTexts($: ReturnType<typeof cheerio.load>, node: CheerioNode): string[] {
  const out: string[] = [];
  node.find('*').each((_i, el) => {
    const child = $(el);
    if (child.children().length === 0 || child.is('p')) {
      const t = child.text().replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
  });
  return out;
}

/** Value of the first "Label: value" line whose label matches, e.g. "Purchased size: XS" -> "XS". */
export function labelledValue(lines: string[], label: RegExp): string {
  for (const line of lines) {
    const m = line.match(LABEL_LINE);
    if (m && label.test(m[1].trim())) return m[2].trim();
  }
  return '';
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_LINE = new RegExp(
  [
    // 12/05/2025, 12.05.2025, 12-5-25
    '^\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}$',
    // 2025-05-12, 2025.05.12, 2025/5/12
    '^\\d{4}[/.-]\\d{1,2}[/.-]\\d{1,2}$',
    // 08 September 2026, 8th Sep. 2026, 8 of May 2026
    `^\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+\\d{4}$`,
    // September 8, 2026, Sep. 8th 2026
    `^${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}$`,
  ].join('|'),
  'i',
);

/** A line that is only a date: "13 January 2025", "Nov 8, 2026", "2026.08.12", "12/05/2025". */
export function looksLikeDate(line: string): boolean {
  return DATE_LINE.test(line.replace(/\s+/g, ' ').trim());
}

/** A badge a widget prints beside the reviewer ("Verified Buyer", "Verified Purchase"): a label, never a title or words. */
export function isBadgeLine(line: string): boolean {
  return /^verified(?: (?:buyer|purchase|purchaser|customer|reviewer|review))?$/i.test(line.replace(/\s+/g, ' ').trim());
}

/**
 * A date stated by a card attribute (data-date). Some storefronts write a Unix time in milliseconds as a float
 * ("1.7888256E12"); that becomes an ISO date. Any other text is returned as it is.
 */
export function dateFromAttribute(value: string): string {
  const raw = value.trim();
  if (/^\d+(?:\.\d+)?(?:e\+?\d+)?$/i.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1e9) {
      const date = new Date(n > 1e12 ? n : n * 1000);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  return raw;
}

/**
 * Longest leaf text that is not a "Label: value" line or a date: the review body on unlabelled markup. A card
 * with no text of its own (a rating and a date only) has none, so it does not read as a review whose words
 * are its date.
 */
export function longestFreeText(lines: string[], exclude: string[]): string {
  let best = '';
  for (const line of lines) {
    if (LABEL_LINE.test(line) || exclude.includes(line) || looksLikeDate(line) || isBadgeLine(line)) continue;
    if (line.length > best.length) best = line;
  }
  return best;
}

/**
 * The words of a card that sit outside every leaf line: text written directly in the card beside its child
 * elements. Used when no leaf line is free text. A card made only of leaf lines (rating, date, size, place)
 * has none, so the whole card text is never taken for a review.
 */
export function textOutsideLines(cardText: string, lines: string[]): string {
  let rest = ` ${cardText} `;
  // Longest lines first, so a line that holds another one is removed whole.
  for (const line of [...lines].sort((a, b) => b.length - a.length)) {
    const at = rest.indexOf(line);
    if (at >= 0) rest = `${rest.slice(0, at)} ${rest.slice(at + line.length)}`;
  }
  rest = rest.replace(/\s+/g, ' ').trim();
  return looksLikeDate(rest) ? '' : rest;
}

/** Empty stars are drawn transparent or light grey (e.g. #DADADA, #eee). */
export function isEmptyStarFill(fill: string): boolean {
  if (/^transparent$/i.test(fill)) return true;
  let hex = fill.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return false;
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16));
  return Math.min(r, g, b) >= 0xc0 && Math.max(r, g, b) - Math.min(r, g, b) <= 0x18;
}

/** Star icons: counts filled SVGs in a 5-icon rating block. Empty stars are grey/transparent. */
export function ratingFromStarIcons($: ReturnType<typeof cheerio.load>, node: CheerioNode): string {
  const block = node.find('[data-testid*="Rating" i], [class*="rating" i], [class*="stars" i]').filter((_i, el) => $(el).find('svg').length === 5).first();
  if (block.length === 0) return '';
  let filled = 0;
  block.find('svg').each((_i, svg) => {
    const icon = $(svg);
    const fills = [icon.attr('fill'), ...icon.find('[fill]').map((_j, f) => $(f).attr('fill')).get()].filter(
      (f): f is string => Boolean(f) && f !== 'none'
    );
    const cls = icon.attr('class') || '';
    const empty = /empty|off|outline/i.test(cls) || (fills.length > 0 && fills.every(isEmptyStarFill));
    if (!empty) filled += 1;
  });
  return filled > 0 ? String(filled) : '';
}

/**
 * Stars drawn as a row of five identical icons, each one filled by an overlay or a fill image: an overlay
 * `overflow-hidden` span with `style="width: 70%"` (Halara), or a `...star-fill` image inside each star
 * (Whistles). Sums the fill of the first five stars. Returns '' when no such row is found.
 */
export function ratingFromStarFills($: ReturnType<typeof cheerio.load>, node: CheerioNode): string {
  // One element per star (class "star" or "x__star"); a star is filled when it holds a "star-fill" image.
  const stars = node.find('[class*="star" i]').filter((_i, el) => /(^|\s)([\w-]*__)?star(\s|$)/i.test($(el).attr('class') || ''));
  if (stars.length === 5) {
    const filled = stars.filter((_i, el) => $(el).find('[class*="star-fill" i]').length > 0).length;
    if (filled > 0) return String(filled);
  }
  const overlays = node
    .find('[style*="width"][class*="overflow-hidden"]')
    .filter((_i, el) => $(el).find('svg').length > 0)
    .slice(0, 5);
  if (overlays.length === 5) {
    let sum = 0;
    overlays.each((_i, el) => {
      const pct = Number(($(el).attr('style') || '').match(/width:\s*([\d.]+)%/)?.[1]);
      if (Number.isFinite(pct)) sum += Math.min(100, Math.max(0, pct)) / 100;
    });
    const rounded = Math.round(sum);
    return rounded >= 1 && rounded <= 5 ? String(rounded) : '';
  }
  return '';
}

/** Cleans titles like "Reviews for Women's Parka | UNIQLO CA" -> "Women's Parka". */
export function cleanProductTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.split(/\s+[|\u2013\u2014]\s+/)[0].replace(/^(customer\s+)?reviews?\s+(for|of)\s+/i, '').trim();
  return t || null;
}

/** Product code from common URL shapes (/products/E487396-000, /p/AY670, /product/.../45215.html, ?pid=795346052). */
export function productIdFromUrl(url: string): string | null {
  // An id in the path wins; a query parameter (which may be a tracking code) is the fallback.
  const param = url.match(/[?&](?:pid|productId|product_id|itemId|item_id|styleId|style)=([A-Z0-9_-]*\d[A-Z0-9_-]*)(?:[&#]|$)/i);
  const m =
    // Target: /p/<name>/-/A-93249836 (the A- number is Target's item id).
    url.match(/\/-\/(A-\d{5,})(?:[/?#]|$)/) ||
    url.match(/\/(\d{4,})\.html/) ||
    // A product code with letters and digits as the page name: /edgartown-pocket-tee/1V011322.html.
    url.match(/\/([A-Z0-9]*\d[A-Z0-9]*[A-Z][A-Z0-9]*|[A-Z][A-Z0-9]*\d[A-Z0-9]*)\.html(?:[?#]|$)/i) ||
    // A code contains a digit. A slug such as /product/mens-shirt/ must not win over the id after it.
    url.match(/\/products?\/([A-Z0-9_-]*\d[A-Z0-9_-]*)(?:[/?#.]|$)/i) ||
    url.match(/\/p\/(?:[^/?#]+\/)*([A-Z0-9]*\d[A-Z0-9]*)(?:[/?#]|$)/i);
  if (m) return m[1];
  if (param) return param[1];
  // Last, a bare number of five or more digits as a path segment: /llb/shop/40651. It could also be a
  // category number, so a product parameter wins over it.
  const numericSegment = url.match(/^[^?#]*\/(\d{5,})(?:[/?#]|$)/);
  return numericSegment ? numericSegment[1] : null;
}

/** "4.5 out of 5 stars" -> "4.5". Ratings on other scales are rescaled to 1-5. */
export function ratingFromLabel(label: string | undefined): string {
  // "4 out of 5 stars", "Rating icons: 5 / 5 star review" (Loox).
  const m = label?.match(/(\d+(?:\.\d+)?)\s*(?:out\s*of|\/)\s*(\d+)/i);
  if (!m) return '';
  const value = parseFloat(m[1]);
  const best = parseFloat(m[2]);
  if (!(best > 1)) return '';
  return best === 5 ? String(value) : String(1 + ((value - 1) / (best - 1)) * 4);
}


/**
 * A plain fetch that threw (connection reset, response headers over Node's 16 KB limit, timeout). It is
 * not a refusal: the page may load in a browser. The cause code (UND_ERR_HEADERS_OVERFLOW) is named
 * because "fetch failed" alone says nothing.
 */
export function describeFetchFailure(url: string, error: unknown): { status: number; message: string; blocked: false; retryInBrowser: true } {
  const err = error instanceof Error ? error : new Error(String(error));
  const cause = err.cause instanceof Error ? ` (${(err.cause as Error & { code?: string }).code ?? err.cause.message})` : '';
  return { status: 502, message: `Could not reach ${url}: ${err.message}${cause}.`, blocked: false, retryInBrowser: true };
}

/**
 * HTTP statuses a store answers an automated request with: forbidden, "access denied" (406, a WAF),
 * teapot (418), too many requests and unavailable.
 */
export function isRefusalStatus(status: number): boolean {
  return [403, 406, 418, 429, 503].includes(status);
}

/**
 * A redirect to a bot-protection challenge (PerimeterX answers with /px?url=… or …/PX-Show). The page
 * behind it is never served to this client, so it is a refusal, not a redirect loop.
 */
export function isBotCheckRedirect(location: string): boolean {
  return /^\/px(\/|\?|$)|\/PX-Show(\?|$)/i.test(location.split('#')[0].replace(/^https?:\/\/[^/]+/i, ''));
}

/**
 * The title of a page a store shows automated visitors instead of the product: a bot check or an
 * access-denied page. Returns the matched text, or null for an ordinary page.
 */
export function blockPageTitle(html: string): string | null {
  // The document's own title (in <head>), not an SVG or product <title> further down the page.
  const head = html.match(/<head[\s>][\s\S]*?<\/head>/i)?.[0] ?? html.slice(0, 5000);
  const title = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  // The whole title is the block phrase, at most followed by a "| Cloudflare"-style suffix, so a product
  // named "Access Denied Graphic Tee" is not a block page.
  const pattern =
    /^(access denied|access to this page has been denied|client challenge|just a moment|attention required|pardon our interruption|are you a robot\??|verify you are (a )?human|request blocked|security check|bot protection)[\s.!…]*([|\-–—:].*)?$/i;
  return pattern.test(title) ? title : null;
}

/**
 * A short page whose visible text says the store refuses automated visitors, or is down for maintenance
 * (Nordstrom: "we don't allow unidentified, automated traffic"; Patagonia: "System maintenance is in
 * progress"), served with HTTP 200 and an ordinary title. A long page is a real page that mentions these
 * words in passing, so only short ones count.
 */
export function blockPageText(html: string): 'refused' | 'maintenance' | null {
  const text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > 1500) return null;
  if (/automated (traffic|requests|access)|unusual (activity|traffic)|verify (that )?you are (a )?human|not a robot|enable javascript and cookies to continue/i.test(text)) {
    return 'refused';
  }
  if (/system maintenance is in progress|(down|closed) for (scheduled )?maintenance|be right back|we.ll be back (soon|shortly)/i.test(text)) {
    return 'maintenance';
  }
  return null;
}

/**
 * Text from a JSON-LD string that holds HTML entities ("Men&#39;s Tee", "Big &amp; Tall"): stores that
 * escape their markup twice. Only the common named entities and numeric ones; a plain name is unchanged.
 */
export function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return named[body.toLowerCase()] ?? whole;
  });
}

/** Words that make a link a size guide: its label ("Size chart", "How to measure"). */
export const GUIDE_LABEL = /size\s*(guide|chart)|sizing\s*(guide|chart)|fit\s*guide|size\s*(&|and|\+)\s*fit|how to measure|measurement guide/i;
/** The same in an address: /pages/size-guide, /sizing-chart, /how-to-measure. */
export const GUIDE_PATH = /size[-_]?(guide|chart)s?\b|sizing[-_]?(guide|chart)?|fit[-_]?guide|measure/i;
/** A name that says size chart or size guide (a "fit guide" usually describes cuts, not measurements, and ranks lower). */
export const GUIDE_NAME = /size\s*[-_]?\s*(guide|chart)s?|sizing\s*[-_]?\s*(guide|chart)?/i;

/**
 * Addresses of size guides that are pages of their own ("/pages/size-chart"), read from a page's links: same-site
 * links whose text or path says size guide, best first. Product, collection and cart addresses are left out, as
 * are links back to the page itself. headlessFetch runs the same rules inside the browser (GUIDE_LINKS).
 */
export function guideLinksFromHtml(html: string, pageUrl: string, limit = 3): string[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const site = (host: string) => host.replace(/^www\./, '');
  const $ = cheerio.load(html);
  const found = new Map<string, { href: string; score: number }>();
  $('a[href]').each((_i, a) => {
    const raw = ($(a).attr('href') ?? '').trim();
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) return;
    let target: URL;
    try {
      target = new URL(raw, page);
    } catch {
      return;
    }
    if (!/^https?:$/.test(target.protocol)) return;
    if (site(target.host) !== site(page.host) || target.pathname === page.pathname) return;
    if (/^\/([a-z]{2}(-[a-z]{2})?\/)?(products|collections|cart|account|search)\b/i.test(target.pathname)) return;
    if (/[?&](prefn1|prefv1|filter|sort|variant)=/i.test(target.search)) return;
    const label = ($(a).attr('aria-label') || $(a).text() || '').replace(/\s+/g, ' ').trim();
    const byLabel = label.length < 60 && GUIDE_LABEL.test(label);
    if (!byLabel && !GUIDE_PATH.test(target.pathname)) return;
    const score = (GUIDE_NAME.test(label) ? 2 : 0) + (GUIDE_NAME.test(target.pathname) ? 2 : 0) + (byLabel ? 1 : 0);
    const key = target.origin + target.pathname;
    if (!found.has(key) || found.get(key)!.score < score) found.set(key, { href: target.href, score });
  });
  return [...found.values()]
    .sort((x, y) => y.score - x.score)
    .map((x) => x.href)
    .slice(0, limit);
}

const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

/**
 * The part of a host a store owns: "au.seafolly.com" and "www.seafolly.com" are both "seafolly.com";
 * "www.collectif.co.uk" is "collectif.co.uk". A short rule for the usual country endings, not the full public
 * suffix list. Used to tell a store's own regional redirect from a redirect to another store.
 */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last = parts[parts.length - 1];
  const before = parts[parts.length - 2];
  return parts.slice(last.length === 2 && SECOND_LEVEL_LABELS.has(before) ? -3 : -2).join('.');
}

/** How often a memoized parser was asked, and how often it really parsed. */
export interface ParseCounters {
  calls: number;
  parses: number;
}

/**
 * Remembers what `parse` answered for the last `max` distinct pages (and hints), so a snapshot that several steps
 * ask about is parsed once: the render checks it after each try, and the scrape endpoint reads it again. A page of
 * several megabytes takes hundreds of milliseconds to parse. The key is a digest of the page, so the cache holds
 * no page text, and every caller gets its own copy of the rows.
 */
export function memoizeParse(
  parse: (html: string, hint?: ProductHint) => SizeChartRow[],
  max = 16,
): ((html: string, hint?: ProductHint) => SizeChartRow[]) & { stats: ParseCounters } {
  const cache = new Map<string, SizeChartRow[]>();
  const stats: ParseCounters = { calls: 0, parses: 0 };
  const run = (html: string, hint?: ProductHint): SizeChartRow[] => {
    stats.calls++;
    const key = `${createHash('sha256').update(html).digest('hex')}|${hint?.name ?? ''}|${hint?.url ?? ''}`;
    let rows = cache.get(key);
    if (rows) {
      // Most recently used last, so the oldest entry is the one dropped.
      cache.delete(key);
    } else {
      stats.parses++;
      rows = parse(html, hint);
    }
    cache.set(key, rows);
    if (cache.size > max) cache.delete(cache.keys().next().value as string);
    return rows.map((row) => ({ ...row }));
  };
  return Object.assign(run, { stats });
}

/** parseSizeChart, parsing each distinct page once. */
export const parseSizeChartCached = memoizeParse(parseSizeChart);
/** parseGuidePageChart, parsing each distinct guide page once. */
export const parseGuidePageChartCached = memoizeParse((html, hint) => parseGuidePageChart(html, hint ?? {}));

/**
 * The chart from the product's own pages, else from the size-guide pages it linked to: the same answer as
 * parseSizeChartWithGuides, with every distinct page parsed once however often this is asked.
 */
export function sizeChartFromPages(
  pages: (string | null | undefined)[],
  guidePages: (string | null | undefined)[],
  hint: ProductHint,
): SizeChartRow[] {
  for (const html of pages) {
    if (!html) continue;
    const rows = parseSizeChartCached(html, hint);
    if (rows.length > 0) return rows;
  }
  for (const html of guidePages) {
    if (!html) continue;
    const rows = parseGuidePageChartCached(html, hint);
    if (rows.length > 0) return rows;
  }
  return [];
}
