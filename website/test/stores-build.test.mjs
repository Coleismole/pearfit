import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTables, parseBullets, parseSupportedStores, platformOf, answerLevel, reasonKind, splitStoreList, slugify, notesByStore, renderJson, loadSource,
} from '../scripts/build-stores.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, 'fixtures', 'supported-stores.md'), 'utf8');
const data = parseSupportedStores(fixture);
const byId = (id) => data.supported.find((store) => store.id === id);

// ---- the markdown reader ----

test('parseTables finds every table with the heading it sits under, padding short rows', () => {
  const tables = parseTables(fixture);
  assert.deepEqual(tables.map((t) => t.heading), ['Reviews and fit', 'Size chart only', 'Refused or unavailable (reported, not retried)']);
  assert.deepEqual(tables[0].header, ['Store', 'Product tested', 'Reviews come from', 'Read / stated', 'Size bought', 'Fit answer']);
  assert.equal(tables[0].rows.length, 9);
  assert.deepEqual(tables[1].rows, [['Kotn', 'Product pages show no reviews. The size chart (flat chest and length, cm) is read.']]);
  const short = parseTables('## T\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 |\n');
  assert.deepEqual(short[0].rows, [['1', '2', '']]);
});

test('an escaped pipe stays inside its cell, and bold and code marks are dropped from cells', () => {
  const odd = parseTables(fixture)[0].rows.find((row) => row[0].startsWith('Odd'));
  assert.equal(odd[0], 'Odd | Pipe');
  const zappos = parseTables(fixture)[0].rows.find((row) => row[0].startsWith('adidas'));
  assert.equal(zappos[2], "Zappos' own review pages, followed page by page (/product/review/<id>/page/N)");
  assert.equal(parseTables('## T\n\n| A |\n|---|\n| **bold** `code` |\n')[0].rows[0][0], 'bold code');
});

test('text with pipes that is not a table is ignored', () => {
  assert.deepEqual(parseTables('## T\n\n| not a table |\n\njust text\n'), []);
});

test('parseBullets joins indented continuation lines and keeps the bold names', () => {
  const bullets = parseBullets(fixture).filter((b) => b.heading === 'Reviews and fit');
  assert.equal(bullets.length, 4);
  assert.match(bullets[0].text, /^\*\*Gap\*\* and \*\*Roots\*\* reviews carry no size field; a size is taken only when the review text states it \("I ordered a large"\)\. Treat/);
  assert.equal(parseBullets(fixture).filter((b) => b.heading !== 'Reviews and fit').length, 0);
});

// ---- normalising ----

test('slugify gives lowercase-with-dashes ids', () => {
  assert.equal(slugify('Uniqlo (CA)'), 'uniqlo-ca');
  assert.equal(slugify('L.L.Bean'), 'l-l-bean');
  assert.equal(slugify('Oak + Fort'), 'oak-fort');
  assert.equal(slugify("Lands' End"), 'lands-end');
});

test('platformOf names the platform, and a named platform beats wording about how it was reached', () => {
  const cases = [
    ['Bazaarvoice (opened from the rating summary)', 'Bazaarvoice'],
    ['Trustpilot', 'Trustpilot'],
    ['Structured data in the page', 'Embedded in the page'],
    ['Bazaarvoice data through L.L.Bean\'s own endpoint ("Load 10 more" needs a real click)', 'Bazaarvoice'],
    ['PowerReviews through Vineyard Vines\' own endpoint', 'PowerReviews'],
    ['TurnTo, on the product\'s own review page (followed from "See Reviews")', 'TurnTo'],
    ["Vuori's own endpoint (Reviews.io data)", 'Reviews.io'],
    ['Yotpo, paged with the widget\'s "next page" button', 'Yotpo'],
    ['Klaviyo Reviews (colourways grouped)', 'Klaviyo Reviews'],
    ['Okendo (first page in the HTML, rest as data)', 'Okendo'],
    ["Uniqlo's own review service", "Store's own service"],
    ["Spanx's own review data", "Store's own service"],
    ['Reviews embedded in the page (the headless browser gets HTTP 429)', 'Embedded in the page'],
    ['Reviews in the page markup', 'Embedded in the page'],
    ['Page markup', 'Embedded in the page'],
    ["Zappos' own review pages, followed page by page", 'Review pages'],
    ['A brand new widget', 'Other'],
    ['', 'Other'],
  ];
  for (const [text, platform] of cases) assert.equal(platformOf(text), platform, text);
});

