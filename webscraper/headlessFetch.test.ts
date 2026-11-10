import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  closeHeadlessBrowser,
  embeddedWidgetHtml,
  fetchGuidePagesWith,
  isReviewWidgetFrame,
  navigationTimedOutAfterLoading,
  JsonCapture,
  linkStaysOnProduct,
  openSizeGuideWith,
  renderPageHtml,
  renderWithServerlessBrowser,
  serverlessGuideOps,
  serverlessGuidePageOps,
  shouldUseHeadlessRender,
  SIZE_GUIDE_LABEL,
  type GuidePageOps,
  type ServerlessBrowser,
  type ServerlessPage,
  type SizeGuideOps,
} from './headlessFetch.ts';
import { parseSizeChart, parseSizeChartFirst, parseSizeChartWithGuides } from './sizeChart.ts';

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
  // 4 reviews in the source and no stated total: a review widget may hold more, so render.
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'auto', staticFailed: false, reviewCount: 4 }),
    true
  );
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'auto', staticFailed: true, reviewCount: null }),
    false
  );
  // 8 reviews in the page source, 120 stated: the rest load by JavaScript.
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'auto', staticFailed: false, reviewCount: 8, reportedReviewCount: 120 }),
    true
  );
  assert.equal(
    shouldUseHeadlessRender({ isRemoteUrl: true, renderMode: 'auto', staticFailed: false, reviewCount: 8, reportedReviewCount: 8 }),
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

test('renderPageHtml pages through a review list whose pager sits outside the review container', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const review = (n: number) => ({ id: 1000 + n, score: 5, content: `Great fit, review number ${n}.`, title: `Title ${n}`, created_at: '2026-05-21T05:42:16.000Z', user: { display_name: `Buyer ${n}` } });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/widget/reviews.json') {
      const page = Number(url.searchParams.get('page') ?? '1');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: { pagination: { page, total: 6 }, reviews: [review(page * 2 - 1), review(page * 2)] } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><title>Tank</title></head><body><h1>Tank</h1>
      <div class="reviews-container" id="list">Loading</div>
      <div class="pager-box"><button aria-label="Go to reviews page 1">1</button><button aria-label="Go to reviews page 2">2</button>
      <button aria-label="Go to reviews page 3">3</button><button id="nx" aria-label="Go to next page">&gt;&gt;</button></div>
      <script>
        let page = 1;
        async function load() {
          const r = await fetch('/widget/reviews.json?page=' + page); const j = await r.json();
          document.getElementById('list').textContent = j.response.reviews.map((x) => x.content).join(' | ');
        }
        document.getElementById('nx').addEventListener('click', () => { if (page < 3) { page++; load(); } });
        load();
      </script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/product`);
    const bodies = result.jsonResponses.map((j) => String(j.body)).join(' ');
    assert.match(bodies, /review number 1\./);
    assert.match(bodies, /review number 3\./);
    assert.match(bodies, /review number 6\./); // page 3, reached through the pager outside the container
  } finally {
    server.close();
  }
});

test('renderPageHtml survives a page that redirects itself while it is being scrolled', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url?.startsWith('/second')) {
      res.end(`<!DOCTYPE html><html><head><title>Second</title></head><body><h1>Tee</h1>
        <div class="review-card" data-author="Dana" data-rating="5"><p class="review-body-copy">Fits great after the redirect, true to size.</p></div></body></html>`);
      return;
    }
    // A locale or consent redirect that fires while the renderer is already scrolling.
    res.end(`<!DOCTYPE html><html><head><title>First</title></head><body style="height:9000px"><h1>Tee</h1>
      <script>setTimeout(() => location.replace('/second'), 400);</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/first`);
    assert.match(result.html, /data-author="Dana"/);
    assert.match(result.finalUrl, /\/second$/);
  } finally {
    server.close();
  }
});

test('a link stays on the product only when it is a hash, the same page, or under the product path', () => {
  const page = 'https://shop.example/products/black-bra';
  assert.equal(linkStaysOnProduct(null, page), true);
  assert.equal(linkStaysOnProduct('#reviews', page), true);
  assert.equal(linkStaysOnProduct('/products/black-bra?tab=reviews', page), true);
  assert.equal(linkStaysOnProduct('/products/black-bra/reviews', page), true);
  // The site-wide reviews page in the header is every product's reviews, not this one's.
  assert.equal(linkStaysOnProduct('/pages/reviews', page), false);
  assert.equal(linkStaysOnProduct('/products/other-bra', page), false);
  assert.equal(linkStaysOnProduct('https://reviews.example/black-bra', page), false);
});

test('Stamped: review cards sent as HTML inside JSON are found and counted by review id', () => {
  const card = (id: number) => `<div class="stamped-review" data-review-id="${id}"><a data-review-id="${id}" class="stamped-thumbs-up"></a></div>`;
  const page1 = JSON.stringify({ rating: 4.4, count: 13, widget: `<div>${card(11)}${card(12)}</div>` });
  const page2 = JSON.stringify({ rating: 4.4, count: 13, widget: `<div>${card(13)}${card(12)}</div>` });
  assert.ok(embeddedWidgetHtml(page1)?.includes('data-review-id="11"'));
  assert.equal(embeddedWidgetHtml(JSON.stringify({ rating: 5, widget: '<div>no cards</div>' })), null);
  assert.equal(embeddedWidgetHtml('not json'), null);
  const capture = new JsonCapture();
  capture.add('https://stamped.io/api/widget?productId=1&page=1', page1);
  assert.equal(capture.reviewCount(), 2);
  capture.add('https://stamped.io/api/widget?productId=1&page=2', page2);
  // Review 12 is on both pages: three distinct reviews.
  assert.equal(capture.reviewCount(), 3);
});

const PAGER_PAGE = `<!DOCTYPE html><html><head><title>Pager Tee</title></head><body>
<h1>Pager Tee</h1>
<div id="list"></div>
<div id="pager"></div>
<script>
  const pages = [['Ana', 'First page review about the fit.'], ['Ben', 'Second page review, true to size.'], ['Cy', 'Third page review, runs large.']];
  let current = 1;
  const draw = () => {
    const [who, text] = pages[current - 1];
    document.getElementById('list').innerHTML =
      '<div class="review-card" data-author="' + who + '" data-rating="4"><p class="review-body-copy">' + text + '</p></div>';
    document.getElementById('pager').innerHTML = pages
      .map((_p, i) => '<button type="button" aria-label="Page ' + (i + 1) + '"' + (i + 1 === current ? ' aria-current="page"' : '') + '>' + (i + 1) + '</button>')
      .join('');
    document.querySelectorAll('#pager button').forEach((b) => b.addEventListener('click', () => { current = Number(b.textContent); draw(); }));
  };
  draw();
</script></body></html>`;

test('renderPageHtml keeps every page of a numbered pager that replaces the cards', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGER_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/product`);
    const all = [...(result.extraHtml ?? []), result.html].join('\n');
    for (const author of ['Ana', 'Ben', 'Cy']) assert.match(all, new RegExp(`data-author="${author}"`));
  } finally {
    server.close();
  }
});

