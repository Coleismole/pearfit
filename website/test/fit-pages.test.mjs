// Tests for scripts/build-fit-pages.mjs. The catalog is written by hand, so every expected value can be checked by eye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOME_END, HOME_START, buildFiles, combineReviews, fitVerdict, formatCount, formatDate, fullName, mergeListings, renderBrandPage,
  renderHomeBlock, renderIndexPage, renderMethodPage, renderProductPage, renderSitemap, selectBrands, selectPages, similarGroup, similarGuides,
  skipReason, slugify, spliceHome,
} from '../scripts/build-fit-pages.mjs';

const reviews = (total, runsSmallPct, trueToSizePct, runsLargePct) => ({ total, runsSmallPct, trueToSizePct, runsLargePct });
const product = (over) => ({
  sku: 'AB-100', candidateId: 'ab-100', brand: 'Acme', name: 'Crew Tee', garmentType: 'tee', reviews: reviews(40, 60, 30, 10), sizes: null, ...over,
});
const chart = { S: { chest_cm: 50, length_cm: 68.5, sleeve_cm: null }, M: { chest_cm: 53.2, length_cm: 72.8, sleeve_cm: null } };

test('slugify lowercases, drops apostrophes and accents, and joins the rest with single dashes', () => {
  assert.equal(slugify("Men's DRY-EX T-Shirt"), 'mens-dry-ex-t-shirt');
  assert.equal(slugify('  Dockers® All Seasons / 5-Pocket  '), 'dockers-all-seasons-5-pocket');
  assert.equal(slugify('Café Tee'), 'cafe-tee');
});

test('fullName does not say the brand twice', () => {
  assert.equal(fullName(product({})), 'Acme Crew Tee');
  assert.equal(fullName(product({ name: 'ACME crew tee' })), 'ACME crew tee');
});

test('formatDate writes the snapshot date in words', () => {
  assert.equal(formatDate('2026-11-12'), '12 November 2026');
  assert.equal(formatDate('2027-01-03'), '3 January 2027');
});

test('a listing cannot be used with no fit answers, no brand, or a name that is not a product', () => {
  assert.equal(skipReason(product({})), null);
  assert.equal(skipReason(product({ reviews: reviews(3, 0, 100, 0) })), null); // the review minimum applies to the combined product
  assert.equal(skipReason(product({ reviews: reviews(40, 0, 0, 0) })), 'no_fit_answers');
  assert.equal(skipReason(product({ brand: 'Unknown brand' })), 'no_brand');
  assert.equal(skipReason(product({ brand: '0' })), 'no_brand');
  assert.equal(skipReason(product({ name: 'An Error Occurred!' })), 'not_a_product_name');
  assert.equal(skipReason(product({ name: '12345' })), 'not_a_product_name');
  assert.equal(skipReason(product({ name: 'x'.repeat(80) })), null); // 80 characters is the limit
  assert.equal(skipReason(product({ name: 'x'.repeat(81) })), 'name_too_long');
});

test('the verdict follows the shares: clear at 70% true to size or 50% small or large, a lean at a 10 point gap', () => {
  const key = (small, tts, large) => fitVerdict(reviews(40, small, tts, large)).key;
  assert.equal(key(10, 70, 20), 'true_to_size'); // 70 is clear
  assert.equal(key(21, 69, 10), 'true_leaning_small'); // 69 is not; small leads large by 11
  assert.equal(key(10, 69, 21), 'true_leaning_large');
  assert.equal(key(20, 65, 15), 'true_mixed'); // the gap is 5
  assert.equal(key(20, 60, 20), 'true_mixed');
  assert.equal(key(50, 30, 20), 'runs_small'); // 50 is clear
  assert.equal(key(49, 31, 20), 'leans_small');
  assert.equal(key(20, 30, 50), 'runs_large');
  assert.equal(key(20, 35, 45), 'leans_large');
  assert.equal(key(40, 40, 20), 'split'); // two answers share the lead
  assert.equal(key(34, 33, 33), 'leans_small'); // ahead by one point is still ahead
});