test('answerLevel reads yes, sometimes and no from the cell wording', () => {
  for (const [text, level] of [
    ['yes', 'yes'], ['yes (variant)', 'yes'], ['yes (1–5 scale)', 'yes'], ['yes (worded)', 'yes'],
    ['from review text only', 'sometimes'], ['rarely stated', 'sometimes'], ['some', 'sometimes'], ['few answer it', 'sometimes'],
    ['no field', 'no'], ['No field', 'no'],
    ['maybe', null], ['', null],
  ]) assert.equal(answerLevel(text), level, text);
});

test('reasonKind separates refusals, outages and "no reviews", and refusals win', () => {
  const cases = [
    ['HTTP 403 to the page request.', 'refused'],
    ['HTTP 418 to the page request.', 'refused'],
    ['HTTP 403 or 429.', 'refused'],
    ['Redirects automated requests in a loop to a challenge page.', 'refused'],
    ['Show the headless browser a "Client Challenge" bot check.', 'refused'],
    ['Shows the headless browser an "Access to this page has been denied" block page.', 'refused'],
    ['The page answers HTTP 200 with a short page saying it does not allow automated traffic.', 'refused'],
    ['HTTP 403 to the page request (reviews would come from TurnTo, which the reader supports).', 'refused'],
    ['HTTP 502 to the headless browser.', 'unavailable'],
    ['Did not answer.', 'unavailable'],
    ['Product pages answer HTTP 404 (site moved).', 'unavailable'],
    ['Serves a "System maintenance is in progress" page (HTTP 200).', 'unavailable'],
    ['The product pages tested showed no reviews.', 'no_reviews'],
    ['The page shows "1975 ratings", but no review data loads for the headless browser.', 'no_reviews'],
    ['The page loads no review data for automated visitors.', 'no_reviews'],
    ['Something we have no wording for.', 'other'],
  ];
  for (const [text, kind] of cases) assert.equal(reasonKind(text), kind, text);
});

test('splitStoreList does not split on commas inside parentheses', () => {
  assert.deepEqual(splitStoreList('adidas (adidas.com, adidas.ca), H&M (US and CA), Levi\'s'), ['adidas (adidas.com, adidas.ca)', 'H&M (US and CA)', "Levi's"]);
  assert.deepEqual(splitStoreList('Kotn'), ['Kotn']);
  assert.deepEqual(splitStoreList(' A ,, B '), ['A', 'B']);
});

test('notesByStore gives each bold-named store its own sentences and no-name sentences follow the last name', () => {
  const notes = notesByStore(parseBullets(fixture).filter((b) => b.heading === 'Reviews and fit'));
  assert.deepEqual(notes.get('gap'), [
    'Gap and Roots reviews carry no size field; a size is taken only when the review text states it ("I ordered a large").',
    'Treat its averages as biased.',
  ]);
  assert.deepEqual(notes.get('roots'), notes.get('gap'), 'Roots shares the sentences about Gap and Roots');
  assert.match(notes.get('janji')[0], /^Janji is the first store tested on Judge\.me/);
  assert.deepEqual(notes.get('honeylove'), ['Honeylove states no SKU, so its SKU is a hash of the URL.']);
  assert.deepEqual(notes.get('gymshark'), notes.get('mack weldon'));
});

// ---- the whole document ----

