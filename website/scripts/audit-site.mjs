// Audits the static pages in website/ in a real browser. No dependencies of its own: it serves website/ from a
// small Node server and takes Playwright from webscraper's install, the same way engine/scripts/build-api.mjs
// takes esbuild. Run `npm ci` in webscraper/ first (set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 if the browser is
// already installed), then from the repo root:
//
//   node website/scripts/audit-site.mjs [--pages index.html,stores.html] [--shots <dir>] [--json]
//
// Per page and per viewport (360, 390 and 1280 px wide, light and dark) it checks: horizontal overflow,
// images without alt, links and buttons with no name, form controls with no label, heading order, landmarks,
// tap targets under 44 px, text contrast, a visible keyboard focus ring, prefers-reduced-motion, lazy images,
// layout shift, and the meta, canonical, social and icon tags. Exit code 1 when anything in the "fail" list is found.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(site, '..');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const pages = String(flag('--pages') || 'index.html').split(',');
const shotsDir = flag('--shots');
const asJson = args.includes('--json');

// Playwright from webscraper's install first; a machine whose browser was installed for another Playwright
// version (a shared or global install) falls back to the plain `playwright` module.
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

// Static server for website/. /api/* is answered by the page's own mocks or with 404: the audit never needs the real API.
function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/posthog-config') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.join(site, rel);
    if (!file.startsWith(site) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Runs in the page. Returns plain data; the Node side decides what fails.
function inPage() {
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };
  const out = {};

  // Horizontal overflow: the page itself, then the elements poking out of the viewport (ignoring scroll containers).
  const vw = document.documentElement.clientWidth;
  out.pageOverflowPx = Math.max(0, document.documentElement.scrollWidth - vw);
  out.overflowing = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const box = el.getBoundingClientRect();
    if (box.right <= vw + 0.5 && box.left >= -0.5) continue;
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox !== 'visible') { clipped = true; break; }
    }
    if (!clipped && getComputedStyle(el).position !== 'absolute') out.overflowing.push(`${describe(el)} right=${Math.round(box.right)} left=${Math.round(box.left)}`);
  }
  out.overflowing = out.overflowing.slice(0, 8);

  // Names.
  const nameOf = (el) => {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) return labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const text = (el.textContent || '').trim();
    if (text) return text;
    const img = el.querySelector('img[alt]:not([alt=""]), svg[aria-label], svg title');
    if (img) return img.getAttribute('alt') || img.getAttribute('aria-label') || img.textContent || '';
    return (el.getAttribute('title') || '').trim();
  };
  out.imagesWithoutAlt = [...document.images].filter((img) => !img.hasAttribute('alt')).map(describe);
  out.svgImgWithoutName = [...document.querySelectorAll('svg[role="img"]')].filter((svg) => !nameOf(svg)).map(describe);
  out.unnamedLinksButtons = [...document.querySelectorAll('a[href], button, [role="button"], [role="tab"], [role="radio"]')]
    .filter((el) => visible(el) && !nameOf(el)).map(describe);
  out.linksWithoutHref = [...document.querySelectorAll('a:not([href])')].map(describe);
  out.unlabelledControls = [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => el.type !== 'hidden' && visible(el))
    .filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
      return !el.closest('label');
    }).map(describe);

  // Headings and landmarks.
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible);
  out.headingLevels = headings.map((h) => Number(h.tagName[1]));
  out.headingJumps = [];
  let prev = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) out.headingJumps.push(`h${prev} -> h${level} at "${(h.textContent || '').trim().slice(0, 40)}"`);
    prev = level;
  }
  out.h1Count = headings.filter((h) => h.tagName === 'H1').length;
  out.landmarks = {
    banner: document.querySelectorAll('header:not(article header):not(section header), [role="banner"]').length,
    nav: document.querySelectorAll('nav, [role="navigation"]').length,
    main: document.querySelectorAll('main, [role="main"]').length,
    contentinfo: document.querySelectorAll('footer, [role="contentinfo"]').length,
  };
  out.unlabelledNavs = document.querySelectorAll('nav:not([aria-label]):not([aria-labelledby])').length;
  out.hasSkipLink = !!document.querySelector('a[href^="#"]:is(.skip-link, [class*="skip"])');
  out.lang = document.documentElement.getAttribute('lang');
  out.duplicateIds = [...new Set([...document.querySelectorAll('[id]')].map((el) => el.id).filter((id, i, all) => all.indexOf(id) !== i))];

  // Tap targets: every interactive element that is not an inline link inside running text.
  out.smallTargets = [];
  for (const el of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, summary, textarea, [role="button"], [role="radio"], [role="tab"]')) {
    if (!visible(el)) continue;
    if (el.closest('.inquiry-honey')) continue;
    const box = el.getBoundingClientRect();
    const display = getComputedStyle(el).display;
    const inText = el.tagName === 'A' && display === 'inline' && el.closest('p, li, dd, dt, td, figcaption, summary');
    if (inText) continue;
    if (el.type === 'range') { if (box.height < 24) out.smallTargets.push(`${describe(el)} ${Math.round(box.width)}x${Math.round(box.height)}`); continue; }
    if (box.width < 44 || box.height < 44) out.smallTargets.push(`${describe(el)} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }

  // Text cut off by a container that hides its overflow (and does not say so with an ellipsis).
  out.clippedText = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el) || !(el.textContent || '').trim() || el.closest('.inquiry-honey')) continue;
    const s = getComputedStyle(el);
    if (s.overflowX === 'visible' || s.overflowX === 'auto' || s.overflowX === 'scroll' || s.textOverflow === 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + 1) out.clippedText.push(`${describe(el)} content ${el.scrollWidth}px in ${el.clientWidth}px`);
  }
  out.clippedText = out.clippedText.slice(0, 6);

  // ARIA that is not allowed: a name on a generic element with no role; a tablist whose tabs control nothing.
  out.ariaMisuse = [
    ...[...document.querySelectorAll('div[aria-label]:not([role]), span[aria-label]:not([role]), p[aria-label]:not([role])')].map((el) => `aria-label on a generic element: ${describe(el)}`),
    ...[...document.querySelectorAll('[role="tablist"]')].filter((el) => ![...el.querySelectorAll('[role="tab"]')].every((t) => t.getAttribute('aria-controls'))).map((el) => `tablist without tabpanels (tabs have no aria-controls): ${describe(el)}`),
    ...[...document.querySelectorAll('[role="radio"]')].filter((el) => el.tagName === 'BUTTON' && el.getAttribute('tabindex') === null).slice(0, 1).map((el) => `role=radio buttons are each a tab stop and need arrow-key handling, or should be toggle buttons: ${describe(el)}`),
  ];

  // Primary navigation must be reachable at every width: visible links, or a visible menu button.
  const headerLinks = [...document.querySelectorAll('header a[href]')].filter((a) => visible(a) && !a.matches('.brand-wordmark, .btn'));
  out.navReachable = headerLinks.length > 0 || [...document.querySelectorAll('header button[aria-expanded]')].some(visible);

  // Contrast of rendered text against what it sits on.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const backdrop = (el) => {
    const layers = [];
    let hasImage = false;
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.backgroundImage !== 'none') hasImage = true;
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] === 1) break; }
    }
    let color = layers.length && layers[layers.length - 1][3] === 1 ? layers.pop() : rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (color[3] < 1) color = over(color, [255, 255, 255, 1]);
    while (layers.length) color = over(layers.pop(), color);
    return { color, hasImage };
  };
  out.lowContrast = [];
  out.contrastSkipped = 0;
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || seen.has(el) || !(node.textContent || '').trim() || !visible(el) || el.closest('.inquiry-honey, script, style, noscript')) continue;
    seen.add(el);
    const style = getComputedStyle(el);
    const bg = backdrop(el);
    if (bg.hasImage) { out.contrastSkipped += 1; continue; }
    const fg = over(rgba(style.color), bg.color);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg.color);
    if (got < need) out.lowContrast.push(`${got.toFixed(2)}:1 (need ${need}) ${describe(el)} ${style.color} on rgb(${bg.color.slice(0, 3).map(Math.round).join(',')})`);
  }

  // Images and the document head.
  out.imagesNotLazy = [...document.images].filter((img) => img.loading !== 'lazy' && img.getBoundingClientRect().top > innerHeight).map(describe);
  out.imagesWithoutSize = [...document.images].filter((img) => !(img.getAttribute('width') && img.getAttribute('height'))).map(describe);
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content') ?? null;
  out.head = {
    title: document.title,
    description: meta('meta[name="description"]'),
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
    noindex: /noindex/i.test(meta('meta[name="robots"]') || ''),
    viewport: meta('meta[name="viewport"]'),
    themeColor: meta('meta[name="theme-color"]'),
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    ogType: meta('meta[property="og:type"]'),
    ogUrl: meta('meta[property="og:url"]'),
    ogImage: meta('meta[property="og:image"]'),
    ogImageAlt: meta('meta[property="og:image:alt"]'),
    ogSiteName: meta('meta[property="og:site_name"]'),
    twitterCard: meta('meta[name="twitter:card"]'),
    twitterImage: meta('meta[name="twitter:image"]'),
    icons: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute('href')),
  };
  return out;
}

// Keyboard focus ring: Tab through the page and read what the browser actually draws on each focused element.
async function focusRings(page) {
  const missing = [];
  let count = 0;
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && s.outlineColor !== 'rgba(0, 0, 0, 0)';
      const shadow = s.boxShadow !== 'none';
      const id = el.id ? `#${el.id}` : '';
      return { ring: ring || shadow, label: `${el.tagName.toLowerCase()}${id} "${(el.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"` };
    });
    if (!info) break;
    count += 1;
    if (!info.ring) missing.push(info.label);
  }
  return { count, missing };
}