test('pages are sorted by brand then name, one page per product however many codes it is listed under', () => {
  const catalog = {
    exported_on: '2026-11-12',
    products: [
      product({ sku: 'ZZ-2', brand: 'Zed', name: 'Polo' }),
      product({ sku: 'AB-2', name: 'Crew Tee', reviews: reviews(25, 0, 92, 8) }),
      product({ sku: 'AB-1', name: 'Crew Tee' }),
      product({ sku: 'AB-3', name: 'Boxy Tee' }),
      product({ sku: 'AB-4', name: 'Rare Tee', reviews: reviews(3, 0, 100, 0) }), // too few reviews: no page
    ],
  };
  const pages = selectPages(catalog);
  assert.deepEqual(pages.map((p) => p.slug), ['acme-boxy-tee', 'acme-crew-tee', 'zed-polo']);
  assert.equal(pages[1].listings, 2);
  assert.equal(pages[1].reviews.total, 65); // 40 + 25
});

test('the review minimum applies to the combined product, and two different products with one slug get their SKU', () => {
  const small = (sku, total, pcts) => product({ sku, name: 'Crew Tee', reviews: reviews(total, ...pcts) });
  const many = selectPages({ products: [small('AB-1', 6, [0, 100, 0]), small('AB-2', 5, [20, 80, 0]), product({ sku: 'AB-3', name: 'Solo Tee', reviews: reviews(9, 0, 100, 0) })] });
  assert.deepEqual(many.map((p) => p.slug), ['acme-crew-tee']); // 6 + 5 = 11 reaches 10; 9 alone does not
  assert.equal(many[0].reviews.total, 11);

  // "Acme Crew" + "Tee" and "Acme" + "Crew Tee" are different products that both read "Acme Crew Tee".
  const clash = selectPages({ products: [product({ sku: 'X1', brand: 'Acme Crew', name: 'Tee' }), product({ sku: 'X2', name: 'Crew Tee' })] });
  assert.deepEqual(clash.map((p) => p.slug).sort(), ['acme-crew-tee-x1', 'acme-crew-tee-x2']);
});

test('a product page states the stored numbers, the chart with unknowns, and links a tee with a chart into the app', () => {
  const page = { ...product({ sizes: chart }), slug: 'acme-crew-tee' };
  const other = { ...product({ sku: 'AB-3', name: 'Boxy Tee', reviews: reviews(12, 0, 100, 0) }), slug: 'acme-boxy-tee' };
  const html = renderProductPage(page, [other], '2026-11-12');
  assert.match(html, /<title>Does the Acme Crew Tee run small\? — Pearfit<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.pearfit\.app\/fit\/acme-crew-tee\.html" \/>/);
  assert.match(html, /<h1>Does the Acme Crew Tee run small\?<\/h1>/);
  assert.match(html, /Yes\. Most reviews say it runs small\./);
  assert.match(html, /Pearfit read 40 reviews of this product\. 30% were counted as true to size, 60% as runs small and 10% as runs large\. A review is counted as true to size when it does not say the fit is small or large\./);
  assert.doesNotMatch(html, /reviews that say how it fits/); // the shares are of all the reviews read, not only those that mention fit
  assert.match(html, /<tr><th scope="row">S<\/th><td>50<\/td><td>68\.5<\/td><td class="is-unknown">unknown<\/td><\/tr>/);
  assert.match(html, /href="\/app\/#\/check\/ab-100"/);
  assert.match(html, /href="\/fit\/acme-boxy-tee\.html"><span class="fit-list-name">Boxy Tee<\/span><span class="fit-list-meta">True to size · 12 reviews<\/span>/);
  assert.match(html, /Numbers as of 12 November 2026\./);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(description.length >= 70 && description.length <= 160, `description is ${description.length} characters`);
});

test('a product with no chart says so, a small sample is called one, and a non-tee links to the app without a product', () => {
  const page = { ...product({ garmentType: 'polo', reviews: reviews(12, 0, 100, 0) }), slug: 'acme-crew-tee' };
  const html = renderProductPage(page, [], '2026-11-12');
  assert.match(html, /Pearfit has no size chart for this product yet\./);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /That is a small sample, so read it as a hint\./);
  assert.match(html, /<a class="btn" href="\/app">/);
  assert.doesNotMatch(html, /related-heading/); // no other page of this brand
});

