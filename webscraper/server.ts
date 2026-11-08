import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import {
  aggregateProductFitReport,
  generateSqlInsertDump,
  parseRawReviewBatch,
  type DumpSizeChartRow,
  type ProductFitReport,
  type RawScrapedReview,
  type ScraperTelemetry,
} from './fitAnalyzer.ts';
import { HM_HEAVYWEIGHT_TEE_REVIEWS } from './seedCatalog.ts';
import {
  extractSizeFromReviewText,
  extractStructuredProduct,
  parseJsonLdScripts,
} from './structuredData.ts';
import { closeHeadlessBrowser, renderPageHtml, REVIEW_CARD_SELECTOR, shouldUseHeadlessRender } from './headlessFetch.ts';
import { parseSizeChart, type SizeChartRow } from './sizeChart.ts';
import {
  cleanProductTitle,
  labelledValue,
  leafTexts,
  LABEL_LINE,
  longestFreeText,
  productIdFromUrl,
  ratingFromLabel,
  ratingFromStarIcons,
} from './pageHelpers.ts';
import { checkFitStore, deleteRemoteFitSku, listRemoteFitSkus, pushFitReports, type SupabaseSync } from './supabaseFit.ts';
import { blockedFetchTargetResolved } from './publicUrl.ts';

function serverDir(): string {
  // The Vercel bundle is CommonJS, where import.meta.url is empty. Skip it there.
  if (process.env.VERCEL) return path.join(process.cwd(), 'api', 'scraper');
  return path.dirname(fileURLToPath(import.meta.url));
}

function loadEnvFiles() {
  const dirs = [serverDir(), path.join(process.cwd(), 'webscraper'), path.join(process.cwd(), 'api', 'scraper')];
  for (const name of ['.env.local', '.env', '.env.example']) {
    for (const dir of dirs) {
      dotenv.config({ path: path.join(dir, name) });
    }
  }
}
loadEnvFiles();

// Local clones keep the database next to the server. Vercel can only write to /tmp,
// and that copy disappears when the function instance goes away. Fit numbers still go to Supabase.
const dbPath = process.env.VERCEL ? '/tmp/commercial_fit.db' : path.join(serverDir(), 'commercial_fit.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS commercial_skus (
    sku TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    brand TEXT NOT NULL,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    retail_price TEXT,
    fabric_composition TEXT,
    total_reviews INTEGER NOT NULL,
    overall_fit_index REAL NOT NULL,
    overall_verdict TEXT NOT NULL,
    grading_delta REAL NOT NULL,
    runs_small_pct INTEGER NOT NULL,
    true_to_size_pct INTEGER NOT NULL,
    runs_large_pct INTEGER NOT NULL,
    shrinkage_mention_pct INTEGER NOT NULL,
    fabric_opacity_pct INTEGER,
    sentiment_score INTEGER NOT NULL,
    avg_rating REAL NOT NULL,
    source_url TEXT,
    scraped_at TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    report_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sku_size_metrics (
    sku TEXT NOT NULL,
    size_code TEXT NOT NULL,
    review_count INTEGER NOT NULL,
    fit_skew REAL NOT NULL,
    fit_verdict TEXT NOT NULL,
    runs_small_pct INTEGER NOT NULL,
    true_to_size_pct INTEGER NOT NULL,
    runs_large_pct INTEGER NOT NULL,
    shrinkage_pct INTEGER NOT NULL,
    sentiment_score INTEGER NOT NULL,
    avg_rating REAL NOT NULL,
    return_risk TEXT NOT NULL,
    primary_fit_note TEXT,
    PRIMARY KEY (sku, size_code)
  );

  CREATE TABLE IF NOT EXISTS sku_reviews (
    review_uid TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    size_code TEXT NOT NULL,
    raw_size TEXT NOT NULL,
    fit_direction TEXT NOT NULL,
    fit_skew REAL NOT NULL,
    sentiment_score INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    mentions_shrinkage INTEGER NOT NULL,
    fabric_opacity TEXT,
    author TEXT,
    review_date TEXT,
    title TEXT,
    body TEXT
  );

  CREATE TABLE IF NOT EXISTS ingestion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    action TEXT NOT NULL,
    rows_affected INTEGER NOT NULL,
    committed_at TEXT NOT NULL
  );

  -- Flat-lay cm per SKU and size, filled from the brand chart on the product page.
  -- chest_cm is pit-to-pit. A cell the chart does not state is NULL, never 0.
  -- The same rows are sent to Supabase sku_size_chart. sort_order runs smallest to largest.
  CREATE TABLE IF NOT EXISTS size_chart (
    sku TEXT NOT NULL,
    size_code TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    chest_cm REAL,
    length_cm REAL,
    sleeve_cm REAL,
    PRIMARY KEY (sku, size_code)
  );

  -- Per-brand correction for length/sleeve: offset = hand-measured - chart at a known size.
  -- NULL or no row = convention unconfirmed, so the engine export leaves that dimension null.
  CREATE TABLE IF NOT EXISTS brand_offsets (
    brand TEXT PRIMARY KEY,
    length_cm REAL,
    sleeve_cm REAL
  );
