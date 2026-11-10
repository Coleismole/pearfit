import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { postScrape, shortError, summarizeScrapeBody, type ScrapeOutcome, type ScrapeRequest } from './scraperClient.ts';
import {
  buildResultsFile,
  decodeHtmlBytes,
  defaultResultsPath,
  findSavedPages,
  formatSummaryTable,
  pageNotes,
  readSavedFolder,
  reviewsCell,
  shrinkHtmlForRequest,
  sniffSourceUrl,
  storeFromUrl,
  urlFromSidecar,
  type SavedPageResult,
} from './savedHtml.ts';

// The integration test below runs the real server in this process, with nothing configured for Supabase.
process.env.VERCEL = '1';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_PUBLISHABLE_KEY = '';
process.env.SUPABASE_SECRET_KEY = '';
const { createApp } = await import('../server.ts');

// ---- source address sniffing ----

test('a sidecar file beats every address inside the page', () => {
  const html = `<html><head><meta property="og:url" content="https://shop.example/og"></head></html>`;
  assert.deepEqual(sniffSourceUrl(html, 'https://shop.example/from-sidecar\n'), { url: 'https://shop.example/from-sidecar', from: 'sidecar' });
});

test('a sidecar with no address falls back to the page', () => {
  const html = `<html><head><link rel="canonical" href="https://shop.example/c"></head></html>`;
  assert.deepEqual(sniffSourceUrl(html, 'not an address'), { url: 'https://shop.example/c', from: 'canonical' });
});

test('urlFromSidecar reads a plain line, comments, a BOM and a Windows URL= line', () => {
  assert.equal(urlFromSidecar('\uFEFF# the page\r\nhttps://shop.example/p/1?color=red\r\n'), 'https://shop.example/p/1?color=red');
  assert.equal(urlFromSidecar('[InternetShortcut]\r\nURL=https://shop.example/p/2\r\n'), 'https://shop.example/p/2');
  assert.equal(urlFromSidecar('ftp://shop.example/p\njavascript:alert(1)\n'), null);
  assert.equal(urlFromSidecar(''), null);
});

test('a url comment is read, including a SingleFile multi-line header', () => {
  assert.deepEqual(sniffSourceUrl('<!-- url: https://shop.example/a?x=1&amp;y=2 --><html></html>'), { url: 'https://shop.example/a?x=1&y=2', from: 'comment' });
  const singleFile = `<!DOCTYPE html>\n<html><!--\n Page saved with SingleFile\n url: https://shop.example/sf\n saved date: Tue Nov 10 2026\n--><head></head></html>`;
  assert.deepEqual(sniffSourceUrl(singleFile), { url: 'https://shop.example/sf', from: 'comment' });
});

test('Chrome\'s "saved from url" comment is read, and ranks below a url comment and above og:url', () => {
  const chrome = `<!DOCTYPE html>\n<!-- saved from url=(0034)https://shop.example/products/tee-1 -->\n<html><head><meta property="og:url" content="https://shop.example/og"></head></html>`;
  assert.deepEqual(sniffSourceUrl(chrome), { url: 'https://shop.example/products/tee-1', from: 'saved-from' });
  const both = `<!-- saved from url=(0034)https://shop.example/products/tee-1 -->\n<!-- url: https://shop.example/manual -->`;
  assert.deepEqual(sniffSourceUrl(both), { url: 'https://shop.example/manual', from: 'comment' });
});

test('og:url is read whichever order its attributes come in, then the canonical link', () => {
  assert.deepEqual(sniffSourceUrl(`<head><meta content="https://shop.example/og" property="og:url"></head>`), { url: 'https://shop.example/og', from: 'og:url' });
  assert.deepEqual(
    sniffSourceUrl(`<head><link rel="canonical" href="https://shop.example/canon"><meta property="og:url" content="https://shop.example/og"></head>`),
    { url: 'https://shop.example/og', from: 'og:url' },
  );
  assert.deepEqual(sniffSourceUrl(`<head><link href="https://shop.example/canon" rel="canonical"></head>`), { url: 'https://shop.example/canon', from: 'canonical' });
});

test('relative, file, chrome-error and javascript addresses are not source addresses', () => {
  assert.equal(sniffSourceUrl(`<head><meta property="og:url" content="/products/tee"><link rel="canonical" href="/products/tee"></head>`), null);
  assert.equal(sniffSourceUrl(`<!-- saved from url=(0014)file:///C:/x.html --><html></html>`), null);
  assert.equal(sniffSourceUrl(`<!-- url: chrome-error://chromewebdata/ --><html></html>`), null);
  assert.equal(sniffSourceUrl(`<html><body>no address</body></html>`), null);
});