const SPAN_TAB_PAGE = `<!DOCTYPE html><html><head><title>Span Tee</title></head><body>
<a href="/pages/reviews">Reviews</a>
<h1>Span Tee</h1>
<span id="tab" style="cursor:pointer;display:inline-block;padding:8px">Reviews (2)</span>
<div id="panel" style="display:none"><div class="review-card" data-author="Dee" data-rating="5"><p class="review-body-copy">Panel review that was hidden until the heading was clicked.</p></div></div>
<script>document.getElementById('tab').addEventListener('click', () => { document.getElementById('panel').style.display = 'block'; });</script>
</body></html>`;

test('renderPageHtml opens a clickable "Reviews (n)" span and ignores the site-wide Reviews link', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url?.startsWith('/pages/reviews') ? '<html><body>Store-wide reviews</body></html>' : SPAN_TAB_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/products/span-tee`);
    assert.match(result.finalUrl, /\/products\/span-tee$/);
    assert.match(result.html, /data-author="Dee"/);
  } finally {
    server.close();
  }
});

test('isReviewWidgetFrame accepts the Loox widget iframe and nothing else', () => {
  assert.equal(isReviewWidgetFrame('https://loox.io/widget/VkcbTL2fZ/reviews/22605561863?limit=4'), true);
  assert.equal(isReviewWidgetFrame('https://loox.io/other'), false);
  assert.equal(isReviewWidgetFrame('https://evil.example/loox.io/widget/x'), false);
  assert.equal(isReviewWidgetFrame('about:blank'), false);
});

const DIV_PAGER_PAGE = `<!DOCTYPE html><html><head><title>Div Pager Tee</title></head><body>
<h1>Div Pager Tee</h1>
<div id="list"></div>
<div class="page-numbers" id="nums"></div>
<script>
  const pages = [['Ana', 'Division pager first review about the fit.'], ['Ben', 'Division pager second review, true to size.']];
  let current = 1;
  const draw = () => {
    const [who, text] = pages[current - 1];
    document.getElementById('list').innerHTML = '<div class="review-card" data-author="' + who + '" data-rating="4"><p class="review-body-copy">' + text + '</p></div>';
    document.getElementById('nums').innerHTML = pages.map((_p, i) => '<div class="page-number' + (i + 1 === current ? ' active' : '') + '" data-page="' + (i + 1) + '">' + (i + 1) + '</div>').join('');
    document.querySelectorAll('#nums .page-number').forEach((d) => d.addEventListener('click', () => { current = Number(d.getAttribute('data-page')); draw(); }));
  };
  draw();
</script></body></html>`;

test('renderPageHtml keeps every page of a div-based numbered pager', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(DIV_PAGER_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await renderPageHtml(`http://127.0.0.1:${port}/product`);
    const all = [...(result.extraHtml ?? []), result.html].join('\n');
    for (const author of ['Ana', 'Ben']) assert.match(all, new RegExp(`data-author="${author}"`));
  } finally {
    server.close();
  }
});

