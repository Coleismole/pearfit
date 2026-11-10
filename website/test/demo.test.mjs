import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// demo.js is a plain browser script that also exports its pure functions for Node. With no document it wires nothing.
const demo = createRequire(import.meta.url)('../demo.js');
const {
  parseMeasurement, slugify, buildWardrobe, parseUrl, matchCandidateByUrl, filterCandidates, chartRows,
  readCandidates, readRecommendation, describeResult, createClient, describeError,
} = demo;

const row = (over = {}) => ({ name: 'White Gap tee', label: 'great', chest: '52.5', length: '70', sleeve: '', ...over });

// ---- measurements ----

test('an empty box is unknown (null), never zero', () => {
  assert.deepEqual(parseMeasurement('', 'cm', 'sleeve_cm'), { ok: true, value: null });
  assert.deepEqual(parseMeasurement('   ', 'cm', 'sleeve_cm'), { ok: true, value: null });
  assert.deepEqual(parseMeasurement(undefined, 'cm', 'sleeve_cm'), { ok: true, value: null });
});

test('centimeters are kept and rounded to one decimal', () => {
  assert.deepEqual(parseMeasurement('52.5', 'cm', 'chest_cm'), { ok: true, value: 52.5 });
  assert.deepEqual(parseMeasurement('52,46', 'cm', 'chest_cm'), { ok: true, value: 52.5 });
  assert.deepEqual(parseMeasurement('54', 'cm', 'chest_cm'), { ok: true, value: 54 });
});

test('inches are converted once, x 2.54, to one decimal (hand computed)', () => {
  assert.deepEqual(parseMeasurement('20', 'in', 'chest_cm'), { ok: true, value: 50.8 }); // 20 x 2.54 = 50.8
  assert.deepEqual(parseMeasurement('28', 'in', 'length_cm'), { ok: true, value: 71.1 }); // 71.12
  assert.deepEqual(parseMeasurement('25.5', 'in', 'sleeve_cm'), { ok: true, value: 64.8 }); // 64.77
});

test('text, negatives and zero are rejected with a message naming the field', () => {
  for (const bad of ['abc', '-5', '0', '0.0', '12cm', '1e3', '5.5.5']) {
    const result = parseMeasurement(bad, 'cm', 'length_cm');
    assert.equal(result.ok, false, bad);
    assert.match(result.message, /^Length:/);
  }
});

test('a chest above 80 cm is called out as a circumference; other dimensions only fail past 150', () => {
  const chest = parseMeasurement('96', 'cm', 'chest_cm');
  assert.equal(chest.ok, false);
  assert.match(chest.message, /full circumference/);
  assert.deepEqual(parseMeasurement('80', 'cm', 'chest_cm'), { ok: true, value: 80 });
  assert.equal(parseMeasurement('35', 'in', 'chest_cm').ok, false, '35 in = 88.9 cm');
  assert.deepEqual(parseMeasurement('100', 'cm', 'length_cm'), { ok: true, value: 100 });
  assert.equal(parseMeasurement('151', 'cm', 'sleeve_cm').ok, false);
});

// ---- wardrobe ----

