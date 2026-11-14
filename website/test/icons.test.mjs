// Tests for the site's icons. Google shows a site's icon in search results only if it can fetch one that is a multiple
// of 48 pixels square (or an SVG), and many crawlers ask for /favicon.ico first, so all of those are kept and declared
// on every page, the generated guides included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(site, file));

/** Width and height from a PNG's header, after checking it really is a PNG. */
function pngSize(file) {
  const bytes = read(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is not a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** The sizes an .ico file holds (0 in a directory entry means 256). */
function icoSizes(file) {
  const bytes = read(file);
  assert.equal(bytes.readUInt16LE(0), 0, 'ico reserved field');
  assert.equal(bytes.readUInt16LE(2), 1, 'not an icon file');
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => [bytes[6 + i * 16] || 256, bytes[7 + i * 16] || 256]);
}

const htmlFiles = () => {
  const top = readdirSync(site).filter((n) => n.endsWith('.html'));
  const nested = ['fit', 'fit/brands'].flatMap((dir) => readdirSync(path.join(site, dir)).filter((n) => n.endsWith('.html')).map((n) => `${dir}/${n}`));
  return [...top, ...nested];
};

test('the PNG icons are square, and the larger ones are multiples of 48 pixels', () => {
  assert.deepEqual(pngSize('favicon-32.png'), [32, 32]);
  for (const size of [48, 96, 192]) assert.deepEqual(pngSize(`favicon-${size}.png`), [size, size], `favicon-${size}.png`);
});

test('favicon.ico exists for crawlers that ask for it first, and holds 16, 32 and 48 pixel images', () => {
  assert.deepEqual(icoSizes('favicon.ico').sort((a, b) => a[0] - b[0]), [[16, 16], [32, 32], [48, 48]]);
});

test('the SVG icon has a square view box', () => {
  const svg = read('favicon.svg').toString();
  const box = svg.match(/viewBox="([\d.\s-]+)"/);
  assert.ok(box, 'no viewBox');
  const [, , w, h] = box[1].trim().split(/\s+/).map(Number);
  assert.equal(w, h);
});

test('every page declares the whole icon set, and each file it names exists', () => {
  const wanted = [
    ['favicon.ico', '48x48'],
    ['favicon.svg', 'any'],
    ['favicon-32.png', '32x32'],
    ['favicon-48.png', '48x48'],
    ['favicon-96.png', '96x96'],
    ['favicon-192.png', '192x192'],
  ];
  for (const file of htmlFiles()) {
    const html = read(file).toString();
    const icons = [...html.matchAll(/<link rel="icon" href="([^"]+)"[^>]*?sizes="([^"]+)"/g)].map((m) => [m[1].replace(/^\//, ''), m[2]]);
    for (const [name, sizes] of wanted) assert.ok(icons.some(([n, s]) => n === name && s === sizes), `${file}: missing ${name} (${sizes})`);
    for (const [name] of icons) assert.ok(existsSync(path.join(site, name)), `${file}: ${name} does not exist`);
    // The apple touch icon stays.
    assert.match(html, /<link rel="apple-touch-icon" href="\/?apple-touch-icon\.png" \/>/, file);
  }
});

test('the generated pages use root-relative icon links, so they work from /fit/ and /fit/brands/', () => {
  for (const file of htmlFiles().filter((f) => f.startsWith('fit/'))) {
    assert.match(read(file).toString(), /<link rel="icon" href="\/favicon\.ico" sizes="48x48" \/>/, file);
  }
});
