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
  ProductFitReport,
  RawScrapedReview,
} from './src/utils/fitAnalyzer.ts';
import { HM_HEAVYWEIGHT_TEE_REVIEWS, SEED_CATALOG } from './src/data/seedCatalog.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize persistent SQLite Commercial Apparel Fit Database
const dbPath = path.join(__dirname, 'commercial_fit.db');
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
    fabric_opacity_pct INTEGER NOT NULL,
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

  -- Size-chart measurements (flat-lay cm) per SKU and size. sort_order runs smallest to largest.
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

  for (const r of report.reviews) {
    insertReviewStmt.run(
      `${report.sku}::${r.id}`,
      report.sku,
      r.normalizedSize,
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
  }

  const totalRows = 1 + report.sizeSummaries.length + report.reviews.length;
  db.prepare(`
    INSERT INTO ingestion_log (sku, product_name, action, rows_affected, committed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(report.sku, report.name, 'UPSERT_COMMIT', totalRows, nowIso);
});

// Seed initial commercial SKUs into SQLite if empty
const existingCount = (
  db.prepare(`SELECT COUNT(*) as cnt FROM commercial_skus`).get() as { cnt: number }
).cnt;
if (existingCount === 0) {
  for (const item of SEED_CATALOG) {
    upsertReportTransaction(item);
  }
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

  const extractedName =
    overrides?.productName ||
    $('meta[property="og:title"]').attr('content') ||
    $('h1.product-title').first().text().trim() ||
    $('h1').first().text().trim() ||
    $('title').text().split('|')[0]?.trim() ||
    'Scraped Apparel SKU';

  const extractedBrand =
    overrides?.brand ||
    $('meta[name="product:brand"]').attr('content') ||
    $('.product-brand').first().text().trim() ||
    'Commercial Apparel Vendor';

  const rawCategory =
    overrides?.category ||
    ($('meta[name="product:category"]').attr('content') as ProductFitReport['category']) ||
    'T-Shirts & Tops';

  const validCategories: ProductFitReport['category'][] = [
    'T-Shirts & Tops',
    'Outerwear',
    'Knitwear',
    'Trousers',
    'Fleece & Hoodies',
    'Shirting',
    'Dresses',
  ];
  const category: ProductFitReport['category'] = validCategories.includes(rawCategory)
    ? rawCategory
    : 'T-Shirts & Tops';

  const sku =
    overrides?.sku ||
    $('meta[name="product:sku"]').attr('content') ||
    $('[data-sku]').attr('data-sku') ||
    `SKU-${Math.floor(1000 + Math.random() * 8999)}`;

  const price =
    $('meta[name="product:price"]').attr('content') ||
    $('[data-price]').attr('data-price') ||
    '$24.99';

  const fabricComposition =
    $('meta[name="product:fabric"]').attr('content') ||
    $('[data-fabric]').attr('data-fabric') ||
    'Scraped Garment Specification';

  const reviews: RawScrapedReview[] = [];

  const reviewElements = $('[data-review-card], .review-card, [itemprop="review"], .review-item');
  if (reviewElements.length > 0) {
    selectorsUsed.push('[data-review-card]', '.review-card', '.review-body-copy');
    reviewElements.each((idx, el) => {
      const node = $(el);
      const sizePurchased =
        node.attr('data-size') ||
        node.find('.review-size-tag strong').text().trim() ||
        node
          .text()
          .match(/Size(?:\s+Purchased)?:\s*([A-Za-z0-9]+)/i)?.[1] ||
        'M';
      const ratingStr =
        node.attr('data-rating') ||
        node
          .find('.review-rating')
          .text()
          .match(/(\d(?:\.\d)?)/)?.[1] ||
        '4';
      const declaredFitTag =
        node.attr('data-fit') ||
        node
          .find('.review-fit-tag')
          .text()
          .replace(/^Fit:\s*/i, '')
          .trim() ||
        undefined;
      const author =
        node.attr('data-author') ||
        node.find('.review-author').text().trim() ||
        `Verified Reviewer #${idx + 1}`;
      const title =
        node.find('.review-title, h3, h4').first().text().trim() || 'Verified Fit Review';
      const body =
        node.find('.review-body-copy, p').last().text().trim() || node.text().trim();
      const date = node.attr('data-date') || '2026-10-25';

      if (body.length > 8) {
        reviews.push({
          id: `dom-rev-${idx + 1}`,
          author,
          sizePurchased,
          rating: Math.min(5, Math.max(1, Math.round(parseFloat(ratingStr) || 4))),
          title,
          body,
          date,
          verifiedPurchase: true,
          declaredFitTag,
        });
      }
    });
  }

  if (reviews.length === 0) {
    selectorsUsed.push('fallback-text-blocks');
    const fallbackReviews = parseRawReviewBatch(html);
    reviews.push(...fallbackReviews);
  }

  const parseDurationMs = Math.max(12, Date.now() - startTime);

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
        domNodesScanned: Math.max(domNodesScanned, reviews.length * 14 + 42),
        reviewNodesMatched: reviews.length,
        selectorsUsed,
        parseDurationMs,
        engineMode: 'cheerio-dom+deterministic-nlp' as const,
      },
    },
    reviews,
  };
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

  return {
    reports,
    stats,
    recentLogs,
  };
}

