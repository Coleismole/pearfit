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
      ${card('facebook Share Review by Anonymous User')}
      ${card("Saw this on Facebook and it fits true to size, I'm 6'1 and got the L")}
      </body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'ROOTS-T', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { reviews: { author: string; text: string }[] };
    // The share line is dropped; a real review that mentions Facebook is kept.
    assert.deepEqual(report.reviews.map((r) => r.author), ['LisaKH', 'Anonymous']);
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

    // The same reviewer written "Eddie K." in one source and "Eddie K" in another is one review.
    const ld2 = { '@context': 'https://schema.org', '@type': 'Product', name: 'Logo Tee', sku: 'P-1',
      review: [{ '@type': 'Review', author: 'Eddie K', reviewBody: 'Nice T-shirt, delivered on time.', reviewRating: { ratingValue: 5 } }] };
    const next = { props: { reviews: { total: 1, items: [{ id: 'r1', rating: 5, body: 'Nice T-shirt, delivered on time.', author: 'Eddie K.' }] } } };
    const html2 = `<!DOCTYPE html><html><head><title>Logo Tee</title><script type="application/ld+json">${JSON.stringify(ld2)}</script></head>
      <body><h1>Logo Tee</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></body></html>`;
    const scraped2 = await request(port, 'POST', '/api/scrape', { rawHtml: html2, commitToDb: false, render: 'never' });
    assert.equal((scraped2.json.report as { totalReviews: number }).totalReviews, 1);

    // A full name in one source and the short form in another ("Eddie Kowalski", "Eddie K.") is one reviewer.
    const ld3 = { ...ld2, review: [{ ...ld2.review[0], author: 'Eddie Kowalski' }] };
    const html3 = html2.replace(JSON.stringify(ld2), JSON.stringify(ld3));
    const scraped3 = await request(port, 'POST', '/api/scrape', { rawHtml: html3, commitToDb: false, render: 'never' });
    assert.equal((scraped3.json.report as { totalReviews: number }).totalReviews, 1);
  } finally {
    server.close();
  }
});

test('/api/posthog-config hands the browser the public PostHog settings, empty when unset', async () => {
  const before = { token: process.env.POSTHOG_PROJECT_TOKEN, host: process.env.POSTHOG_HOST };
  const { server, port } = await listen(createApp());
  try {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    delete process.env.POSTHOG_HOST;
    const unset = await request(port, 'GET', '/api/posthog-config');
    assert.equal(unset.status, 200);
    assert.deepEqual(unset.json, { projectToken: '', host: '' });

    process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_token';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    const set = await request(port, 'GET', '/api/posthog-config');
    assert.deepEqual(set.json, { projectToken: 'phc_test_token', host: 'https://eu.i.posthog.com' });
  } finally {
    if (before.token === undefined) delete process.env.POSTHOG_PROJECT_TOKEN;
    else process.env.POSTHOG_PROJECT_TOKEN = before.token;
    if (before.host === undefined) delete process.env.POSTHOG_HOST;
    else process.env.POSTHOG_HOST = before.host;
    server.close();
  }
});

test('reviews are kept for the product id the page names in its review widget', async () => {
  const { server, port } = await listen(createApp());
  try {
    const items = [1, 2, 3].map((n) => ({ id: `r${n}`, rating: 5, body: `Fits well, review number ${n}, true to size.`, author: `Shopper ${n}`, product_id: '15436121243721' }));
    const page = (widgets: string) => `<!DOCTYPE html><html><head><title>The Pit Stop</title>
      <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'The Pit Stop', sku: '502261-132' })}</script></head>
      <body><h1>The Pit Stop</h1>${widgets}
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { reviews: { total: 3, items } } })}</script></body></html>`;
    const total = async (html: string) => {
      const res = await request(port, 'POST', '/api/scrape', { rawHtml: html, commitToDb: false, render: 'never' });
      return (res.json.report as { totalReviews: number } | undefined)?.totalReviews ?? 0;
    };
    // The widget names the product the reviews belong to.
    assert.equal(await total(page('<div class="yotpo-widget-instance" data-yotpo-product-id="15436121243721"></div>')), 3);
    // A carousel of several rated products names none of them as this page's product.
    assert.equal(
      await total(page('<div data-yotpo-product-id="15436121243721"></div><div data-yotpo-product-id="99999999999"></div>')),
      0,
    );
  } finally {
    server.close();
  }
});