test('names are escaped in the page and in the sitemap', () => {
  const page = { ...product({ name: 'Tee <b>&"x"' }), slug: 'acme-tee-b-x' };
  const html = renderProductPage(page, [], '2026-11-12');
  assert.match(html, /<h1>Does the Acme Tee &lt;b&gt;&amp;&quot;x&quot; run small\?<\/h1>/);
  assert.doesNotMatch(html, /<b>/);
  const sitemap = renderSitemap([page], [], '2026-11-12');
  assert.match(sitemap, /<url><loc>https:\/\/www\.pearfit\.app\/<\/loc><\/url>/); // a hand-written page: no date
  assert.match(sitemap, /<url><loc>https:\/\/www\.pearfit\.app\/fit\/acme-tee-b-x\.html<\/loc><lastmod>2026-11-12<\/lastmod><\/url>/);
});

test('the same catalog always builds the same files, with related guides ordered by review count', () => {
  const home = `<main>\n    ${HOME_START}\n    ${HOME_END}\n</main>`;
  const catalog = {
    exported_on: '2026-11-12',
    products: [
      product({ sku: 'AB-1', name: 'Crew Tee', reviews: reviews(40, 60, 30, 10) }),
      product({ sku: 'AB-2', name: 'Boxy Tee', reviews: reviews(12, 0, 100, 0) }),
      product({ sku: 'AB-3', name: 'Long Tee', reviews: reviews(90, 0, 100, 0) }),
    ],
  };
  const first = buildFiles(catalog, home).files;
  assert.deepEqual(buildFiles(structuredClone(catalog), home).files, first);
  assert.deepEqual(Object.keys(first).sort(), ['fit/acme-boxy-tee.html', 'fit/acme-crew-tee.html', 'fit/acme-long-tee.html', 'fit/brands/acme.html', 'fit/index.html', 'fit/method.html', 'index.html', 'sitemap.xml']);
  assert.match(first['fit/acme-crew-tee.html'], /<a href="\/fit\/brands\/acme\.html">Acme<\/a>/); // three guides: the brand has a page
  const crew = first['fit/acme-crew-tee.html'];
  assert.ok(crew.indexOf('/fit/acme-long-tee.html') < crew.indexOf('/fit/acme-boxy-tee.html')); // 90 reviews before 12
  assert.match(first['fit/index.html'], /How 3 products from 1 brands run/);
});

test('the committed pages match the committed catalog snapshot', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const catalog = JSON.parse(readFileSync(path.join(root, 'data', 'fit-pages', 'catalog.json'), 'utf8'));
  for (const [file, contents] of Object.entries(buildFiles(catalog, readFileSync(path.join(root, 'website', 'index.html'), 'utf8')).files)) {
    const target = path.join(root, 'website', file);
    assert.ok(existsSync(target), `${file} is missing: run node website/scripts/build-fit-pages.mjs`);
    assert.equal(readFileSync(target, 'utf8'), contents, `${file} is stale: run node website/scripts/build-fit-pages.mjs`);
  }
});

// ---- combining listings ----

test('formatCount puts a comma in every thousand', () => {
  assert.equal(formatCount(40), '40');
  assert.equal(formatCount(6241), '6,241');
  assert.equal(formatCount(1234567), '1,234,567');
});

