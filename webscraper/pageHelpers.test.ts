import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { parseSizeChartWithGuides } from './sizeChart.ts';
import {
  cleanProductTitle,
  isEmptyStarFill,
  labelledValue,
  leafTexts,
  longestFreeText,
  looksLikeDate,
  memoizeParse,
  parseGuidePageChartCached,
  parseSizeChartCached,
  sizeChartFromPages,
  registrableDomain,
  guideLinksFromHtml,
  isBadgeLine,
  dateFromAttribute,
  textOutsideLines,
  productIdFromUrl,
  uniqloProductCode,
  blockPageTitle,
  describeFetchFailure,
  isBotCheckRedirect,
  ratingFromStarFills,
  isRefusalStatus,
  blockPageText,
  decodeHtmlEntities,
  ratingFromLabel,
  ratingFromStarIcons,
} from './pageHelpers.ts';

const FILLED = '<svg><path fill="currentColor" d="M0 0"></path></svg>';
const EMPTY = '<svg><path fill="#DADADA" d="M0 0"></path></svg>';

// Trimmed copy of a rendered UNIQLO review list item (class names shortened).
const UNIQLO_CARD = `<li>
  <div>
    <div class="content-alignment"><div>Great jacket but can't handle light rain</div><div>11/1/2026</div></div>
    <div class="rating" data-testid="ITORating">${FILLED}${FILLED}${FILLED}${FILLED}${EMPTY}</div>
    <div><p>Purchased size: XS</p><p>Purchased colour: 31 BEIGE</p><p>How it fits: A bit loose</p></div>
    <div class="add-word-break"><div>I love the light weight of this. It is not water resistant though.</div></div>
    <div class="reviewUserInfo"><span>LizM17</span><span>Female</span><span>Height: 5'4" - 5'5"</span><span>Weight: 120lb - 129lb</span></div>
  </div>
</li>`;

test('labelled fields, body and stars are read from unlabelled review-card markup', () => {
  const $ = cheerio.load(UNIQLO_CARD);
  const node = $('li');
  const lines = leafTexts($, node);

  assert.equal(labelledValue(lines, /^(purchased size|size)$/i), 'XS');
  assert.equal(labelledValue(lines, /^how it fits$/i), 'A bit loose');
  assert.equal(labelledValue(lines, /^height$/i), `5'4" - 5'5"`);
  assert.equal(labelledValue(lines, /^weight$/i), '120lb - 129lb');
  assert.equal(labelledValue(lines, /^usual size$/i), '');
  assert.equal(
    longestFreeText(lines, ['LizM17']),
    'I love the light weight of this. It is not water resistant though.'
  );
  // 4 filled (currentColor) + 1 empty (#DADADA)
  assert.equal(ratingFromStarIcons($, node), '4');
});

test('isEmptyStarFill treats light greys and transparent as empty, real colours as filled', () => {
  assert.equal(isEmptyStarFill('#DADADA'), true);
  assert.equal(isEmptyStarFill('#eee'), true);
  assert.equal(isEmptyStarFill('transparent'), true);
  assert.equal(isEmptyStarFill('#000000'), false);
  assert.equal(isEmptyStarFill('#FFC107'), false); // gold star: channels differ a lot
  assert.equal(isEmptyStarFill('currentColor'), false);
});

test('ratingFromLabel parses "x out of y" and rescales to 1-5', () => {
  assert.equal(ratingFromLabel('4.5 out of 5 stars'), '4.5');
  assert.equal(ratingFromLabel('Rated 10 out of 10'), '5');
  assert.equal(ratingFromLabel('no rating here'), '');
  assert.equal(ratingFromLabel(undefined), '');
});

test('cleanProductTitle strips "Reviews for" and the site suffix', () => {
  assert.equal(cleanProductTitle("Reviews for Women's Utility Cotton Blend Parka | UNIQLO CA"), "Women's Utility Cotton Blend Parka");
  assert.equal(cleanProductTitle('Oxford Shirt'), 'Oxford Shirt');
  assert.equal(cleanProductTitle(''), null);
});

