import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  classifyUrl,
  decideProduct,
  discoverDomain,
  extractLocs,
  isSitemapIndex,
  looksLikeGarment,
  pageSignals,
  parseRobots,
  pickSpread,
  registrableDomain,
  robotsAllows,
  sameSite,
  shopifyPicks,
  type DiscoverOptions,
} from './discoverProducts.ts';

// ---- addresses ----

test('registrableDomain and sameSite look at the site, not the subdomain', () => {
  assert.equal(registrableDomain('www.uniqlo.com'), 'uniqlo.com');
  assert.equal(registrableDomain('us.puma.com'), 'puma.com');
  assert.equal(registrableDomain('www.collectif.co.uk'), 'collectif.co.uk');
  assert.equal(registrableDomain('www.trenery.com.au'), 'trenery.com.au');
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(sameSite('eloquii.com', 'https://www.eloquii.com/p/1'), true);
  assert.equal(sameSite('www.eloquii.com', 'https://shop.eloquii.com/p/1'), true);
  assert.equal(sameSite('eloquii.com', 'https://www.onestopplus.com/os/featured/'), false);
  assert.equal(sameSite('eloquii.com', 'not a url'), false);
});

test('the onestopplus category addresses found for Eloquii, Full Beauty, Woman Within and King Size are rejected', () => {
  const found = [
    'https://www.onestopplus.com/os/featured/shop-by-brand/catherines/tops/',
    'https://www.onestopplus.com/os/featured/shop-by-brand/roamans/sweaters/',
    'https://www.onestopplus.com/os/bras-and-intimates/featured-brands/shop-all-brands/leading-lady/',
  ];
  // Listed in the sitemap of another store: not that store's page.
  for (const store of ['eloquii.com', 'fullbeauty.com', 'womanwithin.com', 'kingsize.com']) {
    for (const url of found) assert.deepEqual(classifyUrl(url, store), { kind: 'rejected', reason: 'foreign-host' }, `${store} ${url}`);
  }
  // On their own site they are category pages.
  for (const url of found) assert.deepEqual(classifyUrl(url, 'onestopplus.com'), { kind: 'rejected', reason: 'category' }, url);
});

test('the Romwe promo addresses are rejected, and a real Romwe product address is product-shaped', () => {
  const promos = [
    'https://www.romwe.com/the-shein-sa-creditbox-threshold-75-every-50-earn-25-top-100-a-3996.html',
    'https://www.romwe.com/the-shein-us-calendar-threshold-20-top-1500-14days-1-a-3694.html',
    'https://www.romwe.com/the-shein-es-creditbox-threshold-10-every-10-earn-15-top-60-a-3254.html',
  ];
  for (const url of promos) assert.deepEqual(classifyUrl(url, 'romwe.com'), { kind: 'rejected', reason: 'promo' }, url);
  assert.deepEqual(classifyUrl('https://www.romwe.com/Floral-Print-Crop-Tee-p-12345678-cat-1738.html', 'romwe.com'), { kind: 'product-shaped' });
});

test('product addresses on the common platforms are product-shaped', () => {
  const shaped = [
    ['https://shop.example/products/blue-oxford-shirt', 'shop.example'],
    ['https://shop.example/collections/shirts/products/blue-oxford-shirt', 'shop.example'],
    ['https://www.uniqlo.com/ca/en/products/E450179-000/00', 'uniqlo.com'],
    ['https://www.gap.com/browse/product.do?pid=811425012', 'gap.com'],
    ['https://www.roots.com/ca/en/mens-organic-cooper-beaver-long-sleeve-t-shirt-39031035.html', 'roots.com'],
    ['https://arcteryx.com/us/en/shop/mens/cormac-crew-neck-shirt-ss-0292', 'arcteryx.com'],
    ['https://www.charlestyrwhitt.com/us/double-breasted-tuxedo-jacket---black/SUD50BLK.html', 'charlestyrwhitt.com'],
    ['https://us.puma.com/us/en/pd/essentials-no-1-logo-mens-tee/682532', 'puma.com'],
    ['https://www.example.com/p/12345678', 'example.com'],
  ] as const;
  for (const [url, store] of shaped) assert.deepEqual(classifyUrl(url, store), { kind: 'product-shaped' }, url);
});