test('a navigation timeout after the page committed is not fatal; other errors and blank tabs are', () => {
  const timeout = new Error('page.goto: Timeout 45000ms exceeded.');
  assert.equal(navigationTimedOutAfterLoading(timeout, 'https://shop.example/products/x'), true);
  assert.equal(navigationTimedOutAfterLoading(timeout, 'about:blank'), false);
  assert.equal(navigationTimedOutAfterLoading(new Error('net::ERR_NAME_NOT_RESOLVED'), 'https://shop.example/'), false);
});

const GUIDE_TABLE = `<table><caption>Size guide (cm)</caption>
  <tr><th>Size</th><th>Pit to pit</th><th>Length</th></tr>
  <tr><td>M</td><td>54</td><td>72</td></tr></table>`;

async function renderLocalPage(routes: Record<string, string>, path = '/product') {
  const server = http.createServer((req, res) => {
    const body = routes[new URL(req.url ?? '/', 'http://x').pathname];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html' });
    res.end(body ?? 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await renderPageHtml(`http://127.0.0.1:${port}${path}`);
  } finally {
    server.close();
  }
}

test('renderPageHtml opens a size guide that is a plain element, not a button', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const result = await renderLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>
      <article class="review-card"><p>Size: M. True to size.</p></article>
      <span id="open" style="cursor:pointer">Size chart</span><div id="modal"></div>
      <script>document.getElementById('open').addEventListener('click', () => {
        document.getElementById('modal').innerHTML = ${JSON.stringify(GUIDE_TABLE)};
      });</script></body></html>`,
  });
  assert.deepEqual(parseSizeChartFirst(result.html, result.chartHtml), [
    { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null },
  ]);
});

test('renderPageHtml opens a size guide button that a sticky overlay covers', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const result = await renderLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>
      <article class="review-card"><p>Size: M. True to size.</p></article>
      <button id="open">Find your size</button><div id="modal"></div>
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99"></div>
      <script>document.getElementById('open').addEventListener('click', () => {
        document.getElementById('modal').innerHTML = ${JSON.stringify(GUIDE_TABLE)};
      });</script></body></html>`,
  });
  assert.equal(parseSizeChartFirst(result.html, result.chartHtml)[0]?.chest_cm, 54);
});