test('a page that states one Shopify product id names its product, a page that states several does not', async () => {
  const { server, port } = await listen(createApp());
  try {
    const items = [1, 2, 3].map((n) => ({ id: `r${n}`, rating: 5, body: `Runs small but I love it, review ${n}.`, author: `Buyer ${n}`, product_id: '6264568643778' }));
    const page = (state: string) => `<!DOCTYPE html><html><head><title>Tank</title></head><body><h1>Tank</h1>
      <script>window.__STATE__ = ${JSON.stringify(state)};</script>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { reviews: { total: 3, items } } })}</script></body></html>`;
    const total = async (html: string) => {
      const res = await request(port, 'POST', '/api/scrape', { rawHtml: html, commitToDb: false, render: 'never', sku: 'TANK-1' });
      return (res.json.report as { totalReviews: number } | undefined)?.totalReviews ?? 0;
    };
    assert.equal(await total(page('gid://shopify/Product/6264568643778')), 3);
    assert.equal(await total(page('gid://shopify/Product/6264568643778 gid://shopify/Product/7777777777777')), 0);
  } finally {
    server.close();
  }
});

test('AfterShip review cards (hashed class names) are read from the markup', async () => {
  const { server, port } = await listen(createApp());
  try {
    const card = (name: string, text: string) => `<div class="aftership-reviews-widget-v2_cardContainer--ZKekts3b"><div>Aug 31, 2025</div><div><div>${name}</div></div><div class="aftership-reviews-widget-v2_reviewTitle--OmAWeh0V">Perfect fit</div><div><div>${text}</div></div></div>`;
    const html = `<!DOCTYPE html><html><head><title>Kids Zip Jumper</title></head><body><h1>Kids Zip Jumper</h1>
      ${card('Miriam L.', 'This jumper fits perfectly. The arm length is just right.')}
      ${card('Jon K.', 'Runs a little small, order one size up for my son.')}
      </body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'AFTERSHIP-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number };
    assert.equal(report.totalReviews, 2);
  } finally {
    server.close();
  }
});

test('Judge.me: the first page of reviews in the widget data attribute is read', async () => {
  const { server, port } = await listen(createApp());
  try {
    const data = {
      number_of_reviews: 3,
      reviews: [
        { uuid: 'j1', title: '', rating: 5, body_html: '<p>Perfect fit, true to size.</p>', reviewer_name: 'Gil', created_at: '2025-12-30T18:49:40.000Z' },
        { uuid: 'j2', title: 'Warm', rating: 4, body_html: '<p>Heavy wool, runs a little long.</p>', reviewer_name: 'Dale', created_at: '2025-12-28T18:19:02.987Z' },
        { uuid: 'j3', title: '', rating: 5, body_html: '<p>He loves it so far.</p>', reviewer_name: 'Morgan', created_at: '2025-10-15T15:25:51.000Z' },
      ],
      pagination: { total_pages: 1, current_page: 1, per_page: 3 },
    };
    const attr = JSON.stringify(data).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const html = `<!DOCTYPE html><html><head><title>Wool Jacket</title></head><body><h1>Wool Jacket</h1>
      <div class="jdgm-review-widget-data-json" hidden data-jdgm-json="${attr}"></div></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'JDGM-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; scraperTelemetry: { reportedReviewCount: number | null } };
    assert.equal(report.totalReviews, 3);
    assert.equal(report.scraperTelemetry.reportedReviewCount, 3);
  } finally {
    server.close();
  }
});