test('storeFromUrl is the host without www', () => {
  assert.equal(storeFromUrl('https://www.uniqlo.com/ca/en/products/E1'), 'uniqlo.com');
  assert.equal(storeFromUrl('https://shop.example.co.uk/p'), 'shop.example.co.uk');
  assert.equal(storeFromUrl(null), '(unknown)');
  assert.equal(storeFromUrl('not a url'), '(unknown)');
});

// ---- reading and shrinking ----

test('decodeHtmlBytes honours a UTF-16 byte-order mark and a meta charset', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>Größe</p>', 'utf16le')]);
  assert.equal(decodeHtmlBytes(utf16), '<p>Größe</p>');
  // 0xE9 is "é" in windows-1252 and is not valid UTF-8 on its own.
  const latin = Buffer.concat([Buffer.from('<meta charset="windows-1252"><p>caf', 'latin1'), Buffer.from([0xe9]), Buffer.from('</p>', 'latin1')]);
  assert.equal(decodeHtmlBytes(latin), '<meta charset="windows-1252"><p>café</p>');
  assert.equal(decodeHtmlBytes(Buffer.from('<p>Größe ✓</p>', 'utf8')), '<p>Größe ✓</p>');
  assert.equal(decodeHtmlBytes(Buffer.from('<meta charset="no-such-charset"><p>ü</p>', 'utf8')), '<meta charset="no-such-charset"><p>ü</p>');
});

test('shrinkHtmlForRequest leaves a small page alone and drops styles, svg and base64 from a big one', () => {
  const small = '<html><body>hi</body></html>';
  assert.deepEqual(shrinkHtmlForRequest(small, 1000), { html: small, shrunk: false, bytes: 28 });

  const script = '<script id="__NEXT_DATA__" type="application/json">{"reviews":[1,2,3]}</script>';
  const big = `<html><style>${'a{b:c}'.repeat(400)}</style><body>${script}<svg viewBox="0 0 1 1">${'<path d="M0"/>'.repeat(100)}</svg><img src="data:image/png;base64,${'QUJD'.repeat(300)}"></body></html>`;
  const shrunk = shrinkHtmlForRequest(big, 400);
  assert.equal(shrunk.shrunk, true);
  assert.ok(!shrunk.html.includes('<style'));
  assert.ok(!shrunk.html.includes('<svg'));
  assert.ok(!shrunk.html.includes('base64'));
  assert.ok(shrunk.html.includes(script), 'the review data script is kept');
  assert.equal(shrunk.bytes, Buffer.byteLength(shrunk.html));
  assert.ok(shrunk.bytes <= 400);
  // Stops at the first step that is enough: removing the styles alone brings this one under the limit.
  const withoutStyle = Buffer.byteLength(big.replace(/<style[\s\S]*?<\/style>/, ''));
  const styleOnly = shrinkHtmlForRequest(big, withoutStyle);
  assert.ok(!styleOnly.html.includes('<style'));
  assert.ok(styleOnly.html.includes('<svg'));
});

// ---- the summary ----

function result(over: Partial<SavedPageResult>): SavedPageResult {
  return {
    product: '',
    brand: '',
    sku: '',
    reviewsRead: 0,
    reviewsStated: null,
    withSize: 0,
    withFit: 0,
    sizeChartRows: 0,
    reviewSources: [],
    avgRating: null,
    file: 'page.html',
    sourceUrl: 'https://shop.example/p',
    urlFrom: 'saved-from',
    store: 'shop.example',
    bytes: 1000,
    shrunk: false,
    committed: false,
    sharedStore: null,
    secs: 0.1,
    error: null,
    notes: [],
    ...over,
  };
}

test('the reviews cell shows read against stated, or "not stated"', () => {
  assert.equal(reviewsCell({ reviewsRead: 8, reviewsStated: 23 }), '8 / 23');
  assert.equal(reviewsCell({ reviewsRead: 66, reviewsStated: null }), '66 / not stated');
});

test('notes say to save again when fewer reviews were read than the page states', () => {
  const base = { error: null, reviewsRead: 8, reviewsStated: 23, sourceUrl: 'https://shop.example/p', shrunk: false, sizeChartRows: 0 };
  assert.match(pageNotes(base).join(' '), /Read 8 of the 23 reviews/);
  assert.deepEqual(pageNotes({ ...base, reviewsRead: 23 }), []);
  assert.deepEqual(pageNotes({ ...base, reviewsStated: null }), []);
  assert.match(pageNotes({ ...base, reviewsRead: 23, sourceUrl: null }).join(' '), /No source address/);
  assert.match(pageNotes({ ...base, reviewsRead: 23, shrunk: true }).join(' '), /4 MB/);
  // A page that failed does not also get the "read fewer" note.
  assert.deepEqual(pageNotes({ ...base, error: 'x', reviewsRead: 0 }), []);
});

