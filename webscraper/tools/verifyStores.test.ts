import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScrapeOutcome, ScrapeResponseBody } from './scraperClient.ts';
import {
  buildReport,
  classifyOutcome,
  isRefusal,
  renderMarkdownReport,
  runPool,
  selectStores,
  summarizeResults,
  type StoreResult,
  type StoreToCheck,
} from './verifyStores.ts';

const STORE: StoreToCheck = {
  name: 'Ten Thousand',
  domain: 'tenthousand.cc',
  url: 'https://www.tenthousand.cc/products/core-tee',
  platform: 'Yotpo',
  expected_min_reviews: 98,
  has_size_chart: false,
};

function outcome(status: number, body: ScrapeResponseBody | null, over: Partial<ScrapeOutcome> = {}): ScrapeOutcome {
  return { status, secs: 12.4, body, networkError: null, ...over };
}

function reviews(read: number, stated: number | null = null, chartRows = 0): ScrapeResponseBody {
  return {
    report: { name: 'Core Tee', totalReviews: read, reviews: [], scraperTelemetry: { reportedReviewCount: stated, reviewSources: ['yotpo'] } },
    sizeChart: Array.from({ length: chartRows }, () => ({})),
  };
}

test('half of the expected reviews is enough, one fewer is not', () => {
  // 98 expected: the line is 49.
  assert.equal(classifyOutcome(STORE, outcome(200, reviews(49, 98))).status, 'ok');
  assert.equal(classifyOutcome(STORE, outcome(200, reviews(120, 400))).status, 'ok');
  const fewer = classifyOutcome(STORE, outcome(200, reviews(48, 98)));
  assert.equal(fewer.status, 'fewer');
  assert.equal(fewer.regression, true);
  assert.equal(fewer.minAllowed, 49);
  assert.match(fewer.detail, /read 48, expected at least 49/);
  // An odd expected count rounds the line up: half of 111 is 55.5, so 56 reviews pass and 55 do not.
  const odd = { ...STORE, expected_min_reviews: 111 };
  assert.equal(classifyOutcome(odd, outcome(200, reviews(56))).status, 'ok');
  const short = classifyOutcome(odd, outcome(200, reviews(55)));
  assert.equal(short.status, 'fewer');
  assert.match(short.detail, /expected at least 56/);
});

test('an expected count of 1 needs one review; zero reviews is never enough', () => {
  const one = { ...STORE, expected_min_reviews: 1 };
  assert.equal(classifyOutcome(one, outcome(200, reviews(1))).status, 'ok');
  assert.equal(classifyOutcome(one, outcome(200, reviews(0))).status, 'fewer');
});

test('a page with no reviews is fewer, and carries the scraper\'s words', () => {
  const result = classifyOutcome(STORE, outcome(422, { error: 'No reviews found on the page. If the reviews show in your own browser, copy them (or View Source) and paste into the raw HTML box instead.' }));
  assert.equal(result.status, 'fewer');
  assert.equal(result.reviewsRead, 0);
  assert.equal(result.detail, 'No reviews found on the page.');
});

test('refusals: a status, the scraper\'s refusal wording, a block page', () => {
  assert.equal(isRefusal(403, ''), true);
  assert.equal(isRefusal(429, ''), true);
  assert.equal(isRefusal(418, ''), true);
  assert.equal(isRefusal(503, ''), true);
  assert.equal(isRefusal(200, ''), false);
  assert.equal(isRefusal(404, 'https://x/p returned HTTP 404'), false);
  assert.equal(isRefusal(400, 'https://x/p sent the request to a bot check: the store refuses automated requests.'), true);
  assert.equal(isRefusal(422, 'No reviews found on the page. The store showed the headless browser a block page ("Access Denied"): it refuses automated requests.'), true);
  assert.equal(isRefusal(422, 'Headless browser got HTTP 403.'), true);
  const result = classifyOutcome(STORE, outcome(403, { error: 'https://www.tenthousand.cc/products/core-tee returned HTTP 403: the store refuses automated requests.' }));
  assert.equal(result.status, 'refused');
  assert.equal(result.regression, true);
});

