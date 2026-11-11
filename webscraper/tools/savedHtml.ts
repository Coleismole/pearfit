// Reads pages a person saved from their own browser and sends each to the local scraper as raw HTML.
// This is the route for stores that refuse automated requests: nothing here touches a store.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import {
  shortError,
  summarizeScrapeBody,
  type ScrapeOutcome,
  type ScrapeRequest,
  type ScrapeSummary,
} from './scraperClient.ts';

// ---- reading the file ----

/** The server accepts a 4 MB request body. Stay a little under it, since the HTML is JSON-escaped. */
export const MAX_REQUEST_BYTES = 3_900_000;

/**
 * Decodes saved bytes. A byte-order mark or the page's own meta charset wins; the default is UTF-8, which
 * is what browsers write.
 */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const label = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_:.-]+)/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export interface ShrinkResult {
  html: string;
  shrunk: boolean;
  /** Size of the HTML as UTF-8 bytes, after any shrinking. */
  bytes: number;
}

/**
 * Makes a very large saved page fit the request limit by dropping what never holds a review: style blocks,
 * inline SVG, and base64 image data. Scripts stay, since review data often sits in one. A page that is still
 * too large is returned as it is, and the caller reports it.
 */
export function shrinkHtmlForRequest(html: string, maxBytes = MAX_REQUEST_BYTES): ShrinkResult {
  const size = (text: string) => Buffer.byteLength(text, 'utf8');
  if (size(html) <= maxBytes) return { html, shrunk: false, bytes: size(html) };
  const steps: ((text: string) => string)[] = [
    (text) => text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''),
    (text) => text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ''),
    (text) => text.replace(/(["'(])data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+(?=["')])/gi, '$1'),
  ];
  let current = html;
  for (const step of steps) {
    current = step(current);
    if (size(current) <= maxBytes) break;
  }
  return { html: current, shrunk: true, bytes: size(current) };
}

// ---- finding the page's own address ----

export type UrlSource = 'sidecar' | 'comment' | 'saved-from' | 'og:url' | 'canonical';

export interface SniffedUrl {
  url: string;
  from: UrlSource;
}

function cleanUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/&amp;/gi, '&').trim().replace(/^["'<]+|["'>]+$/g, '');
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The text of a `<name>.url.txt` file: the first http(s) address in it, or a Windows `URL=` line. */
export function urlFromSidecar(text: string): string | null {
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const found = cleanUrl(line.match(/^(?:url\s*=\s*)?(https?:\/\/\S+)/i)?.[1]);
    if (found) return found;
  }
  return null;
}

const HEAD_WINDOW = 16_000;

/**
 * The address a saved page came from, by the first source that has one:
 * a sidecar file, a `<!-- url: ... -->` comment, the "saved from url" comment Chrome writes on Ctrl+S,
 * the page's og:url, then its canonical link. Null when the page gives none.
 */
export function sniffSourceUrl(html: string, sidecarText?: string | null): SniffedUrl | null {
  if (sidecarText) {
    const url = urlFromSidecar(sidecarText);
    if (url) return { url, from: 'sidecar' };
  }

  const savedFrom: string[] = [];
  for (const match of html.slice(0, HEAD_WINDOW).matchAll(/<!--((?:(?!-->)[\s\S]){0,800})-->/g)) {
    const comment = match[1] ?? '';
    const chrome = comment.match(/saved from url\s*=\s*\(\d+\)\s*(\S+)/i)?.[1];
    if (chrome) {
      const url = cleanUrl(chrome);
      if (url) savedFrom.push(url);
      continue;
    }
    const plain = cleanUrl(comment.match(/(?:^|[\s,;])url\s*[:=]\s*(https?:\/\/\S+)/i)?.[1]);
    if (plain) return { url: plain, from: 'comment' };
  }
  if (savedFrom[0]) return { url: savedFrom[0], from: 'saved-from' };

  const $ = cheerio.load(html.slice(0, 300_000));
  const ogUrl = cleanUrl($('meta[property="og:url"], meta[name="og:url"]').first().attr('content'));
  if (ogUrl) return { url: ogUrl, from: 'og:url' };
  const canonical = cleanUrl($('link[rel="canonical"]').first().attr('href'));
  if (canonical) return { url: canonical, from: 'canonical' };
  return null;
}

/** The store as a short name: the host without "www.". */
export function storeFromUrl(url: string | null): string {
  if (!url) return '(unknown)';
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || '(unknown)';
  } catch {
    return '(unknown)';
  }
}