test('productIdFromUrl finds product codes in common URL shapes', () => {
  assert.equal(productIdFromUrl('https://www.uniqlo.com/ca/en/products/E487396-000/00/reviews'), 'E487396-000');
  assert.equal(productIdFromUrl('https://shop.example/products/e487396-000'), 'e487396-000');
  assert.equal(productIdFromUrl('https://www.patagonia.com/product/mens-shirt/45215.html'), '45215');
  assert.equal(productIdFromUrl('https://example.com/about'), null);
  assert.equal(productIdFromUrl('https://www.gap.com/browse/product.do?pid=795346052'), '795346052');
  assert.equal(productIdFromUrl('https://shop.example/item?color=red&productId=AB123'), 'AB123');
  // A path id wins over a query parameter, which may be an affiliate code.
  assert.equal(productIdFromUrl('https://shop.example/products/E487396-000?pid=aff123'), 'E487396-000');
  assert.equal(productIdFromUrl('https://www.llbean.com/llb/shop/40651?page=carefree-unshrinkable-tee'), '40651');
  // A product parameter wins over a bare number in the path, which may be a category.
  assert.equal(productIdFromUrl('https://shop.example/c/10001/oxford-shirt?pid=AB123'), 'AB123');
  assert.equal(productIdFromUrl('https://www.target.com/p/men-s-crew-neck-t-shirt-goodfellow/-/A-93249836'), 'A-93249836');
  assert.equal(productIdFromUrl('https://www.vineyardvines.com/product/mens-t-shirts/edgartown-short-sleeve-pocket-tee/1V011322.html'), '1V011322');
  // A word page name is not a code.
  assert.equal(productIdFromUrl('https://example.com/about-us.html'), null);
});

test('blockPageTitle recognises bot checks and access-denied pages', () => {
  assert.equal(blockPageTitle('<html><head><title>Client Challenge</title></head></html>'), 'Client Challenge');
  assert.equal(blockPageTitle('<title>Access to this page has been denied</title>'), 'Access to this page has been denied');
  assert.equal(blockPageTitle('<title>Just a moment...</title>'), 'Just a moment...');
  assert.equal(blockPageTitle('<title>Essentials No. 1 Logo Men\'s Tee | PUMA</title>'), null);
  assert.equal(blockPageTitle('<title>Attention Required! | Cloudflare</title>'), 'Attention Required! | Cloudflare');
  // A product named like a block page, and an SVG title in the body, are not block pages.
  assert.equal(blockPageTitle('<title>Access Denied Graphic Tee | Store</title>'), null);
  assert.equal(blockPageTitle('<html><head><title>Logo Tee</title></head><body><svg><title>Security Check</title></svg></body></html>'), null);
});

test('blockPageText reads a short refusal or maintenance page, and ignores a real page', () => {
  const nordstrom = '<html><head><title>Nordstrom</title></head><body><h1>We\'ve noticed some unusual activity</h1><p>To keep our site secure, we don’t allow unidentified, automated traffic.</p></body></html>';
  assert.equal(blockPageText(nordstrom), 'refused');
  const patagonia = '<html><head><title>Patagonia Outdoor Clothing &amp; Gear</title></head><body><h1>We’re working on it.</h1><p>System maintenance is in progress. Please try again in a few minutes.</p><script>var x = "automated traffic";</script></body></html>';
  assert.equal(blockPageText(patagonia), 'maintenance');
  // A long product page that mentions the words in its footer is a product page.
  const product = `<html><body><h1>Tee</h1><p>${'Soft cotton tee that fits true to size. '.repeat(60)}</p><footer>We block automated traffic.</footer></body></html>`;
  assert.equal(blockPageText(product), null);
  assert.equal(blockPageText('<html><body><h1>Logo Tee</h1><p>$25</p></body></html>'), null);
});

test('decodeHtmlEntities decodes escaped names and leaves plain text alone', () => {
  assert.equal(decodeHtmlEntities('Men&#39;s Merino Short Sleeve Tee'), "Men's Merino Short Sleeve Tee");
  assert.equal(decodeHtmlEntities('Big &amp; Tall Nova Wave'), 'Big & Tall Nova Wave');
  assert.equal(decodeHtmlEntities('Sombra &quot;Sun&quot; Shirt &#x27;24'), `Sombra "Sun" Shirt '24`);
  assert.equal(decodeHtmlEntities('Tee &unknown; 100%'), 'Tee &unknown; 100%');
  assert.equal(decodeHtmlEntities("Men's Tee & Co"), "Men's Tee & Co");
});