test('supported stores: fields come from the cells and nothing is invented', () => {
  assert.equal(data.supported.length, 9 - 1 + 1, '8 review stores (the duplicate Gap row is dropped) plus the size-chart-only store');
  const uniqlo = byId('uniqlo-ca');
  assert.deepEqual(
    { ...uniqlo, notes: undefined },
    {
      id: 'uniqlo-ca', name: 'Uniqlo (CA)', status: 'reviews', product_tested: "Men's AIRism Tee, Men's Polo",
      reviews_from: "Uniqlo's own review service", platform: "Store's own service", read_stated: '300 / 7455, 88 / 88',
      size_bought: 'yes', size_bought_text: 'yes', fit_answer: 'yes', fit_answer_text: 'yes (1–5 scale)', size_chart: 'not_recorded', notes: undefined,
    },
  );
  assert.equal(byId('gap').platform, 'Bazaarvoice', 'the first Gap row wins');
  assert.equal(byId('gap').size_bought, 'sometimes');
  assert.equal(byId('gap').fit_answer, 'no');
  assert.equal(byId('vuori').platform, 'Reviews.io');
  assert.equal(byId('vuori').fit_answer, 'sometimes');
  assert.equal(byId('target').read_stated, '8 / not stated');
  assert.equal(byId('odd-pipe').platform, 'Other');
  assert.equal(byId('odd-pipe').size_bought, null, 'wording that is not understood stays null');
});

test('every supported store keeps its limits notes', () => {
  assert.equal(byId('gap').notes.length, 2);
  assert.match(byId('target').notes[0], /refuses the headless browser/);
  assert.equal(byId('oiselle').notes.length, 1);
  assert.deepEqual(byId('uniqlo-ca').notes, []);
});

test('the size-chart-only store is a supported entry with no reviews and a recorded chart', () => {
  const kotn = byId('kotn');
  assert.equal(kotn.status, 'size_chart_only');
  assert.equal(kotn.size_chart, 'yes');
  assert.equal(kotn.platform, null);
  assert.equal(kotn.size_bought, null);
  assert.equal(kotn.fit_answer, null);
  assert.match(kotn.notes[0], /size chart/);
});

test('platforms lists each platform once, sorted, without nulls', () => {
  assert.deepEqual(data.platforms, ['Bazaarvoice', 'Embedded in the page', 'Other', 'Review pages', 'Reviews.io', "Store's own service"]);
});

test('not supported: one entry per store with its reason and kind, and the same store in two rows is merged', () => {
  const names = data.not_supported.map((s) => s.name);
  assert.deepEqual(names, [
    'Old Navy', 'adidas (adidas.com, adidas.ca)', 'H&M (US and CA)', "Levi's", 'Under Armour', 'Ralph Lauren', 'Nordstrom', 'SHEIN',
    'JCPenney', 'FILA', 'Patagonia', 'Southern Tide', 'Psycho Bunny', 'Lululemon', 'Mystery Store',
  ]);
  const find = (name) => data.not_supported.find((s) => s.name === name);
  assert.deepEqual(find('Levi\'s'), { id: 'levi-s', name: "Levi's", reason: 'HTTP 403 to the page request.', kind: 'refused' });
  assert.equal(find('Old Navy').kind, 'no_reviews');
  assert.equal(find('JCPenney').kind, 'unavailable');
  assert.equal(find('Mystery Store').kind, 'other');
  assert.equal(find('Lululemon').reason, 'HTTP 403 to the page request (tried again in round 4: still 403).', 'the more detailed reason is kept once');
});

test('a store can be supported in one place and not supported in another (adidas)', () => {
  assert.ok(byId('adidas-at-zappos'));
  assert.ok(data.not_supported.some((s) => s.name === 'adidas (adidas.com, adidas.ca)'));
});

test('metadata: source file, test date, and no timestamp so the output is reproducible', () => {
  assert.equal(data.source, 'webscraper/SUPPORTED_STORES.md');
  assert.equal(data.tested_on, '2026-11-09');
  assert.equal(renderJson(parseSupportedStores(fixture)), renderJson(parseSupportedStores(fixture)));
  assert.equal(parseSupportedStores('# nothing here').tested_on, null);
  assert.deepEqual(parseSupportedStores('# nothing here').supported, []);
});