test('Halara review items (utility-class markup) are read, with the purchased size', async () => {
  const { server, port } = await listen(createApp());
  try {
    const item = (who: string, size: string, text: string) =>
      `<div class="detailReviewItem flex"><div class="text-[12px]">${who}</div><div class="text-[15px]">2026/11/09</div>` +
      `<div class="font-bold"><span>Size Purchased</span>: ${size}</div>` +
      `<div class="DetailReviewsOldCommentWithEllipsis"><div class="line-clamp-2">${text}</div></div>` +
      `<div><span>Fits</span>:<span>True to size</span></div></div>`;
    const html = `<!DOCTYPE html><html><head><title>Tank Top</title></head><body><h1>Tank Top</h1>
      ${item('1***3', 'L', 'These tank tops are so lovely. They fit true to your regular size.')}
      ${item('a***b', 'S', 'Soft fabric, but the straps run a little long for me.')}
      ${item('c***d', 'S', 'Soft fabric, but the straps run a little long for me.')}
      </body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'HALARA-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; reviews: { normalizedSize: string | null }[] };
    // Two shoppers with different masked names who wrote the same words are two reviews.
    assert.equal(report.totalReviews, 3);
    assert.deepEqual(report.reviews.map((r) => r.normalizedSize).sort(), ['L', 'S', 'S']);
  } finally {
    server.close();
  }
});

test('Salesforce storefront review cards (data-score on the card) are read', async () => {
  const { server, port } = await listen(createApp());
  try {
    const card = (score: number, text: string) =>
      `<div class="product-detail__rating__review px-0 show" data-date="1.7714592E12" data-score="${score}">` +
      `<div class="product-detail__rating__review-header"><div class="product-detail__rating__review-date">19 February 2026</div></div>` +
      `<div class="product-detail__rating__review-message">${text}</div></div>`;
    const html = `<!DOCTYPE html><html><head><title>Wool Mittens</title></head><body><h1>Wool Mittens</h1>
      ${card(5, 'Lovely mittens, nice and warm and very stylish.')}${card(2, 'Far too small for my hands, sent them back.')}</body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'SFCC-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; reviews: { rating: number }[] };
    assert.equal(report.totalReviews, 2);
    assert.deepEqual(report.reviews.map((r) => r.rating).sort(), [2, 5]);
  } finally {
    server.close();
  }
});

test('Halara product-page review articles and their star overlays are read with a rating', async () => {
  const { server, port } = await listen(createApp());
  try {
    const stars = (widths: number[]) =>
      `<div>${widths.map((w) => `<span class="relative"><span class="inline-block"><svg></svg><span class="absolute overflow-hidden" style="width: ${w}%;"><svg></svg></span></span></span>`).join('')}</div>`;
    const article = (who: string, widths: number[], text: string) =>
      `<article><div role="button" aria-label="review item">${stars(widths)}<span>${who}</span><span>Nov 8, 2026</span>` +
      `<span>Size:</span><span>L</span></div><div role="button"><p>Fit: True to size</p><div>${text}</div></div></article>`;
    const html = `<!DOCTYPE html><html><head><title>Tank</title></head><body><h1>Tank</h1>
      ${article('1***', [100, 100, 100, 100, 100], 'Lovely tank top, fits true to size and very soft.')}
      ${article('b***', [100, 100, 0, 0, 0], 'Straps are too long and the fabric pilled quickly.')}</body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'HALARA-2', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; reviews: { rating: number; normalizedSize: string | null }[] };
    assert.equal(report.totalReviews, 2);
    assert.deepEqual(report.reviews.map((r) => r.rating).sort(), [2, 5]);
    assert.deepEqual(report.reviews.map((r) => r.normalizedSize), ['L', 'L']);
  } finally {
    server.close();
  }
});

test('Loox review cards: author, date, rating from the star label, and the size from "Item type"', async () => {
  const { server, port } = await listen(createApp());
  try {
    const card = (id: string, who: string, stars: number, text: string, itemType: string) =>
      `<div data-id="${id}" class="grid-item-wrap"><div data-id="${id}" role="button" class="grid-item"><div class="main">` +
      `<div class="feed-item-title-wrapper"><div class="title">${who}</div></div><div class="time">10/6/2026</div>` +
      `<div class="stars"><span aria-label="Rating icons: ${stars} / 5 star review" role="img"><svg></svg></span></div>` +
      `<div class="text-block"><div class="main-text">${text}</div></div>` +
      `<div class="item-type-block"><span class="small item-type-title">Item type:</span> <span class="value item-type-value">${itemType}</span></div>` +
      `</div></div></div>`;
    const html = `<!DOCTYPE html><html><head><title>Camp Sweater</title></head><body><h1>Camp Sweater</h1>
      ${card('a1', 'Scott T.', 5, 'I like the way it fits, it is true to size, and the fabric is great.', 'RUST / L')}
      ${card('a2', 'Jerry J.', 4, 'Love the camp sweater, a little baggy through the body though.', 'PHANTOM / M')}</body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'LOOX-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; reviews: { rating: number; normalizedSize: string | null; author: string }[] };
    assert.equal(report.totalReviews, 2);
    assert.deepEqual(report.reviews.map((r) => [r.author, r.rating, r.normalizedSize]), [['Scott T.', 5, 'L'], ['Jerry J.', 4, 'M']]);
  } finally {
    server.close();
  }
});

