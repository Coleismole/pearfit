// Checks that the site's pages work, in a real browser. audit-site.mjs covers layout, contrast, tags and
// accessibility; this covers behaviour: every link and in-page section it points at exists (also across pages),
// the logos go home, the footer has the email and this year's copyright, the mobile menu opens and closes,
// the inquiry form shows its validation, success and error messages, and a missing path gets the 404 page.
//
//   node website/scripts/verify-site.mjs                        # serves website/ locally, like Vercel does
//   node website/scripts/verify-site.mjs https://www.pearfit.app # checks a deployed site
//   node website/scripts/verify-site.mjs <url> --attempts 10 --wait 30
//
// With --attempts the whole run repeats until every check passes or the attempts run out, to wait out a deploy.
// Run locally, it also checks that the current branch is pushed (skipped under CI). The form is tested against
// a mocked FormSubmit, so no email is sent. Playwright comes from webscraper's install, like audit-site.mjs.
// Exit code 1 when any check fails.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(site, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const attempts = Math.max(1, flag('--attempts', 1));
const waitSeconds = Math.max(0, flag('--wait', 20));
const target = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

// '/fit/' is the generated list of fit guides, and every brand page (fit/brands/) is listed too: a brand page links
// all of that brand's guides, and the list links the brand pages. A guide that is missing fails the link check on one of them.
const brandPages = existsSync(path.join(site, 'fit', 'brands'))
  ? readdirSync(path.join(site, 'fit', 'brands')).filter((name) => name.endsWith('.html')).sort().map((name) => `/fit/brands/${name}`)
  : [];
const PAGES = ['/', '/stores.html', '/roi.html', '/privacy.html', '/terms.html', '/fit/', ...brandPages];
const MISSING = '/this-page-does-not-exist';
const WIDTHS = [320, 375, 414, 768, 1280];
const INBOX = 'customerservice@pearfit.app';

async function launchBrowser() {
  const errors = [];
  for (const load of [
    () => createRequire(path.join(repo, 'webscraper', 'package.json'))('playwright'),
    () => createRequire(import.meta.url)('playwright'),
  ]) {
    try {
      return await load().chromium.launch();
    } catch (error) {
      errors.push(error.message.split('\n')[0]);
    }
  }
  throw new Error(`Could not start Chromium through Playwright. Run \`npx playwright install chromium\` in webscraper/.\n${errors.join('\n')}`);
}

