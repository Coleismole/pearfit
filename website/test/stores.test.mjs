import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// stores.js is a plain browser script that also exports its pure functions for Node. With no document it wires nothing.
const stores = createRequire(import.meta.url)('../stores.js');
const { readStores, filterStores, groupNotSupported, answerText, chartText, statusText } = stores;

const here = path.dirname(fileURLToPath(import.meta.url));

const FILE = {
  tested_on: '2026-11-09',
  platforms: ['Bazaarvoice', 'Yotpo'],
  supported: [
    { id: 'gap', name: 'Gap', status: 'reviews', product_tested: 'Classic T-Shirt', reviews_from: 'Bazaarvoice', platform: 'Bazaarvoice', size_bought: 'sometimes', size_bought_text: 'from review text only', fit_answer: 'no', fit_answer_text: 'no field', size_chart: 'not_recorded', notes: ['No size field.'] },
    { id: 'faherty', name: 'Faherty', status: 'reviews', product_tested: 'The Movement Shirt', reviews_from: 'Yotpo', platform: 'Yotpo', size_bought: 'yes', size_bought_text: 'yes', fit_answer: 'yes', fit_answer_text: 'yes', size_chart: 'not_recorded', notes: [] },
    { id: 'duer', name: 'Duer', status: 'reviews', product_tested: 'PurePima Only Tee', reviews_from: 'Yotpo', platform: 'Yotpo', size_bought: 'yes', size_bought_text: 'yes', fit_answer: 'sometimes', fit_answer_text: 'some', size_chart: 'not_recorded', notes: [] },
    { id: 'kotn', name: 'Kotn', status: 'size_chart_only', product_tested: null, reviews_from: null, platform: null, size_bought: null, size_bought_text: null, fit_answer: null, fit_answer_text: null, size_chart: 'yes', notes: ['The size chart is read.'] },
  ],
  not_supported: [
    { id: 'hm', name: 'H&M (US and CA)', reason: 'HTTP 403 to the page request.', kind: 'refused' },
    { id: 'levis', name: "Levi's", reason: 'HTTP 403 to the page request.', kind: 'refused' },
    { id: 'old-navy', name: 'Old Navy', reason: 'No review data loads for the headless browser.', kind: 'no_reviews' },
    { id: 'fila', name: 'FILA', reason: 'Product pages answer HTTP 404 (site moved).', kind: 'unavailable' },
  ],
};
const data = readStores(FILE);
const ids = (list) => list.map((s) => s.id);

test('readStores keeps well-formed entries and the date, and refuses a file of the wrong shape', () => {
  assert.equal(data.testedOn, '2026-11-09');
  assert.deepEqual(data.platforms, ['Bazaarvoice', 'Yotpo']);
  assert.equal(data.supported.length, 4);
  assert.equal(data.notSupported.length, 4);
  for (const bad of [null, [], 'x', {}, { supported: [] }, { supported: {}, not_supported: [] }]) assert.equal(readStores(bad), null, JSON.stringify(bad));
  const partial = readStores({ supported: [{ id: 'a', name: 'A' }, { id: 5 }, null], not_supported: [{ id: 'b', name: 'B' }, { id: 'c', name: 'C', reason: 'r' }] });
  assert.deepEqual(ids(partial.supported), ['a']);
  assert.deepEqual(partial.supported[0].notes, []);
  assert.deepEqual(ids(partial.notSupported), ['c'], 'a not-supported entry without a reason is dropped');
  assert.equal(partial.testedOn, null);
});

test('no criteria returns everything in the file\'s order', () => {
  const all = filterStores(data, {});
  assert.deepEqual(ids(all.supported), ['gap', 'faherty', 'duer', 'kotn']);
  assert.deepEqual(ids(all.notSupported), ['hm', 'levis', 'old-navy', 'fila']);
  assert.deepEqual(filterStores(data), all);
});

test('the platform filter matches exactly and drops stores with no platform', () => {
  assert.deepEqual(ids(filterStores(data, { platform: 'Yotpo' }).supported), ['faherty', 'duer']);
  assert.deepEqual(ids(filterStores(data, { platform: 'Bazaarvoice' }).supported), ['gap']);
  assert.deepEqual(filterStores(data, { platform: 'Okendo' }).supported, []);
});

test('the size chart filter separates read from not recorded', () => {
  assert.deepEqual(ids(filterStores(data, { sizeChart: 'yes' }).supported), ['kotn']);
  assert.deepEqual(ids(filterStores(data, { sizeChart: 'not_recorded' }).supported), ['gap', 'faherty', 'duer']);
});