test('slugify makes the lowercase-with-dashes id the engine requires', () => {
  assert.equal(slugify('Blue Uniqlo Oxford!'), 'blue-uniqlo-oxford');
  assert.equal(slugify('  --H&M  tee 2--  '), 'h-m-tee-2');
  assert.equal(slugify(''), 'shirt');
  assert.equal(slugify('!!!'), 'shirt');
  assert.match(slugify('Crème brûlée tee'), /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('buildWardrobe produces the API request format with null for what was left empty', () => {
  const built = buildWardrobe([row(), row({ name: 'Grey Zara shirt', label: 'loose', chest: '57', length: '75', sleeve: '65' })], 'cm');
  assert.equal(built.ok, true);
  assert.deepEqual(built.wardrobe, [
    { id: 'white-gap-tee', label: 'great', measurements: { chest_cm: 52.5, length_cm: 70, sleeve_cm: null } },
    { id: 'grey-zara-shirt', label: 'loose', measurements: { chest_cm: 57, length_cm: 75, sleeve_cm: 65 } },
  ]);
  assert.equal(built.names['white-gap-tee'], 'White Gap tee');
});

test('buildWardrobe converts inches for every box in the wardrobe', () => {
  const built = buildWardrobe([row({ chest: '20', length: '28', sleeve: '' })], 'in');
  assert.equal(built.ok, true);
  assert.deepEqual(built.wardrobe[0].measurements, { chest_cm: 50.8, length_cm: 71.1, sleeve_cm: null });
});

test('same names get unique ids, and an empty name gets a numbered one', () => {
  const built = buildWardrobe([row(), row(), row({ name: '' })], 'cm');
  assert.deepEqual(built.wardrobe.map((s) => s.id), ['white-gap-tee', 'white-gap-tee-2', 'shirt-3']);
  assert.equal(built.names['shirt-3'], 'Shirt 3');
});

test('a name that is an object property name does not collide with inherited keys', () => {
  const built = buildWardrobe([row({ name: 'constructor' }), row({ name: 'constructor' })], 'cm');
  assert.deepEqual(built.wardrobe.map((s) => s.id), ['constructor', 'constructor-2']);
});

test('buildWardrobe says which row is wrong and why', () => {
  const built = buildWardrobe([row(), row({ chest: 'wide', length: '', sleeve: '' })], 'cm');
  assert.equal(built.ok, false);
  assert.equal(built.errors.length, 1);
  assert.equal(built.errors[0].row, 1);
  assert.match(built.errors[0].message, /^Chest:/);
});

test('a shirt with no measurement at all is rejected', () => {
  const built = buildWardrobe([row({ chest: '', length: '', sleeve: '' })], 'cm');
  assert.equal(built.ok, false);
  assert.match(built.errors[0].message, /at least one measurement/);
});

test('at least one shirt must fit great, and the label must be one of the three', () => {
  const noGreat = buildWardrobe([row({ label: 'tight' }), row({ label: 'loose' })], 'cm');
  assert.equal(noGreat.ok, false);
  assert.equal(noGreat.errors[0].row, null);
  assert.match(noGreat.errors[0].message, /great/);
  const badLabel = buildWardrobe([row({ label: 'perfect' })], 'cm');
  assert.equal(badLabel.ok, false);
  assert.equal(badLabel.errors[0].row, 0);
  assert.equal(buildWardrobe([], 'cm').ok, false);
  assert.equal(buildWardrobe(Array.from({ length: demo.MAX_SHIRTS + 1 }, () => row()), 'cm').ok, false);
});

// ---- choosing a product ----

const CANDIDATES = [
  { id: 'e483970-000', name: 'Uniqlo Airism Cotton Oversized Tee', sizes: { S: { chest_cm: 52, length_cm: null, sleeve_cm: null }, M: { chest_cm: 55, length_cm: null, sleeve_cm: null } } },
  { id: 'e483970-000-2', name: 'Longer id that contains the first', sizes: { M: { chest_cm: 55, length_cm: null, sleeve_cm: null } } },
  { id: 'tee', name: 'Too short to match by link', sizes: { M: { chest_cm: 55, length_cm: 70, sleeve_cm: 20 } } },
  { id: 'muji-tee', name: 'Muji crew tee', sizes: { M: { chest_cm: 53, length_cm: 71, sleeve_cm: null } } },
];

test('parseUrl keeps the hostname without www, and only for web addresses', () => {
  assert.equal(parseUrl('https://www.Uniqlo.com/ca/en/products/E483970-000/00?x=1').host, 'uniqlo.com');
  assert.equal(parseUrl('uniqlo.com/products/e1').host, 'uniqlo.com');
  for (const bad of ['', '   ', 'not a link', 'javascript:alert(1)', 'ftp://x.example.com/a', 'localhost', null]) assert.equal(parseUrl(bad), null, String(bad));
});

test('a link containing a candidate id matches it, whatever the case and the separators', () => {
  const match = matchCandidateByUrl('https://www.uniqlo.com/ca/en/products/E483970-000/00', CANDIDATES);
  assert.equal(match.ok, true);
  assert.equal(match.candidate.id, 'e483970-000');
  assert.equal(match.host, 'uniqlo.com');
  assert.equal(matchCandidateByUrl('https://shop.example.com/p/muji-tee?color=white', CANDIDATES).candidate.id, 'muji-tee');
});

test('the longest matching id wins, and ids shorter than five characters never match a link', () => {
  const match = matchCandidateByUrl('https://x.example.com/products/e483970-000-2', CANDIDATES);
  assert.equal(match.candidate.id, 'e483970-000-2');
  assert.equal(matchCandidateByUrl('https://x.example.com/products/tee', CANDIDATES).ok, false);
});

test('an id must match whole path words, not part of a longer one', () => {
  assert.equal(matchCandidateByUrl('https://x.example.com/products/e483970-0001', CANDIDATES).ok, false);
  assert.equal(matchCandidateByUrl('https://x.example.com/products/xe483970-000', CANDIDATES).ok, false);
});

test('an unknown link reports no_match with the host; a non-link reports not_a_url', () => {
  assert.deepEqual(matchCandidateByUrl('https://www.other.com/p/999', CANDIDATES), { ok: false, reason: 'no_match', host: 'other.com' });
  assert.deepEqual(matchCandidateByUrl('hello', CANDIDATES), { ok: false, reason: 'not_a_url', host: null });
});

test('filterCandidates needs every typed word in the name or id, sorted by name', () => {
  assert.deepEqual(filterCandidates(CANDIDATES, 'uniqlo tee').shown.map((c) => c.id), ['e483970-000']);
  assert.deepEqual(filterCandidates(CANDIDATES, 'E483970').shown.map((c) => c.id), ['e483970-000-2', 'e483970-000']);
  assert.equal(filterCandidates(CANDIDATES, 'zzz').total, 0);
  assert.equal(filterCandidates(CANDIDATES, '').total, CANDIDATES.length);
});

test('filterCandidates caps a long list but reports the real total', () => {
  const many = Array.from({ length: demo.MAX_LIST + 25 }, (_, i) => ({ id: `sku-${i}`, name: `Tee ${String(i).padStart(3, '0')}`, sizes: {} }));
  const { shown, total } = filterCandidates(many, '');
  assert.equal(shown.length, demo.MAX_LIST);
  assert.equal(total, demo.MAX_LIST + 25);
});

test('chartRows prints null as "unknown" and keeps numbers as they are', () => {
  assert.deepEqual(chartRows(CANDIDATES[0]), [
    { size: 'S', cells: ['52', 'unknown', 'unknown'] },
    { size: 'M', cells: ['55', 'unknown', 'unknown'] },
  ]);
  assert.deepEqual(chartRows(CANDIDATES[3])[0].cells, ['53', '71', 'unknown']);
});

// ---- reading API answers ----

test('readCandidates keeps good entries, nulls missing measurements and drops malformed ones', () => {
  const list = readCandidates([
    { id: 'a-tee-1', name: 'A', garmentType: 'tee', sizes: { M: { chest_cm: 50, length_cm: null } } },
    { id: 'b', name: 'B', sizes: { M: { chest_cm: 'wide', length_cm: 1, sleeve_cm: 2 } } },
    { id: 'c', name: 'C', sizes: {} },
    { id: 7, name: 'D', sizes: { M: {} } },
    'junk',
    null,
  ]);
  assert.deepEqual(list, [{ id: 'a-tee-1', name: 'A', sizes: { M: { chest_cm: 50, length_cm: null, sleeve_cm: null } } }]);
  assert.equal(readCandidates({ not: 'a list' }), null);
  assert.deepEqual(readCandidates([]), []);
});

const GOOD = { size: 'M', confidence: 'high', matchPercent: 94.4, fitsLike: 'white-gap-tee', verdict: 'Get the M, fits like your white gap tee.', notes: [], garmentType: 'tee' };

test('readRecommendation accepts the documented shape and refuses anything else', () => {
  assert.deepEqual(readRecommendation(GOOD), { size: 'M', confidence: 'high', verdict: GOOD.verdict, notes: [], matchPercent: 94.4, fitsLike: 'white-gap-tee' });
  assert.equal(readRecommendation({ ...GOOD, size: null, matchPercent: null, fitsLike: null }).size, null);
  for (const bad of [null, [], 'x', {}, { ...GOOD, confidence: 'certain' }, { ...GOOD, verdict: 5 }, { ...GOOD, notes: 'no' }, { ...GOOD, notes: [1] }, { ...GOOD, matchPercent: '94' }, { ...GOOD, size: 5 }, { ...GOOD, fitsLike: 5 }]) {
    assert.equal(readRecommendation(bad), null, JSON.stringify(bad));
  }
});

test('describeResult: a high-confidence size shows the verdict as the headline, in the visitor\'s own words', () => {
  const view = describeResult(readRecommendation(GOOD), { 'white-gap-tee': 'White Gap tee' });
  assert.equal(view.hasSize, true);
  assert.equal(view.size, 'M');
  assert.equal(view.title, 'Get the M, fits like your white gap tee.');
  assert.equal(view.detail, null);
  assert.equal(view.confidenceText, 'High confidence');
  assert.equal(view.lowConfidence, false);
  assert.equal(view.matchText, '94% match');
  assert.equal(view.fitsLike, 'White Gap tee');
});

test('describeResult: low confidence is flagged, and unknown parts read "unknown"', () => {
  const low = describeResult(readRecommendation({ ...GOOD, confidence: 'low', matchPercent: null, fitsLike: null }), {});
  assert.equal(low.lowConfidence, true);
  assert.equal(low.matchText, 'unknown');
  assert.equal(low.fitsLike, 'unknown');
});

test('describeResult: no size is an explanation, not a guess', () => {
  const none = describeResult(readRecommendation({ size: null, confidence: 'low', matchPercent: null, fitsLike: null, notes: [], verdict: 'No shirts labelled great in this wardrobe, so there is nothing to compare against.' }), {});
  assert.equal(none.hasSize, false);
  assert.equal(none.size, null);
  assert.equal(none.title, 'No size to suggest');
  assert.match(none.detail, /nothing to compare against/);
  assert.equal(none.lowConfidence, true);
});

test('describeResult falls back to the id when the owned shirt is not one of the visitor\'s (or is an inherited key)', () => {
  assert.equal(describeResult(readRecommendation({ ...GOOD, fitsLike: 'grey-zara-shirt' }), {}).fitsLike, 'grey zara shirt');
  assert.equal(describeResult(readRecommendation({ ...GOOD, fitsLike: 'constructor' }), {}).fitsLike, 'constructor');
});

// ---- the API client, with a mocked fetch ----

function response(status, body, { json = true } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => { if (!json) throw new SyntaxError('bad json'); return body; } };
}

test('loadCandidates calls GET /api/candidates and returns the cleaned list', async () => {
  const calls = [];
  const client = createClient({ fetchFn: async (url, init) => { calls.push([url, init.method]); return response(200, [{ id: 'muji-tee', name: 'Muji crew tee', garmentType: 'tee', sizes: { M: { chest_cm: 53, length_cm: 71, sleeve_cm: null } } }]); } });
  const result = await client.loadCandidates();
  assert.deepEqual(calls, [['/api/candidates', 'GET']]);
  assert.equal(result.ok, true);
  assert.equal(result.data[0].sizes.M.sleeve_cm, null);
});

test('recommend posts { wardrobe, candidateId } as JSON to /api/recommend', async () => {
  let seen;
  const client = createClient({ baseUrl: 'https://www.pearfit.app', fetchFn: async (url, init) => { seen = { url, method: init.method, type: init.headers['Content-Type'], body: JSON.parse(init.body) }; return response(200, GOOD); } });
  const wardrobe = [{ id: 'white-gap-tee', label: 'great', measurements: { chest_cm: 52.5, length_cm: 70, sleeve_cm: null } }];
  const result = await client.recommend(wardrobe, 'muji-tee');
  assert.equal(seen.url, 'https://www.pearfit.app/api/recommend');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.type, 'application/json');
  assert.deepEqual(seen.body, { wardrobe, candidateId: 'muji-tee' });
  assert.equal(result.ok, true);
  assert.equal(result.data.size, 'M');
});

test('HTTP failures map to a kind; only a rejected request shows the server\'s message', async () => {
  const cases = [
    [400, { error: 'wardrobe [0] x: chest_cm must be a positive number or null' }, 'bad_request'],
    [404, { error: 'No candidate "x".' }, 'not_found'],
    [405, { error: 'Use POST.' }, 'server'],
    [502, { error: 'Could not load candidates: Supabase candidates: HTTP 401 secret detail' }, 'server'],
    [500, null, 'server'],
  ];
  for (const [status, body, kind] of cases) {
    const result = await createClient({ fetchFn: async () => response(status, body) }).recommend([], 'x');
    assert.equal(result.ok, false);
    assert.equal(result.kind, kind, String(status));
    assert.equal(result.status, status);
    const text = describeError(result);
    assert.doesNotMatch(text, /secret detail|Supabase/, 'a server-side message is not shown');
    if (kind === 'bad_request') assert.match(text, /chest_cm must be a positive number/);
  }
});

test('a rejected request message is cut to a safe length', async () => {
  const result = await createClient({ fetchFn: async () => response(400, { error: 'x'.repeat(5000) }) }).recommend([], 'x');
  assert.equal(result.message.length, 300);
});

test('a failed fetch is a network error; an aborted one is a timeout', async () => {
  const network = await createClient({ fetchFn: async () => { throw new TypeError('Failed to fetch'); } }).loadCandidates();
  assert.equal(network.ok, false);
  assert.equal(network.kind, 'network');
  assert.match(describeError(network), /Could not reach/);

  const timeout = await createClient({
    timeoutMs: 20,
    fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  }).loadCandidates();
  assert.equal(timeout.kind, 'timeout');
  assert.match(describeError(timeout), /too long/);
});

test('an unreadable or unexpected body is invalid_response, not a crash or a guess', async () => {
  const notJson = await createClient({ fetchFn: async () => response(200, null, { json: false }) }).recommend([], 'x');
  assert.equal(notJson.kind, 'invalid_response');
  const wrongShape = await createClient({ fetchFn: async () => response(200, { size: 'M' }) }).recommend([], 'x');
  assert.equal(wrongShape.kind, 'invalid_response');
  const wrongList = await createClient({ fetchFn: async () => response(200, { candidates: [] }) }).loadCandidates();
  assert.equal(wrongList.kind, 'invalid_response');
});

test('the client never rejects', async () => {
  const odd = createClient({ fetchFn: async () => { throw 'a string, not an Error'; } });
  assert.equal((await odd.loadCandidates()).kind, 'network');
});

test('every error kind has a plain-language message', () => {
  for (const kind of ['network', 'timeout', 'bad_request', 'not_found', 'server', 'invalid_response', 'anything-else']) {
    assert.ok(describeError({ kind, message: '' }).length > 10, kind);
  }
});