// ---- one result per saved page ----

export interface SavedPageResult extends ScrapeSummary {
  file: string;
  sourceUrl: string | null;
  urlFrom: UrlSource | null;
  store: string;
  bytes: number;
  shrunk: boolean;
  committed: boolean;
  /** Whether the shared store took the commit; null when nothing was committed. */
  sharedStore: 'saved' | 'not saved' | null;
  secs: number;
  error: string | null;
  notes: string[];
}

export function pageNotes(result: Pick<SavedPageResult, 'error' | 'reviewsRead' | 'reviewsStated' | 'sourceUrl' | 'shrunk' | 'sizeChartRows'>): string[] {
  const notes: string[] = [];
  if (!result.error && !result.sourceUrl) {
    notes.push('No source address found, so the SKU is not the store\'s own. Add a <name>.url.txt next to the file with the product URL.');
  }
  if (result.shrunk) notes.push('The page was over the 4 MB request limit; styles, SVG and inline images were dropped before sending.');
  if (!result.error && result.reviewsStated !== null && result.reviewsRead < result.reviewsStated) {
    notes.push(
      `Read ${result.reviewsRead} of the ${result.reviewsStated} reviews the page states. If more show in your browser, open them (scroll, "Load more", the reviews tab) and save the page again.`,
    );
  }
  return notes;
}

function blankSummary(): ScrapeSummary {
  return { product: '', brand: '', sku: '', reviewsRead: 0, reviewsStated: null, withSize: 0, withFit: 0, sizeChartRows: 0, reviewSources: [], avgRating: null };
}

export interface FindOptions {
  /** Extension check is case-insensitive. */
  extensions?: string[];
}