test('renderPageHtml reads a size guide that is a page of its own and picks the table for the product', { skip: !browserAvailable && 'no Chromium installed' }, async () => {
  const result = await renderLocalPage({
    '/products/mens-tee': `<!DOCTYPE html><html><body><h1>Men's Tee</h1>
      <article class="review-card"><p>Size: M. True to size.</p></article>
      <a href="/pages/size-chart">Size chart</a>
      <a href="/products/other-tee">Size guide of another product</a></body></html>`,
    '/pages/size-chart': `<!DOCTYPE html><html><body><h1>Size chart</h1>
      <h2>Women's</h2>${GUIDE_TABLE.replace('54', '47').replace('72', '62')}
      <h2>Men's</h2>${GUIDE_TABLE}</body></html>`,
  }, '/products/mens-tee');
  assert.equal(parseSizeChart(result.html).length, 0); // the product page itself shows no chart
  assert.equal(result.guidePages?.length, 1);
  assert.deepEqual(parseSizeChartWithGuides([result.html, result.chartHtml], result.guidePages ?? [], { name: "Men's Tee", url: 'http://x/products/mens-tee' }), [
    { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null },
  ]);
});

// ---- Size-guide steps shared by the Playwright and the serverless (Puppeteer) render ----

interface FakeGuideState {
  url: string;
  tables: number;
  html: string;
}