test('combineReviews weights each listing by its reviews and gives the extra points to the largest remainders', () => {
  // 55 reviews at 5 / 91 / 4 and 25 reviews at 0 / 92 / 8, 80 in all:
  //   runs small  (55 * 5  + 25 * 0) / 80 = 3.4375    true to size (55 * 91 + 25 * 92) / 80 = 91.3125
  //   runs large  (55 * 4  + 25 * 8) / 80 = 5.25      they add up to 100, and the floors 3 + 91 + 5 = 99
  // The one point left goes to the largest remainder, .4375 (runs small): 4 / 91 / 5.
  assert.deepEqual(combineReviews([reviews(55, 5, 91, 4), reviews(25, 0, 92, 8)]), reviews(80, 4, 91, 5));
  // 10 reviews at 50 / 50 / 0 and 10 at 0 / 50 / 50: exactly 25 / 50 / 25, nothing to hand out.
  assert.deepEqual(combineReviews([reviews(10, 50, 50, 0), reviews(10, 0, 50, 50)]), reviews(20, 25, 50, 25));
  // Stored shares that add up to 101 are scaled back to 100 first: 34 / 34 / 33 over 101 -> 33.66 / 33.66 / 32.67.
  const scaled = combineReviews([reviews(10, 34, 34, 33)]);
  assert.equal(scaled.runsSmallPct + scaled.trueToSizePct + scaled.runsLargePct, 100);
});

test('listings of one product combine: identical review numbers count once, different ones are pooled', () => {
  // Same 13 reviews under two codes: counted once. Equal review counts, so the listing with the chart leads.
  const same = mergeListings([
    product({ sku: 'URL-1', candidateId: 'url-1', reviews: reviews(13, 15, 62, 23) }),
    product({ sku: '729', candidateId: '729', reviews: reviews(13, 15, 62, 23), sizes: chart }),
  ]);
  assert.equal(same.sku, '729');
  assert.equal(same.listings, 1);
  assert.deepEqual(same.reviews, reviews(13, 15, 62, 23));

  // Different reviews: the one with the most reviews leads and names the product; the chart comes from the other.
  const pooled = mergeListings([
    product({ sku: 'E2', candidateId: 'e2', name: "Men's Tee", reviews: reviews(25, 0, 92, 8), sizes: chart }),
    product({ sku: 'E1', candidateId: 'e1', name: "Men's TEE", reviews: reviews(55, 5, 91, 4) }),
  ]);
  assert.equal(pooled.name, "Men's TEE");
  assert.equal(pooled.sku, 'E1');
  assert.equal(pooled.listings, 2);
  assert.deepEqual(pooled.reviews, reviews(80, 4, 91, 5)); // the worked example above
  assert.deepEqual(pooled.sizes, chart);
  assert.equal(pooled.candidateId, 'e2'); // the app check follows the listing the chart is from

  const none = mergeListings([product({ sku: 'E3' })]);
  assert.equal(none.sizes, null);
  assert.equal(none.candidateId, 'ab-100');
});

test('one spelling of a brand is used, the one on its most reviewed product', () => {
  const pages = selectPages({
    products: [
      product({ sku: 'A1', brand: 'Uniqlo', name: 'Tee One', reviews: reviews(12, 0, 100, 0) }),
      product({ sku: 'A2', brand: 'UNIQLO', name: 'Tee Two', reviews: reviews(55, 0, 100, 0) }),
    ],
  });
  assert.deepEqual(pages.map((p) => p.brand), ['UNIQLO', 'UNIQLO']);
});

// ---- brand pages ----

const guide = (brand, name, r, over = {}) => ({ ...product({ brand, name, reviews: r, ...over }), slug: slugify(`${brand} ${name}`), listings: 1 });