test('a gone product page is stale, and a maintenance page is down: neither counts as a regression', () => {
  const stale = classifyOutcome(STORE, outcome(404, { error: 'https://www.tenthousand.cc/products/core-tee returned HTTP 404.' }));
  assert.equal(stale.status, 'stale');
  assert.equal(stale.regression, false);
  const staleRender = classifyOutcome(STORE, outcome(422, { error: 'No reviews found on the page. Headless browser got HTTP 404.' }));
  assert.equal(staleRender.status, 'stale');
  const down = classifyOutcome(STORE, outcome(422, { error: "No reviews found on the page. The store's site is showing a maintenance page. It is down; try again later." }));
  assert.equal(down.status, 'down');
  assert.equal(down.regression, false);
  assert.equal(classifyOutcome(STORE, outcome(502, { error: 'https://x/p returned HTTP 502.' })).status, 'down');
});

test('no answer from the scraper, or a scraper failure, is an error', () => {
  const timeout = classifyOutcome(STORE, outcome(0, null, { networkError: 'no answer from the scraper within 180 s' }));
  assert.equal(timeout.status, 'error');
  assert.equal(timeout.regression, true);
  assert.equal(timeout.detail, 'no answer from the scraper within 180 s');
  const crashed = classifyOutcome(STORE, outcome(500, { error: 'Unexpected scraper error' }));
  assert.equal(crashed.status, 'error');
  assert.match(crashed.detail, /HTTP 500: Unexpected scraper error/);
});

test('a size-chart-only store passes on its chart rows, and a chart that went missing is only a warning', () => {
  const kotn = { ...STORE, name: 'Kotn', expected_min_reviews: 0, has_size_chart: true };
  assert.equal(classifyOutcome(kotn, outcome(422, { error: 'No reviews found on the page. A size chart with 6 sizes was read and not stored.', sizeChart: [{}, {}, {}, {}, {}, {}] })).status, 'ok');
  assert.equal(classifyOutcome(kotn, outcome(422, { error: 'No reviews found on the page.', sizeChart: [] })).status, 'fewer');

  const withChart = { ...STORE, has_size_chart: true };
  const kept = classifyOutcome(withChart, outcome(200, reviews(98, 98, 6)));
  assert.equal(kept.chartMissing, false);
  const lost = classifyOutcome(withChart, outcome(200, reviews(98, 98, 0)));
  assert.equal(lost.status, 'ok');
  assert.equal(lost.chartMissing, true);
  assert.equal(lost.regression, false);
  // No chart expected, none read: nothing to warn about.
  assert.equal(classifyOutcome(STORE, outcome(200, reviews(98, 98, 0))).chartMissing, false);
});

test('selectStores narrows by domain, then samples evenly, then limits', () => {
  const stores = Array.from({ length: 10 }, (_, i) => ({ domain: `shop${i}.example` }));
  assert.deepEqual(selectStores(stores, { only: ['shop3', 'www.shop7.example'] }).map((s) => s.domain), ['shop3.example', 'shop7.example']);
  assert.deepEqual(selectStores(stores, { sample: 5 }).map((s) => s.domain), ['shop0.example', 'shop2.example', 'shop4.example', 'shop6.example', 'shop8.example']);
  assert.deepEqual(selectStores(stores, { limit: 2 }).map((s) => s.domain), ['shop0.example', 'shop1.example']);
  assert.equal(selectStores(stores, {}).length, 10);
  assert.equal(selectStores(stores, { sample: 50 }).length, 10);
});

test('runPool keeps result order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const results = await runPool([30, 5, 20, 1, 10], 2, async (ms, index) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, ms));
    running--;
    return index * 10;
  });
  assert.deepEqual(results, [0, 10, 20, 30, 40]);
  assert.equal(peak, 2);
  assert.deepEqual(await runPool([], 2, async () => 1), []);
});

