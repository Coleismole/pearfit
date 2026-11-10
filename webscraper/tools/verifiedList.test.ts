import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerifiedList,
  findUrlHint,
  hostCore,
  hostOf,
  normalizeName,
  parseChartStoreNames,
  parseReadStated,
  parseStoreDoc,
  platformLabel,
  slugify,
  renderReviewTables,
  splitTableLine,
  storeMatchesHost,
  type UrlHint,
} from './verifiedList.ts';
import { parseHintLines } from './build-verified-list.ts';

const MD = `# Stores confirmed scrapeable

Tested on 2026-11-09.

## Reviews and fit

| Store | Product tested | Reviews come from | Read / stated | Size bought | Fit answer |
|---|---|---|---|---|---|
| Uniqlo (CA) | Men's AIRism Cotton Oversized T-Shirt, Men's DRY-EX Polo | Uniqlo's own review service | 300 / 7455, 88 / 88 | yes | yes (1–5 scale) |
| Tentree | Northern Aurora T-Shirt, Kessler Sweater | Okendo (first page in the HTML, rest as data) | 3 / 3, 13 / 13 | yes | yes |
| Janji | M's Circa Daily Tee | Judge.me | 66 / not stated | no field | no field |
| Toad&Co | Abele Dress | Okendo | 19 / 19 | yes | yes |

Known limits:

- **Janji** states no review total.

## Round 7: 4 more stores

Intro paragraph.

| Store | Product tested | Reviews come from | Read / stated | Size bought | Fit answer |
|---|---|---|---|---|---|
| Dickies | 1/4 Zip Work Shirt | Yotpo | 6 / 6 | yes | yes |
| Reitmans | 3/4-Sleeve Embroidered Blouse | PowerReviews | 10 / 10 | no field | yes |
| Reitmans | 3/4-Sleeve Embroidered Blouse | PowerReviews | 10 / 10 | no field | yes |
| Barbour | Barbour® Classic Beaufort Jacket | Yotpo | 181 / 181 | rarely stated | rarely stated |

**Size charts.** A chart was read for 2 of the 4 stores that returned reviews (Dickies, Gone Store). Most other
guides measure the body.

## Size chart only

| Store | Notes |
|---|---|
| Kotn | Product pages show no reviews. The size chart is read. |

## Refused or unavailable (reported, not retried)

| Store | What happened |
|---|---|
| Old Navy | The page shows ratings, but no review data loads. |
`;

const HINTS: UrlHint[] = [
  { source: 'r1', url: 'https://www.janji.com/products/ms-circa-daily-tee', name: "M's Circa Daily Tee", got: 66 },
  { source: 'r1', url: 'https://www.toadandco.com/products/abele-dress-crabapple-print', name: 'Abele Dress', got: 19 },
  { source: 'r7', url: 'https://www.dickies.com/products/zip-work-shirt', name: '1/4 Zip Work Shirt', got: 6, chart: 5 },
  { source: 'r7', url: 'https://www.reitmans.ca/products/blouse-497824', name: '3/4-Sleeve Embroidered Blouse', got: 10 },
  { source: 'r7', url: 'https://www.reitmans.com/products/blouse-497824', name: '3/4-Sleeve Embroidered Blouse', got: 10 },
  { source: 'r7', url: 'https://www.orvis.com/products/classic-beaufort-jacket', name: 'Barbour&#174; Classic Beaufort Jacket', got: 181 },
  { source: 'r1', url: 'https://www.tentree.com/products/northern-aurora-t-shirt', name: 'Northern Aurora T-Shirt - Meteorite', got: 3 },
];

test('splitTableLine splits on unescaped bars and unescapes the others', () => {
  assert.deepEqual(splitTableLine('| a | b \\| c |  |'), ['a', 'b | c', '']);
});

test('parseReadStated reads one or more pairs, with "not stated" as null', () => {
  assert.deepEqual(parseReadStated('300 / 7455, 88 / 88'), [{ read: 300, stated: 7455 }, { read: 88, stated: 88 }]);
  assert.deepEqual(parseReadStated('66 / not stated'), [{ read: 66, stated: null }]);
  assert.deepEqual(parseReadStated('no field'), []);
});

