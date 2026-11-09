import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { aggregateProductFitReport } from './fitAnalyzer.ts';

process.env.VERCEL = '1';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_PUBLISHABLE_KEY = '';
process.env.SUPABASE_SECRET_KEY = '';

const { createApp } = await import('./server.ts');

function listen(app: Express): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

async function request(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const payload = body === undefined ? null : JSON.stringify(body);
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload,
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

const CHART_HTML = `<!DOCTYPE html><html><head><title>Chart Shirt</title></head><body>
<h1>Chart Shirt</h1>
<table>
<caption>Size guide (cm)</caption>
<tr><th>Size</th><th>Pit to pit (cm)</th><th>Body length (cm)</th></tr>
<tr><td>M</td><td>54</td><td>72</td></tr>
</table>
</body></html>`;

test('a size chart with no reviews is stored, and deleting the SKU removes it', async () => {
  const { server, port } = await listen(createApp());
  try {
    const scraped = await request(port, 'POST', '/api/scrape', {
      rawHtml: CHART_HTML,
      productName: 'Chart Shirt',
      brand: 'Example',
      sku: 'CHART-ONLY-1',
      category: 'Shirting',
      commitToDb: true,
      render: 'never',
    });
    assert.equal(scraped.status, 200);
    const report = scraped.json.report as { totalReviews: number; sku: string; overallVerdict: string };
    assert.equal(report.totalReviews, 0);
    assert.equal(report.sku, 'CHART-ONLY-1');
    assert.equal(report.overallVerdict, 'Insufficient Data');
    assert.equal(scraped.json.keptStoredReviews, false);
    const chart = scraped.json.sizeChart as { size: string; chest_cm: number }[];
    assert.equal(chart[0].size, 'M');
    assert.equal(chart[0].chest_cm, 54);

    const dumped = await request(port, 'GET', '/api/db/dump.json');
    const tables = dumped.json.tables as { size_chart: { sku: string }[] };
    assert.equal(tables.size_chart.some((row) => row.sku === 'CHART-ONLY-1'), true);

    const removed = await request(port, 'DELETE', '/api/db/sku/CHART-ONLY-1');
    assert.equal(removed.status, 200);
    const after = await request(port, 'GET', '/api/db/dump.json');
    const afterTables = after.json.tables as {
      commercial_skus: { sku: string }[];
      size_chart: { sku: string }[];
    };
    assert.equal(afterTables.commercial_skus.some((row) => row.sku === 'CHART-ONLY-1'), false);
    assert.equal(afterTables.size_chart.some((row) => row.sku === 'CHART-ONLY-1'), false);
  } finally {
    server.close();
  }
});

test('two reviews that share an id still commit', async () => {
  const { server, port } = await listen(createApp());
  try {
    const report = aggregateProductFitReport(
      {
        id: 'dup',
        name: 'Dup Tee',
        brand: 'Example',
        category: 'T-Shirts & Tops',
        sku: 'DUP-1',
        price: 'Unknown',
        fabricComposition: '100% cotton',
        sourceUrl: 'https://example.test/dup',
      },
      [
        {
          id: 'same',
          author: 'A',
          sizePurchased: 'M',
          rating: 4,
          title: 'Fine',
          body: 'True to size and fits perfectly in the chest.',
          date: '',
          verifiedPurchase: false,
        },
        {
          id: 'same',
          author: 'B',
          sizePurchased: 'L',
          rating: 2,
          title: 'Tight',
          body: 'Runs small and tight in the shoulders.',
          date: '',
          verifiedPurchase: false,
        },
      ]
    );
    const committed = await request(port, 'POST', '/api/db/commit', { report });
    assert.equal(committed.status, 200, JSON.stringify(committed.json));
    const removed = await request(port, 'DELETE', '/api/db/sku/DUP-1');
    assert.equal(removed.status, 200);
  } finally {
    server.close();
  }
});

test('a failed page fetch does not claim the page was scraped', async () => {
  const { server, port } = await listen(createApp());
  try {
    const scraped = await request(port, 'POST', '/api/scrape', {
      url: 'http://127.0.0.1:9/missing',
      commitToDb: false,
      render: 'auto',
    });
    assert.equal(scraped.status, 400);
    assert.match(String(scraped.json.error), /not a public address/);
    assert.equal(scraped.json.report, undefined);
  } finally {
    server.close();
  }
});

const MERGE_HTML = `<!DOCTYPE html><html><head><title>Merge Tee</title>
<script type="application/ld+json">
{"@type":"Product","name":"Merge Tee","sku":"MERGE-1","review":[
  {"@type":"Review","author":"Sam","reviewBody":"Size purchased: M. Runs small across the chest and shoulders.","reviewRating":{"ratingValue":2}}
]}
</script></head><body>
<h1>Merge Tee</h1>
<article class="review-card" data-size="M" data-author="Sam" data-rating="2">
  <p class="review-body-copy">Size purchased: M. Runs small across the chest and shoulders.</p>
</article>
<article class="review-card" data-size="L" data-author="Kim" data-rating="5">
  <p class="review-body-copy">True to size in the waist and the sleeves feel perfect today.</p>
</article>
</body></html>`;

test('JSON-LD reviews do not hide other review cards on the page', async () => {
  const { server, port } = await listen(createApp());
  try {
    const scraped = await request(port, 'POST', '/api/scrape', {
      rawHtml: MERGE_HTML,
      commitToDb: false,
      render: 'never',
    });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json.error));
    const report = scraped.json.report as { totalReviews: number; reviews: { author: string; body: string }[] };
    assert.equal(report.totalReviews, 2);
    assert.deepEqual(
      report.reviews.map((review) => review.author),
      ['Sam', 'Kim'],
    );
  } finally {
    server.close();
  }
});

