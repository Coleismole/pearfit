// Collect adult men's short-sleeve t-shirts for Uniqlo, Gymshark, and Nike.
//
//   npx tsx tools/collect-mens-tees.ts
//
// Zara and Abercrombie & Fitch are not requested: SUPPORTED_STORES.md already records them as refusing
// automated requests. A store that answers 403, 418, 429, or 503, or shows a block page, is stopped and
// not retried. Uniqlo's category page and Gymshark's products.json feed refused earlier in this run and
// are not requested again; product pages come from the sitemaps robots.txt points at.
//
// Each opened page is classified with classifyMensShortSleeveTee. Only a page that states adult men's
// (or unisex sized for men) and a short-sleeve t-shirt is scraped.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLocs, gunzipIfNeeded } from './discoverProducts.ts';
import { fetchStaticHtml } from '../server/staticFetch.ts';
import {
  classifyMensShortSleeveTee,
  extractTeeEvidence,
  type TeeDecision,
  type TeeEvidence,
  type TeeRejectReason,
} from '../mensTee.ts';
import { inferCategory } from '../server/scrapeHtml.ts';
import { postScrape, startScraperServer, type ScrapeResponseBody } from './scraperClient.ts';
import type { ProductFitReport } from '../fitAnalyzer.ts';
import type { SizeChartRow } from '../sizeChart.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PAUSE_MS = 1000;
const WANT = 26;
const PROGRESS = '/tmp/mens-tees-progress.jsonl';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'samples', 'mens-short-sleeve-tees.json');

type BrandId = 'uniqlo' | 'gymshark' | 'nike';

interface ProgressRow {
  brand: BrandId;
  url: string;
  at: string;
  opened: boolean;
  kept: boolean;
  reason: TeeRejectReason | 'duplicate' | 'unavailable' | 'refused' | 'scrape error' | null;
  title: string | null;
  unisex: boolean;
  evidence: TeeEvidence | null;
  scrapeStatus: number | null;
  scrapeError: string | null;
  report: ProductFitReport | null;
  sizeChart: SizeChartRow[] | null;
}

const NOT_REQUESTED = [
  {
    brand: 'Zara',
    kept: 0,
    blocked: true,
    note: 'zara.com is listed in SUPPORTED_STORES.md under "Refused or not scrapeable (not retried)". Not called.',
  },
  {
    brand: 'Abercrombie & Fitch',
    kept: 0,
    blocked: true,
    note: 'SUPPORTED_STORES.md: Hollister and Abercrombie & Fitch show the headless browser a "Client Challenge" bot check. Not called.',
  },
  {
    brand: 'Uniqlo',
    note: 'https://www.uniqlo.com/ca/en/men/tops/t-shirts returned HTTP 403 Access Denied on 2026-11-13 and was not retried. Product addresses come from the sitemap.',
  },
  {
    brand: 'Gymshark',
    note: 'https://www.gymshark.com/products.json returned HTTP 403 on 2026-11-13 and was not retried. Product addresses come from the sitemap. /collections/*/products is disallowed by robots.txt and was not requested.',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadProgress(): ProgressRow[] {
  if (!existsSync(PROGRESS)) return [];
  return readFileSync(PROGRESS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProgressRow);
}

let writeLock: Promise<void> = Promise.resolve();

function appendProgress(row: ProgressRow): Promise<void> {
  const line = JSON.stringify(row) + '\n';
  writeLock = writeLock.then(() => {
    appendFileSync(PROGRESS, line);
  });
  return writeLock;
}

async function fetchBuffer(url: string): Promise<{ status: number; buffer: Buffer | null; refused: boolean }> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(60_000) });
    const refused = response.status === 401 || response.status === 403 || response.status === 418 || response.status === 429 || response.status === 503;
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { status: response.status, buffer: null, refused };
    }
    return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()), refused: false };
  } catch {
    return { status: 0, buffer: null, refused: false };
  }
}

function locsFrom(buffer: Buffer, url: string): string[] {
  // Some Uniqlo sitemap URLs end in .gz but the body is plain XML. Trust the bytes, not the name.
  const xml = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipIfNeeded(buffer, url) : buffer;
  return extractLocs(xml.toString('utf8'));
}