test('ids are unique across the supported list and across the not supported list', () => {
  assert.equal(new Set(data.supported.map((s) => s.id)).size, data.supported.length);
  assert.equal(new Set(data.not_supported.map((s) => s.id)).size, data.not_supported.length);
});

// ---- later rounds and the verified list ----

const ROUNDS = `# Stores

## Reviews and fit

| Store | Product tested | Reviews come from | Read / stated | Size bought | Fit answer |
|---|---|---|---|---|---|
| Faherty | The Movement Shirt | Yotpo | 40 / 40 | yes | yes |

## Round 7: 3 more stores

Prose that is not a table.

| Store | Product tested | Reviews come from | Read / stated | Size bought | Fit answer |
|---|---|---|---|---|---|
| Bad Birdie | Active Short | Okendo | 142 / 172 | yes | yes |
| Dickies | Work Shirt | Structured data in the page | 12 / 12 | no field | no field |
| Faherty | The Movement Shirt again | Yotpo | 5 / 5 | yes | yes |

- **Bad Birdie** states the size on every review.

## Refused or unavailable (reported, not retried)

| Store | What happened |
|---|---|
| Dickies | Reviews not read: 403. |
`;

test('a table under a "Round N" heading lists supported stores, and a store named twice is one entry (the first)', () => {
  const rounds = parseSupportedStores(ROUNDS);
  assert.deepEqual(rounds.supported.map((s) => s.id), ['faherty', 'bad-birdie', 'dickies']);
  assert.equal(rounds.supported[0].product_tested, 'The Movement Shirt');
  assert.equal(rounds.supported.find((s) => s.id === 'dickies').platform, 'Embedded in the page');
  assert.deepEqual(rounds.supported.find((s) => s.id === 'bad-birdie').notes, ['Bad Birdie states the size on every review.']);
});

test('the size chart is "yes" only where the verified list says a chart was read, matched by store name', () => {
  const verified = {
    stores: [
      { id: 'bad-birdie', name: 'Bad Birdie', has_size_chart: false },
      // the verified list suffixes an id it already used; the entry still belongs to the store named Dickies
      { id: 'dickies-2', name: 'Dickies', has_size_chart: true },
    ],
    needs_url: [{ id: 'faherty', name: 'Faherty', has_size_chart: false }],
  };
  const withCharts = parseSupportedStores(ROUNDS, verified);
  assert.deepEqual(withCharts.supported.map((s) => [s.id, s.size_chart]), [['faherty', 'not_recorded'], ['bad-birdie', 'not_recorded'], ['dickies', 'yes']]);
  assert.deepEqual(parseSupportedStores(ROUNDS).supported.map((s) => s.size_chart), ['not_recorded', 'not_recorded', 'not_recorded']);
});

// ---- the real file ----

test('the real SUPPORTED_STORES.md parses into a plausible list with a platform for every store', () => {
  const real = loadSource();
  assert.ok(real.supported.length >= 200, `${real.supported.length} supported (the Round 7 tables are read too)`);
  assert.ok(real.not_supported.length >= 50, `${real.not_supported.length} not supported`);
  const unknown = real.supported.filter((s) => s.platform === 'Other').map((s) => s.name);
  assert.deepEqual(unknown, [], 'a store whose review platform is not recognised: add it to PLATFORMS in scripts/build-stores.mjs');
  const unread = real.supported.filter((s) => s.status === 'reviews' && (s.size_bought === null || s.fit_answer === null)).map((s) => s.name);
  assert.deepEqual(unread, [], 'a Size bought or Fit answer cell the parser does not understand');
  assert.deepEqual(real.not_supported.filter((s) => s.kind === 'other').map((s) => s.name), [], 'a reason the parser cannot classify');
  assert.equal(new Set(real.supported.map((s) => s.id)).size, real.supported.length, 'duplicate supported ids');
});

test('the committed website/stores.json matches SUPPORTED_STORES.md (run node website/scripts/build-stores.mjs)', () => {
  const committed = readFileSync(path.join(here, '..', 'stores.json'), 'utf8');
  assert.equal(committed, renderJson(loadSource()));
});
