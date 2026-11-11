// Parses the tables of SUPPORTED_STORES.md into the machine-readable list the weekly verification reads
// (tools/verified-stores.json), and renders the "Reviews and fit" tables back from that list.
// Pure functions only: the file reading and writing is in build-verified-list.ts and render-supported-stores.ts.

export const REVIEW_TABLE_HEADERS = ['Store', 'Product tested', 'Reviews come from', 'Read / stated', 'Size bought', 'Fit answer'] as const;

/** One row of a "Reviews and fit" table, cell text exactly as written. */
export interface TableRow {
  /** The `##` heading the table sits under. */
  section: string;
  /** Position of the row inside its table, from 0. */
  row: number;
  store: string;
  product: string;
  reviewsFrom: string;
  readStated: string;
  sizeBought: string;
  fitAnswer: string;
}

export interface ReadStated {
  read: number;
  /** The total the store states, or null for "not stated". */
  stated: number | null;
}

export interface SizeChartOnlyRow {
  store: string;
  notes: string;
}

export interface ParsedStoreDoc {
  rows: TableRow[];
  sizeChartOnly: SizeChartOnlyRow[];
  /** Store names the markdown says had a size chart read (from the "Size charts." paragraph). */
  chartStoreNames: string[];
  /** The `##` section that paragraph is in. It speaks only of that section's stores. */
  chartSection: string | null;
  /** The first "Tested on YYYY-MM-DD" date. */
  testedOn: string | null;
}