test('the summary table lines up columns and lists errors and notes', () => {
  const ok = result({ file: 'tee.html', product: 'Classic Tee', reviewsRead: 8, reviewsStated: 23, withSize: 7, withFit: 5, sizeChartRows: 6, notes: ['Read 8 of the 23 reviews the page states.'] });
  const failed = result({ file: 'jacket.htm', store: '(unknown)', sourceUrl: null, urlFrom: null, error: 'No reviews found on the page.' });
  const table = formatSummaryTable([ok, failed]);
  const lines = table.split('\n');
  assert.equal(lines[0], 'File       | Store        | Product     | Reviews read / stated | With size | With fit answer | Size chart rows | Error');
  assert.equal(lines[1], '-----------|--------------|-------------|-----------------------|-----------|-----------------|-----------------|------------------------------');
  assert.equal(lines[2], 'tee.html   | shop.example | Classic Tee | 8 / 23                | 7         | 5               | 6               |');
  assert.equal(lines[3], 'jacket.htm | (unknown)    | -           | -                     | -         | -               | 0               | No reviews found on the page.');
  assert.ok(lines.includes('Notes'));
  assert.ok(lines.includes('- tee.html: Read 8 of the 23 reviews the page states.'));
  assert.equal(lines.at(-1), '2 pages: 1 read, 1 with an error, 8 reviews in total.');
});

test('the results file carries totals and goes next to the folder', () => {
  const file = buildResultsFile('/data/saved', [result({ reviewsRead: 5 }), result({ error: 'x' })], false, new Date('2026-11-10T12:00:00Z'));
  assert.deepEqual(file.totals, { pages: 2, read: 1, failed: 1, reviews: 5 });
  assert.equal(file.generatedAt, '2026-11-10T12:00:00.000Z');
  assert.equal(file.committed, false);
  assert.equal(defaultResultsPath('/data/saved/'), path.join('/data', 'saved.results.json'));
});

test('shortError drops the paste hint the server adds', () => {
  assert.equal(
    shortError('No reviews found on the page. If the reviews show in your own browser, copy them (or View Source) and paste into the raw HTML box instead.'),
    'No reviews found on the page.',
  );
  assert.equal(shortError(undefined), null);
});

test('summarizeScrapeBody counts sized reviews, fit answers and chart rows', () => {
  const summary = summarizeScrapeBody({
    report: {
      name: 'Tee',
      brand: 'Shop',
      sku: 'T-1',
      totalReviews: 3,
      reviews: [{ normalizedSize: 'M', declaredFitTag: 'Runs Small' }, { normalizedSize: null, declaredFitTag: null }, { normalizedSize: 'L' }],
      scraperTelemetry: { reportedReviewCount: 10, reviewSources: ['page'] },
    },
    sizeChart: [{}, {}],
  });
  assert.deepEqual(summary, { product: 'Tee', brand: 'Shop', sku: 'T-1', reviewsRead: 3, reviewsStated: 10, withSize: 2, withFit: 1, sizeChartRows: 2, reviewSources: ['page'], avgRating: null });
  assert.equal(summarizeScrapeBody(null).reviewsRead, 0);
});

// ---- reading a folder ----

