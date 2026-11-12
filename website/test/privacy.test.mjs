// Tests for the privacy side of the site: the analytics consent choice, the pages that explain what the site does, and
// guards that keep them true (no third-party fonts, every outside service disclosed, the footers on every page).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(site, '..');
const read = (file) => readFileSync(path.join(site, file), 'utf8');
const require = createRequire(import.meta.url);
const consent = require('../consent.js');
const analytics = require('../analytics.js');

const htmlFiles = () => {
  const top = readdirSync(site).filter((n) => n.endsWith('.html'));
  const fit = ['fit', 'fit/brands'].flatMap((dir) => readdirSync(path.join(site, dir)).filter((n) => n.endsWith('.html')).map((n) => `${dir}/${n}`));
  return [...top, ...fit];
};

// ---- the consent choice ----

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};

test('no stored answer means not decided, and only granted or denied are accepted', () => {
  const storage = memoryStorage();
  const store = consent.createStore(storage);
  assert.equal(store.get(), null);
  assert.equal(store.set('maybe'), false);
  assert.equal(store.set(undefined), false);
  assert.equal(store.get(), null);
  assert.equal(store.set('granted'), true);
  assert.equal(store.get(), 'granted');
  assert.equal(storage.data[consent.KEY], 'granted');
  assert.equal(store.set('denied'), true);
  assert.equal(consent.createStore(storage).get(), 'denied'); // a later page view reads what was stored
});

test('anything stored that is not exactly granted or denied counts as not decided', () => {
  for (const junk of ['yes', 'GRANTED', '', 'true', '1']) {
    assert.equal(consent.createStore(memoryStorage({ [consent.KEY]: junk })).get(), null, junk);
  }
});

test('storage that is missing or blocked does not break the choice for this page view', () => {
  assert.equal(consent.createStore(null).get(), null);
  const blocked = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  const store = consent.createStore(blocked);
  assert.equal(store.get(), null);
  assert.equal(store.set('denied'), true); // not remembered, but held in memory for now
  assert.equal(store.get(), 'denied');
});

test('the key is the one the scraper page reads', () => {
  assert.equal(consent.KEY, 'pearfit.consent.v1');
  assert.match(readFileSync(path.join(repo, 'webscraper', 'analytics.ts'), 'utf8'), /CONSENT_KEY = 'pearfit\.consent\.v1'/);
});

test('analytics starts again after a decline turns into an accept, and drops what came before', () => {
  analytics.reset();
  const calls = [];
  globalThis.posthog = { capture: (name, props) => calls.push([name, props]) };
  analytics.markUnavailable(); // no answer yet, or declined
  assert.equal(analytics.track('section_viewed', { section: 'hero' }), false);
  analytics.resume(); // accepted: wait for PostHog to start
  assert.equal(analytics.track('section_viewed', { section: 'faq' }), true); // queued, not lost
  assert.equal(calls.length, 0);
  analytics.markReady();
  assert.deepEqual(calls, [['section_viewed', { section: 'faq' }]]); // the earlier event stayed dropped
  analytics.resume(); // running already: nothing changes
  assert.equal(analytics.track('section_viewed', { section: 'pilot' }), true);
  assert.equal(calls.length, 2);
  delete globalThis.posthog;
  analytics.reset();
});

// ---- fonts and outside services ----