test('Review cards with hashed CSS-module class names are read (Testfreaks dialog)', async () => {
  const { server, port } = await listen(createApp());
  try {
    const card = (who: string, text: string) =>
      `<div class="gA1Nqq_review"><div class="gA1Nqq_reviewHeader"><span class="gA1Nqq_author">${who}</span><span class="gA1Nqq_date">2026.08.12</span></div>` +
      `<p class="gA1Nqq_reviewContent">${text}</p></div>`;
    const html = `<!DOCTYPE html><html><head><title>Logo Hoodie</title></head><body><h1>Logo Hoodie</h1>
      <dialog open><div class="gA1Nqq_reviewsList">${card('Pascal', 'As expected, the hoodie fits true to size.')}${card('Taeyoo C', 'Fits great but the hood is too pointy on top.')}</div></dialog></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'TF-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; reviews: { author: string }[] };
    assert.equal(report.totalReviews, 2);
    assert.deepEqual(report.reviews.map((r) => r.author), ['Pascal', 'Taeyoo C']);
  } finally {
    server.close();
  }
});

test('mock store pages are found by their own slugs only, and bad body types are a 400', async () => {
  const { server, port } = await listen(createApp());
  try {
    const missing = await request(port, 'GET', '/api/mock-store/constructor/raw');
    assert.equal(missing.status, 404);
    const badBody = await request(port, 'POST', '/api/scrape', { url: 42 });
    assert.equal(badBody.status, 400);
  } finally {
    server.close();
  }
});

test('Phase Eight: a card with only a rating, a date and a size is not a review whose words are its date', async () => {
  const { server, port } = await listen(createApp());
  try {
    // Markup as the store writes it: the message element exists and is empty when the shopper wrote nothing.
    const card = (epochMs: string, score: number, date: string, size: string, text: string) =>
      `<div class="product-detail__rating__review container review-data-new px-0 show " data-date="${epochMs}" data-score="${score}">` +
      `<div class="product-detail__rating__review-header row no-gutters"><div class="product-detail__rating__review-score">${'<i class="rating-star"></i>'.repeat(score)}</div>` +
      `<div class="product-detail__rating__review-date reviewDate review-items">${date}</div></div>` +
      `<div class="product-detail__rating__review-message row no-gutters review_message">${text}</div>` +
      `<div class="product-detail__rating__review-footer"><div class="product-detail__rating__review-detail--size">Size: ${size}</div>` +
      `<div class="product-detail__rating__review-detail">Purchased: Web</div><div class="product-detail__rating__review-detail">Location: Madinah</div></div></div>`;
    const html = `<!DOCTYPE html><html><head><title>Shirt Dress</title></head><body><h1>Shirt Dress</h1>
      <div class="review-msg"><span class="product-detail__rating__visible-reviews">4</span> of 10 reviews</div>
      ${card('1.7888256E12', 5, '08 September 2026', '10', 'Beautiful and elegant')}
      ${card('1.7367264E12', 4, '13 January 2025', '14', '')}
      ${card('1.7362944E12', 3, '08 January 2025', '16', 'Material and underskirt was not as in the picture')}
      ${card('1.7291232E12', 5, '17 October 2024', '16', '')}</body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'PH8-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as {
      totalReviews: number;
      reviews: { body: string; title: string; date: string; rating: number }[];
    };
    // The two cards with no words are not reviews. Their date used to be taken as the body.
    assert.equal(report.totalReviews, 2);
    assert.deepEqual(report.reviews.map((r) => r.body), ['Beautiful and elegant', 'Material and underskirt was not as in the picture']);
    // The date line is not the title either, and data-date (Unix ms, written as a float) is read as an ISO date.
    assert.deepEqual(report.reviews.map((r) => r.title), ['', '']);
    // 1788825600000 ms = 2026-09-08; 1736294400000 ms = 2025-01-08 (both 00:00 UTC).
    assert.deepEqual(report.reviews.map((r) => r.date), ['2026-09-08T00:00:00.000Z', '2025-01-08T00:00:00.000Z']);
    assert.deepEqual(report.reviews.map((r) => r.rating), [5, 3]);
  } finally {
    server.close();
  }
});