test('category, collection, promo, cart, account, blog and search addresses are rejected', () => {
  const rejected: [string, string][] = [
    ['https://shop.example/collections/shirts', 'category'],
    ['https://shop.example/collections', 'category'],
    ['https://shop.example/c/mens-tees', 'category'],
    ['https://shop.example/category/tees/', 'category'],
    ['https://shop.example/new-arrivals', 'category'],
    ['https://shop.example/sale', 'category'],
    ['https://shop.example/cart', 'cart'],
    ['https://shop.example/checkout/shipping', 'cart'],
    ['https://shop.example/account/login', 'account'],
    ['https://shop.example/en-ca/account/orders', 'account'],
    ['https://shop.example/blogs/news/how-to-style-a-tee', 'blog'],
    ['https://shop.example/pages/size-guide', 'blog'],
    ['https://shop.example/journal/spring-edit', 'blog'],
    ['https://shop.example/search?q=shirt', 'search'],
    ['https://shop.example/', 'home'],
    ['https://shop.example/us/en/', 'home'],
    ['https://shop.example/media/tee-front.jpg', 'file'],
    ['https://shop.example/sitemap_products_1.xml', 'file'],
    ['https://shop.example/black-friday-doorbuster-tee', 'promo'],
    ['https://shop.example/rewards-credit-promo.html', 'promo'],
    ['mailto:help@shop.example', 'not-http'],
    ['ftp://shop.example/p/1', 'not-http'],
  ];
  for (const [url, reason] of rejected) assert.deepEqual(classifyUrl(url, 'shop.example'), { kind: 'rejected', reason }, url);
});

test('a product inside a collection is not rejected as a collection, and a year is not a product id', () => {
  assert.deepEqual(classifyUrl('https://shop.example/collections/sale/products/blue-tee', 'shop.example'), { kind: 'product-shaped' });
  assert.deepEqual(classifyUrl('https://shop.example/summer-edit-2024', 'shop.example'), { kind: 'neutral' });
  assert.deepEqual(classifyUrl('https://shop.example/our-story-tees', 'shop.example'), { kind: 'neutral' });
});

// ---- pages ----

const PRODUCT_PAGE = `<!doctype html><html><head><title>Oxford Shirt</title>
<meta property="og:type" content="product">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Oxford Shirt","offers":{"@type":"Offer","price":"98"}}</script>
</head><body class="template-product"><h1>Oxford Shirt</h1>
<form action="/cart/add" method="post"><button type="submit" name="add">Add to cart</button></form></body></html>`;

const CATEGORY_PAGE = `<!doctype html><html><head><title>Tops | Catherines</title>
<meta property="og:type" content="website">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","mainEntity":{"@type":"ItemList","itemListElement":[
${Array.from({ length: 20 }, (_, i) => `{"@type":"ListItem","position":${i + 1},"item":{"@type":"Product","name":"Top ${i}","url":"https://www.onestopplus.com/p/${100000 + i}"}}`).join(',')}]}}</script>
</head><body class="plp">${Array.from({ length: 20 }, (_, i) => `<div class="tile"><a href="/p/${100000 + i}">Top ${i}</a><button class="quick-add">Add to cart</button></div>`).join('')}</body></html>`;

const PROMO_PAGE = `<!doctype html><html><head><title>Credit Box</title><meta property="og:type" content="website"></head>
<body><h1>Earn $25 credit</h1><p>Spend $75 and get a credit.</p></body></html>`;

test('a product page has JSON-LD, og:type and an add-to-cart control', () => {
  const signals = pageSignals(PRODUCT_PAGE, 'https://shop.example/products/oxford', 'shop.example');
  assert.deepEqual(signals, { jsonLdProduct: true, ogProduct: true, addToCart: true, listing: false, listingReasons: [] });
  const decision = decideProduct(classifyUrl('https://shop.example/products/oxford', 'shop.example'), signals);
  assert.deepEqual(decision, { accepted: true, signals: ['json-ld-product', 'og-type-product', 'add-to-cart', 'product-url'], confidence: 'strong' });
});