test('bot-protection redirects and refusal statuses are told apart from ordinary redirects and errors', () => {
  assert.equal(isBotCheckRedirect('/px?url=aHR0cHM6Ly9leGFtcGxl&frame=1'), true);
  assert.equal(isBotCheckRedirect('https://shop.example/on/demandware.store/Sites-X-Site/default/PX-Show?url=abc'), true);
  assert.equal(isBotCheckRedirect('/products/px-tee'), false);
  assert.equal(isBotCheckRedirect('https://shop.example/us/p/tee'), false);
  for (const status of [403, 406, 418, 429, 503]) assert.equal(isRefusalStatus(status), true);
  for (const status of [404, 433, 500]) assert.equal(isRefusalStatus(status), false);
});

test('ratingFromStarFills reads fill images and overlay widths, and nothing else', () => {
  const $ = cheerio.load(
    `<div id="a">${[1, 1, 1, 0, 0].map((f) => `<span class="pdp-review__star"><img class="pdp-review__star-empty">${f ? '<img class="pdp-review__star-fill">' : ''}</span>`).join('')}</div>` +
      `<div id="b">${[100, 100, 100, 100, 0].map((w) => `<span class="relative"><span class="absolute overflow-hidden" style="width: ${w}%;"><svg></svg></span></span>`).join('')}</div>` +
      `<div id="c"><span class="x">no stars here</span></div>`,
  );
  assert.equal(ratingFromStarFills($, $('#a')), '3');
  assert.equal(ratingFromStarFills($, $('#b')), '4');
  assert.equal(ratingFromStarFills($, $('#c')), '');
});

test('a thrown fetch is reported with its cause and may be retried in a browser', () => {
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('Headers Overflow Error'), { code: 'UND_ERR_HEADERS_OVERFLOW' }) });
  const failure = describeFetchFailure('https://shop.example/p/1', error);
  assert.equal(failure.status, 502);
  assert.equal(failure.blocked, false);
  assert.equal(failure.retryInBrowser, true);
  assert.match(failure.message, /fetch failed \(UND_ERR_HEADERS_OVERFLOW\)/);
});

test('looksLikeDate recognises a line that is only a date, in the layouts stores print', () => {
  for (const line of ['13 January 2025', '08 September 2026', '8th Sep. 2026', 'Nov 8, 2026', 'September 8th 2026', '2026.08.12', '2025-01-13', '12/05/2025', '12.05.25']) {
    assert.equal(looksLikeDate(line), true, line);
  }
  // A sentence that mentions a date is words, and so is a bare year or a size.
  for (const line of ['Bought on 13 January 2025 and love it', 'Size: 14', '2025', 'Verified Buyer', 'May', 'Runs small']) {
    assert.equal(looksLikeDate(line), false, line);
  }
});

test('isBadgeLine names the labels a widget prints beside a reviewer, and nothing longer', () => {
  for (const line of ['Verified Buyer', 'verified purchase', 'Verified', 'Verified Customer']) assert.equal(isBadgeLine(line), true, line);
  for (const line of ['Verified buyer: runs small', 'Great fit', 'Not verified']) assert.equal(isBadgeLine(line), false, line);
  // A badge is not the body of a card that has nothing else.
  assert.equal(longestFreeText(['Hugo T', 'Verified Buyer', '2026.09.01'], ['Hugo T']), '');
});

test('dateFromAttribute turns a Unix time written as a float into an ISO date and leaves other text alone', () => {
  // 1788825600000 ms is 2026-09-08 00:00 UTC (20704 days after 1970-01-01).
  assert.equal(dateFromAttribute('1.7888256E12'), '2026-09-08T00:00:00.000Z');
  assert.equal(dateFromAttribute('1788825600000'), '2026-09-08T00:00:00.000Z');
  // Seconds, as some stores write them.
  assert.equal(dateFromAttribute('1788825600'), '2026-09-08T00:00:00.000Z');
  assert.equal(dateFromAttribute(' 2026-09-08 '), '2026-09-08');
  assert.equal(dateFromAttribute('2026'), '2026');
  assert.equal(dateFromAttribute(''), '');
});

