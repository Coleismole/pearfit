import test from 'node:test';
import assert from 'node:assert/strict';
import { failureReason, scrapeCompletedProperties, scrapeFailedProperties, storeHost } from './analyticsEvents.ts';

test('storeHost keeps only the hostname, without www', () => {
  assert.equal(storeHost('https://www.uniqlo.com/ca/en/products/E123?colorDisplayCode=09'), 'uniqlo.com');
  assert.equal(storeHost('https://Shop.Example.COM/p/1'), 'shop.example.com');
  assert.equal(storeHost('not a url'), null);
  assert.equal(storeHost('javascript:alert(1)'), null);
  assert.equal(storeHost(''), null);
  assert.equal(storeHost(null), null);
});

test('failureReason sorts the server message into three reasons and sends no text', () => {
  assert.equal(failureReason('https://x.com/p returned HTTP 403: the store refuses automated requests.'), 'refused');
  assert.equal(failureReason('The store showed the headless browser a block page ("Client Challenge")'), 'refused');
  assert.equal(failureReason('No reviews found on the page. Rendered the page in a headless browser'), 'no_reviews');
  assert.equal(failureReason('Could not reach https://x.com: ECONNRESET'), 'other');
  assert.equal(failureReason(undefined), 'other');
});

test('scrape_completed holds counts and the host, never the URL path or review text', () => {
  const data = {
    report: {
      totalReviews: 236,
      scraperTelemetry: { reportedReviewCount: 236, reviewSources: ['json-ld', 'dom'] },
      reviews: [{ text: 'I ordered a large and it fits.' }],
    },
    sizeChart: [{ size: 'M' }, { size: 'L' }],
    keptStoredReviews: false,
    committedToDb: true,
  };
  const props = scrapeCompletedProperties('url', 'https://www.zappos.com/product/review/9332491?x=secret', data, 91_834.6);
  assert.deepEqual(props, {
    mode: 'url',
    host: 'zappos.com',
    reviews_read: 236,
    reviews_stated: 236,
    review_source_count: 2,
    size_chart_rows: 2,
    kept_stored_reviews: false,
    committed: true,
    duration_ms: 91_835,
  });
  assert.doesNotMatch(JSON.stringify(props), /secret|9332491|ordered a large/);
});

test('a pasted scrape has no host, and missing or odd numbers become null', () => {
  const props = scrapeCompletedProperties('paste', 'https://ignored.example/p', { report: { totalReviews: -1 } }, -5);
  assert.equal(props.host, null);
  assert.equal(props.reviews_read, null);
  assert.equal(props.reviews_stated, null);
  assert.equal(props.review_source_count, null);
  assert.equal(props.size_chart_rows, 0);
  assert.equal(props.duration_ms, 0);
});

test('scrape_failed holds the host and a reason only', () => {
  const props = scrapeFailedProperties('url', 'https://www.hm.com/en_us/p/1', 'https://www.hm.com/en_us/p/1 returned HTTP 403: the store refuses automated requests.', 1200);
  assert.deepEqual(props, { mode: 'url', host: 'hm.com', reason: 'refused', duration_ms: 1200 });
});