const NEXT_PAGE = (name: string, extra = '') => {
  const data = {
    props: {
      reviews: {
        total: 2,
        items: [
          { id: 'r1', rating: 5, title: 'Great', body: 'Soft and true to size.', author: 'Ana', size: 'M' },
          { id: 'r2', rating: 2, title: 'Small', body: 'Runs small in the chest.', author: 'Bo', size: 'L' },
        ],
      },
    },
  };
  return `<!DOCTYPE html>\n${extra}<html><head><title>${name}</title></head><body><h1>${name}</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
};

async function makeFolder(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saved-html-'));
  const folder = path.join(root, 'saved');
  await mkdir(folder);
  await writeFile(path.join(folder, 'tee.html'), NEXT_PAGE('Next Tee', '<!-- saved from url=(0035)https://www.shop.example/products/tee -->\n'));
  await writeFile(path.join(folder, 'polo.HTM'), NEXT_PAGE('Next Polo'));
  await writeFile(path.join(folder, 'polo.url.txt'), 'https://www.other.example/p/polo\n');
  await writeFile(path.join(folder, 'noaddress.html'), NEXT_PAGE('No Address Tee'));
  await writeFile(path.join(folder, 'empty.html'), '   \n');
  await writeFile(path.join(folder, 'notes.txt'), 'not a page');
  await mkdir(path.join(folder, 'tee_files'));
  await writeFile(path.join(folder, 'tee_files', 'frame.html'), '<p>an iframe the browser saved</p>');
  return root;
}

test('findSavedPages takes .html and .htm files in the folder only', async () => {
  const root = await makeFolder();
  try {
    assert.deepEqual(await findSavedPages(path.join(root, 'saved')), ['empty.html', 'noaddress.html', 'polo.HTM', 'tee.html']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('each page is sent as rawHtml with its own address, never committing unless asked', async () => {
  const root = await makeFolder();
  try {
    const sent: ScrapeRequest[] = [];
    const scrape = async (request: ScrapeRequest): Promise<ScrapeOutcome> => {
      sent.push(request);
      return { status: 200, secs: 0.2, networkError: null, body: { report: { name: 'X', totalReviews: 2, reviews: [] }, committedToDb: request.commitToDb === true, supabase: null } };
    };
    const folder = path.join(root, 'saved');

    const dry = await readSavedFolder({ folder, scrape });
    assert.deepEqual(dry.map((r) => r.file), ['empty.html', 'noaddress.html', 'polo.HTM', 'tee.html']);
    assert.equal(sent.length, 3, 'the empty file is not sent');
    for (const request of sent) {
      assert.equal(request.commitToDb, false);
      assert.equal(request.render, 'never');
      assert.ok(request.rawHtml && request.rawHtml.includes('__NEXT_DATA__'));
    }
    assert.deepEqual(sent.map((r) => r.url), [undefined, 'https://www.other.example/p/polo', 'https://www.shop.example/products/tee']);
    assert.equal(dry[0]!.error, 'the file is empty');
    assert.equal(dry[2]!.urlFrom, 'sidecar');
    assert.equal(dry[2]!.store, 'other.example');
    assert.equal(dry[3]!.urlFrom, 'saved-from');
    assert.equal(dry[3]!.store, 'shop.example');
    assert.equal(dry.every((r) => !r.committed), true);

    sent.length = 0;
    const committed = await readSavedFolder({ folder, scrape, commit: true });
    // The page with no address is never committed: every such page would share one placeholder SKU.
    assert.deepEqual(sent.map((r) => [r.url ?? null, r.commitToDb]), [[null, false], ['https://www.other.example/p/polo', true], ['https://www.shop.example/products/tee', true]]);
    assert.equal(committed[1]!.committed, false);
    assert.match(committed[1]!.notes.join(' '), /Not committed: no source address/);
    assert.equal(committed[3]!.committed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a scraper that does not answer is reported on the page, not thrown', async () => {
  const root = await makeFolder();
  try {
    const results = await readSavedFolder({
      folder: path.join(root, 'saved'),
      scrape: async () => ({ status: 0, secs: 1, body: null, networkError: 'connect ECONNREFUSED 127.0.0.1:1' }),
    });
    assert.equal(results.filter((r) => r.error?.includes('ECONNREFUSED')).length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function listen(app: Express): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

test('against the real scraper: reviews are read from a saved page and nothing is committed', async () => {
  const root = await makeFolder();
  const { server, port } = await listen(createApp());
  try {
    const results = await readSavedFolder({
      folder: path.join(root, 'saved'),
      scrape: (request) => postScrape(`http://127.0.0.1:${port}`, request, 30_000),
    });
    const tee = results.find((r) => r.file === 'tee.html')!;
    assert.equal(tee.error, null);
    assert.equal(tee.reviewsRead, 2);
    assert.equal(tee.reviewsStated, 2);
    assert.equal(tee.withSize, 2);
    assert.equal(tee.product, 'Next Tee');
    assert.equal(tee.sourceUrl, 'https://www.shop.example/products/tee');
    assert.equal(tee.committed, false);
    // The address the page was saved from becomes the report's source address.
    const body = await postScrape(`http://127.0.0.1:${port}`, { rawHtml: NEXT_PAGE('Next Tee'), url: tee.sourceUrl!, commitToDb: false, render: 'never' }, 30_000);
    assert.equal(body.body?.report?.sourceUrl, 'https://www.shop.example/products/tee');
    assert.equal(body.body?.committedToDb, false);

    // A saved page with no reviews is an error on that page only.
    await writeFile(path.join(root, 'saved', 'norev.html'), '<html><head><title>Plain</title></head><body><h1>Plain page</h1></body></html>');
    const again = await readSavedFolder({
      folder: path.join(root, 'saved'),
      scrape: (request) => postScrape(`http://127.0.0.1:${port}`, request, 30_000),
    });
    const plain = again.find((r) => r.file === 'norev.html')!;
    assert.match(plain.error ?? '', /No reviews found/);
    assert.doesNotMatch(plain.error ?? '', /paste into the raw HTML box/);
    assert.equal(again.filter((r) => !r.error).length, 3);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