test('longestFreeText skips dates, and textOutsideLines never takes the whole card for its words', () => {
  // A card of a date and labelled details has no words.
  const lines = ['13 January 2025', 'Size: 14', 'Purchased: Web', 'Location: Madinah'];
  assert.equal(longestFreeText(lines, []), '');
  assert.equal(textOutsideLines(lines.join(' '), lines), '');
  // The words win over the date even when the date is longer.
  assert.equal(longestFreeText(['08 September 2026', 'Lovely'], []), 'Lovely');
  // Words written straight in the card, beside child elements, are found.
  assert.equal(textOutsideLines('Jane Great fit overall 2026-01-01', ['Jane', '2026-01-01']), 'Great fit overall');
  // A card with no child elements at all is its own text.
  assert.equal(textOutsideLines('Runs small in the chest', []), 'Runs small in the chest');
});

test('guideLinksFromHtml finds same-site size-guide pages, best first, and leaves everything else', () => {
  const page = 'https://www.shop.example/products/mens-tee';
  const html = `<html><body>
    <a href="/pages/fit-guide">Fit guide</a>
    <a href="/pages/size-chart-mens">Size Chart</a>
    <a href="https://shop.example/pages/how-to-measure">How to measure</a>
    <a href="https://other.example/pages/size-guide">Size guide</a>
    <a href="/products/other-tee">Size guide of another product</a>
    <a href="/en-gb/collections/size-chart-tees">Size chart tees</a>
    <a href="/products/mens-tee?variant=1">Size guide</a>
    <a href="/pages/shipping">Shipping</a>
    <a href="#size-guide">Size guide</a>
    <a href="mailto:help@shop.example">Size guide</a>
    <a href="/pages/size-chart-mens#top">Size chart again</a>
    </body></html>`;
  // The size chart page outranks the how-to-measure page and the fit guide (which describes cuts). Off-site
  // links, product and collection addresses, the page itself, hash links and mail links are left out. Two links
  // to one address count once.
  assert.deepEqual(guideLinksFromHtml(html, page), [
    'https://www.shop.example/pages/size-chart-mens',
    'https://www.shop.example/pages/fit-guide',
    'https://shop.example/pages/how-to-measure',
  ]);
  assert.deepEqual(guideLinksFromHtml(html, page, 1), ['https://www.shop.example/pages/size-chart-mens']);
  assert.deepEqual(guideLinksFromHtml('<p>no links</p>', page), []);
  assert.deepEqual(guideLinksFromHtml(html, 'not a url'), []);
});

test('registrableDomain keeps what a store owns, so a regional subdomain is its own site and another store is not', () => {
  assert.equal(registrableDomain('www.seafolly.com'), 'seafolly.com');
  assert.equal(registrableDomain('au.seafolly.com'), 'seafolly.com');
  assert.equal(registrableDomain('seafolly.com'), 'seafolly.com');
  assert.equal(registrableDomain('www.collectif.co.uk'), 'collectif.co.uk');
  assert.equal(registrableDomain('shop.rusty.com.au'), 'rusty.com.au');
  assert.notEqual(registrableDomain('rusty.com'), registrableDomain('rusty.com.au'));
  assert.notEqual(registrableDomain('www.mudjeans.eu'), registrableDomain('mudjeans.com'));
  assert.equal(registrableDomain('localhost'), 'localhost');
});

test('memoizeParse parses each distinct page once, forgets the oldest, and hands out copies', () => {
  let parsed = 0;
  const parse = memoizeParse((html) => {
    parsed++;
    return [{ size: 'M', sortOrder: 2, chest_cm: html.length, length_cm: null, sleeve_cm: null }];
  }, 3);
  const first = parse('<p>a</p>');
  parse('<p>a</p>');
  parse('<p>a</p>');
  assert.equal(parsed, 1);
  assert.deepEqual(parse.stats, { calls: 3, parses: 1 });
  // A caller that edits what it got does not change what the next caller gets.
  first[0].chest_cm = 999;
  assert.equal(parse('<p>a</p>')[0].chest_cm, 8);
  // Another hint is another question: the same page is parsed again for it.
  parse('<p>a</p>', { name: "Women's Tee" });
  assert.equal(parsed, 2);
  // Three entries are kept: after b, c and d the first two are gone and 'a' is parsed again.
  parse('b');
  parse('c');
  parse('d');
  assert.equal(parsed, 5);
  parse('<p>a</p>');
  assert.equal(parsed, 6);
  parse('d'); // still remembered
  assert.equal(parsed, 6);
});

const CHART_TABLE = `<table><caption>Size guide (cm)</caption><tr><th>Size</th><th>Pit to pit</th><th>Length</th></tr><tr><td>M</td><td>54</td><td>72</td></tr></table>`;