/** The saved pages directly inside a folder (the "<name>_files" folders a browser writes are not entered). */
export async function findSavedPages(folder: string, options: FindOptions = {}): Promise<string[]> {
  const extensions = options.extensions ?? ['.html', '.htm'];
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readSidecar(folder: string, file: string): Promise<string | null> {
  const stem = file.replace(/\.[^.]+$/, '');
  for (const name of [`${stem}.url.txt`, `${file}.url.txt`]) {
    try {
      return await readFile(path.join(folder, name), 'utf8');
    } catch {
      // not there
    }
  }
  return null;
}

export type ScrapeFn = (request: ScrapeRequest) => Promise<ScrapeOutcome>;

export interface ReadFolderOptions {
  folder: string;
  scrape: ScrapeFn;
  /** Send commitToDb true. Pages with no source address are never committed. */
  commit?: boolean;
  concurrency?: number;
  onResult?: (result: SavedPageResult, done: number, total: number) => void;
}

export async function readSavedPage(folder: string, file: string, options: Pick<ReadFolderOptions, 'scrape' | 'commit'>): Promise<SavedPageResult> {
  const base: SavedPageResult = {
    ...blankSummary(),
    file,
    sourceUrl: null,
    urlFrom: null,
    store: '(unknown)',
    bytes: 0,
    shrunk: false,
    committed: false,
    sharedStore: null,
    secs: 0,
    error: null,
    notes: [],
  };
  let html: string;
  try {
    html = decodeHtmlBytes(await readFile(path.join(folder, file)));
  } catch (err) {
    return { ...base, error: `could not read the file: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!html.trim()) return { ...base, error: 'the file is empty' };

  const sniffed = sniffSourceUrl(html, await readSidecar(folder, file));
  const shrink = shrinkHtmlForRequest(html);
  const located: SavedPageResult = {
    ...base,
    sourceUrl: sniffed?.url ?? null,
    urlFrom: sniffed?.from ?? null,
    store: storeFromUrl(sniffed?.url ?? null),
    bytes: shrink.bytes,
    shrunk: shrink.shrunk,
  };
  if (shrink.bytes > MAX_REQUEST_BYTES) {
    const error = `the page is ${(shrink.bytes / 1_048_576).toFixed(1)} MB, over the scraper's 4 MB request limit. Save it again as "Webpage, HTML only".`;
    return { ...located, error, notes: pageNotes({ ...located, error }) };
  }

  // Without an address every page shares one placeholder SKU, so such a page is never committed.
  const commit = Boolean(options.commit && sniffed);
  const outcome = await options.scrape({
    rawHtml: shrink.html,
    ...(sniffed ? { url: sniffed.url } : {}),
    commitToDb: commit,
    render: 'never',
  });
  const summary = summarizeScrapeBody(outcome.body);
  const error = outcome.networkError ?? (outcome.status >= 400 || outcome.body?.error ? shortError(outcome.body?.error) ?? `HTTP ${outcome.status}` : null);
  const supabase = outcome.body?.supabase;
  const result: SavedPageResult = {
    ...located,
    ...summary,
    secs: outcome.secs,
    committed: !error && commit && outcome.body?.committedToDb === true,
    sharedStore: !error && commit && outcome.body?.committedToDb === true ? (supabase?.ok ? 'saved' : 'not saved') : null,
    error,
    notes: [],
  };
  result.notes = pageNotes(result);
  if (options.commit && !sniffed && !error) result.notes.push('Not committed: no source address.');
  return result;
}

export async function readSavedFolder(options: ReadFolderOptions): Promise<SavedPageResult[]> {
  const files = await findSavedPages(options.folder);
  const results: SavedPageResult[] = new Array(files.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 1, files.length || 1)) }, async () => {
    while (next < files.length) {
      const index = next++;
      const result = await readSavedPage(options.folder, files[index]!, options);
      results[index] = result;
      options.onResult?.(result, ++done, files.length);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- the summary table ----

function clip(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

export function reviewsCell(result: Pick<SavedPageResult, 'reviewsRead' | 'reviewsStated'>): string {
  return `${result.reviewsRead} / ${result.reviewsStated ?? 'not stated'}`;
}

export const SUMMARY_COLUMNS = ['File', 'Store', 'Product', 'Reviews read / stated', 'With size', 'With fit answer', 'Size chart rows', 'Error'] as const;

export function summaryRow(result: SavedPageResult): string[] {
  return [
    clip(result.file, 34),
    result.store,
    clip(result.product || '-', 40),
    result.error && result.reviewsRead === 0 ? '-' : reviewsCell(result),
    result.error && result.reviewsRead === 0 ? '-' : String(result.withSize),
    result.error && result.reviewsRead === 0 ? '-' : String(result.withFit),
    String(result.sizeChartRows),
    result.error ? clip(result.error, 70) : '',
  ];
}

/** A text table with aligned columns, then the notes that need a person's attention. */
export function formatSummaryTable(results: SavedPageResult[]): string {
  const rows = [[...SUMMARY_COLUMNS], ...results.map(summaryRow)];
  const widths = SUMMARY_COLUMNS.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  const line = (row: string[]) => row.map((cell, col) => cell.padEnd(widths[col]!)).join(' | ').trimEnd();
  const out = [line(rows[0]!), widths.map((w) => '-'.repeat(w)).join('-|-')];
  for (const row of rows.slice(1)) out.push(line(row));

  const noted = results.filter((r) => r.notes.length > 0);
  if (noted.length > 0) {
    out.push('', 'Notes');
    for (const result of noted) for (const note of result.notes) out.push(`- ${result.file}: ${note}`);
  }
  const failed = results.filter((r) => r.error).length;
  const reviews = results.reduce((sum, r) => sum + r.reviewsRead, 0);
  out.push('', `${results.length} page${results.length === 1 ? '' : 's'}: ${results.length - failed} read, ${failed} with an error, ${reviews} reviews in total.`);
  return out.join('\n');
}

export interface ResultsFile {
  generatedAt: string;
  folder: string;
  committed: boolean;
  totals: { pages: number; read: number; failed: number; reviews: number };
  results: SavedPageResult[];
}

export function buildResultsFile(folder: string, results: SavedPageResult[], committed: boolean, now = new Date()): ResultsFile {
  const failed = results.filter((r) => r.error).length;
  return {
    generatedAt: now.toISOString(),
    folder,
    committed,
    totals: { pages: results.length, read: results.length - failed, failed, reviews: results.reduce((sum, r) => sum + r.reviewsRead, 0) },
    results,
  };
}

/** results.json goes next to the folder, named after it, so two folders do not overwrite each other. */
export function defaultResultsPath(folder: string): string {
  const resolved = path.resolve(folder);
  return path.join(path.dirname(resolved), `${path.basename(resolved)}.results.json`);
}
