import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeHeadlessBrowser, renderPageHtml, shouldUseHeadlessRender } from './headlessFetch.ts';

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