test('Nudie Jeans: rating-only cards in the reviews dialog are not reviews and do not leak "Verified Buyer" as a body', async () => {
  const { server, port } = await listen(createApp());
  try {
    // After "Load more reviews" the dialog holds every review. A card with stars, a name and a date and no
    // `reviewContent` element is a rating with no words (class "noContent").
    const withText = (who: string, text: string) =>
      `<div class="gA1Nqq_review"><div class="gA1Nqq_reviewHeader"><div class="gA1Nqq_authorInfo"><span class="gA1Nqq_author">${who}</span><span class="gA1Nqq_verified">Verified Buyer</span></div><span class="gA1Nqq_date">2026.08.12</span></div>` +
      `<div class="gA1Nqq_reviewRating"><div class="M6bWGW_stars" aria-hidden="true"><svg></svg></div></div><p class="gA1Nqq_reviewContent">${text}</p></div>`;
    const ratingOnly = (who: string) =>
      `<div class="gA1Nqq_review"><div class="gA1Nqq_reviewHeader"><div class="gA1Nqq_authorInfo"><span class="gA1Nqq_author">${who}</span><span class="gA1Nqq_verified">Verified Buyer</span></div><span class="gA1Nqq_date">2026.09.01</span></div>` +
      `<div class="gA1Nqq_reviewRating gA1Nqq_noContent"><div class="M6bWGW_stars" aria-hidden="true"><svg></svg></div></div></div>`;
    const html = `<!DOCTYPE html><html><head><title>Logo Hoodie</title></head><body><h1>Logo Hoodie</h1>
      <dialog open><h2 id="reviews-title">Reviews</h2><sup class="gA1Nqq_count">6</sup><div class="gA1Nqq_reviewsList">
      ${withText('Pascal', 'As expected, the hoodie fits true to size.')}${withText('David', 'Great fit and nice quality!')}
      ${ratingOnly('Hugo T')}${ratingOnly('Andras V')}${ratingOnly('Jens L')}${ratingOnly('Henrik I')}
      </div></dialog></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'TF-2', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; reviews: { author: string; body: string; title: string }[] };
    assert.equal(report.totalReviews, 2);
    // The author is the name span, not the "name + Verified Buyer" wrapper, and the badge is not a title.
    assert.deepEqual(report.reviews.map((r) => [r.author, r.title, r.body]), [
      ['Pascal', '', 'As expected, the hoodie fits true to size.'],
      ['David', '', 'Great fit and nice quality!'],
    ]);
  } finally {
    server.close();
  }
});

test('Rawganique: a hidden Judge.me preview badge that says "2 reviews" holds no review text, so there is nothing to read', async () => {
  const { server, port } = await listen(createApp());
  try {
    // The page installs only the preview badge (data-auto-install="false", display:none). The review widget is
    // not on the page and the page asks for no review data, so the two reviews cannot be read from it.
    const html = `<!DOCTYPE html><html><head><title>Organic Cotton Carpenter Jeans</title></head><body><h1>Organic Cotton Carpenter Jeans</h1>
      <div class="jdgm-widget jdgm-preview-badge" data-id="5728602652839" data-auto-install="false">
        <div style="display:none" class="jdgm-prev-badge" data-average-rating="5.00" data-number-of-reviews="2" data-number-of-questions="0">
          <span class="jdgm-prev-badge__stars" data-score="5.00" aria-label="5.00 stars" role="button"><span class="jdgm-star jdgm--on"></span></span>
          <span class="jdgm-prev-badge__text">2 reviews</span></div></div></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'RAW-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 422, JSON.stringify(scraped.json));
    assert.match(String(scraped.json.error), /No reviews found/);
  } finally {
    server.close();
  }
});

