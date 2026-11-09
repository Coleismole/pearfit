import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeHeadlessBrowser, renderPageHtml, shouldUseHeadlessRender } from './headlessFetch.ts';
import { parseSizeChart, parseSizeChartFirst } from './sizeChart.ts';

// A product page whose reviews exist only after JavaScript runs: one batch appears after
// clicking a "Reviews" tab, one lives in a shadow root, and a "Load more" button adds a third.
const PAGE = `<!DOCTYPE html><html><head><title>JS Tee</title></head><body>
<h1>JS Tee</h1>
<button role="tab" id="tab">Reviews</button>
<div id="reviews"></div>
<div id="shadow-host"></div>
<script>
  const card = (author, body) =>
    '<article class="review-card" data-author="' + author + '" data-rating="4"><p class="review-body-copy">' + body + '</p></article>';
  document.getElementById('tab').addEventListener('click', () => {
    setTimeout(() => {
      document.getElementById('reviews').innerHTML =
        card('Ana', 'Size: M. Runs small in the chest.') +
        '<button id="more">Load more</button>';
      document.getElementById('more').addEventListener('click', (e) => {
        e.target.insertAdjacentHTML('beforebegin', card('Ben', 'True to size, ordered a large.'));
        e.target.remove();
      });
    }, 300);
  });
  const root = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
  root.innerHTML = card('Cy', 'Shadow DOM review: runs large overall.');
</script></body></html>`;

test('headless render runs only for a remote page that still needs JavaScript', () => {
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'auto', staticFailed: false, reviewCount: 0 }),
    true
  );
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'auto', staticFailed: false, reviewCount: 4 }),
    false
  );
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'auto', staticFailed: true, reviewCount: null }),
    false
  );
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'always', staticFailed: false, reviewCount: 4 }),
    true
  );
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'never', staticFailed: false, reviewCount: 0 }),
    false
  );
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: false, renderMode: 'always', staticFailed: false, reviewCount: null }),
    false
  );
});

let browserAvailable = true;
try {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  await b.close();
} catch {
  browserAvailable = false;
}

after(async () => {
  await closeHeadlessBrowser();
});

test('renderPageHtml returns JS-loaded, tab-hidden, load-more and shadow-DOM reviews', { skip: !browserAvailable && 'no Chromium installed (npx playwright install chromium)' }, async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/product`);
    assert.equal(result.status, 200);
    assert.equal(result.reviewSelectorFound, true);
    assert.match(result.html, /data-author="Ana"/);
    assert.match(result.html, /data-author="Ben"/); // revealed by "Load more"
    assert.match(result.html, /data-author="Cy"/); // inlined from the shadow root
  } finally {
    server.close();
  }
});

test('renderPageHtml reports an HTTP error status without rendering', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(403, { 'content-type': 'text/html' });
    res.end('<html><body>Forbidden</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/blocked`);
    assert.equal(result.status, 403);
    assert.equal(result.html, '');
  } finally {
    server.close();
  }
});

// A product page whose size chart is in the product view, and whose "Load more" review button moves to
// a reviews-only view (like a client-side route change) and removes the chart from the page.
const ROUTE_CHANGE_PAGE = `<!DOCTYPE html><html><head><title>Route Tee</title></head><body>
<div id="app">
  <h1>Route Tee</h1>
  <table>
    <caption>Size guide (cm)</caption>
    <tr><th>Size</th><th>Body width</th><th>Body length</th></tr>
    <tr><td>M</td><td>52</td><td>70</td></tr>
  </table>
  <article class="review-card"><p>Size: M. True to size.</p></article>
  <button id="more">Load more</button>
</div>
<script>
  document.getElementById('more').addEventListener('click', () => {
    history.pushState({}, '', '/product/reviews');
    document.getElementById('app').innerHTML =
      '<article class="review-card"><p>Size: M. True to size.</p></article>' +
      '<article class="review-card"><p>Size: L. Runs small.</p></article>';
  });
</script></body></html>`;

test('renderPageHtml keeps the size chart from before a review click leaves the product view', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(ROUTE_CHANGE_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/product`);
    assert.match(result.html, /Runs small/); // the load-more click really moved to the reviews view
    assert.equal(parseSizeChart(result.html).length, 0); // so the final html has lost the chart
    assert.ok(result.chartHtml && /Size guide \(cm\)/.test(result.chartHtml));
    assert.deepEqual(parseSizeChartFirst(result.html, result.chartHtml), [
      { size: 'M', sortOrder: 2, chest_cm: 52, length_cm: 70, sleeve_cm: null },
    ]);
  } finally {
    server.close();
  }
});
