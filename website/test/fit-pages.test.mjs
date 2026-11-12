// Tests for scripts/build-fit-pages.mjs. The catalog is written by hand, so every expected value can be checked by eye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFiles, fitVerdict, formatDate, fullName, renderProductPage, renderSitemap, selectPages, skipReason, slugify,
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

test('a product gets no page with too few reviews, no fit answers, no brand, or a name that is not a product', () => {
  assert.equal(skipReason(product({})), null);
  assert.equal(skipReason(product({ reviews: reviews(10, 0, 100, 0) })), null); // 10 is enough
  assert.equal(skipReason(product({ reviews: reviews(9, 0, 100, 0) })), 'too_few_reviews');
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

test('pages are sorted by brand then name, and products that share a name get their SKU in the slug', () => {
  const catalog = {
    exported_on: '2026-11-12',
    products: [
      product({ sku: 'ZZ-2', brand: 'Zed', name: 'Polo' }),
      product({ sku: 'AB-2', name: 'Crew Tee' }),
      product({ sku: 'AB-1', name: 'Crew Tee' }),
      product({ sku: 'AB-3', name: 'Boxy Tee' }),
      product({ sku: 'AB-4', name: 'Rare Tee', reviews: reviews(3, 0, 100, 0) }), // too few reviews: no page
    ],
  };
  assert.deepEqual(selectPages(catalog).map((p) => p.slug), ['acme-boxy-tee', 'acme-crew-tee-ab-1', 'acme-crew-tee-ab-2', 'zed-polo']);
});

test('a product page states the stored numbers, the chart with unknowns, and links a tee with a chart into the app', () => {
  const page = { ...product({ sizes: chart }), slug: 'acme-crew-tee' };
  const other = { ...product({ sku: 'AB-3', name: 'Boxy Tee', reviews: reviews(12, 0, 100, 0) }), slug: 'acme-boxy-tee' };
  const html = renderProductPage(page, [other], '2026-11-12');
  assert.match(html, /<title>Does the Acme Crew Tee run small\? — Pearfit<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.pearfit\.app\/fit\/acme-crew-tee\.html" \/>/);
  assert.match(html, /<h1>Does the Acme Crew Tee run small\?<\/h1>/);
  assert.match(html, /Yes\. Most reviewers say it runs small\./);
  assert.match(html, /30% say true to size, 60% say it runs small and 10% say it runs large\. Pearfit read 40 reviews of this product\.<\/p>/);
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
  const sitemap = renderSitemap([page], '2026-11-12');
  assert.match(sitemap, /<url><loc>https:\/\/www\.pearfit\.app\/<\/loc><\/url>/); // a hand-written page: no date
  assert.match(sitemap, /<url><loc>https:\/\/www\.pearfit\.app\/fit\/acme-tee-b-x\.html<\/loc><lastmod>2026-11-12<\/lastmod><\/url>/);
});

test('the same catalog always builds the same files, with related guides ordered by review count', () => {
  const catalog = {
    exported_on: '2026-11-12',
    products: [
      product({ sku: 'AB-1', name: 'Crew Tee', reviews: reviews(40, 60, 30, 10) }),
      product({ sku: 'AB-2', name: 'Boxy Tee', reviews: reviews(12, 0, 100, 0) }),
      product({ sku: 'AB-3', name: 'Long Tee', reviews: reviews(90, 0, 100, 0) }),
    ],
  };
  const first = buildFiles(catalog).files;
  assert.deepEqual(buildFiles(structuredClone(catalog)).files, first);
  assert.deepEqual(Object.keys(first).sort(), ['fit/acme-boxy-tee.html', 'fit/acme-crew-tee.html', 'fit/acme-long-tee.html', 'fit/index.html', 'sitemap.xml']);
  const crew = first['fit/acme-crew-tee.html'];
  assert.ok(crew.indexOf('/fit/acme-long-tee.html') < crew.indexOf('/fit/acme-boxy-tee.html')); // 90 reviews before 12
  assert.match(first['fit/index.html'], /How 3 products from 1 brands run/);
});

test('the committed pages match the committed catalog snapshot', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const catalog = JSON.parse(readFileSync(path.join(root, 'data', 'fit-pages', 'catalog.json'), 'utf8'));
  for (const [file, contents] of Object.entries(buildFiles(catalog).files)) {
    const target = path.join(root, 'website', file);
    assert.ok(existsSync(target), `${file} is missing: run node website/scripts/build-fit-pages.mjs`);
    assert.equal(readFileSync(target, 'utf8'), contents, `${file} is stale: run node website/scripts/build-fit-pages.mjs`);
  }
});