test('platformLabel follows the website generator: a named platform, else a kind of source, else Other', () => {
  assert.equal(platformLabel('Okendo (first page in the HTML, rest as data)'), 'Okendo');
  assert.equal(platformLabel('TurnTo, on the product\'s own review page (followed from "See Reviews")'), 'TurnTo');
  assert.equal(platformLabel("Bazaarvoice data through L.L.Bean's own endpoint"), 'Bazaarvoice');
  assert.equal(platformLabel("Vuori's own endpoint (Reviews.io data)"), 'Reviews.io');
  assert.equal(platformLabel("Uniqlo's own review service"), "Store's own service");
  assert.equal(platformLabel('Reviews embedded in the page'), 'Embedded in the page');
  assert.equal(platformLabel('Page markup'), 'Embedded in the page');
  assert.equal(platformLabel("Zappos' own review pages, followed page by page"), 'Review pages');
  assert.equal(platformLabel('Structured data in the page'), 'Other');
  assert.equal(slugify("Uniqlo (CA)"), 'uniqlo-ca');
  assert.equal(slugify('Oak + Fort'), 'oak-fort');
});

test('names compare without accents, case, punctuation; "&" and "+" read as "and"', () => {
  assert.equal(normalizeName('Café du Cycliste'), 'cafeducycliste');
  assert.equal(normalizeName('Toad&Co'), 'toadandco');
  assert.equal(normalizeName('Oak + Fort'), 'oakandfort');
  assert.equal(hostOf('https://www.Collectif.co.uk/products/x'), 'collectif.co.uk');
  assert.equal(hostCore('collectif.co.uk'), 'collectif');
  assert.equal(hostCore('us.puma.com'), 'puma');
  assert.equal(storeMatchesHost('Toad&Co', 'toadandco.com'), true);
  assert.equal(storeMatchesHost('Barbour', 'orvis.com'), false);
});

test('parseStoreDoc reads the review tables, the chart-only table and the chart names, and skips the others', () => {
  const doc = parseStoreDoc(MD);
  assert.equal(doc.rows.length, 8);
  assert.deepEqual(doc.rows[0], {
    section: 'Reviews and fit',
    row: 0,
    store: 'Uniqlo (CA)',
    product: "Men's AIRism Cotton Oversized T-Shirt, Men's DRY-EX Polo",
    reviewsFrom: "Uniqlo's own review service",
    readStated: '300 / 7455, 88 / 88',
    sizeBought: 'yes',
    fitAnswer: 'yes (1–5 scale)',
  });
  assert.deepEqual(doc.rows.map((r) => r.section), [...Array(4).fill('Reviews and fit'), ...Array(4).fill('Round 7: 4 more stores')]);
  assert.deepEqual(doc.rows.slice(4).map((r) => r.row), [0, 1, 2, 3]);
  assert.deepEqual(doc.sizeChartOnly, [{ store: 'Kotn', notes: 'Product pages show no reviews. The size chart is read.' }]);
  assert.deepEqual(doc.chartStoreNames, ['Dickies', 'Gone Store']);
  assert.equal(doc.chartSection, 'Round 7: 4 more stores');
  assert.deepEqual(parseChartStoreNames('no such paragraph'), []);
});

test('a review table row with the wrong number of cells is an error, not a silent skip', () => {
  const bad = MD.replace('| Janji | M\'s Circa Daily Tee | Judge.me | 66 / not stated | no field | no field |', '| Janji | M\'s Circa Daily Tee | Judge.me | 66 / not stated |');
  assert.throws(() => parseStoreDoc(bad), /has 4 cells, expected 6/);
});