/** A page that records what the size-guide routine asked of it, with a clock that only the fake sleep moves. */
function fakeGuideOps(script: {
  /** Controls per group; a group missing here has none. */
  controls: Record<number, number>;
  /** Called on every click; changes the page state the way the click would. */
  onClick?: (group: number, index: number, state: FakeGuideState) => void;
}) {
  const state: FakeGuideState = { url: 'https://shop.example/products/tee', tables: 0, html: '<html></html>' };
  const log: string[] = [];
  let clock = 1_000_000;
  const ops: SizeGuideOps = {
    url: () => state.url,
    count: async (group) => script.controls[group] ?? 0,
    click: async (group, index) => {
      log.push(`click ${group}.${index}`);
      script.onClick?.(group, index, state);
      return true;
    },
    tables: async () => state.tables,
    serialize: async () => state.html,
    escape: async () => {
      log.push('escape');
    },
    back: async () => {
      log.push('back');
      state.url = 'https://shop.example/products/tee';
      state.html = '<html></html>';
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { ops, state, log, now: () => clock };
}
const CHART_PAGE = `<html><body>${GUIDE_TABLE}</body></html>`;

test('openSizeGuideWith closes a control that shows no chart and takes the next one that does', async () => {
  const fake = fakeGuideOps({
    controls: { 1: 2 },
    onClick: (_g, index, state) => {
      state.tables = 1;
      state.html = index === 1 ? CHART_PAGE : '<html><body><table><tr><td>shipping</td></tr></table></body></html>';
    },
  });
  const html = await openSizeGuideWith(fake.ops, fake.now() + 20_000);
  assert.equal(html, CHART_PAGE);
  assert.deepEqual(fake.log, ['click 1.0', 'escape', 'click 1.1']);
});

test('openSizeGuideWith goes back from a control that leaves the product page, and never reads that page', async () => {
  const fake = fakeGuideOps({
    controls: { 0: 1, 1: 1 },
    onClick: (group, _i, state) => {
      if (group === 0) {
        state.url = 'https://shop.example/pages/size-chart';
        state.html = CHART_PAGE; // the page it left for has a chart, but it is not the product view
      }
    },
  });
  assert.equal(await openSizeGuideWith(fake.ops, fake.now() + 20_000), null);
  assert.deepEqual(fake.log, ['click 0.0', 'back', 'click 1.0', 'escape']);
});

test('openSizeGuideWith treats a hash change as the same page', async () => {
  const fake = fakeGuideOps({
    controls: { 3: 1 },
    onClick: (_g, _i, state) => {
      state.url += '#size-guide';
      state.tables = 1;
      state.html = CHART_PAGE;
    },
  });
  assert.equal(await openSizeGuideWith(fake.ops, fake.now() + 20_000), CHART_PAGE);
  assert.ok(!fake.log.includes('back'));
});

test('openSizeGuideWith starts no try that does not fit in the time left, and caps the tries', async () => {
  const late = fakeGuideOps({ controls: { 1: 3 } });
  assert.equal(await openSizeGuideWith(late.ops, late.now() + 5_000), null);
  assert.deepEqual(late.log, []); // under 6 s left: not even one click

  const many = fakeGuideOps({ controls: { 0: 3, 1: 3, 2: 3 } });
  assert.equal(await openSizeGuideWith(many.ops, many.now() + 600_000, 4), null);
  assert.equal(many.log.filter((entry) => entry.startsWith('click')).length, 4);
});

test('openSizeGuideWith retries with a pointer click only when the script click opened nothing', async () => {
  // The control ignores the script click: the table appears only after the retry.
  const stubborn = fakeGuideOps({ controls: { 1: 1 } });
  let retries = 0;
  stubborn.ops.retryClick = async () => {
    retries++;
    stubborn.state.tables = 1;
    stubborn.state.html = CHART_PAGE;
    return true;
  };
  assert.equal(await openSizeGuideWith(stubborn.ops, stubborn.now() + 30_000), CHART_PAGE);
  assert.equal(retries, 1);

  // The script click worked: no retry.
  const easy = fakeGuideOps({
    controls: { 1: 1 },
    onClick: (_g, _i, state) => {
      state.tables = 1;
      state.html = CHART_PAGE;
    },
  });
  let easyRetries = 0;
  easy.ops.retryClick = async () => {
    easyRetries++;
    return true;
  };
  assert.equal(await openSizeGuideWith(easy.ops, easy.now() + 30_000), CHART_PAGE);
  assert.equal(easyRetries, 0);
});

test('fetchGuidePagesWith reads at most two guides, skips one that will not load, and stops at the time limit', async () => {
  let clock = 5_000_000;
  const loaded: string[] = [];
  const ops: GuidePageOps = {
    now: () => clock,
    links: async () => ['https://shop.example/a', 'https://shop.example/b', 'https://shop.example/c'],
    load: async (href, timeoutMs) => {
      loaded.push(`${href} ${timeoutMs}`);
      clock += 1_000;
      return href.endsWith('/a') ? null : `<html>${href}</html>`;
    },
  };
  // /a fails, /b loads; /c is beyond the two-guide cap even though time is left.
  assert.deepEqual(await fetchGuidePagesWith(ops, clock + 60_000), ['<html>https://shop.example/b</html>']);
  assert.deepEqual(loaded, ['https://shop.example/a 15000', 'https://shop.example/b 15000']);

  // Under 8 s left: nothing is loaded. With 12 s left the load gets at most 9 s.
  loaded.length = 0;
  assert.deepEqual(await fetchGuidePagesWith(ops, clock + 7_999), []);
  assert.deepEqual(loaded, []);
  await fetchGuidePagesWith(ops, clock + 12_000);
  assert.equal(loaded[0], 'https://shop.example/a 9000');
});

// A Puppeteer-shaped page that answers the in-page scripts from canned values, to check what the serverless
// adapters send and how they open and close the tabs of linked guides.
function fakeServerlessPage(overrides: Partial<ServerlessPage> = {}) {
  const calls: string[] = [];
  const page: ServerlessPage = {
    goto: async (url) => {
      calls.push(`goto ${url}`);
      return { status: () => 200 };
    },
    goBack: async () => {
      calls.push('goBack');
    },
    url: () => 'https://shop.example/products/tee',
    setRequestInterception: async (enabled) => {
      calls.push(`intercept ${enabled}`);
    },
    on: () => {},
    evaluate: async () => 0,
    click: async (selector) => {
      calls.push(`click ${selector}`);
    },
    keyboard: {
      press: async (key) => {
        calls.push(`press ${key}`);
      },
    },
    waitForNetworkIdle: async () => {},
    waitForSelector: async () => null,
    close: async () => {
      calls.push('close');
    },
    ...overrides,
  };
  return { page, calls };
}

test('serverlessGuideOps asks the page for the same six control groups and the pointer-click retry', async () => {
  const scripts: string[] = [];
  const { page, calls } = fakeServerlessPage({
    evaluate: async (script) => {
      scripts.push(script);
      return /"count"/.test(script) ? 2 : true;
    },
  });
  const ops = serverlessGuideOps(page, async () => {});
  assert.equal(await ops.count(4), 2);
  assert.equal(await ops.click(4, 1), true);
  assert.ok(/\(4, 0, "count", /.test(scripts[0]));
  assert.ok(/\(4, 1, "click", /.test(scripts[1]));
  // The label the groups match is the one the Playwright locators use.
  assert.ok(scripts[0].includes(JSON.stringify(SIZE_GUIDE_LABEL.source)));
  await ops.retryClick?.();
  await ops.escape();
  await ops.back();
  assert.deepEqual(calls, ['click pierce/[data-pearfit-guide="1"]', 'press Escape', 'goBack']);
});

test('serverlessGuidePageOps loads each guide in a guarded tab and closes the tab', async () => {
  const tabs: ReturnType<typeof fakeServerlessPage>[] = [];
  const main = fakeServerlessPage({ evaluate: async () => ['https://shop.example/pages/size-chart'] });
  const ops = serverlessGuidePageOps(main.page, async () => {
    const tab = fakeServerlessPage({ evaluate: async () => '<html>guide</html>' });
    await tab.page.setRequestInterception(true);
    tabs.push(tab);
    return tab.page;
  });
  assert.deepEqual(await fetchGuidePagesWith(ops, Date.now() + 40_000), ['<html>guide</html>']);
  assert.equal(tabs.length, 1);
  assert.deepEqual(tabs[0].calls, ['intercept true', 'goto https://shop.example/pages/size-chart', 'close']);

  // A tab that cannot load the guide is still closed, and the guide is skipped.
  const failing = fakeServerlessPage({
    goto: async () => {
      throw new Error('net::ERR_FAILED');
    },
  });
  const failOps = serverlessGuidePageOps(main.page, async () => failing.page);
  assert.deepEqual(await fetchGuidePagesWith(failOps, Date.now() + 40_000), []);
  assert.deepEqual(failing.calls, ['close']);
});

// The serverless render runs on puppeteer-core. Here it drives the local Chromium that Playwright installed.
let serverlessBrowser: ServerlessBrowser | null = null;
let closeServerlessBrowser: () => Promise<void> = async () => {};
try {
  const { chromium } = await import('playwright');
  const puppeteer = (await import('puppeteer-core')).default;
  const launched = await puppeteer.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  serverlessBrowser = launched as unknown as ServerlessBrowser;
  closeServerlessBrowser = () => launched.close();
} catch {
  serverlessBrowser = null;
}
after(async () => {
  await closeServerlessBrowser();
});
const serverlessSkip = !serverlessBrowser && 'no Chromium for puppeteer-core (npx playwright install chromium)';

async function renderServerlessLocalPage(routes: Record<string, string>, path = '/product') {
  const server = http.createServer((req, res) => {
    const body = routes[new URL(req.url ?? '/', 'http://x').pathname];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html' });
    res.end(body ?? 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await renderWithServerlessBrowser(serverlessBrowser!, `http://127.0.0.1:${port}${path}`);
  } finally {
    server.close();
  }
}

const OPENS_GUIDE = `document.getElementById('modal').innerHTML = ${JSON.stringify(GUIDE_TABLE)};`;
// 300 review cards are the most the render pages for, so it does not spend its idle waits looking for more.
const REVIEW = `<div id="reviews">${'<article class="review-card"><p>Size: M. True to size.</p></article>'.repeat(300)}</div>`;

test('serverless render opens a size guide that is a plain element, not a button', { skip: serverlessSkip }, async () => {
  const result = await renderServerlessLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>${REVIEW}
      <span id="open" style="cursor:pointer">Size chart</span><div id="modal"></div>
      <script>document.getElementById('open').addEventListener('click', () => { ${OPENS_GUIDE} });</script></body></html>`,
  });
  assert.deepEqual(parseSizeChartFirst(result.html, result.chartHtml), [
    { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null },
  ]);
});

test('serverless render skips a "Size & Fit" accordion with prose only and opens the size guide button after it', { skip: serverlessSkip }, async () => {
  const result = await renderServerlessLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>${REVIEW}
      <details><summary>Size &amp; Fit</summary><p>Model is 6ft and wears a medium.</p></details>
      <button id="open">Size Guide</button><div id="modal"></div>
      <script>document.getElementById('open').addEventListener('click', () => { ${OPENS_GUIDE} });</script></body></html>`,
  });
  assert.equal(parseSizeChartFirst(result.html, result.chartHtml)[0]?.chest_cm, 54);
});

test('serverless render opens a size guide button that a sticky overlay covers', { skip: serverlessSkip }, async () => {
  const result = await renderServerlessLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>${REVIEW}
      <button id="open">Find your size</button><div id="modal"></div>
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99"></div>
      <script>document.getElementById('open').addEventListener('click', () => { ${OPENS_GUIDE} });</script></body></html>`,
  });
  assert.equal(parseSizeChartFirst(result.html, result.chartHtml)[0]?.chest_cm, 54);
});

test('serverless render sends a pointer click to a size guide button that ignores a script click', { skip: serverlessSkip }, async () => {
  const result = await renderServerlessLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>${REVIEW}
      <button id="open">Size Guide</button><div id="modal"></div>
      <script>document.getElementById('open').addEventListener('click', (e) => { if (e.isTrusted) { ${OPENS_GUIDE} } });</script></body></html>`,
  });
  assert.equal(parseSizeChartFirst(result.html, result.chartHtml)[0]?.chest_cm, 54);
});

test('serverless render goes back from a size guide control that navigates away', { skip: serverlessSkip }, async () => {
  const result = await renderServerlessLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>${REVIEW}
      <button onclick="location.href='/elsewhere'">Size Guide</button></body></html>`,
    '/elsewhere': `<html><body><h1>Somewhere else</h1>${GUIDE_TABLE}</body></html>`,
  });
  assert.equal(new URL(result.finalUrl).pathname, '/product');
  assert.equal(parseSizeChart(result.html).length, 0);
  assert.equal(result.chartHtml !== null && parseSizeChart(result.chartHtml).length, 0);
  assert.deepEqual(result.guidePages, []);
});

test('serverless render reads a size guide that is a page of its own and picks the table for the product', { skip: serverlessSkip }, async () => {
  const result = await renderServerlessLocalPage(
    {
      '/products/mens-tee': `<!DOCTYPE html><html><body><h1>Men's Tee</h1>${REVIEW}
        <a href="/pages/size-chart">Size chart</a>
        <a href="/products/other-tee">Size guide of another product</a></body></html>`,
      '/pages/size-chart': `<!DOCTYPE html><html><body><h1>Size chart</h1>
        <h2>Women's</h2>${GUIDE_TABLE.replace('54', '47').replace('72', '62')}
        <h2>Men's</h2>${GUIDE_TABLE}</body></html>`,
    },
    '/products/mens-tee',
  );
  assert.equal(parseSizeChart(result.html).length, 0); // the product page itself shows no chart
  assert.equal(new URL(result.finalUrl).pathname, '/products/mens-tee'); // the link was read in another tab
  assert.equal(result.guidePages?.length, 1);
  assert.deepEqual(parseSizeChartWithGuides([result.html, result.chartHtml], result.guidePages ?? [], { name: "Men's Tee", url: 'http://x/products/mens-tee' }), [
    { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null },
  ]);
});

test('serverless render reads no guide page when the product page already shows the chart', { skip: serverlessSkip }, async () => {
  const result = await renderServerlessLocalPage({
    '/product': `<!DOCTYPE html><html><body><h1>Tee</h1>${REVIEW}${GUIDE_TABLE}<a href="/pages/size-chart">Size chart</a></body></html>`,
    '/pages/size-chart': `<html><body>${GUIDE_TABLE}</body></html>`,
  });
  assert.deepEqual(result.guidePages, []);
  assert.equal(parseSizeChartFirst(result.html, result.chartHtml)[0]?.chest_cm, 54);
});