const TYPES = { '.xml': 'application/xml', '.txt': 'text/plain', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

// Like Vercel for this site: /scraper and /app are separate apps (answered with a stub), /api is not run,
// and a missing file gets 404.html with status 404.
function serve() {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/api/posthog-config') return res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    if (/^\/(scraper|app)(\/|$)/.test(pathname) && !path.extname(pathname)) {
      return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>app</title>');
    }
    const file = path.join(site, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!file.startsWith(site) || !existsSync(file) || !statSync(file).isFile()) {
      return res.writeHead(404, { 'content-type': 'text/html' }).end(readFileSync(path.join(site, '404.html')));
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Stands in for PostHog's script in the consent checks: records what the site asks it to do.
const POSTHOG_STUB = `window.posthog = { __loaded: false, calls: [], init() { this.__loaded = true; this.calls.push('init'); }, register() {},
  capture(name) { this.calls.push('capture:' + name); }, opt_in_capturing() { this.calls.push('opt_in'); },
  opt_out_capturing() { this.calls.push('opt_out'); }, reset() { this.calls.push('reset'); } };`;

async function runChecks(browser, base) {
  const results = [];
  // Most checks run as a visitor who has already answered the analytics banner, so it never covers what they test.
  // The "analytics consent" group below uses fresh pages, and checks the banner itself.
  const rawNewPage = browser.newPage.bind(browser);
  const newPage = async (options) => {
    const page = await rawNewPage(options);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('pearfit.consent.v1', 'denied');
      } catch {
        // Storage blocked: the banner would show, which these checks can live with.
      }
    });
    return page;
  };
  const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
  // A missing element fails its group and the run moves on, so one problem does not hide the rest.
  const group = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      check(name, false, error.message.split('\n')[0]);
    }
  };
  const url = (p) => new URL(p, base).href;
  const year = String(new Date().getFullYear());
  const sectionCache = new Map();
  const fetcher = await browser.newContext();
  const sectionsOf = async (pagePath) => {
    if (!sectionCache.has(pagePath)) {
      const html = await (await fetcher.request.get(url(pagePath))).text();
      sectionCache.set(pagePath, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    }
    return sectionCache.get(pagePath);
  };

  for (const pagePath of [...PAGES, MISSING]) {
    await group(`${pagePath}: page checks`, async () => {
      const page = await newPage({ viewport: { width: 375, height: 800 } });
      page.setDefaultTimeout(4000);
      const failed = [];
      const otherSites = new Set();
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.protocol.startsWith('http') && u.origin !== new URL(base).origin) otherSites.add(u.hostname);
      });
      page.on('response', (r) => {
        const u = new URL(r.url());
        if (u.origin === new URL(base).origin && r.status() >= 400 && !u.pathname.startsWith('/api/') && u.pathname !== MISSING) {
          failed.push(`${r.status()} ${u.pathname}`);
        }
      });
      page.on('pageerror', (e) => failed.push(`script error: ${e.message}`));
      const response = await page.goto(url(pagePath), { waitUntil: 'networkidle' });

      if (pagePath === MISSING) {
        check(`${MISSING}: answers 404`, response?.status() === 404, response?.status());
        check(`${MISSING}: shows the Pearfit 404 page`, (await page.title()).includes('Page not found'), await page.title());
      }
      check(`${pagePath}: no failed requests or script errors`, failed.length === 0, failed.join(', '));
      check(`${pagePath}: no request to another site (fonts are our own, analytics wait for consent)`, otherSites.size === 0, [...otherSites].join(', '));

      // Every link resolves, including a #section on another page.
      const hrefs = [...new Set(await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href'))))];
      const broken = [];
      for (const href of hrefs) {
        if (href === '#' || href === '') { broken.push(`"${href}" goes nowhere`); continue; }
        if (/^(mailto|tel):/.test(href) || /^https?:/.test(href) && new URL(href).origin !== new URL(base).origin) continue;
        const u = new URL(href, page.url());
        const local = u.origin === new URL(page.url()).origin && u.pathname === new URL(page.url()).pathname;
        if (!local) {
          const r = await page.request.get(u.origin + u.pathname);
          if (!r.ok()) { broken.push(`${href} (${r.status()})`); continue; }
        }
        const id = decodeURIComponent(u.hash.slice(1));
        if (id && !(local ? await page.$(`[id="${id}"]`) : (await sectionsOf(u.pathname)).has(id))) broken.push(`${href} (no #${id})`);
      }
      check(`${pagePath}: all ${hrefs.length} links resolve`, broken.length === 0, broken.join(', '));

      const logos = await page.$$eval('.brand-wordmark', (els) => els.map((e) => `${e.tagName}:${e.getAttribute('href')}`));
      check(`${pagePath}: header and footer logos link home`, logos.length >= 2 && logos.every((l) => /^A:(\.\/|\/)$/.test(l)), logos.join(', '));
      const footer = (await page.textContent('footer').catch(() => '')) || '';
      check(`${pagePath}: footer shows © ${year}`, footer.includes(`© ${year}`), footer.replace(/\s+/g, ' ').slice(0, 80));
      check(`${pagePath}: footer email is a mailto link`, await page.$(`footer a[href="mailto:${INBOX}"]`));
      const plain = await page.evaluate(() => {
        const found = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(n.textContent) && !n.parentElement.closest('a, script, style, input, textarea')) found.push(n.textContent.trim());
        }
        return found;
      });
      check(`${pagePath}: no email address shown without a link`, plain.length === 0, plain.join(' | '));

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        const m = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        check(`${pagePath} @${width}px: no horizontal scroll`, m[0] <= m[1], `${m[0]}px wide in ${m[1]}px`);
      }

      if (await page.$('#nav-toggle')) {
        await page.setViewportSize({ width: 375, height: 800 });
        const nav = '#nav-links';
        const closedAtStart = !(await page.isVisible(nav));
        await page.click('#nav-toggle');
        const opens = await page.isVisible(nav);
        await page.keyboard.press('Escape');
        const escCloses = !(await page.isVisible(nav));
        await page.click('#nav-toggle');
        await page.click(`${nav} a >> nth=0`);
        await page.waitForTimeout(200);
        const linkCloses = (await page.getAttribute('#nav-toggle', 'aria-expanded')) === 'false';
        check(`${pagePath}: mobile menu opens, Escape and a link close it`, closedAtStart && opens && escCloses && linkCloses,
          JSON.stringify({ closedAtStart, opens, escCloses, linkCloses }));
      }
      await page.close();
    });
  }

  await group('inquiry form', async () => {
    const page = await newPage({ viewport: { width: 375, height: 800 } });
    page.setDefaultTimeout(5000);
    let outcome = 'ok';
    await page.route('https://formsubmit.co/**', (route) =>
      outcome === 'ok'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":"true"}' })
        : route.abort()
    );
    await page.goto(url('/#pilot'), { waitUntil: 'networkidle' });
    const note = '#form-note';
    const fill = async () => {
      await page.fill('#pilot-form [name=name]', 'Verify Bot');
      await page.fill('#pilot-form [name=email]', 'verify@example.com');
      await page.fill('#pilot-form [name=store]', 'yourbrand.com');
    };
    await page.click('#pilot-submit-btn');
    check('form: empty submit says which field is missing', (await page.getAttribute(note, 'class'))?.includes('form-error'), await page.textContent(note));
    await fill();
    await page.click('#pilot-submit-btn');
    const success = await page.waitForSelector('.form-success', { timeout: 5000 }).catch(() => null);
    check('form: a plain domain is accepted and a sent inquiry shows success', success, await page.textContent(note));
    outcome = 'fail';
    await fill();
    await page.click('#pilot-submit-btn');
    const error = await page.waitForSelector(`.form-error a[href="mailto:${INBOX}"]`, { timeout: 5000 }).catch(() => null);
    check('form: a failed send shows an error with the email', error, await page.textContent(note));
    check('form: the button works again after a send', !(await page.isDisabled('#pilot-submit-btn')));
    await page.close();
  });

  await group('analytics consent', async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const posthogRequests = [];
    await context.route('**/api/posthog-config', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ projectToken: 'phc_verify', host: 'https://ph.example.test' }) })
    );
    await context.route('https://ph.example.test/**', (route) => {
      posthogRequests.push(new URL(route.request().url()).pathname);
      return route.fulfill({ contentType: 'text/javascript', body: POSTHOG_STUB });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const stored = () => page.evaluate(() => localStorage.getItem('pearfit.consent.v1'));
    const calls = () => page.evaluate(() => (window.posthog ? window.posthog.calls.slice() : null));

    await page.goto(url('/'), { waitUntil: 'networkidle' });
    check('consent: the banner shows on a first visit', await page.isVisible('#consent-banner'));
    const boxes = await page.$$eval('#consent-banner button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check('consent: Accept and Decline are both there, the same size and tappable',
      boxes.length === 2 && boxes[0][0] === boxes[1][0] && boxes[0][1] === boxes[1][1] && boxes[0][1] >= 44, JSON.stringify(boxes));
    check('consent: with no answer nothing is requested from PostHog and nothing is stored',
      posthogRequests.length === 0 && (await calls()) === null && (await stored()) === null, `${posthogRequests.length} requests`);

    await page.click('#consent-banner [data-consent=granted]');
    await page.waitForFunction(() => window.posthog && window.posthog.__loaded);
    check('consent: Accept hides the banner, remembers the answer and starts PostHog',
      !(await page.isVisible('#consent-banner')) && (await stored()) === 'granted' && (await calls()).includes('init'), JSON.stringify(await calls()));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.posthog && window.posthog.__loaded);
    check('consent: the next visit starts PostHog without asking again', !(await page.isVisible('#consent-banner')));

    await page.click('footer [data-consent-open]');
    const focusedInBanner = await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('#consent-banner')));
    check('consent: "Privacy choices" in the footer brings the banner back, with focus on it', (await page.isVisible('#consent-banner')) && focusedInBanner);

    await page.click('#consent-banner [data-consent=denied]');
    const afterDecline = await calls();
    check('consent: Decline after accepting stops PostHog, forgets the visitor and hides the banner',
      !(await page.isVisible('#consent-banner')) && (await stored()) === 'denied' && afterDecline.includes('opt_out') && afterDecline.includes('reset'),
      JSON.stringify(afterDecline));

    const before = posthogRequests.length;
    await page.reload({ waitUntil: 'networkidle' });
    check('consent: after a decline PostHog is not requested again', posthogRequests.length === before && (await calls()) === null, `${posthogRequests.length - before} new requests`);
    await context.close();
  });

  await fetcher.close();
  return results;
}