test('findUrlHint matches by product name, tells brands on another site, and reports ambiguity', () => {
  const row = (store: string, product: string, readStated = '1 / 1') => ({ store, product, readStated });
  const hit = findUrlHint(row('Janji', "M's Circa Daily Tee"), HINTS);
  assert.ok(hit.match);
  assert.equal(hit.match.hint.url, 'https://www.janji.com/products/ms-circa-daily-tee');
  // "&" in the store name against "and" in the host.
  assert.equal(findUrlHint(row('Toad&Co', 'Abele Dress'), HINTS).match?.hint.source, 'r1');
  // A numeric HTML entity in the hint's name (&#174; is the registered sign), and a brand sold on another retailer's site (specific name accepted).
  assert.equal(findUrlHint(row('Barbour', 'Barbour® Classic Beaufort Jacket'), HINTS).match?.hint.url, 'https://www.orvis.com/products/classic-beaufort-jacket');
  // A shortened product name: its words are all in the hint's name, and the host fits the store.
  assert.equal(findUrlHint(row('Tentree', 'Northern Aurora T-Shirt, Kessler Sweater', '3 / 3, 13 / 13'), HINTS).match?.productIndex, 0);
  // Nothing recorded.
  assert.deepEqual(findUrlHint(row('Gap', 'Classic T-Shirt'), HINTS), { match: null, reason: 'no recorded product address for this product name' });
  // Two stores with the same product name: refused, unless the table repeats the row.
  const twice = findUrlHint(row('Reitmans', '3/4-Sleeve Embroidered Blouse'), HINTS, { duplicateIndex: 2 });
  assert.equal(twice.match, null);
  assert.match((twice as { reason: string }).reason, /more than one store/);
  assert.equal(findUrlHint(row('Reitmans', '3/4-Sleeve Embroidered Blouse'), HINTS, { duplicateIndex: 0 }).match?.hint.url, 'https://www.reitmans.ca/products/blouse-497824');
  assert.equal(findUrlHint(row('Reitmans', '3/4-Sleeve Embroidered Blouse'), HINTS, { duplicateIndex: 1 }).match?.hint.url, 'https://www.reitmans.com/products/blouse-497824');
  // An address an earlier row took is not given twice.
  const used = new Set(['https://www.janji.com/products/ms-circa-daily-tee']);
  assert.match((findUrlHint(row('Janji', "M's Circa Daily Tee"), HINTS, { usedUrls: used }) as { reason: string }).reason, /duplicate/);
});

test('a short, generic product name on a host that does not fit the store is not taken', () => {
  const hints: UrlHint[] = [{ source: 'r', url: 'https://www.somewhere.com/p/1', name: 'Classic Tee', got: 5 }];
  const lookup = findUrlHint({ store: 'Gap', product: 'Classic Tee', readStated: '5 / 5' }, hints);
  assert.equal(lookup.match, null);
  assert.match((lookup as { reason: string }).reason, /does not fit the store name/);
});

test('buildVerifiedList gives each store its address, expected reviews and size chart flag; the rest go in needs_url', () => {
  const list = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  assert.deepEqual(list.stores.map((s) => [s.name, s.domain, s.expected_min_reviews, s.has_size_chart]), [
    // Tentree's hint is its first product, so its expected count is the first pair's (3), not the second's (13).
    ['Tentree', 'tentree.com', 3, false],
    ['Janji', 'janji.com', 66, false],
    ['Toad&Co', 'toadandco.com', 19, false],
    ['Dickies', 'dickies.com', 6, true],
    ['Reitmans', 'reitmans.ca', 10, false],
    ['Reitmans', 'reitmans.com', 10, false],
    ['Barbour', 'orvis.com', 181, false],
  ]);
  assert.deepEqual(list.needs_url.map((s) => [s.name, s.expected_min_reviews, s.reason]), [
    ['Uniqlo (CA)', 300, 'no recorded product address for this product name'],
    ['Kotn', 0, 'size chart only: no product address recorded'],
  ]);
  assert.deepEqual(list.unmatched_chart_names, ['Gone Store']);
  assert.equal(list.tested_on, '2026-11-09');
  assert.equal(list.source, 'SUPPORTED_STORES.md');
  assert.equal(list.stores.find((s) => s.name === 'Dickies')?.url_source, 'r7');
});

