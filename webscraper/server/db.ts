/** The local SQLite store: connection, schema, migrations, and the reads and writes on it. */
import path from 'path';
import Database from 'better-sqlite3';
import type { ProductFitReport } from '../fitAnalyzer.ts';
import type { SizeChartRow } from '../sizeChart.ts';
import { serverDir } from './env.ts';

// Local clones keep the database next to the server. Vercel can only write to /tmp,
// and that copy disappears when the function instance goes away. Fit numbers still go to Supabase.
const dbPath = process.env.VERCEL ? '/tmp/commercial_fit.db' : path.join(serverDir(), 'commercial_fit.db');
export const db = new Database(dbPath);
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
    sentiment_score INTEGER,
    rating INTEGER,
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

// A review whose stars could not be read has no rating and no sentiment score: NULL, never a stand-in 3.
// Databases created before that cannot store it, so rebuild sku_reviews with the two columns nullable.
const reviewColumns = db.prepare(`PRAGMA table_info(sku_reviews)`).all() as { name: string; notnull: number }[];
if (reviewColumns.some((column) => (column.name === 'rating' || column.name === 'sentiment_score') && column.notnull === 1)) {
  db.exec(`
    BEGIN;
    CREATE TABLE sku_reviews__nullable (
      review_uid TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      size_code TEXT NOT NULL,
      raw_size TEXT NOT NULL,
      fit_direction TEXT NOT NULL,
      fit_skew REAL NOT NULL,
      sentiment_score INTEGER,
      rating INTEGER,
      mentions_shrinkage INTEGER NOT NULL,
      fabric_opacity TEXT,
      author TEXT,
      review_date TEXT,
      title TEXT,
      body TEXT
    );
    INSERT INTO sku_reviews__nullable (
      review_uid, sku, size_code, raw_size, fit_direction, fit_skew,
      sentiment_score, rating, mentions_shrinkage, fabric_opacity,
      author, review_date, title, body
    )
    SELECT
      review_uid, sku, size_code, raw_size, fit_direction, fit_skew,
      sentiment_score, rating, mentions_shrinkage, fabric_opacity,
      author, review_date, title, body
    FROM sku_reviews;
    DROP TABLE sku_reviews;
    ALTER TABLE sku_reviews__nullable RENAME TO sku_reviews;
    COMMIT;
  `);
}

/** True when this SKU is stored locally with at least one review. */
export function hasStoredReviews(sku: string): boolean {
  const row = db.prepare(`SELECT total_reviews FROM commercial_skus WHERE sku = ?`).get(sku) as
    | { total_reviews: number }
    | undefined;
  return (row?.total_reviews ?? 0) > 0;
}

/** The report this machine stored for a SKU, or null when there is none. */
export function loadStoredReport(sku: string): ProductFitReport | null {
  const row = db.prepare(`SELECT report_json, committed_at FROM commercial_skus WHERE sku = ?`).get(sku) as
    | { report_json: string; committed_at: string }
    | undefined;
  if (!row) return null;
  const report = JSON.parse(row.report_json) as ProductFitReport;
  report.committedToDbAt = row.committed_at;
  return report;
}

export const upsertReportTransaction = db.transaction((report: ProductFitReport) => {
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

export function chartsBySku(reports: ProductFitReport[]): Record<string, SizeChartRow[]> {
  const charts: Record<string, SizeChartRow[]> = {};
  for (const report of reports) charts[report.sku] = loadSizeChart(report.sku);
  return charts;
}

export function saveSizeChart(sku: string, rows: SizeChartRow[]) {
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

export function getDatabaseSummary() {
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