test('a card whose stars cannot be read has no rating, not a neutral 3', async () => {
  const { server, port } = await listen(createApp());
  try {
    const html = `<!DOCTYPE html><html><head><title>Plain Tee</title></head><body><h1>Plain Tee</h1>
      <div class="review-card" data-author="Ana"><p class="review-body-copy">Runs a little small, I ordered a medium.</p></div>
      <div class="review-card" data-author="Bo" data-rating="0"><p class="review-body-copy">True to size and very soft.</p></div>
      <div class="review-card" data-author="Cy" data-rating="4"><p class="review-body-copy">Great fit, a bit long in the body.</p></div></body></html>`;
    const scraped = await request(port, 'POST', '/api/scrape', { rawHtml: html, sku: 'NORATE-1', commitToDb: false, render: 'never' });
    assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
    const report = scraped.json.report as { totalReviews: number; reviews: { author: string; rating: number | null }[] };
    assert.equal(report.totalReviews, 3);
    assert.deepEqual(report.reviews.map((r) => [r.author, r.rating]), [['Ana', null], ['Bo', null], ['Cy', 4]]);
  } finally {
    server.close();
  }
});

/**
 * Runs `body` with fetch answering for the made-up host shop.example from `pages` (path -> status and html, or a
 * redirect). Requests to the test server itself go through. Returns the shop.example addresses that were asked.
 */
async function withShopFetch(
  pages: Record<string, { status?: number; html?: string; location?: string }>,
  body: (asked: string[]) => Promise<void>,
): Promise<string[]> {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!address.startsWith('https://shop.example')) return realFetch(input, init);
    asked.push(address);
    const page = pages[new URL(address).pathname];
    if (!page) return new Response('not found', { status: 404 });
    return new Response(page.html ?? '', {
      status: page.status ?? 200,
      headers: { 'content-type': 'text/html', ...(page.location ? { location: page.location } : {}) },
    });
  }) as typeof fetch;
  try {
    await body(asked);
  } finally {
    globalThis.fetch = realFetch;
  }
  return asked;
}

const SOURCE_REVIEWS = `<article class="review-card" data-author="Ana" data-rating="4"><p class="review-body-copy">Runs a little small, I ordered a medium.</p></article>
  <article class="review-card" data-author="Bo" data-rating="5"><p class="review-body-copy">True to size and very soft.</p></article>`;
const productPage = (links: string) => `<!DOCTYPE html><html><head><title>Mens Tee</title></head><body><h1>Mens Tee</h1>${SOURCE_REVIEWS}${links}</body></html>`;
const GUIDE_TABLE_CM = `<h2>Men's size chart</h2><table><caption>Size guide (cm)</caption>
  <tr><th>Size</th><th>Pit to pit</th><th>Length</th></tr><tr><td>M</td><td>54</td><td>72</td></tr><tr><td>L</td><td>57</td><td>74</td></tr></table>`;