test('no page, stylesheet or script asks a font service for anything, and the font files exist', () => {
  const files = [...htmlFiles(), 'styles.css', ...readdirSync(site).filter((n) => n.endsWith('.js'))];
  for (const file of files) assert.doesNotMatch(read(file), /fonts\.googleapis\.com|fonts\.gstatic\.com/, file);
  const css = read('styles.css');
  const urls = [...css.matchAll(/url\((fonts\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2);
  for (const url of urls) assert.ok(existsSync(path.join(site, url)), `${url} is missing`);
  assert.ok(existsSync(path.join(site, 'fonts', 'plus-jakarta-sans-LICENSE.txt')), 'the font licence must stay with the files');
  assert.match(css, /font-family: "Plus Jakarta Sans";/);
});

test('every page that preloads a font points at a file that exists', () => {
  for (const file of htmlFiles()) {
    for (const [, href] of read(file).matchAll(/<link rel="preload" href="([^"]+\.woff2)"/g)) {
      const target = href.startsWith('/') ? href.slice(1) : path.posix.join(path.posix.dirname(file), href);
      assert.ok(existsSync(path.join(site, target)), `${file}: ${href}`);
    }
  }
});

test('every outside host in the site code is a link, a label or a service the privacy notice names', () => {
  // Hosts the code mentions that are not requests the visitor's browser makes: links out, a JSON-LD vocabulary,
  // documentation in a comment, and placeholder text. A host that is not here and not a named service is new: tell the
  // visitor in privacy.html, add it to SERVICES below, and only then list it as a plain link.
  const links = new Set(['github.com', 'schema.org', 'vercel.com', 'www.example.com', 'www.uniqlo.com', 'formsubmit.co']);
  const services = { 'formsubmit.co': 'FormSubmit' };
  const privacy = read('privacy.html');
  const found = new Set();
  const files = [...htmlFiles(), ...readdirSync(site).filter((n) => n.endsWith('.js') && n !== 'posthog-init.js')];
  for (const file of files) {
    for (const [, host] of read(file).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const h = host.toLowerCase();
      if (h !== 'www.pearfit.app' && h !== 'pearfit.app' && h !== 'localhost') found.add(h);
    }
  }
  for (const host of found) assert.ok(links.has(host), `${host} is new: name the service in privacy.html first`);
  for (const [host, name] of Object.entries(services)) assert.match(privacy, new RegExp(name), `${name} (${host}) must be in the privacy notice`);
});

test('the privacy notice names every service that handles data, and the storage keys the code uses', () => {
  const privacy = read('privacy.html');
  for (const name of ['PostHog', 'Vercel', 'Sentry', 'FormSubmit', 'Privacy choices']) assert.match(privacy, new RegExp(name), name);
  assert.match(privacy, /only if you accept/);
  assert.match(privacy, new RegExp(consent.KEY.replace(/\./g, '\\.')));
  const storageSource = readFileSync(path.join(repo, 'app', 'src', 'lib', 'storage.ts'), 'utf8');
  for (const [, key] of storageSource.matchAll(/"(pearfit\.[a-z]+\.v1)"/g)) {
    if (key !== consent.KEY) assert.match(privacy, new RegExp(key.replace(/\./g, '\\.')), `${key} is used by the app but not listed`);
  }
  assert.match(readFileSync(path.join(repo, 'website', 'api', 'posthog-config.js'), 'utf8'), /POSTHOG_HOST/); // host comes from config; the notice says US region
});

// ---- pages ----

test('privacy and terms are complete pages with a date, one h1 and a canonical address', () => {
  for (const [file, h1] of [['privacy.html', 'Privacy notice'], ['terms.html', 'Terms of use']]) {
    const html = read(file);
    assert.equal((html.match(/<h1/g) || []).length, 1, file);
    assert.match(html, new RegExp(`<h1>${h1}</h1>`), file);
    assert.match(html, /Last updated \d{1,2} [A-Z][a-z]+ \d{4}/, file);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://www\\.pearfit\\.app/${file}" />`), file);
    const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(description.length >= 70 && description.length <= 160, `${file} description is ${description.length} characters`);
    assert.doesNotMatch(html, /stores\.js/, file);
  }
  assert.match(read('terms.html'), /not affiliated with, endorsed by or sponsored by/);
  assert.match(read('terms.html'), /Do not use it to get around a store’s blocks/);
});

test('every page footer links the privacy notice and terms and says Pearfit is not affiliated with the brands named', () => {
  for (const file of htmlFiles()) {
    const html = read(file);
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    assert.match(footer, /href="(\.\/|\/)?privacy\.html">Privacy</, file);
    assert.match(footer, /href="(\.\/|\/)?terms\.html">Terms</, file);
    assert.match(footer, /not affiliated with, endorsed by or sponsored by the brands and stores named on this site/, file);
  }
});

test('every page that has analytics loads consent.js first, and offers "Privacy choices" to change the answer', () => {
  for (const file of htmlFiles()) {
    const html = read(file);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ''));
    const analyticsAt = scripts.findIndex((s) => ['speed-insights-init.js', 'analytics.js', 'posthog-init.js'].includes(s));
    if (analyticsAt === -1) {
      assert.doesNotMatch(html, /data-consent-open/, `${file} has no analytics, so it needs no choice`);
      continue;
    }
    assert.equal(scripts.indexOf('consent.js'), 0, `${file}: consent.js must be the first script`);
    assert.match(html, /<button type="button" data-consent-open>Privacy choices<\/button>/, file);
    assert.ok(scripts.indexOf('posthog-init.js') > scripts.indexOf('consent.js'), file);
  }
});

test('the inquiry form names FormSubmit next to the button and is left out of replays, like the demo form', () => {
  const html = read('index.html');
  assert.match(html, /class="pilot-form ph-no-capture"/);
  assert.match(html, /class="try-form ph-no-capture"/);
  const form = html.slice(html.indexOf('id="pilot-form"'), html.indexOf('</form>', html.indexOf('id="pilot-form"')));
  assert.match(form, /form-disclosure[^>]*>We send this form through <a href="https:\/\/formsubmit\.co\/"[^>]*>FormSubmit<\/a>, a third-party service/);
  assert.match(form, /href="privacy\.html">privacy notice<\/a>/);
  assert.doesNotMatch(form, /id="form-note"[^>]*>[^<]*FormSubmit/); // the status line is rewritten by app.js; the disclosure is its own paragraph
});

test('PostHog and Speed Insights are only loaded after consent', () => {
  const posthog = read('posthog-init.js');
  const speed = read('speed-insights-init.js');
  assert.match(posthog, /if \(consentGranted\(\)\) start\(\);\s*else reportUnavailable\(\);/);
  assert.match(posthog, /addEventListener\('pearfit:consent'/);
  assert.match(speed, /function load\(\) \{\s*if \(loaded \|\| !consentGranted\(\)\) return;/);
  // The scripts that fetch PostHog's code appear only inside start(), after the consent check.
  assert.equal(posthog.split("createElement('script')").length - 1, 1);
});
