/**
 * Pure helpers for pulling review fields out of rendered review-card markup.
 * No I/O; used by server.ts and unit-tested in pageHelpers.test.ts.
 */
import type * as cheerio from 'cheerio';

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

/** Longest leaf text that is not a "Label: value" line: the review body on unlabelled markup. */
export function longestFreeText(lines: string[], exclude: string[]): string {
  let best = '';
  for (const line of lines) {
    if (LABEL_LINE.test(line) || exclude.includes(line)) continue;
    if (line.length > best.length) best = line;
  }
  return best;
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
  const m = label?.match(/(\d+(?:\.\d+)?)\s*out\s*of\s*(\d+)/i);
  if (!m) return '';
  const value = parseFloat(m[1]);
  const best = parseFloat(m[2]);
  if (!(best > 1)) return '';
  return best === 5 ? String(value) : String(1 + ((value - 1) / (best - 1)) * 4);
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