test('parseSizeChartCached parses a large snapshot once however often the render and the endpoint ask', () => {
  // A big page: thousands of product tiles around one chart. Unique, so no earlier test has parsed it.
  const page = `<html><body>${'<div class="tile"><a href="/p">Tile</a></div>'.repeat(5000)}<p>${Math.random()}</p>${CHART_TABLE}</body></html>`;
  const before = { ...parseSizeChartCached.stats };
  const rows = Array.from({ length: 6 }, () => parseSizeChartCached(page, { name: 'Tee', url: 'https://shop.example/p/tee' }));
  assert.equal(parseSizeChartCached.stats.calls - before.calls, 6);
  assert.equal(parseSizeChartCached.stats.parses - before.parses, 1);
  for (const r of rows) assert.deepEqual(r, [{ size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null }]);
});

test('sizeChartFromPages answers as parseSizeChartWithGuides does, and reads each page once', () => {
  const unique = `<p>${Math.random()}</p>`;
  const noChart = `<html><body><h1>Tee</h1>${unique}</body></html>`;
  const withChart = `<html><body><h1>Tee</h1>${unique}${CHART_TABLE}</body></html>`;
  const guide = `<html><body><h1>Size chart</h1><h2>Men's</h2>${CHART_TABLE}</body></html>`;
  const hint = { name: "Men's Tee", url: 'https://shop.example/products/mens-tee' };
  const cases: [(string | null)[], (string | null)[]][] = [
    [[noChart, withChart], []],
    [[noChart, null], [guide]],
    [[noChart], [null, noChart, guide]],
    [[], []],
  ];
  const beforeOwn = { ...parseSizeChartCached.stats };
  const beforeGuide = { ...parseGuidePageChartCached.stats };
  for (const [pages, guides] of cases) {
    assert.deepEqual(sizeChartFromPages(pages, guides, hint), parseSizeChartWithGuides(pages, guides, hint));
  }
  // Asked again, nothing is parsed.
  const ownParses = parseSizeChartCached.stats.parses;
  const guideParses = parseGuidePageChartCached.stats.parses;
  for (const [pages, guides] of cases) sizeChartFromPages(pages, guides, hint);
  assert.equal(parseSizeChartCached.stats.parses, ownParses);
  assert.equal(parseGuidePageChartCached.stats.parses, guideParses);
  assert.equal(ownParses - beforeOwn.parses, 2); // noChart and withChart, once each
  assert.equal(guideParses - beforeGuide.parses, 2); // noChart as a guide page, and the guide
});

test('uniqloProductCode reads the E<digits>-000 code from a uniqlo.com product URL', () => {
  assert.equal(uniqloProductCode('https://www.uniqlo.com/ca/en/products/E465193-000/00'), 'E465193-000');
  assert.equal(uniqloProductCode('https://www.uniqlo.com/ca/en/products/E465193-000/00?colorDisplayCode=09&sizeDisplayCode=003'), 'E465193-000');
  assert.equal(uniqloProductCode('https://www.uniqlo.com/ca/en/products/E465193-000/00/reviews'), 'E465193-000');
  assert.equal(uniqloProductCode('https://uniqlo.com/ca/en/products/E465193-000/00'), 'E465193-000');
  assert.equal(uniqloProductCode('https://www.uniqlo.com/ca/en/products/e465193-000/00'), 'E465193-000'); // stored rows are upper case
});

test('uniqloProductCode is null for other hosts, look-alike hosts, and Uniqlo URLs without a -000 code', () => {
  assert.equal(uniqloProductCode('https://shop.example/products/E465193-000'), null);
  assert.equal(uniqloProductCode('https://www.nike.com/t/some-tee/E465193-000'), null);
  assert.equal(uniqloProductCode('https://uniqlo.com.evil.example/ca/en/products/E465193-000/00'), null);
  assert.equal(uniqloProductCode('https://notuniqlo.com/ca/en/products/E465193-000/00'), null);
  assert.equal(uniqloProductCode('https://www.uniqlo.com/ca/en/'), null); // no product in the URL
  assert.equal(uniqloProductCode('https://www.uniqlo.com/ca/en/products/E465193-09-003-000'), null); // a variant id is not a product code
  assert.equal(uniqloProductCode('not a url'), null);
});