test("each entry has the website data's field names, and ids are unique", () => {
  const list = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  const janji = list.stores.find((s) => s.name === 'Janji')!;
  assert.deepEqual(janji, {
    id: 'janji',
    name: 'Janji',
    status: 'reviews',
    domain: 'janji.com',
    url: 'https://www.janji.com/products/ms-circa-daily-tee',
    url_source: 'r1',
    platform: 'Judge.me',
    expected_min_reviews: 66,
    has_size_chart: false,
    product_tested: "M's Circa Daily Tee",
    reviews_from: 'Judge.me',
    read_stated: '66 / not stated',
    size_bought_text: 'no field',
    fit_answer_text: 'no field',
    table_section: 'Reviews and fit',
    table_row: 2,
  });
  const kotn = list.needs_url.find((s) => s.name === 'Kotn')!;
  assert.equal(kotn.status, 'size_chart_only');
  assert.equal(kotn.platform, null);
  assert.equal(kotn.product_tested, null);
  assert.equal(kotn.size_chart_notes, 'Product pages show no reviews. The size chart is read.');
  // Reitmans is in two rows: the second id is suffixed.
  assert.deepEqual(list.stores.filter((s) => s.name === 'Reitmans').map((s) => s.id), ['reitmans', 'reitmans-2']);
  const ids = [...list.stores, ...list.needs_url].map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a rebuild keeps the addresses of the list it starts from, including for repeated rows', () => {
  const first = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  // Fill in Uniqlo by hand, then rebuild with no hints at all.
  const { reason: _reason, ...uniqlo } = first.needs_url.find((s) => s.name === 'Uniqlo (CA)')!;
  first.stores.push({ ...uniqlo, domain: 'uniqlo.com', url: 'https://www.uniqlo.com/ca/en/products/E1-000', url_source: 'by hand' });
  const second = buildVerifiedList(parseStoreDoc(MD), { hints: [], existing: first });
  assert.deepEqual(
    second.stores.map((s) => s.url).sort(),
    first.stores.map((s) => s.url).sort(),
  );
  assert.equal(second.needs_url.length, 1);
  assert.equal(second.needs_url[0]!.name, 'Kotn');
});

test('rendering the tables from the list gives back the markdown byte for byte', () => {
  const list = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  const rendered = renderReviewTables(MD, list);
  assert.equal(rendered.text, MD);
  assert.deepEqual(rendered.missingFromList, []);
  assert.deepEqual(rendered.extraInList, []);
});

test('rendering follows an edit to the list, and reports rows the list lacks', () => {
  const list = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  const janji = list.stores.find((s) => s.name === 'Janji')!;
  janji.read_stated = '70 / not stated';
  const edited = renderReviewTables(MD, list);
  assert.ok(edited.text.includes('| Janji | M\'s Circa Daily Tee | Judge.me | 70 / not stated | no field | no field |'));
  assert.equal(edited.text.split('\n').length, MD.split('\n').length);
  assert.notEqual(edited.text, MD);
  // The same store and product are in both, so nothing is missing or extra: only a cell changed.
  assert.deepEqual(edited.missingFromList, []);
  assert.deepEqual(edited.extraInList, []);

  const lost = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  lost.stores = lost.stores.filter((s) => s.name !== 'Barbour');
  assert.deepEqual(renderReviewTables(MD, lost).missingFromList.map((r) => r.store), ['Barbour']);
});

test('a table the list has no rows for is left alone, and a lost repeated row is noticed', () => {
  const list = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  // Pretend the list was built from a markdown whose second section had another name.
  for (const entry of [...list.stores, ...list.needs_url]) {
    if (entry.table_section.startsWith('Round 7')) entry.table_section = 'Renamed section';
  }
  const rendered = renderReviewTables(MD, list);
  assert.deepEqual(rendered.untouchedSections, ['Round 7: 4 more stores']);
  assert.ok(rendered.text.includes('| Dickies | 1/4 Zip Work Shirt | Yotpo | 6 / 6 | yes | yes |'), 'the markdown rows are kept');
  assert.equal(rendered.missingFromList.length, 4);

  const twice = buildVerifiedList(parseStoreDoc(MD), { hints: HINTS });
  const index = twice.stores.findIndex((s) => s.name === 'Reitmans');
  twice.stores.splice(index, 1);
  // Two identical Reitmans rows in the markdown, one in the list: one is missing.
  assert.deepEqual(renderReviewTables(MD, twice).missingFromList.map((r) => r.store), ['Reitmans']);
});

test('parseHintLines keeps rows with an http(s) url and a name, and labels them with the file', () => {
  const text = [
    JSON.stringify({ url: 'https://shop.example/p/1', name: 'Tee', got: 3, stated: 4, chart: 2, source: 'mine' }),
    JSON.stringify({ url: 'ftp://shop.example/p/2', name: 'Skipped' }),
    JSON.stringify({ url: 'https://shop.example/p/3' }),
    JSON.stringify({ url: 'https://shop.example/p/4', name: 'Shirt' }),
    '',
  ].join('\n');
  assert.deepEqual(parseHintLines(text, 'results.jsonl'), [
    { source: 'mine', url: 'https://shop.example/p/1', name: 'Tee', got: 3, stated: 4, chart: 2 },
    { source: 'results.jsonl', url: 'https://shop.example/p/4', name: 'Shirt', got: undefined, stated: null, chart: undefined },
  ]);
});