function stored(status: StoreResult['status'], over: Partial<StoreResult> = {}): StoreResult {
  return {
    ...classifyOutcome(STORE, outcome(200, reviews(98, 98))),
    status,
    regression: status === 'fewer' || status === 'refused' || status === 'error',
    attempts: 1,
    ...over,
  };
}

test('the regression rate counts fewer, refused and errors, not stale or down', () => {
  const results = [stored('ok'), stored('ok'), stored('ok'), stored('ok'), stored('fewer'), stored('stale'), stored('down'), stored('refused'), stored('error'), stored('ok')];
  const totals = summarizeResults(results);
  assert.equal(totals.checked, 10);
  assert.equal(totals.regressed, 3);
  assert.equal(totals.regressionRate, 0.3);
  assert.deepEqual([totals.ok, totals.fewer, totals.refused, totals.error, totals.stale, totals.down], [5, 1, 1, 1, 1, 1]);
  assert.equal(summarizeResults([]).regressionRate, 0);
});

test('the run fails only above the threshold: exactly 20 percent passes', () => {
  const at20 = [...Array(8).fill(null).map(() => stored('ok')), stored('fewer'), stored('refused')];
  assert.equal(buildReport(at20, 0.2).passed, true);
  const above = [...Array(7).fill(null).map(() => stored('ok')), stored('fewer'), stored('refused'), stored('error')];
  assert.equal(buildReport(above, 0.2).passed, false);
  assert.equal(buildReport([], 0.2).passed, true);
});

test('the markdown report lists regressions, stale pages and the chart warning', () => {
  const results = [
    stored('ok', { store: 'Good Store', domain: 'good.example' }),
    stored('refused', { store: 'Bad Store', domain: 'bad.example', reviewsRead: 0, detail: 'HTTP 403: the store refuses automated requests.' }),
    stored('stale', { store: 'Old Store', domain: 'old.example', url: 'https://old.example/p/1', detail: 'HTTP 404' }),
    stored('ok', { store: 'Chart Store', domain: 'chart.example', chartMissing: true, url: 'https://chart.example/p/2' }),
  ];
  const report = buildReport(results, 0.2, new Date('2026-11-10T06:00:00Z'));
  const md = renderMarkdownReport(report);
  assert.match(md, /Run 2026-11-10T06:00:00.000Z\. 4 stores checked: \*\*2 ok\*\*, 0 fewer reviews than expected, 1 now refused, 0 errors, 1 stale product pages, 0 down\./);
  assert.match(md, /Regressed \(fewer \+ refused \+ errors\): \*\*1\*\* = 25\.0% of the stores checked\. The run fails above 20\.0%: \*\*FAILED\*\*\./);
  assert.match(md, /## Regressed\n\n\| Store \| Domain \| Status \| Read \| Expected at least \| Detail \|\n\|---\|---\|---\|---\|---\|---\|\n\| Bad Store \| bad\.example \| refused \| 0 \| 49 \| HTTP 403: the store refuses automated requests\. \|/);
  assert.match(md, /## Product page gone[^\n]*\n\n\| Store \| URL \| Detail \|\n\|---\|---\|---\|\n\| Old Store \| https:\/\/old\.example\/p\/1 \| HTTP 404 \|/);
  assert.match(md, /## Size chart no longer read[^\n]*\n\n\| Store \| URL \|\n\|---\|---\|\n\| Chart Store \| https:\/\/chart\.example\/p\/2 \|/);
  assert.match(md, /<details><summary>All stores<\/summary>/);
  assert.equal(report.passed, false);
  // Stores left unchecked by the time budget are said so.
  assert.match(renderMarkdownReport(buildReport([stored('ok')], 0.2, new Date(), 12)), /12 stores were not checked: the time budget ran out\./);
  assert.equal(buildReport([stored('ok')], 0.2, new Date(), 12).notChecked, 12);
  // A report with no regressions has no "Regressed" section.
  assert.doesNotMatch(renderMarkdownReport(buildReport([stored('ok')], 0.2)), /## Regressed/);
});