test('a commit stores the size chart sent with the report', async () => {
  const { server, port } = await listen(createApp());
  try {
    const report = aggregateProductFitReport(
      {
        id: 'chart-commit',
        name: 'Chart Commit',
        brand: 'Example',
        category: 'Shirting',
        sku: 'CHART-COMMIT-1',
        price: 'Unknown',
        fabricComposition: '100% cotton',
        sourceUrl: 'https://example.test/chart-commit',
      },
      [
        {
          id: '1',
          author: 'A',
          sizePurchased: 'M',
          rating: 4,
          title: '',
          body: 'True to size and fits perfectly in the chest.',
          date: '',
          verifiedPurchase: false,
        },
      ]
    );
    const committed = await request(port, 'POST', '/api/db/commit', {
      report,
      charts: {
        'CHART-COMMIT-1': [{ size: 'M', sortOrder: 2, chest_cm: 54, length_cm: null, sleeve_cm: 63 }],
      },
    });
    assert.equal(committed.status, 200, JSON.stringify(committed.json.error));
    const charts = committed.json.charts as Record<string, { size: string; chest_cm: number; sleeve_cm: number }[]>;
    assert.equal(charts['CHART-COMMIT-1'][0].chest_cm, 54);
    assert.equal(charts['CHART-COMMIT-1'][0].sleeve_cm, 63);
    const removed = await request(port, 'DELETE', '/api/db/sku/CHART-COMMIT-1');
    assert.equal(removed.status, 200);
  } finally {
    server.close();
  }
});

test('a re-scrape that finds a chart but no reviews keeps the stored reviews', async () => {
  const { server, port } = await listen(createApp());
  try {
    const review = (id: string, size: string) => ({
      id,
      author: id,
      sizePurchased: size,
      rating: 5,
      title: '',
      body: 'True to size and fits perfectly in the chest.',
      date: '',
      verifiedPurchase: false,
    });
    const report = aggregateProductFitReport(
      {
        id: 'keep-1',
        name: 'Keep Tee',
        brand: 'Example',
        category: 'T-Shirts & Tops',
        sku: 'KEEP-1',
        price: 'Unknown',
        fabricComposition: '100% cotton',
        sourceUrl: 'https://example.test/keep',
      },
      [review('a', 'M'), review('b', 'L')],
    );
    const committed = await request(port, 'POST', '/api/db/commit', { report });
    assert.equal(committed.status, 200, JSON.stringify(committed.json));

    // Same SKU again, but this time the page only shows the chart (e.g. the reviews failed to load).
    const rescraped = await request(port, 'POST', '/api/scrape', {
      rawHtml: CHART_HTML,
      sku: 'KEEP-1',
      commitToDb: true,
      render: 'never',
    });
    assert.equal(rescraped.status, 200, JSON.stringify(rescraped.json));
    // The response shows the stored report (2 reviews), not an empty one, and says the reviews were kept.
    assert.equal(rescraped.json.keptStoredReviews, true);
    assert.equal((rescraped.json.report as { totalReviews: number }).totalReviews, 2);

    const dumped = await request(port, 'GET', '/api/db/dump.json');
    const tables = dumped.json.tables as {
      commercial_skus: { sku: string; total_reviews: number }[];
      sku_reviews: { sku: string }[];
      size_chart: { sku: string; chest_cm: number }[];
    };
    // The two earlier reviews are still there, and the new chart (M, 54 cm) was saved.
    assert.equal(tables.commercial_skus.find((row) => row.sku === 'KEEP-1')?.total_reviews, 2);
    assert.equal(tables.sku_reviews.filter((row) => row.sku === 'KEEP-1').length, 2);
    assert.deepEqual(
      tables.size_chart.filter((row) => row.sku === 'KEEP-1').map((row) => row.chest_cm),
      [54],
    );
  } finally {
    await request(port, 'DELETE', '/api/db/sku/KEEP-1');
    server.close();
  }
});