test('a category page with Product items inside its ItemList and quick-add buttons is a listing, not a product', () => {
  const signals = pageSignals(CATEGORY_PAGE, 'https://www.onestopplus.com/os/tops/', 'onestopplus.com');
  assert.equal(signals.jsonLdProduct, false, 'products nested in an ItemList are not the page\'s product');
  assert.equal(signals.addToCart, false, 'twenty add-to-cart buttons are quick-add tiles');
  assert.equal(signals.listing, true);
  assert.ok(signals.listingReasons.some((r) => /JSON-LD says collection/.test(r)));
  assert.ok(signals.listingReasons.some((r) => /20 add-to-cart buttons/.test(r)));
  const decision = decideProduct({ kind: 'neutral' }, signals);
  assert.equal(decision.accepted, false);
  assert.match((decision as { reason: string }).reason, /^category page/);
  // Even a product-shaped address does not rescue a page that is a listing.
  assert.equal(decideProduct({ kind: 'product-shaped' }, signals).accepted, false);
});

test('a promo page has no product signal', () => {
  const signals = pageSignals(PROMO_PAGE, 'https://www.romwe.com/promo-page', 'romwe.com');
  assert.deepEqual(signals, { jsonLdProduct: false, ogProduct: false, addToCart: false, listing: false, listingReasons: [] });
  assert.deepEqual(decideProduct({ kind: 'neutral' }, signals), { accepted: false, reason: 'no product signal in the page or the address' });
  // A rejected address is refused whatever the page holds.
  assert.deepEqual(decideProduct({ kind: 'rejected', reason: 'promo' }, pageSignals(PRODUCT_PAGE, 'https://x.example/p/1', 'x.example')), { accepted: false, reason: 'promo' });
});

test('an add-to-cart control alone is enough, a product address alone is weak, and neither is nothing', () => {
  const magento = `<html><body><h1>Tee</h1><button id="product-addtocart-button" type="button">Add to Cart</button></body></html>`;
  assert.deepEqual(decideProduct({ kind: 'neutral' }, pageSignals(magento, 'https://shop.example/blue-tee.html', 'shop.example')), { accepted: true, signals: ['add-to-cart'], confidence: 'strong' });
  const byText = `<html><body><button class="btn">Add to bag</button></body></html>`;
  assert.equal(pageSignals(byText, 'https://shop.example/x', 'shop.example').addToCart, true);
  const spa = `<html><body><div id="root"></div></body></html>`;
  assert.deepEqual(decideProduct({ kind: 'product-shaped' }, pageSignals(spa, 'https://shop.example/products/x', 'shop.example')), { accepted: true, signals: ['product-url'], confidence: 'weak' });
  assert.equal(decideProduct({ kind: 'neutral' }, pageSignals(spa, 'https://shop.example/x', 'shop.example')).accepted, false);
  assert.deepEqual(decideProduct({ kind: 'product-shaped' }, null), { accepted: true, signals: ['product-url'], confidence: 'weak' });
});

