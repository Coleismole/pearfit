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

/** Product code from common URL shapes (/products/E487396-000, /p/AY670, /product/.../45215.html). */
export function productIdFromUrl(url: string): string | null {
  const m =
    url.match(/\/(\d{4,})\.html/) ||
    // A code contains a digit. A slug such as /product/mens-shirt/ must not win over the id after it.
    url.match(/\/products?\/([A-Z0-9_-]*\d[A-Z0-9_-]*)(?:[/?#.]|$)/i) ||
    url.match(/\/p\/(?:[^/?#]+\/)*([A-Z0-9]*\d[A-Z0-9]*)(?:[/?#]|$)/i);
  return m ? m[1] : null;
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