`);

// Databases created when fabric_opacity_pct was NOT NULL cannot store "not stated".
const opacityColumn = (
  db.prepare(`PRAGMA table_info(commercial_skus)`).all() as { name: string; notnull: number }[]
).find((column) => column.name === 'fabric_opacity_pct');
if (opacityColumn?.notnull === 1) {
  db.exec(`
    BEGIN;
    CREATE TABLE commercial_skus__opacity (
      sku TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      product_name TEXT NOT NULL,
      category TEXT NOT NULL,
      retail_price TEXT,
      fabric_composition TEXT,
      total_reviews INTEGER NOT NULL,
      overall_fit_index REAL NOT NULL,
      overall_verdict TEXT NOT NULL,
      grading_delta REAL NOT NULL,
      runs_small_pct INTEGER NOT NULL,
      true_to_size_pct INTEGER NOT NULL,
      runs_large_pct INTEGER NOT NULL,
      shrinkage_mention_pct INTEGER NOT NULL,
      fabric_opacity_pct INTEGER,
      sentiment_score INTEGER NOT NULL,
      avg_rating REAL NOT NULL,
      source_url TEXT,
      scraped_at TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      report_json TEXT NOT NULL
    );
    INSERT INTO commercial_skus__opacity (
      sku, product_id, brand, product_name, category, retail_price, fabric_composition,
      total_reviews, overall_fit_index, overall_verdict, grading_delta,
      runs_small_pct, true_to_size_pct, runs_large_pct,
      shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating,
      source_url, scraped_at, committed_at, report_json
    )
    SELECT
      sku, product_id, brand, product_name, category, retail_price, fabric_composition,
      total_reviews, overall_fit_index, overall_verdict, grading_delta,
      runs_small_pct, true_to_size_pct, runs_large_pct,
      shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating,
      source_url, scraped_at, committed_at, report_json
    FROM commercial_skus;
    DROP TABLE commercial_skus;
    ALTER TABLE commercial_skus__opacity RENAME TO commercial_skus;
    COMMIT;
  `);
}

const upsertReportTransaction = db.transaction((report: ProductFitReport) => {
  const nowIso = new Date().toISOString();
  report.committedToDbAt = nowIso;

  db.prepare(`
    INSERT OR REPLACE INTO commercial_skus (
      sku, product_id, brand, product_name, category, retail_price, fabric_composition,
      total_reviews, overall_fit_index, overall_verdict, grading_delta,
      runs_small_pct, true_to_size_pct, runs_large_pct,
      shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating,
      source_url, scraped_at, committed_at, report_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.sku,
    report.id,
    report.brand,
    report.name,
    report.category,
    report.price,
    report.fabricComposition,
    report.totalReviews,
    report.overallFitIndex,
    report.overallVerdict,
    report.gradingDelta,
    report.overallDistribution.runsSmallPct,
    report.overallDistribution.trueToSizePct,
    report.overallDistribution.runsLargePct,
    report.tshirtSignals.overallShrinkagePct,
    report.tshirtSignals.fabricOpacityPct,
    report.overallSentimentScore,
    report.overallAvgRating,
    report.sourceUrl,
    report.scraperTelemetry.scrapedAt,
    nowIso,
    JSON.stringify(report)
  );

  db.prepare(`DELETE FROM sku_size_metrics WHERE sku = ?`).run(report.sku);
  const insertSizeStmt = db.prepare(`
    INSERT INTO sku_size_metrics (
      sku, size_code, review_count, fit_skew, fit_verdict,
      runs_small_pct, true_to_size_pct, runs_large_pct,
      shrinkage_pct, sentiment_score, avg_rating, return_risk, primary_fit_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of report.sizeSummaries) {
    insertSizeStmt.run(
      report.sku,
      s.size,
      s.reviewCount,
      s.fitSkew,
      s.verdict,
      s.runsSmallPct,
      s.trueToSizePct,
      s.runsLargePct,
      s.shrinkageMentionPct,
      s.sentimentScore,
      s.avgRating,
      s.returnRisk,
      s.primaryFitNote
    );
  }

  db.prepare(`DELETE FROM sku_reviews WHERE sku = ?`).run(report.sku);
  const insertReviewStmt = db.prepare(`
    INSERT INTO sku_reviews (
      review_uid, sku, size_code, raw_size, fit_direction, fit_skew,
      sentiment_score, rating, mentions_shrinkage, fabric_opacity,
      author, review_date, title, body
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  report.reviews.forEach((r, index) => {
    insertReviewStmt.run(
      `${report.sku}::${index}::${r.id}`,
      report.sku,
      r.normalizedSize ?? 'UNKNOWN',
      r.sizePurchased,
      r.fitDirection,
      r.fitSkew,
      r.sentimentScore,
      r.rating,
      r.mentionsShrinkage ? 1 : 0,
      r.mentionsFabricOpacity || 'unspecified',
      r.author,
      r.date,
      r.title,
      r.body
    );
  });

  const totalRows = 1 + report.sizeSummaries.length + report.reviews.length;
  db.prepare(`
    INSERT INTO ingestion_log (sku, product_name, action, rows_affected, committed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(report.sku, report.name, 'UPSERT_COMMIT', totalRows, nowIso);
});

function loadSizeChart(sku: string): SizeChartRow[] {
  const rows = db
    .prepare(
      `SELECT size_code, sort_order, chest_cm, length_cm, sleeve_cm
       FROM size_chart WHERE sku = ? ORDER BY sort_order`,
    )
    .all(sku) as {
    size_code: string;
    sort_order: number;
    chest_cm: number | null;
    length_cm: number | null;
    sleeve_cm: number | null;
  }[];
  return rows.map((row) => ({
    size: row.size_code,
    sortOrder: row.sort_order,
    chest_cm: row.chest_cm,
    length_cm: row.length_cm,
    sleeve_cm: row.sleeve_cm,
  }));
}

function chartsBySku(reports: ProductFitReport[]): Record<string, SizeChartRow[]> {
  const charts: Record<string, SizeChartRow[]> = {};
  for (const report of reports) charts[report.sku] = loadSizeChart(report.sku);
  return charts;
}

function saveSizeChart(sku: string, rows: SizeChartRow[]) {
  if (rows.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO size_chart (sku, size_code, sort_order, chest_cm, length_cm, sleeve_cm)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const write = db.transaction(() => {
    db.prepare(`DELETE FROM size_chart WHERE sku = ?`).run(sku);
    for (const row of rows) {
      insert.run(sku, row.size, row.sortOrder, row.chest_cm, row.length_cm, row.sleeve_cm);
    }
  });
  write();
}

interface MockStoreProduct {
  slug: string;
  name: string;
  brand: string;
  category: ProductFitReport['category'];
  sku: string;
  price: string;
  fabricComposition: string;
  reviews: RawScrapedReview[];
}

const MOCK_STORE_PRODUCTS: Record<string, MockStoreProduct> = {
  'hm-heavyweight-relaxed-tee': {
    slug: 'hm-heavyweight-relaxed-tee',
    name: 'H&M Relaxed Fit Heavyweight Cotton T-Shirt',
    brand: 'H&M (Blank Staples)',
    category: 'T-Shirts & Tops',
    sku: 'HM-1096385-WHT',
    price: '$19.99',
    fabricComposition: '100% Heavyweight Carded Cotton Jersey (240 GSM · Non-Sheer Opaque Knit)',
    reviews: HM_HEAVYWEIGHT_TEE_REVIEWS,
  },
  'hm-regular-fit-crew-tee': {
    slug: 'hm-regular-fit-crew-tee',
    name: 'H&M Regular Fit Crew-Neck Cotton Tee',
    brand: 'H&M Divided',
    category: 'T-Shirts & Tops',
    sku: 'HM-0685816-BLK',
    price: '$9.99',
    fabricComposition: '100% Lightweight Combed Cotton Jersey (160 GSM)',
    reviews: [
      {
        id: 'hmr-1',
        author: 'Kevin T.',
        sizePurchased: 'XS',
        rating: 4,
        title: 'Slimmer cut than Blank Staples',
        body: 'True to size in XS for a close standard fit, though the 160 gsm lightweight fabric is much thinner and slightly sheer in white.',
        date: '2026-10-28',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'hmr-2',
        author: 'Leo P.',
        sizePurchased: 'S',
        rating: 3,
        title: 'Shrunk a full size after first wash',
        body: 'Runs small after the first wash! Shrunk in both chest width and torso length in the dryer. Definitely size up.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-3',
        author: 'Samir B.',
        sizePurchased: 'S',
        rating: 3,
        title: 'Snug shoulders and thin jersey',
        body: 'Smaller than expected across the shoulders and sleeves. Paper-thin fabric compared to the heavyweight tee.',
        date: '2026-10-22',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-4',
        author: 'Andre M.',
        sizePurchased: 'M',
        rating: 2,
        title: 'Runs small and tight in the chest',
        body: 'Runs very small in size M! Tight across the chest and armholes, and shrank in length after washing. Order a size larger.',
        date: '2026-10-27',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-5',
        author: 'Jason K.',
        sizePurchased: 'M',
        rating: 3,
        title: 'Clings to midsection',
        body: 'Runs small through the waist and chest. Lightweight jersey shows everything and is slightly see-through.',
        date: '2026-10-19',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-6',
        author: 'Ryan D.',
        sizePurchased: 'L',
        rating: 2,
        title: 'L fits like a tight Medium after wash',
        body: 'Runs small! Shrunk in the dryer and now it is way too tight in the shoulders and short in the torso.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-7',
        author: 'Carter W.',
        sizePurchased: 'L',
        rating: 4,
        title: 'Sized up to L from M',
        body: 'Ordered a size up to L because H&M regular fit tees run small and shrink. Fits fine in the chest if you hang dry.',
        date: '2026-10-16',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-8',
        author: 'Nate H.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'Narrow shoulders and short sleeves in XL',
        body: 'Runs very small in XL. Way too tight across the upper back and shoulders, and thin sheer cotton.',
        date: '2026-10-24',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-9',
        author: 'Paul G.',
        sizePurchased: 'XXL',
        rating: 2,
        title: 'XXL is tight in the waist and short',
        body: 'Runs small in XXL! Tight around the midsection and shrunk in torso length after the first wash.',
        date: '2026-10-20',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
    ],
  },
  'solaris-linen-shirt': {
    slug: 'solaris-linen-shirt',
    name: 'Solaris Relaxed Belgian Linen Camp Shirt',
    brand: 'Atelier Côte',
    category: 'Shirting',
    sku: 'ATC-312-SND',
    price: '$165',
    fabricComposition: '100% Yarn-Dyed Belgian Flax Linen (195 gsm, Enzyme Washed)',
    reviews: [
      {
        id: 'sls-1',
        author: 'Henri L.',
        sizePurchased: 'XS',
        rating: 5,
        title: 'Breezy resort cut in XS',
        body: 'Runs large with a generous cut across the shoulders and chest. Great drape for summer wear.',
        date: '2026-10-24',
        verifiedPurchase: true,
        reviewerHeight: '5\'7"',
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-2',
        author: 'Matteo G.',
        sizePurchased: 'XS',
        rating: 4,
        title: 'Roomy sleeves and body',
        body: 'Bigger than expected in XS. Loose around the waist and wide sleeves, size down if between sizes.',
        date: '2026-10-19',
        verifiedPurchase: true,
        reviewerHeight: '5\'6"',
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-3',
        author: 'Sebastian V.',
        sizePurchased: 'S',
        rating: 5,
        title: 'Sized down to S from M — spot on',
        body: 'Runs large so I ordered a size down to S. Fits perfectly in the shoulders and chest now!',
        date: '2026-10-22',
        verifiedPurchase: true,
        reviewerHeight: '5\'9"',
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-4',
        author: 'Oliver W.',
        sizePurchased: 'S',
        rating: 4,
        title: 'Very relaxed boxy camp collar',
        body: 'Runs large through the waist and chest. Breathable linen fabric.',
        date: '2026-10-15',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-5',
        author: 'Adrian K.',
        sizePurchased: 'M',
        rating: 4,
        title: 'Generous sizing in M',
        body: 'Runs large! Loose in the waist and wide in the sleeves. Definitely a resort oversized fit.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-6',
        author: 'Felix N.',
        sizePurchased: 'M',
        rating: 5,
        title: 'True to camp shirt proportions',
        body: 'True to size if you like a relaxed coastal drape in the chest and shoulders.',
        date: '2026-10-12',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'sls-7',
        author: 'Damian R.',
        sizePurchased: 'L',
        rating: 3,
        title: 'Way too baggy in the midsection',
        body: 'Runs very large in size L. Swimming in it around the waist and chest. Size down one full size.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-8',
        author: 'Jonah P.',
        sizePurchased: 'L',
        rating: 4,
        title: 'Wide shoulders and long sleeves',
        body: 'Bigger than expected in the shoulders and sleeves. Super soft linen though.',
        date: '2026-10-17',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-9',
        author: 'Marcus B.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'Like a sail in XL',
        body: 'Runs extremely large! Way too boxy in the waist and hips, and sleeves reach past my elbows. Returning for L.',
        date: '2026-10-27',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-10',
        author: 'Grant T.',
        sizePurchased: 'XL',
        rating: 3,
        title: 'Excess fabric at waist and back',
        body: 'Runs large and loose around the waist and chest. Size down.',
        date: '2026-10-14',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-11',
        author: 'Winston H.',
        sizePurchased: 'XXL',
        rating: 3,
        title: 'Very wide cut in XXL',
        body: 'Runs large with overly wide chest and waist proportions. Order a size smaller.',
        date: '2026-10-20',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
    ],
  },
  'corsa-sculpt-midi-dress': {
    slug: 'corsa-sculpt-midi-dress',
    name: 'Corsa Compression Rib Sculpt Midi Dress',
    brand: 'Studio Veloce',
    category: 'Dresses',
    sku: 'STV-904-BLK',
    price: '$245',
    fabricComposition: '78% Viscose Compact Rib, 22% High-Recovery Polyamide',
    reviews: [
      {
        id: 'cmd-1',
        author: 'Elena V.',
        sizePurchased: 'XS',
        rating: 4,
        title: 'Snug compression fit in XS',
        body: 'Runs small with strong compression in the waist and bust, but flattering if you like a sculpted look.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-2',
        author: 'Aria M.',
        sizePurchased: 'S',
        rating: 3,
        title: 'Very tight through ribcage and bust',
        body: 'Runs small! Way too tight in the chest and waist. Definitely size up if you want to breathe.',
        date: '2026-10-23',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-3',
        author: 'Nina C.',
        sizePurchased: 'S',
        rating: 5,
        title: 'Sized up to S from XS',
        body: 'Ordered a size up to S because it runs small. Now the hips and waist fit like a glove!',
        date: '2026-10-18',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-4',
        author: 'tessa_k',
        sizePurchased: 'M',
        rating: 2,
        title: 'Constricting in the hips and shoulders',
        body: 'Runs very small in size M. Pulls at the hips and tight across the shoulders and armholes. Returning to size up.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-5',
        author: 'Jade R.',
        sizePurchased: 'M',
        rating: 3,
        title: 'Smaller than expected',
        body: 'Smaller than expected around the waist and bust. Heavyweight rib has less stretch than anticipated.',
        date: '2026-10-16',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-6',
        author: 'Sophia L.',
        sizePurchased: 'L',
        rating: 2,
        title: 'L fits like a tight Small/Medium',
        body: 'Runs extremely small! Couldn’t get it over my shoulders comfortably and way too tight in the hips and waist.',
        date: '2026-10-27',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-7',
        author: 'Lauren B.',
        sizePurchased: 'L',
        rating: 3,
        title: 'Size up at least one size',
        body: 'Runs small through the bust, waist, and hips. Order a size larger.',
        date: '2026-10-19',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-8',
        author: 'Vanessa D.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'Unwearably tight in XL',
        body: 'Runs very small in XL. Way too tight in the chest, waist, and sleeves. Disappointed and returning.',
        date: '2026-10-24',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-9',
        author: 'Keira P.',
        sizePurchased: 'XXL',
        rating: 3,
        title: 'XXL works if you are normally L/XL',
        body: 'Runs small across the hips and bust, so sizing up to XXL was necessary for a comfortable drape.',
        date: '2026-10-14',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
    ],
  },
  'nordic-boiled-wool-overshirt': {
    slug: 'nordic-boiled-wool-overshirt',
    name: 'Nordic Boiled Wool Structured Overshirt',
    brand: 'Fjord & Loom',
    category: 'Outerwear',
    sku: 'FJL-508-GRY',
    price: '$275',
    fabricComposition: '100% Norwegian Felted Boiled Virgin Wool (420 gsm)',
    reviews: [
      {
        id: 'nwo-1',
        author: 'Soren A.',
        sizePurchased: 'XS',
        rating: 5,
        title: 'True to size Scandinavian tailoring',
        body: 'True to size in XS! Fits perfectly across the shoulders and torso length.',
        date: '2026-10-22',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'nwo-2',
        author: 'Freja M.',
        sizePurchased: 'S',
        rating: 5,
        title: 'Fits just right in S',
        body: 'Fits just right in the chest, shoulders, and sleeves. Warm boiled wool without bulk.',
        date: '2026-10-20',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'nwo-3',
        author: 'Lukas E.',
        sizePurchased: 'M',
        rating: 5,
        title: 'Exact usual size M',
        body: 'True to size and fits like a glove over a light knit. Shoulders and waist are balanced.',
        date: '2026-10-18',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'nwo-4',
        author: 'Henrik B.',
        sizePurchased: 'L',
        rating: 3,
        title: 'Runs small in L across upper back',
        body: 'Runs small in size L! Tight across the shoulders and sleeves have zero stretch. Size up if layering.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'nwo-5',
        author: 'Magnus T.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'XL chest and cuffs are way too tight',
        body: 'Runs very small in XL. Pulls at the chest buttons and tight in the shoulders and forearms. Returning.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'nwo-6',
        author: 'Anders K.',
        sizePurchased: 'XXL',
        rating: 2,
        title: 'XXL grading is narrow in shoulders',
        body: 'Runs small! Smaller than expected in the shoulders, chest, and sleeve length for XXL. Size up.',
        date: '2026-10-24',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
    ],
  },
};

function renderMockStoreHtml(product: MockStoreProduct): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    brand: { '@type': 'Brand', name: product.brand },
    sku: product.sku,
    category: product.category,
  };

  const reviewHtml = product.reviews
    .map(
      (r) => `
      <article class="review-card" data-review-card="true" data-size="${r.sizePurchased}" data-rating="${r.rating}" data-fit="${r.declaredFitTag || ''}" data-author="${r.author}" data-date="${r.date}">
        <header>
          <span class="review-author">${r.author}</span>
          <span class="review-size-tag">Size Purchased: <strong>${r.sizePurchased}</strong></span>
          <span class="review-rating">${r.rating}/5 Stars</span>
          ${r.declaredFitTag ? `<span class="review-fit-tag">Fit: ${r.declaredFitTag}</span>` : ''}
        </header>
        <h4 class="review-title">${r.title}</h4>
        <p class="review-body-copy">${r.body}</p>
      </article>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${product.name} | ${product.brand}</title>
  <meta property="og:title" content="${product.name}" />
  <meta name="product:brand" content="${product.brand}" />
  <meta name="product:category" content="${product.category}" />
  <meta name="product:sku" content="${product.sku}" />
  <meta name="product:price" content="${product.price}" />
  <meta name="product:fabric" content="${product.fabricComposition}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <main data-product-container>
    <h1 class="product-title">${product.name}</h1>
    <p class="product-brand">${product.brand}</p>
    <p class="product-specs" data-fabric="${product.fabricComposition}" data-price="${product.price}" data-sku="${product.sku}">${product.fabricComposition}</p>
    <section id="customer-reviews" data-reviews-section>
      <h2>Verified Customer Fit Reviews (${product.reviews.length})</h2>
      ${reviewHtml}
    </section>
  </main>
</body>
</html>`;
}

/** Stable short hash so the same URL always gets the same fallback SKU. */
function stableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase();
}

const VALID_CATEGORIES: ProductFitReport['category'][] = [
  'T-Shirts & Tops',
  'Outerwear',
  'Knitwear',
  'Trousers',
  'Fleece & Hoodies',
  'Shirting',
  'Dresses',
];

/** Maps a free-text category/product name onto the app's fixed category list. */
function inferCategory(...hints: (string | null | undefined)[]): ProductFitReport['category'] {
  for (const hint of hints) {
    if (!hint) continue;
    const exact = VALID_CATEGORIES.find((c) => c.toLowerCase() === hint.toLowerCase());
    if (exact) return exact;
    const h = hint.toLowerCase();
    if (/hoodie|sweatshirt|fleece|crewneck sweat/.test(h)) return 'Fleece & Hoodies';
    if (/jacket|coat|parka|puffer|blazer|outerwear|anorak|vest/.test(h)) return 'Outerwear';
    if (/sweater|knit|cardigan|jumper|pullover/.test(h)) return 'Knitwear';
    if (/trouser|pant|jean|chino|short|legging|jogger/.test(h)) return 'Trousers';
    if (/dress|skirt/.test(h)) return 'Dresses';
    if (/oxford|button[- ]?(down|up)|shirt(?!s? ?&)|flannel|overshirt/.test(h) && !/t-?shirt|tee/.test(h)) return 'Shirting';
    if (/t-?shirt|tee|tank|top|polo|henley/.test(h)) return 'T-Shirts & Tops';
  }
  return 'T-Shirts & Tops';
}

function looksLikeFullHtmlDocument(input: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]/i.test(input.slice(0, 5000));
}

/** JSON-LD stays the base. DOM cards fill a blank size and add reviews that were not in the script. */
function mergeScrapedReviews(primary: RawScrapedReview[], extra: RawScrapedReview[]): RawScrapedReview[] {
  const norm = (body: string) => body.replace(/\s+/g, ' ').trim().toLowerCase();
  const merged = primary.map((review) => ({ ...review }));
  const index = new Map<string, RawScrapedReview>();
  for (const review of merged) {
    const key = norm(review.body);
    if (key && !index.has(key)) index.set(key, review);
  }
  for (const review of extra) {
    const key = norm(review.body);
    const existing = key ? index.get(key) : undefined;
    if (!existing) {
      merged.push(review);
      if (key) index.set(key, review);
      continue;
    }
    if (!existing.sizePurchased && review.sizePurchased) existing.sizePurchased = review.sizePurchased;
    if (!existing.declaredFitTag && review.declaredFitTag) existing.declaredFitTag = review.declaredFitTag;
    if (!existing.date && review.date) existing.date = review.date;
    if ((!existing.author || existing.author === 'Anonymous') && review.author && review.author !== 'Anonymous') {
      existing.author = review.author;
    }
    if (!existing.usualSize && review.usualSize) existing.usualSize = review.usualSize;
  }
  return merged;
}

function chartRowsFromClient(value: unknown): SizeChartRow[] {
  if (!Array.isArray(value)) return [];
  const rows: SizeChartRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.size !== 'string' || !row.size.trim()) continue;
    const measurement = (field: unknown) => (typeof field === 'number' && Number.isFinite(field) ? field : null);
    rows.push({
      size: row.size.trim(),
      sortOrder: typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) ? row.sortOrder : rows.length,
      chest_cm: measurement(row.chest_cm),
      length_cm: measurement(row.length_cm),
      sleeve_cm: measurement(row.sleeve_cm),
    });
  }
  return rows;
}

function scrapeHtmlWithCheerio(
  html: string,
  sourceUrl: string,
  overrides?: {
    productName?: string;
    brand?: string;
    sku?: string;
    category?: ProductFitReport['category'];
  }
) {
  const startTime = Date.now();
  const $ = cheerio.load(html);
  const domNodesScanned = $('*').length;
  const selectorsUsed: string[] = [];

  // 1. schema.org JSON-LD: the most reliable source on real storefronts.
  const jsonLdScripts = $('script[type="application/ld+json"]')
    .map((_i, el) => $(el).contents().text())
    .get();
  const structured = extractStructuredProduct(parseJsonLdScripts(jsonLdScripts));
  if (structured) selectorsUsed.push('script[type="application/ld+json"] Product');

  const meta = (selector: string) => $(selector).attr('content')?.trim() || null;
  const firstText = (selector: string) => $(selector).first().text().replace(/\s+/g, ' ').trim() || null;

  const extractedName =
    overrides?.productName ||
    structured?.name ||
    cleanProductTitle(meta('meta[property="og:title"]')) ||
    firstText('h1.product-title') ||
    cleanProductTitle($('title').first().text()) ||
    firstText('h1') ||
    'Unknown product';

  const extractedBrand =
    overrides?.brand ||
    structured?.brand ||
    meta('meta[name="product:brand"]') ||
    meta('meta[property="product:brand"]') ||
    meta('meta[property="og:site_name"]') ||
    firstText('.product-brand') ||
    'Unknown brand';

  const category =
    overrides?.category ||
    inferCategory(
      meta('meta[name="product:category"]'),
      meta('meta[property="product:category"]'),
      structured?.category,
      extractedName
    );

  const sku =
    overrides?.sku ||
    structured?.sku ||
    meta('meta[name="product:sku"]') ||
    meta('meta[property="product:retailer_item_id"]') ||
    $('[data-sku]').attr('data-sku') ||
    // No SKU on the page: derive a stable id from the URL so re-scrapes update the same row.
    productIdFromUrl(sourceUrl) ||
    `URL-${stableHash(sourceUrl)}`;

  const priceAmount = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]');
  const priceCurrency = meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]');
  const price =
    structured?.price ||
    meta('meta[name="product:price"]') ||
    (priceAmount ? [priceAmount, priceCurrency].filter(Boolean).join(' ') : null) ||
    $('[data-price]').attr('data-price') ||
    'Unknown';

  const fabricComposition =
    structured?.material ||
    meta('meta[name="product:fabric"]') ||
    $('[data-fabric]').attr('data-fabric') ||
    'Unknown';

  const domReviews: RawScrapedReview[] = [];

  // 2. Review cards in the DOM (microdata and common review-widget markup).
  // JSON-LD often carries only a few reviews. The cards on the page are still read.
  {
    const reviewElements = $(REVIEW_CARD_SELECTOR);
    if (reviewElements.length > 0) {
      selectorsUsed.push('review-card DOM selectors');
      reviewElements.each((idx, el) => {
        const node = $(el);
        // Skip wrappers that contain another matched card (avoids double counting).
        if (node.find(REVIEW_CARD_SELECTOR).length > 0) return;
        const nodeText = node.text().replace(/\s+/g, ' ').trim();
        const lines = leafTexts($, node);

        const isDate = (l: string) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{4}-\d{2}-\d{2}$/.test(l);
        const author =
          node.attr('data-author') ||
          node.attr('data-reviewer') ||
          node.find('[itemprop="author"]').first().text().trim() ||
          node.find('[class*="reviewer-name"], .review-author, [class*="review-author"], .jdgm-rev__author, .yotpo-user-name, [class*="reviewUserInfo"] > :first-child, [class*="user-info" i] > :first-child').first().text().replace(/^[\s\u2014-]+/, '').trim() ||
          'Anonymous';
        const body =
          node.find('[itemprop="reviewBody"], .review-body-copy, [class*="review-body"], [class*="review-content"], [class*="review-text"], .jdgm-rev__body, .bv-content-summary-body-text, .pr-rd-description-text').first().text().replace(/\s+/g, ' ').trim() ||
          longestFreeText(lines, [author]) ||
          nodeText;
        // Unlabelled markup: the first short free-text line before the body is the title.
        const title =
          node.find('[itemprop="name"], [class*="review-title"], h3, h4').first().text().replace(/\s+/g, ' ').trim() ||
          lines.slice(0, Math.max(0, lines.indexOf(body))).find(
            (l) => l !== author && l.length <= 150 && !LABEL_LINE.test(l) && !isDate(l)
          ) ||
          '';
        const sizePurchased =
          node.attr('data-size') ||
          node.find('.review-size-tag strong').text().trim() ||
          labelledValue(lines, /^(purchased size|size purchased|size ordered|size bought|size)$/i) ||
          nodeText.match(/Size(?:\s+(?:Purchased|Ordered|Bought))?:\s*([A-Za-z0-9]+)/i)?.[1] ||
          extractSizeFromReviewText(body);
        const ratingStr =
          node.attr('data-rating') ||
          node.find('[itemprop="ratingValue"]').attr('content') ||
          node.find('[itemprop="ratingValue"]').text().trim() ||
          node.find('[data-score]').attr('data-score') ||
          node.find('.review-rating').text().match(/(\d(?:\.\d)?)/)?.[1] ||
          // Accessible star widgets: aria-label/title like "4 out of 5 stars".
          ratingFromLabel(node.find('[aria-label*="out of 5" i], [title*="out of 5" i]').first().attr('aria-label') ?? node.find('[title*="out of 5" i]').first().attr('title')) ||
          ratingFromStarIcons($, node) ||
          '';
        const declaredFitTag =
          node.attr('data-fit') ||
          node.find('.review-fit-tag').text().replace(/^Fit:\s*/i, '').trim() ||
          labelledValue(lines, /^(how it fits|fit|overall fit|sizing)$/i) ||
          undefined;
        const date =
          node.attr('data-date') ||
          node.find('[itemprop="datePublished"]').attr('content') ||
          node.find('time').attr('datetime') ||
          lines.find(isDate) ||
          '';
        const reviewerHeight = labelledValue(lines, /^height$/i) || undefined;
        const reviewerBuild = labelledValue(lines, /^(weight|body type|build)$/i) || undefined;
        const usualSize = labelledValue(lines, /^(usual size|normally wears|usually wears)$/i) || undefined;
        const parsedRating = parseFloat(ratingStr);

        if (body.length > 8) {
          domReviews.push({
            id: `dom-rev-${idx + 1}`,
            author,
            sizePurchased,
            usualSize,
            // 3 = neutral midpoint when the card shows no rating.
            rating: Number.isFinite(parsedRating) ? Math.min(5, Math.max(1, Math.round(parsedRating))) : 3,
            title,
            body,
            date,
            verifiedPurchase: false,
            reviewerHeight,
            reviewerBuild,
            declaredFitTag,
          });
        }
      });
    }
  }

  const reviews = mergeScrapedReviews(structured?.reviews ?? [], domReviews);

  // 3. Free-text fallback, only for pasted review text/snippets. On a full fetched page it
  // would treat navigation and footer text as "reviews".
  if (reviews.length === 0 && !looksLikeFullHtmlDocument(html)) {
    selectorsUsed.push('fallback-text-blocks');
    reviews.push(...parseRawReviewBatch(html));
  }

  const parseDurationMs = Date.now() - startTime;

  return {
    meta: {
      id: sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: extractedName,
      brand: extractedBrand,
      category,
      sku,
      price,
      fabricComposition,
      sourceUrl,
      scraperTelemetry: {
        sourceUrl,
        scrapedAt: new Date().toISOString(),
        domNodesScanned,
        reviewNodesMatched: reviews.length,
        selectorsUsed,
        parseDurationMs,
        engineMode: 'cheerio-dom+deterministic-nlp' as ScraperTelemetry['engineMode'],
      },
    },
    reviews,
  };
}

type RenderMode = 'auto' | 'always' | 'never';

const PASTE_HINT =
  ' If the reviews show in your own browser, copy them (or View Source) and paste into the raw HTML box instead.';

/** Plain HTTP fetch. Returns the HTML, or a status + message describing the failure. */
interface StaticFetchError {
  status: number;
  message: string;
  blocked: boolean;
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchStaticHtml(url: string): Promise<{ html: string } | StaticFetchError> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const blocked = await blockedFetchTargetResolved(current);
    if (blocked) return { status: 400, message: blocked, blocked: true };
    let response: Response;
    try {
      response = await fetch(current, {
        headers: FETCH_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
    } catch (fetchErr) {
      const reason = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return { status: 502, message: `Could not reach ${url}: ${reason}.`, blocked: false };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || hop === 5) {
        return { status: 400, message: `Too many redirects while scraping ${url}.`, blocked: false };
      }
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      const refused = response.status === 403 || response.status === 429 || response.status === 503;
      return {
        status: 400,
        message: refused
          ? `${url} returned HTTP ${response.status}: the store refuses automated requests.`
          : `Remote server returned HTTP ${response.status} when scraping ${url}.`,
        blocked: refused,
      };
    }
    return { html: await response.text() };
  }
  return { status: 400, message: `Too many redirects while scraping ${url}.`, blocked: false };
}

function getDatabaseSummary() {
  const rows = db
    .prepare(`SELECT report_json, committed_at FROM commercial_skus ORDER BY committed_at DESC`)
    .all() as { report_json: string; committed_at: string }[];

  const reports: ProductFitReport[] = rows.map((r) => {
    const parsed = JSON.parse(r.report_json) as ProductFitReport;
    parsed.committedToDbAt = r.committed_at;
    return parsed;
  });

  const stats = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM commercial_skus) as skuCount,
        (SELECT COUNT(*) FROM sku_size_metrics WHERE review_count > 0) as sizeMetricRows,
        (SELECT COUNT(*) FROM sku_reviews) as reviewRows
    `)
    .get() as { skuCount: number; sizeMetricRows: number; reviewRows: number };

  const recentLogs = db
    .prepare(`SELECT id, sku, product_name, action, rows_affected, committed_at FROM ingestion_log ORDER BY id DESC LIMIT 10`)
    .all();

  const chartRows = db
    .prepare(
      `SELECT sku, size_code, sort_order, chest_cm, length_cm, sleeve_cm
       FROM size_chart ORDER BY sku, sort_order`,
    )
    .all() as {
    sku: string;
    size_code: string;
    sort_order: number;
    chest_cm: number | null;
    length_cm: number | null;
    sleeve_cm: number | null;
  }[];
  const charts: Record<string, SizeChartRow[]> = {};
  for (const row of chartRows) {
    const list = charts[row.sku] ?? [];
    list.push({
      size: row.size_code,
      sortOrder: row.sort_order,
      chest_cm: row.chest_cm,
      length_cm: row.length_cm,
      sleeve_cm: row.sleeve_cm,
    });
    charts[row.sku] = list;
  }

  return {
    reports,
    stats,
    recentLogs,
    charts,
  };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Serve realistic mock e-commerce store pages for live scraping
  app.get('/api/mock-store/:slug', (req, res) => {
    const product = MOCK_STORE_PRODUCTS[req.params.slug];
    if (!product) {
      res.status(404).send('Product not found');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderMockStoreHtml(product));
  });

  app.get('/api/mock-store/:slug/raw', (req, res) => {
    const product = MOCK_STORE_PRODUCTS[req.params.slug];
    if (!product) {
      res.status(404).json({ error: 'Preset store page not found' });
      return;
    }
    res.json({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      sku: product.sku,
      category: product.category,
      html: renderMockStoreHtml(product),
    });
  });

  // Commercial SQLite Database Query & Inspection Endpoints
  app.get('/api/db/remote', async (_req, res) => {
    const remote = await listRemoteFitSkus();
    res.json(remote);
  });

  app.get('/api/db/records', (_req, res) => {
    res.json(getDatabaseSummary());
  });

  app.post('/api/db/commit', async (req, res) => {
    try {
      const { report, reports, charts: incomingCharts } = req.body as {
        report?: ProductFitReport;
        reports?: ProductFitReport[];
        charts?: Record<string, unknown>;
      };

      const list = reports || (report ? [report] : []);
      if (list.length === 0) {
        res.status(400).json({ error: 'No scraped SKU report provided to dump into database.' });
        return;
      }

      for (const item of list) {
        upsertReportTransaction(item);
        const rows = chartRowsFromClient(incomingCharts?.[item.sku]);
        if (rows.length > 0) saveSizeChart(item.sku, rows);
      }

      const supabase = await pushFitReports(list, chartsBySku(list));
      res.json({
        committedCount: list.length,
        supabase,
        ...getDatabaseSummary(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Database commit failed',
      });
    }
  });

  const deleteSkuTransaction = db.transaction((sku: string) => {
    db.prepare(`DELETE FROM commercial_skus WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_size_metrics WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_reviews WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM size_chart WHERE sku = ?`).run(sku);
    db.prepare(`
      INSERT INTO ingestion_log (sku, product_name, action, rows_affected, committed_at)
      VALUES (?, ?, 'DELETE_SKU', 1, ?)
    `).run(sku, sku, new Date().toISOString());
  });

  app.delete('/api/db/sku/:sku', async (req, res) => {
    const sku = req.params.sku;
    deleteSkuTransaction(sku);

    const supabase = await deleteRemoteFitSku(sku);
    res.json({ supabase, ...getDatabaseSummary() });
  });

  app.get('/api/db/dump.sql', (_req, res) => {
    const { reports, charts } = getDatabaseSummary();
    const chartRows: DumpSizeChartRow[] = Object.entries(charts).flatMap(([sku, rows]) =>
      rows.map((row) => ({ sku, ...row })),
    );
    const sql = generateSqlInsertDump(reports, chartRows);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="pearfit_scraper_commercial_db_dump.sql"'
    );
    res.send(sql);
  });

  app.get('/api/db/dump.json', (_req, res) => {
    const skus = db.prepare(`SELECT sku, product_id, brand, product_name, category, retail_price, fabric_composition, total_reviews, overall_fit_index, overall_verdict, grading_delta, runs_small_pct, true_to_size_pct, runs_large_pct, shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating, source_url, scraped_at, committed_at FROM commercial_skus`).all();
    const sizeMetrics = db.prepare(`SELECT * FROM sku_size_metrics`).all();
    const reviews = db.prepare(`SELECT * FROM sku_reviews`).all();
    const sizeChart = db.prepare(`SELECT * FROM size_chart ORDER BY sku, sort_order`).all();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="pearfit_scraper_commercial_db_dump.json"'
    );
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          engine: 'Pearfit Scraper Commercial Apparel Fit Database (SQLite3 + Deterministic NLP)',
          tables: {
            commercial_skus: skus,
            sku_size_metrics: sizeMetrics,
            sku_reviews: reviews,
            size_chart: sizeChart,
          },
        },
        null,
        2
      )
    );
  });

  // Deterministic Web Scraper Endpoint (Zero LLM)
  app.post('/api/scrape', async (req, res) => {
    try {
      const {
        url,
        rawHtml,
        productName,
        brand,
        sku,
        category,
        commitToDb = true,
        render,
      } = req.body as {
        url?: string;
        rawHtml?: string;
        productName?: string;
        brand?: string;
        sku?: string;
        category?: ProductFitReport['category'];
        commitToDb?: boolean;
        render?: RenderMode;
      };

      const renderMode: RenderMode = render === 'always' || render === 'never' ? render : 'auto';
      let targetHtml = (rawHtml || '').trim();
      let sourceUrl = (url || 'batch://direct-review-payload').trim();
      let isRemoteUrl = false;
      let staticError: StaticFetchError | null = null;

      if (!targetHtml && url) {
        const mockMatch = url.match(/\/api\/mock-store\/([a-z0-9-]+)/i);
        if (mockMatch && MOCK_STORE_PRODUCTS[mockMatch[1]]) {
          const mockProd = MOCK_STORE_PRODUCTS[mockMatch[1]];
          targetHtml = renderMockStoreHtml(mockProd);
          sourceUrl = `https://storefront.pearfitscraper.local/api/mock-store/${mockProd.slug}`;
        } else if (/^https?:\/\//i.test(url)) {
          isRemoteUrl = true;
          const blocked = await blockedFetchTargetResolved(url);
          if (blocked) {
            res.status(400).json({ error: blocked });
            return;
          }
          if (renderMode !== 'always') {
            const result = await fetchStaticHtml(url);
            if ('html' in result) targetHtml = result.html;
            else staticError = result;
          }
        } else {
          res.status(400).json({
            error:
              'Provide a valid http(s):// URL, select a target SKU endpoint, or paste review HTML/text.',
          });
          return;
        }
      }

      const overrides = { productName, brand, sku, category };
      let scraped = targetHtml ? scrapeHtmlWithCheerio(targetHtml, sourceUrl, overrides) : null;
      let headlessNote: string | null = null;

      // Headless fallback for reviews loaded by JavaScript. A failed fetch is reported as
      // that failure. A refusal (403/429/503) is not retried in a browser.
      const needsRender = shouldUseHeadlessRender({
        isRemoteUrl,
        renderMode,
        staticFailed: staticError !== null,
        reviewCount: scraped ? scraped.reviews.length : null,
      });
      if (needsRender) {
        try {
          const rendered = await renderPageHtml(url!);
          if (rendered.status !== null && rendered.status >= 400) {
            headlessNote = `Headless browser got HTTP ${rendered.status}.`;
          } else {
            const renderedScrape = scrapeHtmlWithCheerio(rendered.html, sourceUrl, overrides);
            renderedScrape.meta.scraperTelemetry.engineMode = 'headless-chromium+cheerio-dom';
            renderedScrape.meta.scraperTelemetry.selectorsUsed.unshift('headless-chromium render');
            if (!scraped || renderedScrape.reviews.length > 0 || scraped.reviews.length === 0) {
              scraped = renderedScrape;
              targetHtml = rendered.html;
            }
            if (renderedScrape.reviews.length === 0) {
              headlessNote = 'Rendered the page in a headless browser but still found no reviews.';
            }
          }
        } catch (renderErr) {
          const reason = renderErr instanceof Error ? renderErr.message.split('\n')[0] : String(renderErr);
          const missingLocalBrowser =
            !process.env.VERCEL &&
            /Executable doesn't exist|browserType\.launch|Cannot find (module|package) 'playwright'/i.test(reason);
          headlessNote = missingLocalBrowser
            ? 'Headless browser is not installed (run `npx playwright install chromium`).'
            : `Headless browser render failed: ${reason}`;
        }
      }

      if (!scraped) {
        const parts = [staticError?.message ?? 'No HTML or review content provided to scrape.', headlessNote].filter(Boolean);
        res.status(staticError?.status ?? 400).json({
          error: `${parts.join(' ')}${isRemoteUrl ? PASTE_HINT : ''}`,
        });
        return;
      }

      const { meta, reviews } = scraped;

      if (reviews.length === 0) {
        const sizeChart = targetHtml ? parseSizeChart(targetHtml) : [];
        // A chart with no parent SKU never shows up and never reaches Supabase.
        // Store an empty fit report so the chart has a row to hang on.
        if (commitToDb && sizeChart.length > 0) {
          const report = aggregateProductFitReport(meta, []);
          upsertReportTransaction(report);
          saveSizeChart(report.sku, sizeChart);
          const supabase = await pushFitReports([report], { [report.sku]: sizeChart });
          res.json({
            report,
            sizeChart,
            committedToDb: true,
            supabase,
            dbState: getDatabaseSummary(),
          });
          return;
        }
        const chartNote =
          sizeChart.length > 0
            ? ` A size chart with ${sizeChart.length} sizes was read and not stored.`
            : '';
        res.status(422).json({
          error: `${
            isRemoteUrl || looksLikeFullHtmlDocument(targetHtml)
              ? `No reviews found on the page.${headlessNote ? ` ${headlessNote}` : ''}${PASTE_HINT}`
              : 'No recognizable clothing reviews were found in the pasted content.'
          }${chartNote}`,
          sizeChart,
        });
        return;
      }

      const report = aggregateProductFitReport(meta, reviews);
      const sizeChart = targetHtml ? parseSizeChart(targetHtml) : [];

      let supabase: SupabaseSync | null = null;
      if (commitToDb) {
        upsertReportTransaction(report);
        saveSizeChart(report.sku, sizeChart);
        supabase = await pushFitReports([report], { [report.sku]: sizeChart });
      }

      res.json({
        report,
        sizeChart,
        committedToDb: commitToDb,
        supabase,
        dbState: getDatabaseSummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected scraper error';
      res.status(500).json({ error: message });
    }
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(serverDir(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      closeHeadlessBrowser().finally(() => process.exit(0));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pearfit Scraper listening on http://127.0.0.1:${PORT}`);
    checkFitStore().then((sync) => {
      if (sync.ok) {
        console.log('Supabase fit store is ready. Scrapes will push fit numbers.');
        return;
      }
      if ('skipped' in sync) {
        console.log(`Supabase fit store skipped: ${sync.reason}`);
        return;
      }
      console.log(`Supabase fit store is not writable yet: ${sync.error}`);
      console.log('One person runs webscraper/fit_store.sql once in the Supabase SQL editor. After that, every clone can push.');
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`Supabase fit store check failed: ${message}`);
    });
  });
}

if (!process.env.VERCEL) {
  startServer();
}