async function layoutShift(browser, url, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const cls = await page.evaluate(() => window.__cls);
  await context.close();
  return cls;
}

const findings = [];
const add = (page, viewport, level, rule, detail) => findings.push({ page, viewport, level, rule, detail });

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser();
try {
  for (const pageName of pages) {
    const url = `${base}/${pageName}`;
    for (const [width, height] of [[360, 780], [390, 844], [1280, 900]]) {
      for (const scheme of ['light', 'dark']) {
        const viewport = `${width}px ${scheme}`;
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme });
        const page = await context.newPage();
        // Fonts come from Google Fonts; the audit sandbox may have no route to it, so fall back to system fonts.
        await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
        const consoleErrors = [];
        page.on('pageerror', (e) => consoleErrors.push(e.message));
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(400);
        const r = await page.evaluate(inPage);

        if (r.pageOverflowPx > 0) add(pageName, viewport, 'fail', 'horizontal-overflow', `page scrolls sideways by ${r.pageOverflowPx}px`);
        r.overflowing.forEach((d) => add(pageName, viewport, 'fail', 'element-overflow', d));
        r.imagesWithoutAlt.forEach((d) => add(pageName, viewport, 'fail', 'img-alt', d));
        r.svgImgWithoutName.forEach((d) => add(pageName, viewport, 'fail', 'svg-name', d));
        r.unnamedLinksButtons.forEach((d) => add(pageName, viewport, 'fail', 'empty-link-or-button', d));
        r.linksWithoutHref.forEach((d) => add(pageName, viewport, 'warn', 'anchor-without-href', d));
        r.unlabelledControls.forEach((d) => add(pageName, viewport, 'fail', 'form-label', d));
        r.headingJumps.forEach((d) => add(pageName, viewport, 'fail', 'heading-order', d));
        if (r.h1Count !== 1) add(pageName, viewport, 'fail', 'h1-count', `${r.h1Count} h1 elements`);
        for (const [name, count] of Object.entries(r.landmarks)) if (count < 1) add(pageName, viewport, 'fail', 'landmark', `no ${name} landmark`);
        if (r.landmarks.main > 1) add(pageName, viewport, 'fail', 'landmark', `${r.landmarks.main} main landmarks`);
        if (r.landmarks.nav > 1 && r.unlabelledNavs > 0) add(pageName, viewport, 'fail', 'landmark', `${r.unlabelledNavs} nav landmarks without a label`);
        if (!r.hasSkipLink) add(pageName, viewport, 'warn', 'skip-link', 'no skip-to-content link');
        if (!r.lang) add(pageName, viewport, 'fail', 'lang', 'html has no lang');
        r.duplicateIds.forEach((d) => add(pageName, viewport, 'fail', 'duplicate-id', d));
        r.smallTargets.forEach((d) => add(pageName, viewport, width <= 390 ? 'fail' : 'warn', 'tap-target-44px', d));
        r.lowContrast.forEach((d) => add(pageName, viewport, 'fail', 'contrast', d));
        r.clippedText.forEach((d) => add(pageName, viewport, 'fail', 'clipped-text', d));
        r.ariaMisuse.forEach((d) => add(pageName, viewport, 'fail', 'aria', d));
        if (!r.navReachable) add(pageName, viewport, 'fail', 'navigation', 'no visible navigation links and no menu button in the header');
        r.imagesNotLazy.forEach((d) => add(pageName, viewport, 'warn', 'lazy-image', `below the fold without loading=lazy: ${d}`));
        r.imagesWithoutSize.forEach((d) => add(pageName, viewport, 'fail', 'image-size', `no width/height (layout shift): ${d}`));
        consoleErrors.forEach((d) => add(pageName, viewport, 'fail', 'page-error', d));

        if (width === 390 && scheme === 'light') {
          const h = r.head;
          const need = (key, label = key) => { if (!h[key]) add(pageName, viewport, 'fail', 'head', `missing ${label}`); };
          // A noindex page (404.html) is never shared or indexed, so it needs no canonical or social tags.
          const social = ['canonical', 'ogTitle', 'ogDescription', 'ogType', 'ogUrl', 'ogImage', 'ogSiteName', 'twitterCard', 'twitterImage'];
          ['title', 'description', 'viewport', ...(h.noindex ? [] : social)].forEach((k) => need(k));
          if (h.description && (h.description.length < 70 || h.description.length > 160)) add(pageName, viewport, 'warn', 'head', `description is ${h.description.length} characters (aim for 70 to 160)`);
          if (h.title && h.title.length > 65) add(pageName, viewport, 'warn', 'head', `title is ${h.title.length} characters (aim for 65 or fewer)`);
          if (h.twitterCard === 'summary_large_image' && !h.twitterImage) add(pageName, viewport, 'fail', 'head', 'twitter:card is summary_large_image but there is no twitter:image');
          for (const href of [...h.icons, h.ogImage, h.twitterImage].filter(Boolean)) {
            const local = href.startsWith('http') ? new URL(href).pathname : href;
            const res = await page.request.get(new URL(local, url).toString());
            if (!res.ok()) add(pageName, viewport, 'fail', 'asset-404', `${href} -> ${res.status()}`);
          }
          const focus = await focusRings(page);
          focus.missing.forEach((d) => add(pageName, viewport, 'fail', 'focus-ring', d));
          if (focus.count < 3) add(pageName, viewport, 'fail', 'focus-ring', `only ${focus.count} elements reachable with Tab`);
        }
        await context.close();
      }
      const cls = await layoutShift(browser, url, { width, height });
      if (cls > 0.05) add(pageName, `${width}px`, 'fail', 'layout-shift', `CLS ${cls.toFixed(3)} (fonts blocked)`);
      else if (!asJson) console.log(`  ${pageName} ${width}px: CLS ${cls.toFixed(3)}`);
    }

    // prefers-reduced-motion: nothing may animate or smooth-scroll.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto(url, { waitUntil: 'load' });
    const motion = await page.evaluate(() => {
      const moving = [];
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        const ms = (v) => Math.max(...v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000) || 0));
        if (ms(s.transitionDuration) > 1 || ms(s.animationDuration) > 1) moving.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${s.transitionDuration}/${s.animationDuration}`);
      }
      return { smooth: getComputedStyle(document.documentElement).scrollBehavior, moving: [...new Set(moving)].slice(0, 6) };
    });
    if (motion.smooth !== 'auto') add(pageName, 'reduced-motion', 'fail', 'reduced-motion', `scroll-behavior is ${motion.smooth}`);
    motion.moving.forEach((d) => add(pageName, 'reduced-motion', 'fail', 'reduced-motion', `still animates: ${d}`));
    await context.close();

    if (shotsDir) {
      mkdirSync(shotsDir, { recursive: true });
      for (const [width, height] of [[390, 844], [1280, 900]]) {
        const shotContext = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        const shotPage = await shotContext.newPage();
        await shotPage.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
        await shotPage.goto(url, { waitUntil: 'load' });
        await shotPage.waitForTimeout(400);
        await shotPage.screenshot({ path: path.join(shotsDir, `${pageName.replace(/\.html$/, '')}-${width}.png`), fullPage: true });
        await shotContext.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}

// Same finding on several viewports is one line with the viewports joined.
const grouped = new Map();
for (const f of findings) {
  const key = `${f.page}|${f.level}|${f.rule}|${f.detail.replace(/ [\d.]+x[\d.]+$/, '')}`;
  const entry = grouped.get(key) || { ...f, viewports: [] };
  entry.viewports.push(f.viewport);
  grouped.set(key, entry);
}
const rows = [...grouped.values()];
const fails = rows.filter((r) => r.level === 'fail');

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const level of ['fail', 'warn']) {
    const list = rows.filter((r) => r.level === level);
    console.log(`\n${level.toUpperCase()} (${list.length})`);
    for (const r of list) console.log(`  [${r.page}] ${r.rule}: ${r.detail}  (${[...new Set(r.viewports)].join(', ')})`);
  }
  console.log(`\n${fails.length} failing finding(s), ${rows.length - fails.length} warning(s) across ${pages.length} page(s).`);
}
process.exit(fails.length ? 1 : 0);