/** Splits a table line into its cells. A `\|` inside a cell is kept as `|`. */
export function splitTableLine(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

/** "300 / 7455, 88 / 88" is two products; "8 / not stated" has no total. */
export function parseReadStated(cell: string): ReadStated[] {
  const pairs: ReadStated[] = [];
  for (const match of cell.matchAll(/(\d+)\s*\/\s*(\d+|not stated)/gi)) {
    pairs.push({ read: Number(match[1]), stated: /^\d+$/.test(match[2]!) ? Number(match[2]) : null });
  }
  return pairs;
}

const PLATFORMS: [RegExp, string][] = [
  [/bazaarvoice/i, 'Bazaarvoice'],
  [/yotpo/i, 'Yotpo'],
  [/okendo/i, 'Okendo'],
  [/stamped/i, 'Stamped'],
  [/klaviyo/i, 'Klaviyo Reviews'],
  [/powerreviews/i, 'PowerReviews'],
  [/turnto/i, 'TurnTo'],
  [/bayengage/i, 'BayEngage'],
  [/judge\.me/i, 'Judge.me'],
  [/junip/i, 'Junip'],
  [/reviews\.io/i, 'Reviews.io'],
];

/**
 * The review platform behind a "Reviews come from" cell. These are the rules of platformOf in
 * website/scripts/build-stores.mjs, so the `platform` field here is the value that script computes:
 * a named platform wins over wording about how the reviews were reached; stores with no third-party
 * platform are "Store's own service", "Embedded in the page" or "Review pages"; anything else is "Other".
 */
export function platformLabel(reviewsFrom: string): string {
  for (const [pattern, name] of PLATFORMS) if (pattern.test(reviewsFrom)) return name;
  if (/embedded in the page|page markup|page's markup/i.test(reviewsFrom)) return 'Embedded in the page';
  if (/own (review )?(service|endpoint|data)/i.test(reviewsFrom)) return "Store's own service";
  if (/review pages/i.test(reviewsFrom)) return 'Review pages';
  return 'Other';
}

/** "Uniqlo (CA)" -> "uniqlo-ca": the same slug as slugify in website/scripts/build-stores.mjs. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Store names inside the brackets of "A chart was read for N of the M stores ... (A, B, C)." */
export function parseChartStoreNames(md: string): string[] {
  const paragraph = md.match(/\*\*Size charts\.\*\*[\s\S]*?\(([^)]*)\)/);
  if (!paragraph) return [];
  return paragraph[1]!
    .replace(/\s+/g, ' ')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function parseStoreDoc(md: string): ParsedStoreDoc {
  const lines = md.split(/\r?\n/);
  const rows: TableRow[] = [];
  const sizeChartOnly: SizeChartOnlyRow[] = [];
  let section = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      section = heading[1]!;
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      const header = splitTableLine(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        body.push(splitTableLine(lines[i]!));
        i++;
      }
      const isReviewTable = REVIEW_TABLE_HEADERS.every((name, col) => header[col] === name);
      if (isReviewTable) {
        body.forEach((cells, row) => {
          if (cells.length !== REVIEW_TABLE_HEADERS.length) {
            throw new Error(`Row ${row + 1} of the table under "${section}" has ${cells.length} cells, expected ${REVIEW_TABLE_HEADERS.length}: ${cells.join(' | ')}`);
          }
          rows.push({
            section,
            row,
            store: cells[0]!,
            product: cells[1]!,
            reviewsFrom: cells[2]!,
            readStated: cells[3]!,
            sizeBought: cells[4]!,
            fitAnswer: cells[5]!,
          });
        });
      } else if (header.length === 2 && header[0] === 'Store' && header[1] === 'Notes' && /size chart only/i.test(section)) {
        for (const cells of body) if (cells.length === 2) sizeChartOnly.push({ store: cells[0]!, notes: cells[1]! });
      }
      continue;
    }
    i++;
  }
  const chartNames = parseChartStoreNames(md);
  const chartAt = lines.findIndex((line) => /\*\*Size charts\.\*\*/.test(line));
  let chartSection: string | null = null;
  for (let j = chartAt; j >= 0; j--) {
    const heading = lines[j]!.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      chartSection = heading[1]!;
      break;
    }
  }
  const testedOn = md.match(/Tested on (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return { rows, sizeChartOnly, chartStoreNames: chartNames, chartSection, testedOn };
}

// ---- matching rows to product addresses ----

/** A product address some earlier run recorded, with the product name it showed. */
export interface UrlHint {
  source: string;
  url: string;
  name: string;
  got?: number;
  stated?: number | null;
  chart?: number;
}

function unescapeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Lower-case words of a name with accents and entities folded away; "&" and "+" read as "and". */
function nameWords(text: string): string[] {
  return unescapeEntities(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[&+]/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function normalizeName(text: string): string {
  return nameWords(text).join('');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\d?\./, '');
  } catch {
    return '';
  }
}

/** The part of a host that names the store: "uniqlo" for "uniqlo.com" and "collectif" for "collectif.co.uk". */
export function hostCore(host: string): string {
  const parts = host.split('.').filter(Boolean);
  const skip = new Set(['com', 'co', 'net', 'org', 'ca', 'uk', 'au', 'us', 'shop', 'store', 'clothing', 'la']);
  const core = parts.filter((part) => !skip.has(part));
  return (core.length > 0 ? core[0]! : parts[0] ?? '').replace(/[^a-z0-9]/g, '');
}

/** Whether a store's name and a host can be the same store. */
export function storeMatchesHost(store: string, host: string): boolean {
  const name = normalizeName(store);
  const core = hostCore(host);
  if (!name || !core) return false;
  return name.includes(core) || core.includes(name);
}

/** The product names a row may be known by: the whole cell, and each part of a comma-separated list. */
function productCandidates(product: string): string[] {
  const parts = product.split(/,\s+/).map((part) => part.trim()).filter(Boolean);
  return [...new Set([product.trim(), ...parts])];
}

export interface UrlMatch {
  hint: UrlHint;
  /** Which of the row's comma-separated products the hint is. */
  productIndex: number;
}

export type UrlLookup = { match: UrlMatch } | { match: null; reason: string };

/** True when every word of the shorter name is a word of the longer one (two words at least). */
function wordsContained(a: string, b: string): boolean {
  const left = new Set(nameWords(a));
  const right = new Set(nameWords(b));
  const [small, big] = left.size <= right.size ? [left, right] : [right, left];
  return small.size >= 2 && [...small].every((word) => big.has(word));
}

export interface FindContext {
  /** Addresses already given to an earlier row; a row never takes one of them. */
  usedUrls?: Set<string>;
  /** How many earlier rows have this same store and product. Identical rows are told apart by order. */
  duplicateIndex?: number;
}

/**
 * The hint for a row, or why there is none. A hint counts when its product name equals the row's product
 * (the table cuts names at 60 characters and swaps "|" for "/", so that form is tried too), or, when the
 * host also fits the store's name, when one name's words are all in the other. Two different stores
 * answering to one product name is reported, not resolved by guessing, except for rows the table repeats
 * word for word (Reitmans .ca and .com): those take the hosts in alphabetical order.
 */
export function findUrlHint(row: Pick<TableRow, 'store' | 'product' | 'readStated'>, hints: UrlHint[], context: FindContext = {}): UrlLookup {
  const used = context.usedUrls ?? new Set<string>();
  const productTexts = productCandidates(row.product);
  const candidates = productTexts.map(normalizeName);
  const reads = parseReadStated(row.readStated);

  const exact: UrlMatch[] = [];
  const loose: UrlMatch[] = [];
  for (const hint of hints) {
    const tableForm = normalizeName(unescapeEntities(hint.name).slice(0, 60).replace(/\|/g, '/'));
    const full = normalizeName(hint.name);
    // Candidate 0 is the whole cell; candidate k is the k-th comma-separated product.
    const index = candidates.findIndex((candidate) => candidate === tableForm || candidate === full);
    if (index >= 0) {
      exact.push({ hint, productIndex: index === 0 ? 0 : index - 1 });
      continue;
    }
    const looseIndex = productTexts.findIndex((text) => wordsContained(text, hint.name));
    if (looseIndex >= 0 && storeMatchesHost(row.store, hostOf(hint.url))) {
      loose.push({ hint, productIndex: looseIndex === 0 ? 0 : looseIndex - 1 });
    }
  }
  const found = exact.length > 0 ? exact : loose;
  if (found.length === 0) return { match: null, reason: 'no recorded product address for this product name' };

  const fitting = found.filter((m) => storeMatchesHost(row.store, hostOf(m.hint.url)));
  let pool = fitting.length > 0 ? fitting : found;
  const hosts = [...new Set(pool.map((m) => hostOf(m.hint.url)))].sort();
  if (hosts.length > 1) {
    const duplicateIndex = context.duplicateIndex ?? 0;
    if (fitting.length === 0 || duplicateIndex >= hosts.length) {
      return { match: null, reason: `product name matches more than one store (${hosts.join(', ')})` };
    }
    pool = pool.filter((m) => hostOf(m.hint.url) === hosts[duplicateIndex]);
  } else if (fitting.length === 0) {
    // One host, but nothing ties it to this store's name (a brand sold on another retailer's site):
    // accepted only for a long, specific product name.
    const specific = candidates.some((c) => c.length >= 12);
    if (!specific) return { match: null, reason: `the only match is on ${hosts[0]}, which does not fit the store name` };
  }
  pool = pool.filter((m) => !used.has(m.hint.url));
  if (pool.length === 0) return { match: null, reason: 'same product address as an earlier row (a duplicate row)' };

  // Prefer the run whose review count is the one in the table, then the biggest run.
  const wanted = reads[0]?.read;
  pool.sort((a, b) => {
    const aHit = wanted !== undefined && a.hint.got === wanted ? 1 : 0;
    const bHit = wanted !== undefined && b.hint.got === wanted ? 1 : 0;
    return bHit - aHit || (b.hint.got ?? 0) - (a.hint.got ?? 0);
  });
  return { match: pool[0]! };
}

// ---- the list ----
//
// Field names are snake_case and, where the website's data has the same fact, the same name:
// id, name, status, platform, product_tested, reviews_from, read_stated, size_bought_text, fit_answer_text.
// website/scripts/build-stores.mjs can later read this file instead of parsing the markdown.

export interface VerifiedStore {
  /** slugify(name); a name that repeats gets -2, -3. */
  id: string;
  name: string;
  /** "reviews", or "size_chart_only" for the store(s) in the size-chart-only table. */
  status: 'reviews' | 'size_chart_only';
  domain: string;
  url: string;
  /** Where the address was taken from, for example "round7/merged/results.jsonl". */
  url_source: string;
  /** The review platform, by the rules the website uses ("Okendo", "Store's own service", "Other"). */
  platform: string | null;
  /** Reviews the scraper read when the store was last confirmed. The check allows half of this. */
  expected_min_reviews: number;
  /** True when a size chart was read for this product; the check then expects chart rows. */
  has_size_chart: boolean;
  /** The markdown row's cells as written, null when the cell is empty. */
  product_tested: string | null;
  reviews_from: string | null;
  read_stated: string | null;
  size_bought_text: string | null;
  fit_answer_text: string | null;
  /** The size-chart-only table's note, for status size_chart_only. */
  size_chart_notes?: string;
  /** The `##` heading of the table the row is in, and its position in that table (from 0). */
  table_section: string;
  table_row: number;
}

export interface NeedsUrlStore extends Omit<VerifiedStore, 'domain' | 'url' | 'url_source'> {
  reason: string;
}

export interface VerifiedList {
  source: string;
  /** The first "Tested on YYYY-MM-DD" date in the markdown, as the website data has it. */
  tested_on: string | null;
  note: string;
  stores: VerifiedStore[];
  needs_url: NeedsUrlStore[];
  /** Names the markdown lists as having a chart that no row matched (so they are not marked has_size_chart). */
  unmatched_chart_names: string[];
}

export const LIST_NOTE =
  'Built by tools/build-verified-list.ts from SUPPORTED_STORES.md. expected_min_reviews is the number of reviews read when the store was confirmed; ' +
  'verify-stores allows half of it. has_size_chart true means a chart was read then. needs_url lists stores with no known product address: add one and rebuild.';

export interface BuildOptions {
  source?: string;
  hints?: UrlHint[];
  /** A previous list: its addresses are kept for stores whose rows still match. */
  existing?: VerifiedList | null;
}

function keptLookup(kept: VerifiedStore, product: string): UrlLookup {
  return { match: { hint: { source: kept.url_source, url: kept.url, name: product, chart: kept.has_size_chart ? 1 : 0 }, productIndex: 0 } };
}

function chartNameMatches(row: Pick<TableRow, 'store'>, chartNames: string[]): string | null {
  const store = normalizeName(row.store);
  for (const name of chartNames) {
    const wanted = normalizeName(name);
    if (wanted && (store === wanted || store.includes(wanted) || wanted.includes(store))) return name;
  }
  return null;
}

const orNull = (text: string): string | null => (text === '' ? null : text);

export function buildVerifiedList(doc: ParsedStoreDoc, options: BuildOptions = {}): VerifiedList {
  const hints = options.hints ?? [];
  // Addresses of a previous list, by store, product and the order among identical rows.
  const keptByKey = new Map<string, VerifiedStore>();
  const oldSeen = new Map<string, number>();
  const oldEntries = [...(options.existing?.stores ?? []), ...(options.existing?.needs_url ?? [])].sort(
    (a, b) => a.table_section.localeCompare(b.table_section) || a.table_row - b.table_row,
  );
  for (const old of oldEntries) {
    const base = `${old.name}\n${old.product_tested ?? ''}`;
    const index = oldSeen.get(base) ?? 0;
    oldSeen.set(base, index + 1);
    if ('url' in old) keptByKey.set(`${base}\n${index}`, old);
  }

  const stores: VerifiedStore[] = [];
  const needsUrl: NeedsUrlStore[] = [];
  const usedChartNames = new Set<string>();
  const usedUrls = new Set<string>();
  const seenKeys = new Map<string, number>();
  const seenIds = new Map<string, number>();
  const idFor = (name: string): string => {
    const slug = slugify(name);
    const count = (seenIds.get(slug) ?? 0) + 1;
    seenIds.set(slug, count);
    return count === 1 ? slug : `${slug}-${count}`;
  };

  for (const row of doc.rows) {
    const reads = parseReadStated(row.readStated);
    if (reads.length === 0) {
      throw new Error(`Cannot read "Read / stated" for ${row.store}: "${row.readStated}"`);
    }
    const rowKey = `${row.store}\n${row.product}`;
    const duplicateIndex = seenKeys.get(rowKey) ?? 0;
    seenKeys.set(rowKey, duplicateIndex + 1);
    // A previous list keeps its address, matched by store, product and the order of identical rows.
    const kept = keptByKey.get(`${rowKey}\n${duplicateIndex}`);
    const lookup: UrlLookup = kept ? keptLookup(kept, row.product) : findUrlHint(row, hints, { usedUrls, duplicateIndex });
    if (lookup.match) usedUrls.add(lookup.match.hint.url);
    const productIndex = lookup.match ? Math.min(lookup.match.productIndex, reads.length - 1) : 0;

    const chartName = row.section === doc.chartSection ? chartNameMatches(row, doc.chartStoreNames) : null;
    if (chartName) usedChartNames.add(chartName);
    const base = {
      id: idFor(row.store),
      name: row.store,
      status: 'reviews' as const,
    };
    const rest = {
      platform: platformLabel(row.reviewsFrom),
      expected_min_reviews: reads[productIndex]!.read,
      has_size_chart: (lookup.match?.hint.chart ?? 0) > 0 || chartName !== null,
      product_tested: orNull(row.product),
      reviews_from: orNull(row.reviewsFrom),
      read_stated: orNull(row.readStated),
      size_bought_text: orNull(row.sizeBought),
      fit_answer_text: orNull(row.fitAnswer),
      table_section: row.section,
      table_row: row.row,
    };
    if (lookup.match) {
      const url = lookup.match.hint.url;
      stores.push({ ...base, domain: hostOf(url), url, url_source: lookup.match.hint.source, ...rest });
    } else {
      needsUrl.push({ ...base, reason: lookup.reason, ...rest });
    }
  }

  // The size-chart-only table has no product and no review count. Its address comes from a previous list
  // or from a hint named after the store.
  doc.sizeChartOnly.forEach((chartRow, index) => {
    const base = { id: idFor(chartRow.store), name: chartRow.store, status: 'size_chart_only' as const };
    const rest = {
      platform: null,
      expected_min_reviews: 0,
      has_size_chart: true,
      product_tested: null,
      reviews_from: null,
      read_stated: null,
      size_bought_text: null,
      fit_answer_text: null,
      size_chart_notes: chartRow.notes,
      table_section: 'Size chart only',
      table_row: index,
    };
    const kept = keptByKey.get(`${chartRow.store}\n\n0`);
    const hint = kept ? keptLookup(kept, '').match?.hint : hints.find((h) => normalizeName(h.name) === normalizeName(chartRow.store));
    if (hint) stores.push({ ...base, domain: hostOf(hint.url), url: hint.url, url_source: hint.source, ...rest });
    else needsUrl.push({ ...base, reason: 'size chart only: no product address recorded', ...rest });
  });

  return {
    source: options.source ?? 'SUPPORTED_STORES.md',
    tested_on: doc.testedOn,
    note: LIST_NOTE,
    stores,
    needs_url: needsUrl,
    unmatched_chart_names: doc.chartStoreNames.filter((name) => !usedChartNames.has(name)),
  };
}

// ---- rendering the tables back ----

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** The rows of the review tables, from the list's stores and needs_url entries, cells as the markdown had them. */
export function rowsFromList(list: Pick<VerifiedList, 'stores' | 'needs_url'>): TableRow[] {
  const entries = [...list.stores, ...list.needs_url].filter((e) => e.status === 'reviews');
  return entries.map((entry) => ({
    section: entry.table_section,
    row: entry.table_row,
    store: entry.name,
    product: entry.product_tested ?? '',
    reviewsFrom: entry.reviews_from ?? '',
    readStated: entry.read_stated ?? '',
    sizeBought: entry.size_bought_text ?? '',
    fitAnswer: entry.fit_answer_text ?? '',
  }));
}

export function tableLine(row: TableRow): string {
  return `| ${[row.store, row.product, row.reviewsFrom, row.readStated, row.sizeBought, row.fitAnswer].map(cell).join(' | ')} |`;
}

/**
 * Rewrites the body of every "Reviews and fit" table in the markdown from the list, leaving everything else
 * (headings, paragraphs, the other tables) as it is. A table whose heading the list has no rows for is left
 * as it is (`untouchedSections`), never emptied. `missingFromList` holds rows the markdown has and the list
 * lacks: a write would lose them. `extraInList` holds rows the list has and the markdown lacks.
 */
export function renderReviewTables(
  md: string,
  list: Pick<VerifiedList, 'stores' | 'needs_url'>,
): { text: string; missingFromList: TableRow[]; extraInList: TableRow[]; untouchedSections: string[] } {
  const listRows = rowsFromList(list);
  const bySection = new Map<string, TableRow[]>();
  for (const row of listRows) bySection.set(row.section, [...(bySection.get(row.section) ?? []), row]);
  for (const rows of bySection.values()) rows.sort((a, b) => a.row - b.row);

  const lines = md.split('\n');
  const out: string[] = [];
  const untouchedSections: string[] = [];
  let section = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) section = heading[1]!;
    const header = line.trim().startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1]!) ? splitTableLine(line) : null;
    if (header && REVIEW_TABLE_HEADERS.every((name, col) => header[col] === name)) {
      out.push(line, lines[i + 1]!);
      i += 2;
      const bodyStart = i;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) i++;
      const rows = bySection.get(section);
      if (rows) out.push(...rows.map(tableLine));
      else {
        out.push(...lines.slice(bodyStart, i));
        untouchedSections.push(section);
      }
      continue;
    }
    out.push(line);
    i++;
  }

  // Compare as multisets: a table may repeat a row word for word.
  const key = (row: TableRow) => `${row.section}\n${row.store}\n${row.product}`;
  const count = (rows: TableRow[]) => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
    return counts;
  };
  const surplus = (rows: TableRow[], other: Map<string, number>) => {
    const left = new Map(other);
    return rows.filter((row) => {
      const remaining = left.get(key(row)) ?? 0;
      if (remaining > 0) {
        left.set(key(row), remaining - 1);
        return false;
      }
      return true;
    });
  };
  const docRows = parseStoreDoc(md).rows;
  return {
    text: out.join('\n'),
    missingFromList: surplus(docRows, count(listRows)),
    extraInList: surplus(listRows, count(docRows)),
    untouchedSections,
  };
}