test('the size bought and fit answer filters use the normalised level', () => {
  assert.deepEqual(ids(filterStores(data, { sizeBought: 'yes' }).supported), ['faherty', 'duer']);
  assert.deepEqual(ids(filterStores(data, { sizeBought: 'sometimes' }).supported), ['gap']);
  assert.deepEqual(ids(filterStores(data, { fitAnswer: 'no' }).supported), ['gap']);
  assert.deepEqual(ids(filterStores(data, { fitAnswer: 'sometimes' }).supported), ['duer']);
  assert.deepEqual(filterStores(data, { sizeBought: 'no' }).supported, [], 'a store whose size is unknown (null) never matches a level');
});

test('filters combine with AND', () => {
  assert.deepEqual(ids(filterStores(data, { platform: 'Yotpo', fitAnswer: 'yes' }).supported), ['faherty']);
  assert.deepEqual(ids(filterStores(data, { platform: 'Yotpo', sizeBought: 'yes', fitAnswer: 'sometimes', query: 'duer' }).supported), ['duer']);
  assert.deepEqual(filterStores(data, { platform: 'Bazaarvoice', fitAnswer: 'yes' }).supported, []);
});

test('the search needs every word, ignores case, and looks at name, platform and product tested', () => {
  assert.deepEqual(ids(filterStores(data, { query: 'GAP' }).supported), ['gap']);
  assert.deepEqual(ids(filterStores(data, { query: 'yotpo' }).supported), ['faherty', 'duer']);
  assert.deepEqual(ids(filterStores(data, { query: 'movement shirt' }).supported), ['faherty']);
  assert.deepEqual(ids(filterStores(data, { query: 'tee yotpo' }).supported), ['duer']);
  assert.deepEqual(ids(filterStores(data, { query: '  ' }).supported).length, 4);
  assert.deepEqual(filterStores(data, { query: 'zzz' }).supported, []);
});

test('the search covers the not supported list too (name and reason) and the other filters do not', () => {
  assert.deepEqual(ids(filterStores(data, { query: 'levi' }).notSupported), ['levis']);
  assert.deepEqual(ids(filterStores(data, { query: '403' }).notSupported), ['hm', 'levis']);
  assert.deepEqual(ids(filterStores(data, { query: 'headless' }).notSupported), ['old-navy']);
  assert.equal(filterStores(data, { platform: 'Yotpo' }).notSupported.length, 4);
});

test('groupNotSupported groups by kind, then says each reason once with its stores', () => {
  const groups = groupNotSupported(data.notSupported);
  assert.deepEqual(groups.map((g) => g.kind), ['refused', 'no_reviews', 'unavailable']);
  assert.equal(groups[0].title, 'Refuse automated requests');
  assert.equal(groups[0].reasons.length, 1);
  assert.equal(groups[0].reasons[0].reason, 'HTTP 403 to the page request.');
  assert.deepEqual(ids(groups[0].reasons[0].stores), ['hm', 'levis']);
  assert.deepEqual(groupNotSupported([]), []);
});

test('an unknown kind is shown under Other rather than lost', () => {
  const groups = groupNotSupported([{ id: 'x', name: 'X', reason: 'r', kind: 'brand-new-kind' }]);
  assert.equal(groups[0].kind, 'other');
  assert.equal(groups[0].reasons[0].stores[0].id, 'x');
});

test('wording: answers keep the cell\'s text, missing is "unknown", the size chart says what is not known', () => {
  assert.equal(answerText('yes (variant)'), 'Yes (variant)');
  assert.equal(answerText('from review text only'), 'From review text only');
  assert.equal(answerText(null), 'unknown');
  assert.equal(answerText(''), 'unknown');
  assert.equal(chartText('yes'), 'Read');
  assert.equal(chartText('not_recorded'), 'Not recorded yet');
  assert.equal(chartText(undefined), 'Not recorded yet');
  assert.equal(statusText(1, 0), '1 supported store and 0 not supported yet match your search and filters.');
  assert.equal(statusText(12, 3), '12 supported stores and 3 not supported yet match your search and filters.');
});

test('the committed stores.json loads and every platform in its filter list is used', () => {
  const real = readStores(JSON.parse(readFileSync(path.join(here, '..', 'stores.json'), 'utf8')));
  assert.ok(real && real.supported.length >= 60);
  for (const platform of real.platforms) assert.ok(filterStores(real, { platform }).supported.length > 0, platform);
  assert.ok(filterStores(real, { query: 'hollister' }).notSupported.length === 1);
  assert.ok(filterStores(real, { sizeChart: 'yes' }).supported.some((s) => s.id === 'kotn'));
  // every supported store is reachable through exactly one platform filter or is size chart only
  const counted = real.platforms.reduce((sum, platform) => sum + filterStores(real, { platform }).supported.length, 0);
  assert.equal(counted + real.supported.filter((s) => s.platform === null).length, real.supported.length);
});