test('when the page holds review data, widget markup is not counted as more reviews', async () => {
  const { server, port } = await listen(createApp());
  try {
    const nextData = {
      props: {
        pageProps: {
          product: { id: 'NEXT-1', name: 'Next Tee' },
          reviews: {
            total: 2,
            items: [
              { id: 'r1', rating: 5, title: 'Great', body: 'Soft and true to size.', author: 'Ana', size: 'M' },
              { id: 'r2', rating: 2, title: 'Small', body: 'Runs small in the chest.', author: 'Bo', size: 'L' },
            ],
          },
        },
      },
    };
    const html = `<!DOCTYPE html><html><head><title>Next Tee</title></head><body><h1>Next Tee</h1>
      <div class="review-card"><p>Was this review helpful to you?</p></div>
      <div class="review-card"><p>BobbieLynn,</p></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
      </body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'NEXT-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as {
      totalReviews: number;
      reviews: { id: string; normalizedSize: string | null; rating: number }[];
      scraperTelemetry: { reportedReviewCount: number | null; reviewSources: string[] };
    };
    // The two reviews in the page data, with their sizes and ratings; the two widget lines are not reviews.
    assert.equal(report.totalReviews, 2);
    assert.deepEqual(report.reviews.map((r) => [r.id, r.normalizedSize, r.rating]), [['r1', 'M', 5], ['r2', 'L', 2]]);
    assert.equal(report.scraperTelemetry.reportedReviewCount, 2);
    assert.deepEqual(report.scraperTelemetry.reviewSources, ['page']);
  } finally {
    server.close();
  }
});

test('a complete review card in the markup is kept next to review data, a bare widget line is not', async () => {
  const { server, port } = await listen(createApp());
  try {
    // Page data holds review r2 (page 2 of a widget); the first review was rendered as markup only.
    const nextData = { props: { reviews: { total: 2, items: [{ id: 'r2', rating: 4, body: 'Second page review, fits well.', author: 'Bo', size: 'L' }] } } };
    const html = `<!DOCTYPE html><html><head><title>Mixed Tee</title></head><body><h1>Mixed Tee</h1>
      <article class="review-card" data-author="Ana" data-rating="5" data-size="M"><p class="review-body-copy">First page review, rendered by the store.</p></article>
      <div class="review-card"><p>Was this review helpful to you?</p></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
      </body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'MIXED-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { reviews: { author: string; normalizedSize: string | null }[] };
    assert.deepEqual(
      report.reviews.map((r) => [r.author, r.normalizedSize]).sort(),
      [['Ana', 'M'], ['Bo', 'L']],
    );
  } finally {
    server.close();
  }
});

test('Bazaarvoice search-engine debug text in review markup is not counted as reviews', async () => {
  const { server, port } = await listen(createApp());
  try {
    const card = (body: string, attrs = '') => `<div class="review-card"${attrs}><p class="review-body-copy">${body}</p></div>`;
    const html = `<!DOCTYPE html><html><head><title>Roots Tee</title></head><body><h1>Roots Tee</h1>
      ${card('Nice soft material, but runs very large.', ' data-author="LisaKH" data-rating="4"')}
      ${card('y_2026, m_11, d_8, h_6')}
      ${card('bvseo_bulk, prod_bvrr, vn_bulk_3.0.50')}
      ${card('loc_en_CA, sid_39031035, prod, sort_default')}
      </body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'ROOTS-T', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { reviews: { author: string }[] };
    assert.deepEqual(report.reviews.map((r) => r.author), ['LisaKH']);
  } finally {
    server.close();
  }
});

test('a review card whose text is the whole card still matches its review from the page data', async () => {
  const { server, port } = await listen(createApp());
  try {
    const nextData = { props: { reviews: { total: 1, items: [{ id: 'r1', rating: 4, body: 'Nice quality! The fit was a little shorter than I expected', author: 'Hayley W.' }] } } };
    const html = `<!DOCTYPE html><html><head><title>Sweater</title></head><body><h1>Sweater</h1>
      <div class="review-card" data-author="Hayley W." data-rating="4"><span>Rated 4 out of 5 stars6 days agoGood Sweater Nice quality! The fit was a little shorter than I expected</span></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
      </body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'SWEATER-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 1);
  } finally {
    server.close();
  }
});