test('a page whose reviews are all in its source still gets its size chart from the guide page it links to', async () => {
  const { server, port } = await listen(createApp());
  try {
    const asked = await withShopFetch(
      {
        '/products/tee': { html: productPage('<a href="/pages/size-chart">Size chart</a><a href="https://other.example/size-guide">Size guide</a><a href="/products/other-tee">Size guide</a>') },
        '/pages/size-chart': { html: `<!DOCTYPE html><html><body><h1>Size chart</h1>${GUIDE_TABLE_CM}</body></html>` },
      },
      async () => {
        const scraped = await request(port, 'POST', '/api/scrape', { url: 'https://shop.example/products/tee', commitToDb: false, render: 'never' });
        assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
        assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 2);
        assert.deepEqual(scraped.json.sizeChart, [
          { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null },
          { size: 'L', sortOrder: 3, chest_cm: 57, length_cm: 74, sleeve_cm: null },
        ]);
      },
    );
    // The product page and the one guide on the same site; not the other site, not another product.
    assert.deepEqual(asked, ['https://shop.example/products/tee', 'https://shop.example/pages/size-chart']);
  } finally {
    server.close();
  }
});

test('a size guide that refuses the request ends the guide fetch, and the reviews still stand', async () => {
  const { server, port } = await listen(createApp());
  try {
    const asked = await withShopFetch(
      {
        '/products/tee': { html: productPage('<a href="/pages/size-chart">Size chart</a><a href="/pages/fit-guide">Fit guide</a>') },
        '/pages/size-chart': { status: 403, html: 'Forbidden' },
        '/pages/fit-guide': { html: GUIDE_TABLE_CM },
      },
      async () => {
        const scraped = await request(port, 'POST', '/api/scrape', { url: 'https://shop.example/products/tee', commitToDb: false, render: 'never' });
        assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
        assert.equal((scraped.json.report as { totalReviews: number }).totalReviews, 2);
        assert.deepEqual(scraped.json.sizeChart, []);
      },
    );
    assert.deepEqual(asked, ['https://shop.example/products/tee', 'https://shop.example/pages/size-chart']);
  } finally {
    server.close();
  }
});

test('a size guide that redirects to another site is not followed', async () => {
  const { server, port } = await listen(createApp());
  try {
    const asked = await withShopFetch(
      {
        '/products/tee': { html: productPage('<a href="/pages/size-chart">Size chart</a>') },
        '/pages/size-chart': { status: 302, location: 'https://elsewhere.example/size-chart' },
      },
      async () => {
        const scraped = await request(port, 'POST', '/api/scrape', { url: 'https://shop.example/products/tee', commitToDb: false, render: 'never' });
        assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
        assert.deepEqual(scraped.json.sizeChart, []);
      },
    );
    assert.deepEqual(asked, ['https://shop.example/products/tee', 'https://shop.example/pages/size-chart']);
  } finally {
    server.close();
  }
});

test('a linked size guide that only gives body ranges leaves the chart empty, not guessed', async () => {
  const { server, port } = await listen(createApp());
  try {
    await withShopFetch(
      {
        '/products/tee': { html: productPage('<a href="/pages/size-guide">Size guide</a>') },
        '/pages/size-guide': {
          html: `<!DOCTYPE html><html><body><h1>Size guide</h1><table><caption>Body measurements (in)</caption>
            <tr><th>Size</th><th>Chest</th><th>Waist</th></tr><tr><td>M</td><td>38-40</td><td>32-34</td></tr><tr><td>L</td><td>41-43</td><td>35-37</td></tr></table></body></html>`,
        },
      },
      async () => {
        const scraped = await request(port, 'POST', '/api/scrape', { url: 'https://shop.example/products/tee', commitToDb: false, render: 'never' });
        assert.equal(scraped.status, 200, JSON.stringify(scraped.json));
        assert.deepEqual(scraped.json.sizeChart, []);
      },
    );
  } finally {
    server.close();
  }
});