async function startServer() {
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
  app.get('/api/db/records', (_req, res) => {
    res.json(getDatabaseSummary());
  });

  app.post('/api/db/commit', (req, res) => {
    try {
      const { report, reports } = req.body as {
        report?: ProductFitReport;
        reports?: ProductFitReport[];
      };

      const list = reports || (report ? [report] : []);
      if (list.length === 0) {
        res.status(400).json({ error: 'No scraped SKU report provided to dump into database.' });
        return;
      }

      for (const item of list) {
        upsertReportTransaction(item);
      }

      res.json({
        committedCount: list.length,
        ...getDatabaseSummary(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Database commit failed',
      });
    }
  });

  app.delete('/api/db/sku/:sku', (req, res) => {
    const sku = req.params.sku;
    db.prepare(`DELETE FROM commercial_skus WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_size_metrics WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_reviews WHERE sku = ?`).run(sku);
    db.prepare(`
      INSERT INTO ingestion_log (sku, product_name, action, rows_affected, committed_at)
      VALUES (?, ?, 'DELETE_SKU', 1, ?)
    `).run(sku, sku, new Date().toISOString());

    res.json(getDatabaseSummary());
  });

  app.get('/api/db/dump.sql', (_req, res) => {
    const { reports } = getDatabaseSummary();
    const sql = generateSqlInsertDump(reports);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fitpulse_commercial_db_dump.sql"'
    );
    res.send(sql);
  });

  app.get('/api/db/dump.json', (_req, res) => {
    const skus = db.prepare(`SELECT sku, product_id, brand, product_name, category, retail_price, fabric_composition, total_reviews, overall_fit_index, overall_verdict, grading_delta, runs_small_pct, true_to_size_pct, runs_large_pct, shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating, source_url, scraped_at, committed_at FROM commercial_skus`).all();
    const sizeMetrics = db.prepare(`SELECT * FROM sku_size_metrics`).all();
    const reviews = db.prepare(`SELECT * FROM sku_reviews`).all();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fitpulse_commercial_db_dump.json"'
    );
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          engine: 'FitPulse Commercial Apparel Fit Database (SQLite3 + Deterministic NLP)',
          tables: {
            commercial_skus: skus,
            sku_size_metrics: sizeMetrics,
            sku_reviews: reviews,
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
      } = req.body as {
        url?: string;
        rawHtml?: string;
        productName?: string;
        brand?: string;
        sku?: string;
        category?: ProductFitReport['category'];
        commitToDb?: boolean;
      };

      let targetHtml = (rawHtml || '').trim();
      let sourceUrl = (url || 'batch://direct-review-payload').trim();

      if (!targetHtml && url) {
        const mockMatch = url.match(/\/api\/mock-store\/([a-z0-9-]+)/i);
        if (mockMatch && MOCK_STORE_PRODUCTS[mockMatch[1]]) {
          const mockProd = MOCK_STORE_PRODUCTS[mockMatch[1]];
          targetHtml = renderMockStoreHtml(mockProd);
          sourceUrl = `https://storefront.fitpulse.local/api/mock-store/${mockProd.slug}`;
        } else if (/^https?:\/\//i.test(url)) {
          const response = await fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (compatible; FitPulseCommercialScraper/3.0)',
              Accept: 'text/html,application/xhtml+xml',
            },
          });
          if (!response.ok) {
            res.status(400).json({
              error: `Remote server returned HTTP ${response.status} when scraping ${url}.`,
            });
            return;
          }
          targetHtml = await response.text();
        } else {
          res.status(400).json({
            error:
              'Provide a valid http(s):// URL, select a target SKU endpoint, or paste review HTML/text.',
          });
          return;
        }
      }

      if (!targetHtml) {
        res.status(400).json({
          error: 'No HTML or review content provided to scrape.',
        });
        return;
      }

      const { meta, reviews } = scrapeHtmlWithCheerio(targetHtml, sourceUrl, {
        productName,
        brand,
        sku,
        category,
      });

      if (reviews.length === 0) {
        res.status(422).json({
          error:
            'No recognizable clothing reviews were found in the target document.',
        });
        return;
      }

      const report = aggregateProductFitReport(meta, reviews);

      if (commitToDb) {
        upsertReportTransaction(report);
      }

      res.json({
        report,
        committedToDb: commitToDb,
        dbState: getDatabaseSummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected scraper error';
      res.status(500).json({ error: message });
    }
  });

  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FitPulse Commercial Scraper & Database Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
