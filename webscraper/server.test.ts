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