function pushChecks() {
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const local = git('rev-parse', 'HEAD');
  // Ask the remote itself: a shallow or single-branch clone has no origin/<branch> ref to compare with.
  const remote = git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0] || '';
  const dirty = git('status', '--porcelain', '--', 'website');
  return [
    { name: `pushed: origin/${branch} matches this commit`, ok: Boolean(remote) && local === remote, detail: `${local.slice(0, 7)} vs ${remote.slice(0, 7) || 'not pushed'}` },
    { name: 'no uncommitted changes in website/', ok: dirty === '', detail: dirty.replace(/\n/g, ', ') },
  ];
}

const server = target ? null : await serve();
const base = target || `http://127.0.0.1:${server.address().port}/`;
let allOk = false;
for (let attempt = 1; attempt <= attempts && !allOk; attempt++) {
  const browser = await launchBrowser();
  let results;
  try {
    results = [...(target || process.env.CI ? [] : pushChecks()), ...(await runChecks(browser, base))];
  } finally {
    await browser.close();
  }
  allOk = results.every((r) => r.ok);
  console.log(`\nAttempt ${attempt}/${attempts} against ${base}`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ''}`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (!allOk && attempt < attempts) {
    console.log(`Retrying in ${waitSeconds}s…`);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
}
server?.close();
process.exit(allOk ? 0 : 1);