test('one featured review in the page data does not hide the review cards in the markup', async () => {
  const { server, port } = await listen(createApp());
  try {
    const nextData = { props: { featured: { review: { id: 'f1', rating: 5, body: 'Featured: the best tee I own.', author: 'Shop' } } } };
    const cards = ['Soft cotton and the fit is right for me.', 'Shrank a little after the first hot wash.', 'Good weight, runs a touch long in the body.']
      .map((t) => `<div class="review-card"><p class="review-body-copy">${t}</p></div>`).join('');
    const html = `<!DOCTYPE html><html><head><title>Tee</title></head><body><h1>Tee</h1>${cards}
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'FEAT-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    // Three anonymous cards in the markup plus the featured review.
    assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 4);
  } finally {
    server.close();
  }
});

test('a whole-card text with a very short review still matches its review by the same reviewer', async () => {
  const { server, port } = await listen(createApp());
  try {
    const nextData = { props: { reviews: { total: 1, items: [{ id: 'r1', rating: 5, title: 'Perfect for every occasion', body: 'Good', author: 'sachit k.' }] } } };
    const html = `<!DOCTYPE html><html><head><title>Oxford</title></head><body><h1>Oxford</h1>
      <div class="review-card" data-author="sachit k." data-rating="5"><span>Rated 5 out of 5 stars2 months agoPerfect for every occasion GoodRead More</span></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'OXF-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 1);
  } finally {
    server.close();
  }
});

test('a card cut short by "Read more" matches its review by the same reviewer through the title', async () => {
  const { server, port } = await listen(createApp());
  try {
    const nextData = { props: { reviews: { total: 1, items: [{ id: 'r1', rating: 3, title: 'Decent shirt, don’t love the material', body: 'It’s a bit of a cheap material. Not like T-shirts that are a heavier weight.', author: 'Aaron S.' }] } } };
    const html = `<!DOCTYPE html><html><head><title>Oxford</title></head><body><h1>Oxford</h1>
      <div class="review-card" data-author="Aaron S." data-rating="3"><span>Rated 3 out of 5 stars10 months agoDecent shirt, don’t love the material It’s a bi… Read More</span></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'OXF-2', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 1);
  } finally {
    server.close();
  }
});

test('a Shopify page with no SKU uses the product id from its analytics object', async () => {
  const { server, port } = await listen(createApp());
  try {
    const html = `<!DOCTYPE html><html><head><title>Mill Shirt</title>
      <script>var meta = {"product":{"id":7123456789012,"vendor":"Alex Mill"}};</script></head><body><h1>Mill Shirt</h1>
      <div class="review-card" data-author="Sam" data-rating="5"><p class="review-body-copy">Great oxford, true to size.</p></div>
      <script>var recs = [{"product":{"id":9999999999999}}];</script></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, url: undefined, commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    assert.equal((scraped.json.report as { sku: string }).sku, '7123456789012');
  } finally {
    server.close();
  }
});

test('cards by a placeholder reviewer, or with a short text inside another word, are not merged into a review', async () => {
  const { server, port } = await listen(createApp());
  try {
    const nextData = { props: { reviews: { total: 1, items: [{ id: 'r1', rating: 5, title: 'Great shirt', body: 'Ok', author: 'Verified Buyer' }] } } };
    const html = `<!DOCTYPE html><html><head><title>Tee</title></head><body><h1>Tee</h1>
      <div class="review-card" data-author="Verified Buyer" data-rating="4"><p class="review-body-copy">Great shirt! Looks good, runs a bit small.</p></div>
      <div class="review-card" data-author="Dana" data-rating="4"><p class="review-body-copy">Looks good on me, fits well.</p></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { reviews: { total: 2, items: [...nextData.props.reviews.items, { id: 'r2', rating: 4, title: 'x', body: 'Ok', author: 'Dana' }] } } })}</script></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'PH-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    // Two page-data reviews plus both cards: "Verified Buyer" identifies no one, and "ok" inside "Looks" is not a match.
    assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 4);
  } finally {
    server.close();
  }
});

test('two shoppers who wrote the same words are two reviews; the same text by one shopper is one', async () => {
  const { server, port } = await listen(createApp());
  try {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Essential Tee',
      sku: 'Z-1',
      review: [
        { '@type': 'Review', author: 'Ann', reviewBody: 'Love it, fits great.', reviewRating: { ratingValue: 5 } },
        { '@type': 'Review', author: 'Bob', reviewBody: 'Love it, fits great.', reviewRating: { ratingValue: 4 } },
      ],
    };
    const html = `<!DOCTYPE html><html><head><title>Essential Tee</title>
      <script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>Essential Tee</h1>
      <div class="review-card" data-author="Ann" data-rating="5"><p class="review-body-copy">Love it, fits great.</p></div></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    // Ann and Bob are two reviews; Ann's card is Ann's review again.
    assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 2);
  } finally {
    server.close();
  }
});