test('a brand gets a page with at least three guides', () => {
  const pages = [
    guide('Acme', 'A1', reviews(20, 0, 100, 0)), guide('Acme', 'A2', reviews(20, 0, 100, 0)), guide('Acme', 'A3', reviews(20, 0, 100, 0)),
    guide('Zed', 'Z1', reviews(20, 0, 100, 0)), guide('Zed', 'Z2', reviews(20, 0, 100, 0)),
  ];
  assert.deepEqual(selectBrands(pages).map((b) => [b.brand, b.slug, b.pages.length]), [['Acme', 'acme', 3]]);
});

test('a brand page gives the brand-wide answer, how its guides break down, the callouts and the guides by type', () => {
  // Crew Tee 40 reviews 60 / 30 / 10, Boxy Tee 30 reviews 0 / 100 / 0, Polo 20 reviews 0 / 70 / 30. 90 reviews:
  //   runs small (40 * 60) / 90 = 26.67   true to size (40 * 30 + 30 * 100 + 20 * 70) / 90 = 62.22   runs large (40 * 10 + 20 * 30) / 90 = 11.11
  // Floors 26 + 62 + 11 = 99; the extra point goes to .67 (runs small): 27 / 62 / 11. True to size leads below 70, and
  // runs small is ahead of runs large by 16 (10 or more): "mostly true to size, leaning small".
  const pages = [
    guide('Acme', 'Crew Tee', reviews(40, 60, 30, 10)),
    guide('Acme', 'Boxy Tee', reviews(30, 0, 100, 0)),
    guide('Acme', 'Polo', reviews(20, 0, 70, 30), { garmentType: 'polo' }),
  ];
  const html = renderBrandPage({ brand: 'Acme', slug: 'acme', pages }, '2026-11-12');
  assert.match(html, /<title>Does Acme run small\? Fit guide for 3 products — Pearfit<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.pearfit\.app\/fit\/brands\/acme\.html" \/>/);
  assert.match(html, /<h1>Does Acme run small\?<\/h1>/);
  assert.match(html, /Mostly no\. More reviews are counted as true to size than anything else, but a fair share say it runs small\./);
  assert.match(html, /Across the 3 Acme products Pearfit has guides for, 62% of reviews are counted as true to size, 27% as runs small and 11% as runs large\. Pearfit read 90 reviews in all\./);
  // Crew Tee is "runs small" (60 is 50 or more); the other two are "true to size" (100, and 70 which is the clear mark).
  assert.match(html, /<li>True to size: 2 guides<\/li>\s*<li>Runs small: 1 guide<\/li>/);
  // Callouts: runs small 20% or more with 20 or more reviews -> Crew Tee (60%); runs large -> Polo (30%, exactly 20 reviews).
  assert.match(html, /Products reviewers say run small[\s\S]*60% say it runs small · 40 reviews/);
  assert.match(html, /Products reviewers say run large[\s\S]*30% say it runs large · 20 reviews/);
  // Two tees and one polo: fewer than three of a type, so no per-type sentence.
  assert.match(html, /<h3 class="fit-type">T-shirts<\/h3>/);
  assert.match(html, /<h3 class="fit-type">Polo shirts<\/h3>/);
  assert.doesNotMatch(html, /Across these/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(description.length >= 70 && description.length <= 160, `description is ${description.length} characters`);
  assert.match(html, /"position":3,"name":"Acme"/);
});

test('a brand page sums up a type of garment with three or more guides, and leaves out a callout nobody qualifies for', () => {
  // Three tees of 10 reviews, all true to size: 100 / 0 / 0 over 30 reviews. No product has 20 reviews, so no callouts.
  const pages = ['One', 'Two', 'Three'].map((n) => guide('Acme', `${n} Tee`, reviews(10, 0, 100, 0)));
  const html = renderBrandPage({ brand: 'Acme', slug: 'acme', pages }, '2026-11-12');
  assert.match(html, /Across these 3 guides: 100% of reviews are counted as true to size, 0% as runs small, 0% as runs large \(30 reviews\)\./);
  assert.doesNotMatch(html, /Products reviewers say run/);
});

test('a product page links its brand page, and says when it combines several listings', () => {
  const brand = { brand: 'Acme', slug: 'acme', pages: [1, 2, 3].map((n) => guide('Acme', `Tee ${n}`, reviews(12, 0, 100, 0))) };
  const page = { ...guide('Acme', 'Crew Tee', reviews(40, 60, 30, 10), { sizes: chart }), listings: 3 };
  const html = renderProductPage(page, brand.pages, '2026-11-12', brand);
  assert.match(html, /<a href="\/fit\/">Fit guides<\/a> <span aria-hidden="true">›<\/span> <a href="\/fit\/brands\/acme\.html">Acme<\/a>/);
  assert.match(html, /<a href="\/fit\/brands\/acme\.html">All 3 Acme fit guides<\/a>/);
  assert.match(html, /"position":3,"name":"Acme"/);
  assert.match(html, /Pearfit read 40 reviews across 3 listings of this product\./);
  assert.match(html, /The store lists this product under several codes/);
  const single = renderProductPage({ ...page, listings: 1 }, [], '2026-11-12');
  assert.match(single, /Pearfit read 40 reviews of this product\./);
  assert.doesNotMatch(single, /several codes/);
  assert.doesNotMatch(single, /\/fit\/brands\//);
});

test('the index shows a brand that has its own page as its most reviewed guides and a link, and lists any other brand in full', () => {
  const acme = Array.from({ length: 10 }, (_, i) => guide('Acme', `Tee ${i + 1}`, reviews(100 - i, 0, 100, 0)));
  const zed = [guide('Zed', 'Z1', reviews(20, 0, 100, 0)), guide('Zed', 'Z2', reviews(15, 0, 100, 0))];
  const pages = [...acme, ...zed];
  const html = renderIndexPage(pages, selectBrands(pages), '2026-11-12');
  assert.equal(html.match(/href="\/fit\/acme-tee-\d+\.html"/g).length, 8); // the 8 most reviewed of 10
  assert.doesNotMatch(html, /acme-tee-9\.html|acme-tee-10\.html/); // the two with the fewest reviews
  assert.match(html, /<a href="\/fit\/brands\/acme\.html"><span class="fit-list-name">All 10 Acme fit guides<\/span>/);
  assert.equal(html.match(/href="\/fit\/zed-z\d\.html"/g).length, 2); // Zed has two guides: all shown, no brand page
  assert.match(html, /How 12 products from 2 brands run/);
  assert.match(html, /<a href="\/fit\/" aria-current="page">Fit guides<\/a>/);
});

// ---- the home page block ----

test('the home block links the biggest brands, then the most reviewed guides with at most two per brand', () => {
  const pages = [
    guide('Acme', 'T1', reviews(300, 0, 100, 0)), guide('Acme', 'T2', reviews(200, 0, 100, 0)), guide('Acme', 'T3', reviews(100, 0, 100, 0)),
    guide('Bee', 'B1', reviews(250, 0, 100, 0)), guide('Bee', 'B2', reviews(150, 0, 100, 0)),
    guide('Cee', 'C1', reviews(50, 0, 100, 0)),
  ];
  const block = renderHomeBlock(pages, selectBrands(pages));
  assert.ok(block.startsWith(HOME_START) && block.endsWith(HOME_END));
  const links = [...block.matchAll(/href="(\/fit\/[^"]*)"/g)].map((m) => m[1]);
  // The method page link in the intro, the one brand with three guides, then guides by reviews: Acme T1 (300), Bee B1 (250), Acme T2 (200), Bee B2 (150),
  // [Acme T3 (100) is skipped: Acme already has two], Cee C1 (50), then the link to all of them.
  assert.deepEqual(links, ['/fit/method.html', '/fit/brands/acme.html', '/fit/acme-t1.html', '/fit/bee-b1.html', '/fit/acme-t2.html', '/fit/bee-b2.html', '/fit/cee-c1.html', '/fit/']);
  assert.match(block, /Does Acme run small\?/);
  assert.match(block, /See all 6 fit guides/);
  assert.match(block, /<section id="fit-guides"/);
});

test('spliceHome replaces only what is between the markers, and runs again without changing anything', () => {
  const block = renderHomeBlock([guide('Acme', 'T1', reviews(20, 0, 100, 0))], []);
  const html = `<main>\n    <section id="how">how</section>\n\n    ${HOME_START}\n    stale stuff\n    ${HOME_END}\n\n    <section id="pilot">pilot</section>\n</main>`;
  const once = spliceHome(html, block);
  assert.ok(once.startsWith('<main>\n    <section id="how">how</section>\n\n    ' + HOME_START));
  assert.ok(once.endsWith(HOME_END + '\n\n    <section id="pilot">pilot</section>\n</main>'));
  assert.doesNotMatch(once, /stale stuff/);
  assert.equal(spliceHome(once, block), once);
  assert.throws(() => spliceHome('<main></main>', block), /markers/);
});

// ---- similar guides from other brands ----

test('similar guides come from other brands, start in a different place on each page, and wrap round', () => {
  // Eight brands with one tee each, slugs a-tee .. h-tee. Six are shown, and a page starts at its own position
  // (0 for a-tee, 1 for b-tee, ...) times six, wrapping round the pool of the other seven.
  //   a-tee: pool [b c d e f g h], start 0            -> b c d e f g
  //   b-tee: pool [a c d e f g h], start 1 * 6 % 7 = 6 -> h a c d e f
  //   c-tee: pool [a b d e f g h], start 2 * 6 % 7 = 5 -> g h a b d e
  const pages = 'ABCDEFGH'.split('').map((b) => guide(b, 'Tee', reviews(20, 0, 100, 0)));
  const slugs = (page) => similarGuides(page, pages).map((p) => p.slug.replace('-tee', ''));
  assert.deepEqual(slugs(pages[0]), ['b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(slugs(pages[1]), ['h', 'a', 'c', 'd', 'e', 'f']);
  assert.deepEqual(slugs(pages[2]), ['g', 'h', 'a', 'b', 'd', 'e']);
});

test('similar guides never include the same brand or another type of garment, and a brand on its own gets none', () => {
  const pages = [
    guide('Acme', 'Crew Tee', reviews(20, 0, 100, 0)), guide('Acme', 'Boxy Tee', reviews(20, 0, 100, 0)),
    guide('Zed', 'Zed Tee', reviews(20, 0, 100, 0)), guide('Zed', 'Zed Polo', reviews(20, 0, 100, 0), { garmentType: 'polo' }),
  ];
  assert.deepEqual(similarGuides(pages[0], pages).map((p) => p.slug), ['zed-zed-tee']); // not the Acme tee, not the polo
  assert.deepEqual(similarGuides(pages[3], pages), []); // the only polo
  assert.deepEqual(similarGuides(pages[0], pages.slice(0, 2)), []); // only Acme here
});

test('other garments are grouped by a word in the name, and a name that matches no group has no similar guides', () => {
  const other = (brand, name) => guide(brand, name, reviews(20, 0, 100, 0), { garmentType: 'other' });
  const pages = [
    other('Acme', 'Barrel Jeans'), other('Zed', 'Baggy Jeans'), other('Zed', 'Wide Pants'),
    other('Acme', 'Short Sleeve Top'), other('Zed', 'Active Short - Black'), other('Zed', 'The Casual Clog'),
  ];
  assert.deepEqual(pages.map((p) => similarGroup(p)?.label ?? null), ['Jeans', 'Jeans', 'Pants', 'Tops', 'Shorts', null]); // "Short Sleeve" is not shorts
  assert.deepEqual(similarGuides(pages[0], pages).map((p) => p.slug), ['zed-baggy-jeans']);
  assert.deepEqual(similarGuides(pages[1], pages).map((p) => p.slug), ['acme-barrel-jeans']);
  assert.deepEqual(similarGuides(pages[2], pages), []); // the only pants
  assert.deepEqual(similarGuides(pages[5], pages), []);
  assert.equal(similarGroup(guide('Acme', 'Crew Tee', reviews(20, 0, 100, 0))).label, 'T-shirts');
});

test('a product page lists its similar guides under the group name, with the brand in each name', () => {
  const page = guide('Acme', 'Crew Tee', reviews(40, 60, 30, 10));
  const others = [guide('Zed', 'Zed Tee', reviews(20, 0, 100, 0)), guide('Bee', 'Bee Tee', reviews(15, 0, 100, 0))];
  const html = renderProductPage(page, [], '2026-11-12', null, others);
  assert.match(html, /<h2 id="similar-heading">T-shirts from other brands<\/h2>/);
  assert.match(html, /href="\/fit\/zed-zed-tee\.html"><span class="fit-list-name">Zed Tee<\/span>/); // the brand is not said twice
  assert.doesNotMatch(renderProductPage(page, [], '2026-11-12'), /similar-heading/);
});

// ---- the methodology page ----

test('the method page says how a review is counted, with the generator settings and the live counts', () => {
  const pages = [guide('Acme', 'Crew Tee', reviews(40, 60, 30, 10))];
  const html = renderMethodPage(pages, '2026-11-12');
  assert.match(html, /<title>How the fit numbers are made — Pearfit<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.pearfit\.app\/fit\/method\.html" \/>/);
  assert.match(html, /<h1>How the fit numbers are made<\/h1>/);
  assert.match(html, /Today that is 1 guides? from 1 brand, built from 40 reviews, as of 12 November 2026\./);
  assert.match(html, /<strong>A review with no such phrase, including one that never mentions fit, is counted as true to size\.<\/strong>/);
  assert.match(html, /It is not the share that say “true to size”\./);
  assert.match(html, /True to size at 70% or more is “true to size”\./); // CLEAR_TRUE_TO_SIZE_PCT
  assert.match(html, /at least 10 points ahead of the other/); // LEAN_MARGIN_PCT
  assert.match(html, /“runs small” at 50% or more/); // CLEAR_RUNS_PCT
  assert.match(html, /needs at least 10 reviews after pooling, and a brand page needs at least 3 guides/);
  assert.match(html, /<a href="\/stores\.html">supported stores<\/a>/);
  assert.match(html, /<a href="mailto:customerservice@pearfit\.app">customerservice@pearfit\.app<\/a>/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(description.length >= 70 && description.length <= 160, `description is ${description.length} characters`);
});

test('every guide links the method page, and the sitemap lists it', () => {
  const page = guide('Acme', 'Crew Tee', reviews(40, 60, 30, 10));
  assert.match(renderProductPage(page, [], '2026-11-12'), /<a href="\/fit\/method\.html">How these numbers are made<\/a>/);
  const brand = { brand: 'Acme', slug: 'acme', pages: [1, 2, 3].map((n) => guide('Acme', `Tee ${n}`, reviews(12, 0, 100, 0))) };
  assert.match(renderBrandPage(brand, '2026-11-12'), /<a href="\/fit\/method\.html">How these numbers are made<\/a>/);
  assert.match(renderIndexPage([page], [], '2026-11-12'), /<a href="\/fit\/method\.html">How these numbers are made<\/a>/);
  assert.match(renderHomeBlock([page], []), /<a href="\/fit\/method\.html">How the numbers are made<\/a>/);
  assert.match(renderSitemap([page], [], '2026-11-12'), /<url><loc>https:\/\/www\.pearfit\.app\/fit\/method\.html<\/loc><lastmod>2026-11-12<\/lastmod><\/url>/);
});