function uniqloCode(url: string): string | null {
  const match = url.match(/\/products\/(E\d+-000)\//i);
  return match ? match[1]!.toUpperCase() : null;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  const rand = seeded(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

function nikeStyle(url: string): string {
  const slug = url.split('/t/')[1] ?? url;
  const parts = slug.split('-');
  return parts.length > 1 ? parts.slice(0, -1).join('-') : slug;
}

function isMensSlug(slug: string): boolean {
  const low = slug.toLowerCase();
  if (/women|girls|kids|youth|boys/.test(low)) return false;
  return /(^|[^a-z])men'?s([^a-z]|$)|(^|-)mens(-|$)/.test(low);
}

async function candidateUrls(brand: BrandId): Promise<{ urls: string[]; note: string | null; refused: boolean }> {
  if (brand === 'uniqlo') {
    const url = 'https://www.uniqlo.com/ca/en/sitemap_ca-en_products.xml.gz';
    const got = await fetchBuffer(url);
    if (got.refused) return { urls: [], note: `sitemap refused (HTTP ${got.status})`, refused: true };
    if (!got.buffer) return { urls: [], note: `sitemap not readable (HTTP ${got.status})`, refused: false };
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const loc of locsFrom(got.buffer, url)) {
      const code = uniqloCode(loc);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      urls.push(loc.split('?')[0]!);
    }
    return { urls: shuffle(urls, 20261113), note: null, refused: false };
  }
  if (brand === 'gymshark') {
    const url = 'https://www.gymshark.com/sitemap_products_1.xml';
    const got = await fetchBuffer(url);
    if (got.refused) return { urls: [], note: `sitemap refused (HTTP ${got.status})`, refused: true };
    if (!got.buffer) return { urls: [], note: `sitemap not readable (HTTP ${got.status})`, refused: false };
    const styles = new Map<string, string>();
    for (const loc of locsFrom(got.buffer, url)) {
      if (!/\/products\//.test(loc) || /\/es-us\//i.test(loc)) continue;
      const handle = decodeURIComponent(loc.split('/products/')[1] ?? '').toLowerCase();
      if (!/t-?shirt|\btee\b/.test(handle)) continue;
      if (/women|long-sleeve|crop|tank|polo|hoodie|sweat|legging|bra\b|jacket|jogger|henley|sleeveless|base-layer/.test(handle)) continue;
      const style = handle.replace(/-(aw|ss)\d{2}$/g, '').replace(/-(black|white|navy|grey|gray|red|blue|green|brown|pink|purple|teal|orange|charcoal|onyx|marl|heather|washed|light|dark|smokey|core)(-[a-z0-9]+)*$/g, '');
      if (!styles.has(style)) styles.set(style, loc.split('?')[0]!);
    }
    return { urls: [...styles.values()], note: null, refused: false };
  }
  const url = 'https://www.nike.com/sitemap-v2-pdp-en-us.xml';
  const got = await fetchBuffer(url);
  if (got.refused) return { urls: [], note: `sitemap refused (HTTP ${got.status})`, refused: true };
  if (!got.buffer) return { urls: [], note: `sitemap not readable (HTTP ${got.status})`, refused: false };
  const styles = new Map<string, string>();
  const extras: string[] = [];
  for (const loc of locsFrom(got.buffer, url)) {
    if (!loc.includes('/t/')) continue;
    const slug = loc.split('/t/')[1] ?? '';
    if (!isMensSlug(slug) || !/t-shirt|tshirt/i.test(slug)) continue;
    if (/long-sleeve|sleeveless|tank|polo|henley|hoodie|sweatshirt|jersey/i.test(slug)) continue;
    const clean = loc.split('?')[0]!;
    if (/short-sleeve/i.test(slug)) {
      const style = nikeStyle(clean);
      if (!styles.has(style)) styles.set(style, clean);
    } else if (extras.length < 15 && !/baseball/i.test(slug)) {
      extras.push(clean);
    }
  }
  return { urls: [...styles.values(), ...extras], note: null, refused: false };
}

function productKey(brand: BrandId, url: string, title: string | null): string {
  if (brand === 'uniqlo') return uniqloCode(url) ?? url;
  // Nike style codes already group colorways. Gymshark colorways share a title.
  if (brand === 'nike') return nikeStyle(url).toLowerCase();
  return (title ?? url).toLowerCase();
}

async function screenBrand(brand: BrandId, urls: string[], done: Set<string>, maxOpen: number): Promise<{ refused: string | null; opened: number; keptRows: ProgressRow[] }> {
  const prior = latestByUrl(loadProgress()).filter((row) => row.brand === brand);
  let opened = prior.filter((row) => row.opened || row.reason === 'unavailable' || row.reason === 'refused').length;
  let kept = prior.filter((row) => row.kept).length;
  const seen = new Set(prior.filter((row) => row.kept && row.title).map((row) => productKey(brand, row.url, row.title)));
  const keptRows = prior.filter((row) => row.kept && row.scrapeStatus === null);
  let last = 0;
  let refused: string | null = null;
  for (const url of urls) {
    if (kept >= WANT || opened >= maxOpen) break;
    if (done.has(`${brand} ${url}`)) continue;
    const wait = last + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const result = await fetchStaticHtml(url);
    if (!('html' in result)) {
      const row: ProgressRow = {
        brand, url, at: new Date().toISOString(), opened: false, kept: false,
        reason: result.blocked ? 'refused' : 'unavailable',
        title: null, unisex: false, evidence: null, scrapeStatus: null, scrapeError: result.message, report: null, sizeChart: null,
      };
      await appendProgress(row);
      done.add(`${brand} ${url}`);
      opened++;
      console.log(`${brand} ${result.blocked ? 'REFUSED' : 'miss'} ${url} ${result.message}`);
      if (result.blocked) {
        refused = result.message;
        break;
      }
      continue;
    }
    const evidence = extractTeeEvidence(result.html);
    const decision: TeeDecision = classifyMensShortSleeveTee(evidence);
    const key = productKey(brand, url, evidence.title);
    let reason: ProgressRow['reason'] = decision.keep ? null : decision.reason;
    let keep = decision.keep;
    if (decision.keep && seen.has(key)) {
      keep = false;
      reason = 'duplicate';
    }
    const row: ProgressRow = {
      brand, url, at: new Date().toISOString(), opened: true, kept: keep, reason,
      title: evidence.title, unisex: decision.keep ? decision.unisex : false,
      evidence, scrapeStatus: null, scrapeError: null, report: null, sizeChart: null,
    };
    if (keep) {
      seen.add(key);
      kept++;
      keptRows.push(row);
    }
    await appendProgress(row);
    done.add(`${brand} ${url}`);
    opened++;
    console.log(`${brand} ${keep ? 'KEEP' : 'drop'} ${kept}/${WANT} opened ${opened} ${evidence.title ?? url} ${reason ?? ''}`);
  }
  return { refused, opened, keptRows };
}

interface ScrapeBody extends ScrapeResponseBody {
  report?: ProductFitReport;
  sizeChart?: SizeChartRow[];
}

let scrapeLock: Promise<void> = Promise.resolve();

async function scrapeKept(rows: ProgressRow[], baseUrl: string): Promise<void> {
  const pending = rows.filter((row) => row.kept && row.scrapeStatus === null);
  let refused = false;
  for (const row of pending) {
    if (refused) break;
    const run = scrapeLock.then(async () => {
      if (refused) return;
      const outcome = await postScrape(baseUrl, { url: row.url, commitToDb: true }, 180_000);
      const body = outcome.body as ScrapeBody | null;
      const error = body?.error ?? outcome.networkError;
      const blocked = Boolean(error && /refus|block page|does not allow automated/i.test(error));
      await appendProgress({
        ...row,
        at: new Date().toISOString(),
        scrapeStatus: outcome.status,
        scrapeError: error ?? null,
        report: body?.report ?? null,
        sizeChart: body?.sizeChart ?? null,
        kept: row.kept && !blocked,
        reason: blocked ? 'refused' : error && !body?.report && !(body?.sizeChart && body.sizeChart.length > 0) ? 'scrape error' : row.reason,
      });
      console.log(`scrape ${row.brand} ${outcome.status} reviews ${body?.report?.totalReviews ?? 0} chart ${body?.sizeChart?.length ?? 0} ${row.title ?? row.url}`);
      if (blocked) refused = true;
    });
    scrapeLock = run.then(() => {}, () => {});
    await run;
  }
}

function passedCheck(row: ProgressRow): boolean {
  if (!row.evidence || row.reason === 'duplicate' || row.reason === 'unavailable' || row.reason === 'refused') return false;
  return classifyMensShortSleeveTee(row.evidence).keep;
}

function rejectReason(row: ProgressRow): string | null {
  if (!row.opened || !row.evidence || row.reason === 'duplicate') return row.reason === 'unavailable' || row.reason === 'refused' ? row.reason : null;
  const decision = classifyMensShortSleeveTee(row.evidence);
  return decision.keep ? null : decision.reason;
}

function latestByUrl(rows: ProgressRow[]): ProgressRow[] {
  const map = new Map<string, ProgressRow>();
  for (const row of rows) map.set(`${row.brand} ${row.url}`, row);
  return [...map.values()];
}

function writeOutput(rows: ProgressRow[]): void {
  const latest = latestByUrl(rows);
  const brands: BrandId[] = ['uniqlo', 'gymshark', 'nike'];
  const names: Record<BrandId, string> = { uniqlo: 'Uniqlo', gymshark: 'Gymshark', nike: 'Nike' };
  const verification = brands.map((brand) => {
    const mine = latest.filter((row) => row.brand === brand);
    const kept = mine.filter((row) => passedCheck(row));
    const samples = kept.slice(0, 3).map((row) => ({ name: row.report?.name ?? row.title, url: row.report?.sourceUrl ?? row.url, unisex: row.unisex }));
    const rejectionReasons: Record<string, number> = {};
    for (const row of mine) {
      const reason = rejectReason(row);
      if (!reason || reason === 'duplicate' || reason === 'unavailable') continue;
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }
    return {
      brand: names[brand],
      blocked: mine.some((row) => row.reason === 'refused'),
      productsKept: kept.length,
      productsRejected: Object.values(rejectionReasons).reduce((sum, n) => sum + n, 0) - (rejectionReasons.refused ?? 0),
      duplicates: mine.filter((row) => row.reason === 'duplicate').length,
      unavailable: mine.filter((row) => row.reason === 'unavailable').length,
      rejectionReasons,
      samples,
    };
  });
  const skus: Record<string, unknown>[] = [];
  const metrics: Record<string, unknown>[] = [];
  const reviews: Record<string, unknown>[] = [];
  const charts: Record<string, unknown>[] = [];
  for (const row of latest) {
    if (!passedCheck(row)) continue;
    const report = row.report;
    if (!report) {
      const sku = row.brand === 'uniqlo' ? (uniqloCode(row.url) ?? row.url) : row.url;
      skus.push({
        sku,
        product_id: sku.toLowerCase(),
        brand: names[row.brand],
        product_name: row.title,
        category: inferCategory(...(row.evidence?.categories ?? []), row.title),
        retail_price: null,
        fabric_composition: null,
        total_reviews: 0,
        overall_fit_index: null,
        overall_verdict: null,
        grading_delta: null,
        runs_small_pct: null,
        true_to_size_pct: null,
        runs_large_pct: null,
        shrinkage_mention_pct: null,
        fabric_opacity_pct: null,
        sentiment_score: null,
        avg_rating: null,
        source_url: row.url,
        scraped_at: row.at,
        committed_at: null,
        unisex: row.unisex,
        scrape_error: row.scrapeError,
        check: row.evidence,
      });
      continue;
    }
    skus.push({
      sku: report.sku,
      product_id: report.id,
      brand: report.brand,
      product_name: report.name,
        category: inferCategory(...(row.evidence?.categories ?? []), report.name),
      retail_price: report.price,
      fabric_composition: report.fabricComposition,
      total_reviews: report.totalReviews,
      overall_fit_index: report.overallFitIndex,
      overall_verdict: report.overallVerdict,
      grading_delta: report.gradingDelta,
      runs_small_pct: report.overallDistribution.runsSmallPct,
      true_to_size_pct: report.overallDistribution.trueToSizePct,
      runs_large_pct: report.overallDistribution.runsLargePct,
      shrinkage_mention_pct: report.tshirtSignals.overallShrinkagePct,
      fabric_opacity_pct: report.tshirtSignals.fabricOpacityPct,
      sentiment_score: report.overallSentimentScore,
      avg_rating: report.overallAvgRating,
      source_url: report.sourceUrl,
      scraped_at: report.scraperTelemetry.scrapedAt,
      committed_at: report.committedToDbAt ?? null,
      unisex: row.unisex,
      check: row.evidence,
    });
    for (const size of report.sizeSummaries) {
      metrics.push({
        sku: report.sku,
        size_code: size.size,
        review_count: size.reviewCount,
        fit_skew: size.fitSkew,
        fit_verdict: size.verdict,
        runs_small_pct: size.runsSmallPct,
        true_to_size_pct: size.trueToSizePct,
        runs_large_pct: size.runsLargePct,
        shrinkage_pct: size.shrinkageMentionPct,
        sentiment_score: size.sentimentScore,
        avg_rating: size.avgRating,
        return_risk: size.returnRisk,
        primary_fit_note: size.primaryFitNote,
      });
    }
    report.reviews.forEach((review, index) => {
      reviews.push({
        review_uid: `${report.sku}::${index}::${review.id}`,
        sku: report.sku,
        size_code: review.normalizedSize,
        raw_size: review.sizePurchased,
        fit_direction: review.fitDirection,
        fit_skew: review.fitSkew,
        sentiment_score: review.sentimentScore,
        rating: review.rating,
        mentions_shrinkage: review.mentionsShrinkage ? 1 : 0,
        fabric_opacity: review.mentionsFabricOpacity,
        author: review.author,
        review_date: review.date,
        title: review.title,
        body: review.body,
      });
    });
    for (const chart of row.sizeChart ?? []) {
      charts.push({ sku: report.sku, size_code: chart.size, sort_order: chart.sortOrder, chest_cm: chart.chest_cm, length_cm: chart.length_cm, sleeve_cm: chart.sleeve_cm });
    }
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        engine: 'Pearfit Scraper Commercial Apparel Fit Database (SQLite3 + Deterministic NLP)',
        note: 'Adult men\'s short-sleeve t-shirts whose Supabase commercial_skus.category is "T-Shirts & Tops". Each product also passed the short-sleeve and adult men\'s check. Zara and Abercrombie & Fitch were not requested.',
        category: 'T-Shirts & Tops',
        notRequested: NOT_REQUESTED,
        verification,
        tables: { commercial_skus: skus, sku_size_metrics: metrics, sku_reviews: reviews, size_chart: charts },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${OUT} kept ${skus.length}`);
  console.log(JSON.stringify(verification, null, 2));
}

async function main(): Promise<void> {
  if (process.argv.includes('--write-only')) {
    writeOutput(loadProgress());
    return;
  }
  const progress = loadProgress();
  const done = new Set(progress.map((row) => `${row.brand} ${row.url}`));
  const caps: Record<BrandId, number> = { uniqlo: 1600, gymshark: 220, nike: 80 };
  const server = await startScraperServer({ blockSharedStore: true });
  try {
    await Promise.all(
      (['uniqlo', 'gymshark', 'nike'] as BrandId[]).map(async (brand) => {
        let candidates: { urls: string[]; note: string | null; refused: boolean };
        try {
          candidates = await candidateUrls(brand);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(`${brand} candidates failed: ${message}`);
          await appendProgress({
            brand, url: `sitemap:${brand}`, at: new Date().toISOString(), opened: false, kept: false, reason: 'unavailable',
            title: null, unisex: false, evidence: null, scrapeStatus: null, scrapeError: message, report: null, sizeChart: null,
          });
          return;
        }
        console.log(`${brand} candidates ${candidates.urls.length} ${candidates.note ?? ''}`);
        if (candidates.refused) {
          await appendProgress({
            brand, url: `sitemap:${brand}`, at: new Date().toISOString(), opened: false, kept: false, reason: 'refused',
            title: null, unisex: false, evidence: null, scrapeStatus: null, scrapeError: candidates.note, report: null, sizeChart: null,
          });
          return;
        }
        const result = await screenBrand(brand, candidates.urls, done, caps[brand]);
        console.log(`${brand} screen done opened ${result.opened} kept ${result.keptRows.length} refused ${result.refused ?? 'no'}`);
        await scrapeKept(result.keptRows, server.baseUrl);
      }),
    );
  } finally {
    await server.stop();
  }
  writeOutput(loadProgress());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
