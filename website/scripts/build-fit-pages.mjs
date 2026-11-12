// Builds the fit guide pages: one static page per product ("Does the <brand> <product> run small?"), the list of
// them at fit/index.html, and sitemap.xml for the whole site.
//
//   node website/scripts/build-fit-pages.mjs           write website/fit/ and website/sitemap.xml
//   node website/scripts/build-fit-pages.mjs --check   exit 1 if the committed pages are stale (no write)
//
// The source is data/fit-pages/catalog.json, a committed snapshot of the fit store written by
// `npm run export-fit-catalog` in engine/. This script never touches the network, and the output has no clock in
// it (the date on the pages is the snapshot's), so the same snapshot always gives byte-identical files.
//
// Nothing is invented. Every number on a page is a stored number. The sentences around them are picked by the
// rules in fitVerdict() from those numbers; no language model writes them. A product with too few reviews, no
// brand, or a name that is not a product name gets no page. A measurement the chart does not have prints as
// "unknown". No review text, reviewer name or store URL is published: the snapshot does not hold any.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(root, 'data', 'fit-pages', 'catalog.json');
const SITE = path.join(root, 'website');
const OUT_DIR = path.join(SITE, 'fit');
const SITEMAP = path.join(SITE, 'sitemap.xml');
const ORIGIN = 'https://www.pearfit.app';

// ---- Settings ----

// A page needs at least this many reviews. Fewer is too little to say how a product runs.
export const MIN_REVIEWS = 10;
// Below this many reviews the page says the sample is small.
export const SMALL_SAMPLE = 20;
// "True to size" for at least this share is a clear answer.
export const CLEAR_TRUE_TO_SIZE_PCT = 70;
// "Runs small" (or large) for at least this share is a clear answer.
export const CLEAR_RUNS_PCT = 50;
// When true to size leads without being clear, the page names a lean if one side is ahead of the other by this much.
export const LEAN_MARGIN_PCT = 10;
// A longer name is a store's whole marketing line, not a product name, and makes an unreadable title.
export const MAX_NAME_LENGTH = 80;
// How many other products of the same brand a page links to.
export const RELATED_SHOWN = 8;
// The hand-written pages that also go in the sitemap.
const STATIC_PAGES = ['/', '/stores.html', '/roi.html'];
// The shopper app only offers these garment types (PICKER_GARMENT_TYPES in engine/api/config.ts), so only these get
// a link straight to the product's size check.
const APP_GARMENT_TYPES = ['tee'];