test('JSON-LD: Product in an @graph or a type array counts, broken JSON is ignored, a list of products does not', () => {
  const graph = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Product","Thing"],"name":"Tee"}]}</script>`;
  assert.equal(pageSignals(`<html><head>${graph}</head></html>`, 'https://s.example/a', 's.example').jsonLdProduct, true);
  const broken = `<script type="application/ld+json">{ not json </script>`;
  assert.equal(pageSignals(`<html><head>${broken}</head></html>`, 'https://s.example/a', 's.example').jsonLdProduct, false);
  const list = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"item":{"@type":"Product"}}]}</script>`;
  const signals = pageSignals(`<html><head>${list}</head></html>`, 'https://s.example/a', 's.example');
  assert.equal(signals.jsonLdProduct, false);
  assert.equal(signals.listing, true);
});

test('a website page that links to many product pages is a listing; a Shopify collection template is too', () => {
  const links = Array.from({ length: 14 }, (_, i) => `<a href="/products/tee-${i}">Tee ${i}</a>`).join('');
  const html = `<html><head><meta property="og:type" content="website"></head><body>${links}</body></html>`;
  const signals = pageSignals(html, 'https://shop.example/trending', 'shop.example');
  assert.equal(signals.listing, true);
  assert.match(signals.listingReasons.join(' '), /links to 14 product pages/);
  const shopify = `<html><body class="template-collection"><h1>Shirts</h1></body></html>`;
  assert.equal(pageSignals(shopify, 'https://shop.example/trending', 'shop.example').listing, true);
  // A product page that mentions pageType in analytics for another page is not touched by og:type product.
  assert.equal(pageSignals(PRODUCT_PAGE.replace('template-product', 'template-collection'), 'https://shop.example/x', 'shop.example').listing, false);
});

// ---- robots.txt ----

const ROBOTS = `# example
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /cart
Disallow: /collections/*+*
Disallow: /search$
Allow: /search/suggest
Crawl-delay: 30

Sitemap: https://shop.example/sitemap.xml
`;

test('parseRobots takes the * group, caps the delay and lists the sitemaps', () => {
  const rules = parseRobots(ROBOTS);
  assert.deepEqual(rules.disallow, ['/cart', '/collections/*+*', '/search$']);
  assert.deepEqual(rules.allow, ['/search/suggest']);
  assert.equal(rules.crawlDelay, 10);
  assert.deepEqual(rules.sitemaps, ['https://shop.example/sitemap.xml']);
});

test('robotsAllows uses the longest matching rule, wildcards and end anchors', () => {
  const rules = parseRobots(ROBOTS);
  assert.equal(robotsAllows(rules, '/cart'), false);
  assert.equal(robotsAllows(rules, '/cart/add'), false);
  assert.equal(robotsAllows(rules, '/products/blue-tee'), true);
  assert.equal(robotsAllows(rules, '/collections/red+blue'), false);
  assert.equal(robotsAllows(rules, '/collections/red'), true);
  assert.equal(robotsAllows(rules, '/search'), false);
  assert.equal(robotsAllows(rules, '/search?q=tee'), true, 'the $ anchors the rule to the exact path');
  assert.equal(robotsAllows(rules, '/search/suggest'), true);
  assert.equal(robotsAllows(parseRobots(''), '/anything'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /\nAllow: /products/'), '/products/x'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /\nAllow: /products/'), '/about'), false);
});

// ---- sitemaps and feeds ----

test('sitemap addresses are read, with entities, and an index is told from a list of pages', () => {
  const xml = `<urlset><url><loc>https://s.example/p/1?a=1&amp;b=2</loc></url><url><loc> https://s.example/p/2 </loc></url></urlset>`;
  assert.deepEqual(extractLocs(xml), ['https://s.example/p/1?a=1&b=2', 'https://s.example/p/2']);
  assert.equal(isSitemapIndex(['https://s.example/sitemap_products_1.xml', 'https://s.example/sitemap_pages.xml.gz']), true);
  assert.equal(isSitemapIndex(['https://s.example/p/1']), false);
  assert.equal(isSitemapIndex([]), false);
});

test('garments are told from accessories and bundles', () => {
  assert.equal(looksLikeGarment('/products/blue-oxford-shirt'), true);
  assert.equal(looksLikeGarment('Merino Crew Sock'), false);
  assert.equal(looksLikeGarment('Gift Card Tee'), false);
  assert.equal(looksLikeGarment('Leather Belt'), false);
  assert.equal(looksLikeGarment('The Pit Stop Short'), true);
});

test('shopifyPicks keeps garments in stock and skips accessories and sold-out products', () => {
  const feed = {
    products: [
      { title: 'Oxford Shirt', handle: 'oxford-shirt', product_type: 'Shirts', variants: [{ available: true }] },
      { title: 'Gift Card', handle: 'gift-card', variants: [{ available: true }] },
      { title: 'Sold Out Tee', handle: 'sold-out-tee', variants: [{ available: false }, { available: false }] },
      { title: 'Linen Dress', handle: 'linen-dress', variants: [{ available: false }, { available: true }] },
      { title: 'Wool Hat', handle: 'wool-hat', variants: [{ available: true }] },
      { title: 'Crew Neck Tee', handle: 'crew-neck-tee', variants: [{ available: true }] },
    ],
  };
  assert.deepEqual(shopifyPicks(feed, 'https://shop.example', 2), {
    urls: ['https://shop.example/products/oxford-shirt', 'https://shop.example/products/linen-dress'],
    total: 6,
  });
  assert.equal(shopifyPicks({ products: [] }, 'https://shop.example', 3), null);
  assert.equal(shopifyPicks(null, 'https://shop.example', 3), null);
});

test('pickSpread takes the first and then evenly through the rest', () => {
  assert.deepEqual(pickSpread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4), [1, 3, 6, 8]);
  assert.deepEqual(pickSpread([1, 2], 5), [1, 2]);
});

// ---- discovering, against a pretend store ----

interface Reply {
  status?: number;
  body?: string | Buffer;
  url?: string;
}

function pretendWeb(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const fetch: DiscoverOptions['fetch'] = async (url) => {
    calls.push(url);
    const reply = replies[url];
    if (!reply) return { status: 404, ok: false, url, buffer: async () => Buffer.from('') };
    const status = reply.status ?? 200;
    return { status, ok: status >= 200 && status < 300, url: reply.url ?? url, buffer: async () => Buffer.from(reply.body ?? '') };
  };
  return { fetch, calls };
}

const noSleep = async () => {};

test('a Shopify store: the feed gives garments in stock, and no page is fetched', async () => {
  const { fetch, calls } = pretendWeb({
    'https://shop.example/robots.txt': { body: 'User-agent: *\nDisallow: /cart\n' },
    'https://shop.example/collections/all/products.json?sort_by=best-selling&limit=80': {
      body: JSON.stringify({ products: [{ title: 'Oxford Shirt', handle: 'oxford-shirt', variants: [{ available: true }] }, { title: 'Gift Card', handle: 'gift-card', variants: [{ available: true }] }] }),
    },
  });
  const found = await discoverDomain('shop.example', { fetch, sleep: noSleep });
  assert.equal(found.kind, 'shopify');
  assert.deepEqual(found.urls, ['https://shop.example/products/oxford-shirt']);
  assert.deepEqual(found.accepted[0]!.signals, ['shopify-feed']);
  assert.deepEqual(calls, ['https://shop.example/robots.txt', 'https://shop.example/collections/all/products.json?sort_by=best-selling&limit=80']);
});

test('a sitemap store: foreign, category, promo and robots-disallowed addresses never become products', async () => {
  const sitemap = `<urlset>${[
    'https://www.onestopplus.com/os/featured/shop-by-brand/catherines/tops/',
    'https://shop.example/collections/tees',
    'https://shop.example/the-shein-credit-threshold-75-top-tee-a-3996.html',
    'https://shop.example/cart/tee',
    'https://shop.example/private/products/secret-tee',
    'https://shop.example/products/oxford-shirt',
    'https://shop.example/products/spring-dress',
    'https://shop.example/products/linen-top',
    'https://shop.example/products/the-tops-page',
    'https://shop.example/products/gift-card',
  ].map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
  const { fetch, calls } = pretendWeb({
    'https://shop.example/robots.txt': { body: 'User-agent: *\nDisallow: /private\nSitemap: https://shop.example/sitemap.xml\n' },
    'https://shop.example/sitemap.xml': { body: sitemap },
    'https://shop.example/products/oxford-shirt': { body: PRODUCT_PAGE },
    'https://shop.example/products/spring-dress': { body: CATEGORY_PAGE.replaceAll('onestopplus', 'shop.example') },
    'https://shop.example/products/linen-top': { body: PRODUCT_PAGE },
    'https://shop.example/products/the-tops-page': { body: PROMO_PAGE },
  });
  const found = await discoverDomain('shop.example', { fetch, sleep: noSleep, want: 3 });
  assert.equal(found.kind, 'sitemap');
  assert.deepEqual(found.urls, ['https://shop.example/products/oxford-shirt', 'https://shop.example/products/linen-top', 'https://shop.example/products/the-tops-page']);
  // The listing page is rejected; the promo-looking page has a product-shaped address, so it is a weak accept
  // only because nothing on it says it is a listing.
  assert.deepEqual(found.rejected.map((r) => r.url), ['https://shop.example/private/products/secret-tee', 'https://shop.example/products/spring-dress']);
  assert.match(found.rejected[0]!.reason ?? '', /robots\.txt disallows/);
  assert.match(found.rejected[1]!.reason ?? '', /^category page/);
  assert.equal(found.accepted[2]!.confidence, 'weak');
  // Never asked for: the other site, the disallowed path, cart, collection and promo addresses.
  const pageCalls = calls.filter((c) => !c.includes('products.json') && !c.endsWith('robots.txt') && !c.endsWith('sitemap.xml'));
  assert.deepEqual(pageCalls, ['https://shop.example/products/oxford-shirt', 'https://shop.example/products/spring-dress', 'https://shop.example/products/linen-top', 'https://shop.example/products/the-tops-page']);
  assert.ok(!calls.some((c) => c.includes('onestopplus') || c.includes('/private/') || c.includes('/cart/') || c.includes('credit-threshold')));
  assert.equal(found.total, 5, 'five garment addresses survive the address filter (the gift card does not); one of them robots.txt disallows');
});

test('a sitemap that redirects a product address to a category page or another site is not a product', async () => {
  const sitemap = `<urlset><url><loc>https://shop.example/products/blue-tee</loc></url><url><loc>https://shop.example/products/red-tee</loc></url></urlset>`;
  const { fetch } = pretendWeb({
    'https://shop.example/robots.txt': { status: 404 },
    'https://shop.example/sitemap.xml': { body: sitemap },
    'https://shop.example/products/blue-tee': { body: PRODUCT_PAGE, url: 'https://elsewhere.example/products/blue-tee' },
    'https://shop.example/products/red-tee': { body: CATEGORY_PAGE, url: 'https://shop.example/collections/tees' },
  });
  const found = await discoverDomain('shop.example', { fetch, sleep: noSleep });
  assert.deepEqual(found.urls, []);
  assert.match(found.rejected[0]!.reason ?? '', /redirects to another site/);
  assert.match(found.rejected[1]!.reason ?? '', /category/);
  assert.match(found.note ?? '', /none was a product page/);
});

test('a sitemap index leads to the product sitemap, and a gzipped sitemap is read', async () => {
  const index = `<sitemapindex><sitemap><loc>https://shop.example/sitemap_pages.xml</loc></sitemap><sitemap><loc>https://shop.example/sitemap_products_1.xml.gz</loc></sitemap></sitemapindex>`;
  const products = zlib.gzipSync(`<urlset><url><loc>https://shop.example/products/oxford-shirt</loc></url></urlset>`);
  const { fetch, calls } = pretendWeb({
    'https://shop.example/robots.txt': { body: 'Sitemap: https://shop.example/sitemap.xml' },
    'https://shop.example/sitemap.xml': { body: index },
    'https://shop.example/sitemap_products_1.xml.gz': { body: products },
    'https://shop.example/products/oxford-shirt': { body: PRODUCT_PAGE },
  });
  const found = await discoverDomain('shop.example', { fetch, sleep: noSleep });
  assert.deepEqual(found.urls, ['https://shop.example/products/oxford-shirt']);
  assert.ok(!calls.includes('https://shop.example/sitemap_pages.xml'));
});

test('a refusal ends the visit: no retry and nothing more is requested', async () => {
  const blockedAtRobots = pretendWeb({ 'https://shop.example/robots.txt': { status: 403 } });
  const first = await discoverDomain('shop.example', { fetch: blockedAtRobots.fetch, sleep: noSleep });
  assert.deepEqual(blockedAtRobots.calls, ['https://shop.example/robots.txt']);
  assert.deepEqual(first.urls, []);
  assert.match(first.note ?? '', /refuses automated requests/);

  const sitemap = `<urlset><url><loc>https://shop.example/products/blue-tee</loc></url><url><loc>https://shop.example/products/red-tee</loc></url></urlset>`;
  const blockedAtPage = pretendWeb({
    'https://shop.example/robots.txt': { status: 404 },
    'https://shop.example/sitemap.xml': { body: sitemap },
    'https://shop.example/products/blue-tee': { status: 429 },
    'https://shop.example/products/red-tee': { body: PRODUCT_PAGE },
  });
  const second = await discoverDomain('shop.example', { fetch: blockedAtPage.fetch, sleep: noSleep });
  assert.equal(blockedAtPage.calls.filter((c) => c.endsWith('/products/blue-tee')).length, 1, 'the 429 page is not asked again');
  assert.ok(!blockedAtPage.calls.includes('https://shop.example/products/red-tee'), 'no further page after a 429');
  assert.deepEqual(second.urls, []);
  assert.match(second.note ?? '', /HTTP 429/);
});

test('requests to one store are spaced by the larger of the set delay and robots.txt Crawl-delay', async () => {
  const sleeps: number[] = [];
  let clock = 0;
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const { fetch } = pretendWeb({
      'https://shop.example/robots.txt': { body: 'User-agent: *\nCrawl-delay: 3\n' },
      'https://shop.example/sitemap.xml': { body: '<urlset><url><loc>https://shop.example/products/blue-tee</loc></url></urlset>' },
      'https://shop.example/products/blue-tee': { body: PRODUCT_PAGE },
    });
    await discoverDomain('shop.example', {
      fetch,
      delayMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
  } finally {
    Date.now = realNow;
  }
  // robots.txt is asked first, with no wait. Then the 3 s it asks for (more than the 1 s set) is waited before each of the
  // next four requests: two product feeds, the sitemap, the page. The clock stands still while a request runs.
  assert.deepEqual(sleeps, [3000, 3000, 3000, 3000]);
});