const DIMS = ['chest_cm', 'length_cm', 'sleeve_cm'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---- Pure helpers ----

export function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "Men's DRY-EX T-Shirt" -> "mens-dry-ex-t-shirt". Apostrophes vanish; anything else that is not a-z or 0-9 is a dash. */
export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "2026-11-12" -> "12 November 2026". */
export function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "Acme Crew Tee" for brand "Acme" and name "Acme Crew Tee" (the brand is not said twice); "Acme Crew Tee" for name "Crew Tee". */
export function fullName(product) {
  return product.name.toLowerCase().startsWith(product.brand.toLowerCase()) ? product.name : `${product.brand} ${product.name}`;
}

/**
 * Why a product gets no page, or null when it gets one. The scraper stores what a store's page says, and some of
 * that is not a product: an error page's title, a placeholder brand.
 */
export function skipReason(product) {
  const { brand, name, reviews } = product;
  if (reviews.total < MIN_REVIEWS) return 'too_few_reviews';
  if (reviews.runsSmallPct + reviews.trueToSizePct + reviews.runsLargePct === 0) return 'no_fit_answers';
  if (!/[a-z]/i.test(brand) || /^unknown\b/i.test(brand)) return 'no_brand';
  if (!/[a-z]{3}/i.test(name) || /\b(error|not found|access denied|page|404)\b/i.test(name)) return 'not_a_product_name';
  if (name.length > MAX_NAME_LENGTH) return 'name_too_long';
  return null;
}

/**
 * What the review numbers say, as a key plus the sentences that go with it. The key is decided by the settings at
 * the top of this file and nothing else.
 */
export function fitVerdict(reviews) {
  const { runsSmallPct: small, trueToSizePct: tts, runsLargePct: large } = reviews;
  const top = Math.max(small, tts, large);
  const leaders = [small, tts, large].filter((pct) => pct === top).length;
  let key;
  if (leaders > 1) key = 'split';
  else if (tts === top) {
    if (tts >= CLEAR_TRUE_TO_SIZE_PCT) key = 'true_to_size';
    else if (small - large >= LEAN_MARGIN_PCT) key = 'true_leaning_small';
    else if (large - small >= LEAN_MARGIN_PCT) key = 'true_leaning_large';
    else key = 'true_mixed';
  } else if (small === top) key = small >= CLEAR_RUNS_PCT ? 'runs_small' : 'leans_small';
  else key = large >= CLEAR_RUNS_PCT ? 'runs_large' : 'leans_large';
  return { key, ...VERDICTS[key] };
}

// label: short, for lists and the description. answer: the page's first sentence. advice: what to do with it.
const VERDICTS = {
  true_to_size: {
    label: 'True to size',
    answer: 'No. Most reviewers say it fits true to size.',
    advice: 'Your usual size in this brand is the place to start.',
  },
  true_leaning_small: {
    label: 'Mostly true to size, leaning small',
    answer: 'Mostly no. More reviewers say true to size than anything else, but a fair share say it runs small.',
    advice: 'Start from your usual size. If you are between two sizes, the larger one is the safer choice.',
  },
  true_leaning_large: {
    label: 'Mostly true to size, leaning large',
    answer: 'No. More reviewers say true to size than anything else, and a fair share say it runs large.',
    advice: 'Start from your usual size. If you are between two sizes, the smaller one is the safer choice.',
  },
  true_mixed: {
    label: 'Mostly true to size, with mixed reports',
    answer: 'Mostly no. More reviewers say true to size than anything else, but the rest are divided between small and large.',
    advice: 'Start from your usual size, and check the size chart against a shirt you own.',
  },
  runs_small: {
    label: 'Runs small',
    answer: 'Yes. Most reviewers say it runs small.',
    advice: 'If you are between two sizes, the larger one is the safer choice.',
  },
  leans_small: {
    label: 'Leans small',
    answer: 'Somewhat. More reviewers say it runs small than anything else, but they are not a majority.',
    advice: 'If you are between two sizes, the larger one is the safer choice.',
  },
  runs_large: {
    label: 'Runs large',
    answer: 'No, the opposite. Most reviewers say it runs large.',
    advice: 'If you are between two sizes, the smaller one is the safer choice.',
  },
  leans_large: {
    label: 'Leans large',
    answer: 'No. More reviewers say it runs large than anything else, but they are not a majority.',
    advice: 'If you are between two sizes, the smaller one is the safer choice.',
  },
  split: {
    label: 'Reviewers are split',
    answer: 'The reviews do not agree. No answer is ahead of the others.',
    advice: 'The reviews do not point one way, so check the size chart against a shirt you own.',
  },
};

/**
 * The products that get a page, each with its slug, sorted by brand and then name. A slug is the brand and product
 * name; when two products share one, each gets its SKU on the end, so a slug never depends on the order of the rows.
 */
export function selectPages(catalog) {
  const kept = catalog.products.filter((p) => skipReason(p) === null);
  const baseOf = (p) => slugify(fullName(p));
  const counts = new Map();
  for (const p of kept) counts.set(baseOf(p), (counts.get(baseOf(p)) ?? 0) + 1);
  const pages = kept.map((p) => {
    const base = baseOf(p);
    return { ...p, slug: counts.get(base) > 1 ? `${base}-${slugify(p.sku)}` : base };
  });
  const seen = new Set();
  for (const page of pages) {
    if (page.slug === '' || page.slug === 'index' || seen.has(page.slug)) throw new Error(`fit pages: slug "${page.slug}" is empty or used twice (sku ${page.sku})`);
    seen.add(page.slug);
  }
  const key = (p) => `${p.brand.toLowerCase()}\u0000${p.name.toLowerCase()}\u0000${p.sku}`;
  return pages.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

const hasChart = (page) => page.sizes !== null && Object.values(page.sizes).some((row) => DIMS.some((dim) => row[dim] !== null));
const reviewCount = (n) => `${n} ${n === 1 ? 'review' : 'reviews'}`;
const pageUrl = (page) => `${ORIGIN}/fit/${page.slug}.html`;

// ---- HTML ----

function head({ title, description, canonical, jsonLd }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta name="theme-color" content="#f6f4ee" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#131512" media="(prefers-color-scheme: dark)" />
  <meta property="og:site_name" content="Pearfit" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${ORIGIN}/apple-touch-icon.png" />
  <meta property="og:image:width" content="180" />
  <meta property="og:image:height" content="180" />
  <meta property="og:image:alt" content="The Pearfit pear logo" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${ORIGIN}/apple-touch-icon.png" />
  <meta name="twitter:image:alt" content="The Pearfit pear logo" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <script>
    document.documentElement.classList.add('js');
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
  </script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  <header class="nav" id="top">
    <div class="wrap nav-inner">
      <a href="/" class="brand-wordmark"><img class="brand-mark" src="/logo-mark.svg" alt="" width="20" height="30" />Pearfit</a>
      <nav class="nav-links" id="nav-links" aria-label="Primary">
        <a href="/#how">How it works</a>
        <a href="/#try">Try it</a>
        <a href="/#pilot">For brands</a>
        <a href="/#faq">FAQ</a>
        <a href="/stores.html">Stores</a>
      </nav>
      <div class="nav-actions">
        <a href="/app" class="btn btn-sm">Try it live</a>
        <button type="button" class="nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false" aria-controls="nav-links"><span class="nav-toggle-bars" aria-hidden="true"></span></button>
      </div>
    </div>
  </header>
`;
}

const FOOT = `
  <footer class="footer">
    <div class="wrap footer-inner">
      <a href="/" class="brand-wordmark" aria-label="Pearfit home"><img class="brand-mark" src="/logo-mark.svg" alt="" width="20" height="30" loading="lazy" decoding="async" />Pearfit</a>
      <span class="muted">Pearfit compares a shirt with the shirts you already own, and tells you what size to buy.</span>
      <nav class="footer-links" aria-label="Footer">
        <a href="/#try">Try it</a>
        <a href="/fit/">Fit guides</a>
        <a href="/stores.html">Supported stores</a>
        <a href="/scraper">Scraper</a>
        <a href="/#faq">FAQ</a>
        <a href="/#pilot">Book a pilot</a>
        <a href="/roi.html">ROI calculator</a>
      </nav>
      <p class="footer-legal">&copy; <span data-year>2026</span> Pearfit. <a href="mailto:customerservice@pearfit.app">customerservice@pearfit.app</a></p>
    </div>
  </footer>

  <script src="/speed-insights-init.js"></script>
  <script src="/analytics.js"></script>
  <script src="/posthog-init.js"></script>
  <script src="/nav.js"></script>
</body>
</html>
`;

function crumbs(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  };
}

function bars(reviews) {
  const rows = [
    ['True to size', reviews.trueToSizePct],
    ['Runs small', reviews.runsSmallPct],
    ['Runs large', reviews.runsLargePct],
  ];
  return `<dl class="fit-bars">
${rows
  .map(
    ([label, pct]) => `          <div class="fit-bars-row">
            <dt>${label}</dt>
            <dd><span class="fit-bars-track" aria-hidden="true"><span class="fit-bars-fill" style="width: ${Math.max(0, Math.min(100, pct))}%"></span></span><span class="fit-bars-value">${pct}%</span></dd>
          </div>`,
  )
  .join('\n')}
        </dl>`;
}

function chart(page) {
  const cell = (value) => (value === null ? '<td class="is-unknown">unknown</td>' : `<td>${value}</td>`);
  return `<table class="try-chart fit-chart">
          <caption>Garment measurements in centimetres, laid flat</caption>
          <thead><tr><th scope="col">Size</th><th scope="col">Chest</th><th scope="col">Length</th><th scope="col">Sleeve</th></tr></thead>
          <tbody>
${Object.entries(page.sizes)
  .map(([size, row]) => `            <tr><th scope="row">${esc(size)}</th>${DIMS.map((dim) => cell(row[dim])).join('')}</tr>`)
  .join('\n')}
          </tbody>
        </table>
        <p class="try-foot">Chest is pit to pit with the garment laid flat, which is half the measurement around. “unknown” means Pearfit has no number it trusts for that cell; it is not filled in.</p>`;
}

/** One product's page. `related` is the other pages of the same brand, already cut to RELATED_SHOWN. */
export function renderProductPage(page, related, exportedOn) {
  const name = fullName(page);
  const verdict = fitVerdict(page.reviews);
  const { total, runsSmallPct, trueToSizePct, runsLargePct } = page.reviews;
  const question = `Does the ${name} run small?`;
  const title = question.length + ' — Pearfit'.length <= 65 ? `${question} — Pearfit` : question;
  const shares = `${trueToSizePct}% say true to size, ${runsSmallPct}% say it runs small and ${runsLargePct}% say it runs large`;
  const description = `${verdict.label}: of the reviews that say how it fits, ${trueToSizePct}% say true to size, ${runsSmallPct}% runs small, ${runsLargePct}% runs large. From ${reviewCount(total)}.`;
  const canonical = pageUrl(page);
  const inApp = APP_GARMENT_TYPES.includes(page.garmentType) && hasChart(page);
  const appHref = inApp ? `/app/#/check/${encodeURIComponent(page.candidateId)}` : '/app';

  return `${head({
    title,
    description,
    canonical,
    jsonLd: crumbs([
      ['Pearfit', `${ORIGIN}/`],
      ['Fit guides', `${ORIGIN}/fit/`],
      [name, canonical],
    ]),
  })}
  <main id="main" tabindex="-1">
    <section class="section fit-intro">
      <div class="wrap narrow-wrap">
        <nav class="fit-crumbs" aria-label="Breadcrumb"><a href="/">Pearfit</a> <span aria-hidden="true">›</span> <a href="/fit/">Fit guides</a></nav>
        <span class="kicker">Fit guide · ${esc(page.brand)}</span>
        <h1>${esc(question)}</h1>
        <p class="fit-answer">${esc(verdict.answer)}</p>
        <p>Of the reviews that say how it fits, ${shares}. Pearfit read ${reviewCount(total)} of this product.${total < SMALL_SAMPLE ? ' That is a small sample, so read it as a hint.' : ''}</p>
        ${bars(page.reviews)}
        <h2>What size to get</h2>
        <p>${esc(verdict.advice)}</p>
        <p>Reviews say how a garment runs on other people. Pearfit works out your size by comparing the garment’s measurements with shirts you already own, so the answer is about how it fits you.</p>
        <p><a class="btn" href="${appHref}">${inApp ? 'Check this against your own shirts' : 'Find your size with shirts you own'}</a></p>
      </div>
    </section>

    <section class="section section-alt" aria-labelledby="chart-heading">
      <div class="wrap narrow-wrap">
        <h2 id="chart-heading">${esc(name)} size chart</h2>
        ${hasChart(page) ? chart(page) : '<p class="muted">Pearfit has no size chart for this product yet.</p>'}
      </div>
    </section>
${
  related.length > 0
    ? `
    <section class="section" aria-labelledby="related-heading">
      <div class="wrap narrow-wrap">
        <h2 id="related-heading">More ${esc(page.brand)} fit guides</h2>
        <ul class="fit-list">
${related.map((other) => listItem(other, false)).join('\n')}
        </ul>
      </div>
    </section>
`
    : ''
}
    <section class="section section-rule">
      <div class="wrap narrow-wrap">
        <p class="muted">Numbers as of ${formatDate(exportedOn)}. The shares are rounded to whole percents and count only reviews that say how the product fits. <a href="/fit/">All fit guides</a></p>
      </div>
    </section>
  </main>
${FOOT}`;
}

function listItem(page, withBrand) {
  const label = withBrand ? fullName(page) : page.name;
  return `          <li><a href="/fit/${page.slug}.html"><span class="fit-list-name">${esc(label)}</span><span class="fit-list-meta">${esc(fitVerdict(page.reviews).label)} · ${reviewCount(page.reviews.total)}</span></a></li>`;
}

/** fit/index.html: every page, under its brand. */
export function renderIndexPage(pages, exportedOn) {
  const byBrand = new Map();
  for (const page of pages) byBrand.set(page.brand, [...(byBrand.get(page.brand) ?? []), page]);
  const title = 'Fit guides: does it run small? — Pearfit';
  const description = `How ${pages.length} products from ${byBrand.size} brands run, from the reviews Pearfit read: true to size, small or large, with size charts in centimetres.`;
  return `${head({
    title,
    description,
    canonical: `${ORIGIN}/fit/`,
    jsonLd: crumbs([
      ['Pearfit', `${ORIGIN}/`],
      ['Fit guides', `${ORIGIN}/fit/`],
    ]),
  })}
  <main id="main" tabindex="-1">
    <section class="section fit-intro">
      <div class="wrap">
        <span class="kicker">Fit guides</span>
        <h1>Does it run small?</h1>
        <p class="lede">How ${pages.length} products from ${byBrand.size} brands run, according to the reviews Pearfit read.</p>
        <p class="muted narrow">Each guide gives the share of reviews that say true to size, runs small and runs large, and the size chart where Pearfit has one. A product needs at least ${MIN_REVIEWS} reviews to be listed. Numbers as of ${formatDate(exportedOn)}.</p>
      </div>
    </section>

    <section class="section section-alt">
      <div class="wrap">
${[...byBrand]
  .map(
    ([brand, items]) => `        <h2 class="fit-brand" id="${slugify(brand)}">${esc(brand)}</h2>
        <ul class="fit-list fit-list-wide">
${items.map((page) => listItem(page, false)).join('\n')}
        </ul>`,
  )
  .join('\n')}
      </div>
    </section>
  </main>
${FOOT}`;
}

/** sitemap.xml for the whole site: the hand-written pages, then the fit guides with the snapshot's date. */
export function renderSitemap(pages, exportedOn) {
  const entry = (loc, lastmod) => `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...STATIC_PAGES.map((p) => entry(`${ORIGIN}${p}`)), entry(`${ORIGIN}/fit/`, exportedOn), ...pages.map((page) => entry(pageUrl(page), exportedOn))].join('\n')}
</urlset>
`;
}

/** Every file this script owns, as { path relative to website/: contents }. */
export function buildFiles(catalog) {
  const pages = selectPages(catalog);
  const files = { 'sitemap.xml': renderSitemap(pages, catalog.exported_on), 'fit/index.html': renderIndexPage(pages, catalog.exported_on) };
  for (const page of pages) {
    const related = pages
      .filter((other) => other.brand === page.brand && other.slug !== page.slug)
      .sort((a, b) => b.reviews.total - a.reviews.total || (a.slug < b.slug ? -1 : 1))
      .slice(0, RELATED_SHOWN);
    files[`fit/${page.slug}.html`] = renderProductPage(page, related, catalog.exported_on);
  }
  return { pages, files };
}

// ---- Command line ----

function existingFitFiles() {
  return existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((name) => name.endsWith('.html')).map((name) => `fit/${name}`) : [];
}

function main() {
  const check = process.argv.includes('--check');
  const catalog = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const { pages, files } = buildFiles(catalog);
  const extra = existingFitFiles().filter((file) => !(file in files));
  const stale = Object.entries(files)
    .filter(([file, contents]) => !existsSync(path.join(SITE, file)) || readFileSync(path.join(SITE, file), 'utf8') !== contents)
    .map(([file]) => file);

  if (check) {
    if (stale.length === 0 && extra.length === 0) return console.log(`Fit pages are up to date (${pages.length} guides).`);
    console.error(`Fit pages are stale: ${stale.length} to rewrite, ${extra.length} to remove. Run: node website/scripts/build-fit-pages.mjs`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of extra) rmSync(path.join(SITE, file));
  for (const [file, contents] of Object.entries(files)) writeFileSync(path.join(SITE, file), contents);
  const skipped = catalog.products.length - pages.length;
  console.log(`Wrote ${pages.length} fit guides, fit/index.html and sitemap.xml (${skipped} of ${catalog.products.length} products have no page; ${extra.length} old pages removed).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
