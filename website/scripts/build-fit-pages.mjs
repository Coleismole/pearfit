// Builds the fit guide pages: one static page per product ("Does the <brand> <product> run small?"), one per brand
// with enough guides ("Does <brand> run small?"), the list of them at fit/index.html, the "fit guides" block on the
// home page, and sitemap.xml for the whole site.
//
//   node website/scripts/build-fit-pages.mjs           write website/fit/, website/sitemap.xml and the home page block
//   node website/scripts/build-fit-pages.mjs --check   exit 1 if the committed files are stale (no write)
//
// The source is data/fit-pages/catalog.json, a committed snapshot of the fit store written by
// `npm run export-fit-catalog` in engine/. This script never touches the network, and the output has no clock in
// it (the date on the pages is the snapshot's), so the same snapshot always gives byte-identical files.
//
// What a share means: the scraper counts every review it read as runs small, true to size or runs large, by fixed
// phrase rules (webscraper/fitAnalyzer.ts), and a review with no small or large cue, including one that never
// mentions fit, is counted as true to size. So the true to size share is the share of reviews that do not call the fit
// small or large, not the share that say "true to size". Every page says this and links fit/method.html.
//
// Nothing is invented. Every number on a page is a stored number, or a share combined from stored numbers (see
// combineReviews). The sentences around them are picked by the rules in fitVerdict() from those numbers; no language
// model writes them. A product with too few reviews, no brand, or a name that is not a product name gets no page.
// A product the store lists under several codes is one page. A measurement the chart does not have prints as
// "unknown". No review text, reviewer name or store URL is published: the snapshot does not hold any.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(root, 'data', 'fit-pages', 'catalog.json');
const SITE = path.join(root, 'website');
const OUT_DIR = path.join(SITE, 'fit');
const BRAND_DIR = path.join(OUT_DIR, 'brands');
const HOME = path.join(SITE, 'index.html');
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
// A brand gets its own page with at least this many guides.
export const MIN_BRAND_GUIDES = 3;
// The brand page names products where at least this share of reviewers say "runs small" (or large), when the
// product has at least SMALL_SAMPLE reviews, and shows at most BRAND_CALLOUTS_SHOWN of each.
export const BRAND_CALLOUT_PCT = 20;
export const BRAND_CALLOUTS_SHOWN = 5;
// The brand page sums up a type of garment (T-shirts, jackets) with at least this many guides.
export const TYPE_SUMMARY_MIN = 3;
// The fit guide index lists this many guides of a brand that has its own page, then links to it.
export const INDEX_BRAND_SHOWN = 8;
// The home page block: the most reviewed guides, at most this many per brand, this many in all.
export const HOME_GUIDES_SHOWN = 6;
export const HOME_GUIDES_PER_BRAND = 2;
// ...and links to the pages of this many brands (those with the most guides).
export const HOME_BRANDS_SHOWN = 3;
// A product page links this many guides of the same type of garment from other brands.
export const SIMILAR_GUIDES_SHOWN = 6;
// The hand-written pages that also go in the sitemap.
const STATIC_PAGES = ['/', '/stores.html', '/roi.html', '/privacy.html', '/terms.html'];
// The shopper app only offers these garment types (PICKER_GARMENT_TYPES in engine/api/config.ts), so only these get
// a link straight to the product's size check.
const APP_GARMENT_TYPES = ['tee'];

const DIMS = ['chest_cm', 'length_cm', 'sleeve_cm'];
const SHARE_KEYS = ['runsSmallPct', 'trueToSizePct', 'runsLargePct'];
const GARMENT_PLURAL = { tee: 'T-shirts', tee_long_sleeve: 'Long-sleeve tees', polo: 'Polo shirts', button_shirt: 'Shirts', jacket: 'Jackets', other: 'Other garments' };
const METHOD_PATH = '/fit/method.html';
export const HOME_START = '<!-- fit-guides:start (written by scripts/build-fit-pages.mjs: edit the script, not this block) -->';
export const HOME_END = '<!-- fit-guides:end -->';
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

/** 6348 -> "6,348". Written out, so the page does not depend on the machine's locale. */
export function formatCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "Acme Crew Tee" for brand "Acme" and name "Acme Crew Tee" (the brand is not said twice); "Acme Crew Tee" for name "Crew Tee". */
export function fullName(product) {
  return product.name.toLowerCase().startsWith(product.brand.toLowerCase()) ? product.name : `${product.brand} ${product.name}`;
}

/**
 * Why one stored listing cannot be used for a page, or null when it can. The scraper stores what a store's page
 * says, and some of that is not a product: an error page's title, a placeholder brand. The review minimum is not
 * here: it applies to a product after its listings are combined (selectPages).
 */
export function skipReason(product) {
  const { brand, name, reviews } = product;
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
    answer: 'No. Most reviews are counted as true to size.',
    advice: 'Your usual size in this brand is the place to start.',
  },
  true_leaning_small: {
    label: 'Mostly true to size, leaning small',
    answer: 'Mostly no. More reviews are counted as true to size than anything else, but a fair share say it runs small.',
    advice: 'Start from your usual size. If you are between two sizes, the larger one is the safer choice.',
  },
  true_leaning_large: {
    label: 'Mostly true to size, leaning large',
    answer: 'No. More reviews are counted as true to size than anything else, and a fair share say it runs large.',
    advice: 'Start from your usual size. If you are between two sizes, the smaller one is the safer choice.',
  },
  true_mixed: {
    label: 'Mostly true to size, with mixed reports',
    answer: 'Mostly no. More reviews are counted as true to size than anything else, but the rest are divided between small and large.',
    advice: 'Start from your usual size, and check the size chart against a shirt you own.',
  },
  runs_small: {
    label: 'Runs small',
    answer: 'Yes. Most reviews say it runs small.',
    advice: 'If you are between two sizes, the larger one is the safer choice.',
  },
  leans_small: {
    label: 'Leans small',
    answer: 'Somewhat. More reviews say it runs small than anything else, but they are not a majority.',
    advice: 'If you are between two sizes, the larger one is the safer choice.',
  },
  runs_large: {
    label: 'Runs large',
    answer: 'No, the opposite. Most reviews say it runs large.',
    advice: 'If you are between two sizes, the smaller one is the safer choice.',
  },
  leans_large: {
    label: 'Leans large',
    answer: 'No. More reviews say it runs large than anything else, but they are not a majority.',
    advice: 'If you are between two sizes, the smaller one is the safer choice.',
  },
  split: {
    label: 'Reviewers are split',
    answer: 'The reviews do not agree. No answer is ahead of the others.',
    advice: 'The reviews do not point one way, so check the size chart against a shirt you own.',
  },
};

const hasChart = (item) => item.sizes !== null && Object.values(item.sizes).some((row) => DIMS.some((dim) => row[dim] !== null));
const reviewCount = (n) => `${formatCount(n)} ${n === 1 ? 'review' : 'reviews'}`;
const pageUrl = (page) => `${ORIGIN}/fit/${page.slug}.html`;
const brandUrl = (brand) => `${ORIGIN}/fit/brands/${brand.slug}.html`;

/**
 * Shares for several sets of reviews taken together: each listing's shares weighted by its review count, rounded to
 * whole percents that add up to 100 (the largest remainders get the extra points). The stored shares are already
 * rounded, so the result is close to, not exactly, the share of a pooled count.
 */
export function combineReviews(items) {
  const total = items.reduce((sum, r) => sum + r.total, 0);
  let raw = SHARE_KEYS.map((key) => items.reduce((sum, r) => sum + r.total * r[key], 0) / total);
  const rawSum = raw.reduce((a, b) => a + b, 0);
  raw = raw.map((v) => (v * 100) / rawSum);
  const shares = raw.map(Math.floor);
  let left = 100 - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - shares[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return { total, runsSmallPct: shares[0], trueToSizePct: shares[1], runsLargePct: shares[2] };
}

/**
 * One product from the listings that share its brand and name (a store can list a product under several codes).
 * The listing with the most reviews leads. Listings with identical review numbers are the same reviews seen twice,
 * so they count once; different ones are combined. The size chart is the lead's, or the first listing's that has one.
 */
export function mergeListings(listings) {
  const sorted = [...listings].sort(
    (a, b) => b.reviews.total - a.reviews.total || Number(hasChart(b)) - Number(hasChart(a)) || (a.sku < b.sku ? -1 : 1),
  );
  const lead = sorted[0];
  const seen = new Set();
  const distinct = sorted.filter((l) => {
    const key = [l.reviews.total, ...SHARE_KEYS.map((k) => l.reviews[k])].join('/');
    return seen.has(key) ? false : (seen.add(key), true);
  });
  const charted = sorted.find(hasChart);
  return {
    sku: lead.sku,
    candidateId: (charted ?? lead).candidateId,
    brand: lead.brand,
    name: lead.name,
    garmentType: lead.garmentType,
    reviews: distinct.length === 1 ? distinct[0].reviews : combineReviews(distinct.map((l) => l.reviews)),
    sizes: charted ? charted.sizes : null,
    listings: distinct.length,
  };
}

/**
 * The products that get a page, each with its slug, sorted by brand and then name. Listings with the same brand and
 * name are one product (mergeListings), and the review minimum applies to the combined count. A slug is the brand and
 * product name; if two different products still share one, each gets its SKU on the end.
 */
export function selectPages(catalog) {
  const groups = new Map();
  for (const listing of catalog.products) {
    if (skipReason(listing) !== null) continue;
    const key = `${listing.brand.toLowerCase()}\u0000${listing.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
    groups.set(key, [...(groups.get(key) ?? []), listing]);
  }
  const kept = [...groups.values()].map(mergeListings).filter((p) => p.reviews.total >= MIN_REVIEWS);

  // One spelling per brand: the one on the product with the most reviews.
  const spelling = new Map();
  for (const p of kept) {
    const key = p.brand.toLowerCase();
    const current = spelling.get(key);
    if (!current || p.reviews.total > current.reviews.total || (p.reviews.total === current.reviews.total && p.brand < current.brand)) spelling.set(key, p);
  }
  for (const p of kept) p.brand = spelling.get(p.brand.toLowerCase()).brand;

  const baseOf = (p) => slugify(fullName(p));
  const counts = new Map();
  for (const p of kept) counts.set(baseOf(p), (counts.get(baseOf(p)) ?? 0) + 1);
  const pages = kept.map((p) => ({ ...p, slug: counts.get(baseOf(p)) > 1 ? `${baseOf(p)}-${slugify(p.sku)}` : baseOf(p) }));
  const seen = new Set();
  for (const page of pages) {
    if (page.slug === '' || page.slug === 'index' || page.slug === 'method' || seen.has(page.slug)) throw new Error(`fit pages: slug "${page.slug}" is empty or used twice (sku ${page.sku})`);
    seen.add(page.slug);
  }
  const order = (p) => `${p.brand.toLowerCase()}\u0000${p.name.toLowerCase()}\u0000${p.sku}`;
  return pages.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

// "Other garments" is too mixed to link as one group, so its guides are grouped by a word in the product name. The
// first group whose pattern matches wins. A name that matches none (a pair of clogs, "The Pit Stop") has no group and no
// similar guides: it is left out rather than guessed. "Short Sleeve Top" is not shorts.
const OTHER_GROUPS = [
  ['Jeans', /\bjeans?\b/],
  ['Pants', /\b(pants?|trousers|joggers|chinos?)\b/],
  ['Shorts', /\bshorts?\b(?![\s-]*sleeve)/],
  ['Leggings', /\b(leggings?|tights)\b/],
  ['Dresses and jumpsuits', /\b(dress(es)?|jumpsuits?)\b/],
  ['Hoodies and sweatshirts', /\b(hoodies?|sweatshirts?)\b/],
  ['Sweaters and cardigans', /\b(sweaters?|cardigans?)\b/],
  ['Tops', /\b(tops?|tanks?|blouses?)\b/],
  ['Bras', /\bbras?\b/],
];

/** The group a guide is linked with: its type of garment, or for "other garments" the word group its name matches. null when none. */
export function similarGroup(page) {
  const type = page.garmentType in GARMENT_PLURAL ? page.garmentType : 'other';
  if (type !== 'other') return { key: type, label: GARMENT_PLURAL[type] };
  const name = page.name.toLowerCase();
  const found = OTHER_GROUPS.find(([, pattern]) => pattern.test(name));
  return found ? { key: `other:${found[0]}`, label: found[0] } : null;
}

/**
 * Up to SIMILAR_GUIDES_SHOWN guides of the same group (similarGroup) from other brands, so a brand with one product
 * still links out. Each page starts at a different place in the list (its own position times the number shown, wrapping
 * round), which spreads the links over every guide instead of sending all of them to the most reviewed ones. Nothing
 * here is random: the same pages give the same links.
 */
export function similarGuides(page, pages) {
  const group = similarGroup(page);
  if (!group) return [];
  const same = pages.filter((p) => similarGroup(p)?.key === group.key).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const pool = same.filter((p) => p.brand !== page.brand);
  if (pool.length === 0) return [];
  const shown = Math.min(SIMILAR_GUIDES_SHOWN, pool.length);
  const start = (same.findIndex((p) => p.slug === page.slug) * shown) % pool.length;
  return Array.from({ length: shown }, (_, i) => pool[(start + i) % pool.length]);
}

/** The brands with a page of their own: at least MIN_BRAND_GUIDES guides each, sorted by name. */
export function selectBrands(pages) {
  const byBrand = new Map();
  for (const page of pages) byBrand.set(page.brand, [...(byBrand.get(page.brand) ?? []), page]);
  const brands = [...byBrand]
    .filter(([, items]) => items.length >= MIN_BRAND_GUIDES)
    .map(([brand, items]) => ({ brand, slug: slugify(brand), pages: items }))
    .sort((a, b) => (a.brand.toLowerCase() < b.brand.toLowerCase() ? -1 : 1));
  const seen = new Set();
  for (const b of brands) {
    if (b.slug === '' || seen.has(b.slug)) throw new Error(`fit pages: brand slug "${b.slug}" is empty or used twice (${b.brand})`);
    seen.add(b.slug);
  }
  return brands;
}

// ---- HTML ----

function head({ title, description, canonical, jsonLd, fitNavCurrent = false }) {
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
  <link rel="preload" href="/fonts/plus-jakarta-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
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
        <a href="/fit/"${fitNavCurrent ? ' aria-current="page"' : ''}>Fit guides</a>
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
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
        <button type="button" data-consent-open>Privacy choices</button>
      </nav>
      <p class="footer-legal">&copy; <span data-year>2026</span> Pearfit. <a href="mailto:customerservice@pearfit.app">customerservice@pearfit.app</a></p>
      <p class="footer-note">Pearfit is not affiliated with, endorsed by or sponsored by the brands and stores named on this site. Their names belong to their owners and are used only to say which product a guide or list refers to.</p>
    </div>
  </footer>

  <script src="/consent.js"></script>
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
  const several = page.listings > 1 ? ' The store lists this product under several codes: the chart is from one of them, and the review shares above combine them.' : '';
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
        <p class="try-foot">Chest is pit to pit with the garment laid flat, which is half the measurement around. “unknown” means Pearfit has no number it trusts for that cell; it is not filled in.${several}</p>`;
}

/** One product's page. `related` is the other pages of the same brand, already cut to RELATED_SHOWN; `brand` is that brand's own page (selectBrands), or null when it has none; `similar` is similarGuides(). */
export function renderProductPage(page, related, exportedOn, brand = null, similar = []) {
  const name = fullName(page);
  const verdict = fitVerdict(page.reviews);
  const { total, runsSmallPct, trueToSizePct, runsLargePct } = page.reviews;
  const question = `Does the ${name} run small?`;
  const title = question.length + ' — Pearfit'.length <= 65 ? `${question} — Pearfit` : question;
  const counted = `${trueToSizePct}% of its ${reviewCount(total)} are counted as true to size, ${runsSmallPct}% as runs small and ${runsLargePct}% as runs large.`;
  const description = [`${verdict.label}: ${counted}`, counted].find((d) => d.length <= 160) ?? counted;
  const canonical = pageUrl(page);
  const inApp = APP_GARMENT_TYPES.includes(page.garmentType) && hasChart(page);
  const appHref = inApp ? `/app/#/check/${encodeURIComponent(page.candidateId)}` : '/app';
  const read = page.listings > 1 ? `across ${page.listings} listings of this product` : 'of this product';
  const brandCrumb = brand ? ` <span aria-hidden="true">›</span> <a href="/fit/brands/${brand.slug}.html">${esc(brand.brand)}</a>` : '';

  return `${head({
    title,
    description,
    canonical,
    jsonLd: crumbs([
      ['Pearfit', `${ORIGIN}/`],
      ['Fit guides', `${ORIGIN}/fit/`],
      ...(brand ? [[brand.brand, brandUrl(brand)]] : []),
      [name, canonical],
    ]),
  })}
  <main id="main" tabindex="-1">
    <section class="section fit-intro">
      <div class="wrap narrow-wrap">
        <nav class="fit-crumbs" aria-label="Breadcrumb"><a href="/">Pearfit</a> <span aria-hidden="true">›</span> <a href="/fit/">Fit guides</a>${brandCrumb}</nav>
        <span class="kicker">Fit guide · ${esc(page.brand)}</span>
        <h1>${esc(question)}</h1>
        <p class="fit-answer">${esc(verdict.answer)}</p>
        <p>Pearfit read ${reviewCount(total)} ${read}. ${trueToSizePct}% were counted as true to size, ${runsSmallPct}% as runs small and ${runsLargePct}% as runs large. A review is counted as true to size when it does not say the fit is small or large.${total < SMALL_SAMPLE ? ' That is a small sample, so read it as a hint.' : ''}</p>
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
        </ul>${brand ? `\n        <p class="fit-more"><a href="/fit/brands/${brand.slug}.html">All ${brand.pages.length} ${esc(brand.brand)} fit guides</a></p>` : ''}
      </div>
    </section>
`
    : ''
}${
  similar.length > 0
    ? `
    <section class="section section-alt" aria-labelledby="similar-heading">
      <div class="wrap narrow-wrap">
        <h2 id="similar-heading">${similarGroup(page).label} from other brands</h2>
        <ul class="fit-list">
${similar.map((other) => listItem(other, true)).join('\n')}
        </ul>
      </div>
    </section>
`
    : ''
}
    <section class="section section-rule">
      <div class="wrap narrow-wrap">
        <p class="muted">Numbers as of ${formatDate(exportedOn)}. The shares are of all the reviews Pearfit read, rounded to whole percents, and a review with no small or large comment is counted as true to size. <a href="${METHOD_PATH}">How these numbers are made</a> · <a href="/fit/">All fit guides</a></p>
      </div>
    </section>
  </main>
${FOOT}`;
}

function listItem(page, withBrand) {
  const label = withBrand ? fullName(page) : page.name;
  return `          <li><a href="/fit/${page.slug}.html"><span class="fit-list-name">${esc(label)}</span><span class="fit-list-meta">${esc(fitVerdict(page.reviews).label)} · ${reviewCount(page.reviews.total)}</span></a></li>`;
}

/** A guide in a "runs small / runs large" callout: the name, and the share that said so. */
function calloutItem(page, key, phrase) {
  return `          <li><a href="/fit/${page.slug}.html"><span class="fit-list-name">${esc(page.name)}</span><span class="fit-list-meta">${page.reviews[key]}% ${phrase} · ${reviewCount(page.reviews.total)}</span></a></li>`;
}

/**
 * One brand's page: the brand's answer from all its guides together, how its guides break down, the products where
 * reviewers lean small or large, and every guide by type of garment. `info` is one entry of selectBrands().
 */
export function renderBrandPage(info, exportedOn) {
  const { brand, pages } = info;
  const reviews = combineReviews(pages.map((p) => p.reviews));
  const verdict = fitVerdict(reviews);
  const question = `Does ${brand} run small?`;
  const title = [`${question} Fit guide for ${pages.length} products — Pearfit`, `${question} — Pearfit`, question].find((t) => t.length <= 65) ?? question;
  const detail = `${reviews.trueToSizePct}% of reviews are counted as true to size, ${reviews.runsSmallPct}% as runs small, ${reviews.runsLargePct}% as runs large. From ${reviewCount(reviews.total)}.`;
  const description = [`${verdict.label} across ${pages.length} ${brand} products: ${detail}`, `${pages.length} ${brand} products: ${detail}`].find((d) => d.length <= 160) ?? detail;
  const canonical = brandUrl(info);
  const shares = `${reviews.trueToSizePct}% of reviews are counted as true to size, ${reviews.runsSmallPct}% as runs small and ${reviews.runsLargePct}% as runs large`;

  const counts = new Map();
  for (const page of pages) counts.set(fitVerdict(page.reviews).label, (counts.get(fitVerdict(page.reviews).label) ?? 0) + 1);
  const breakdown = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  const callouts = [
    ['runsSmallPct', 'Products reviewers say run small', 'say it runs small'],
    ['runsLargePct', 'Products reviewers say run large', 'say it runs large'],
  ]
    .map(([key, heading, phrase]) => ({
      key,
      heading,
      phrase,
      items: pages
        .filter((p) => p.reviews.total >= SMALL_SAMPLE && p.reviews[key] >= BRAND_CALLOUT_PCT)
        .sort((a, b) => b.reviews[key] - a.reviews[key] || b.reviews.total - a.reviews.total || (a.slug < b.slug ? -1 : 1))
        .slice(0, BRAND_CALLOUTS_SHOWN),
    }))
    .filter((c) => c.items.length > 0);

  const typeOf = (p) => (p.garmentType in GARMENT_PLURAL ? p.garmentType : 'other');
  const types = Object.keys(GARMENT_PLURAL)
    .map((type) => [type, pages.filter((p) => typeOf(p) === type)])
    .filter(([, items]) => items.length > 0);

  return `${head({
    title,
    description,
    canonical,
    jsonLd: crumbs([
      ['Pearfit', `${ORIGIN}/`],
      ['Fit guides', `${ORIGIN}/fit/`],
      [brand, canonical],
    ]),
  })}
  <main id="main" tabindex="-1">
    <section class="section fit-intro">
      <div class="wrap narrow-wrap">
        <nav class="fit-crumbs" aria-label="Breadcrumb"><a href="/">Pearfit</a> <span aria-hidden="true">›</span> <a href="/fit/">Fit guides</a></nav>
        <span class="kicker">Brand fit guide</span>
        <h1>${esc(question)}</h1>
        <p class="fit-answer">${esc(verdict.answer)}</p>
        <p>Across the ${pages.length} ${esc(brand)} products Pearfit has guides for, ${shares}. Pearfit read ${reviewCount(reviews.total)} in all.</p>
        ${bars(reviews)}
        <h2>What size to get</h2>
        <p>${esc(verdict.advice)}</p>
        <p>A brand-wide answer hides differences between products, so check the guide for the product you are buying. Pearfit works out your size by comparing a garment’s measurements with shirts you already own, so the answer is about how it fits you.</p>
        <p><a class="btn" href="/app">Find your size with shirts you own</a></p>
      </div>
    </section>

    <section class="section section-alt" aria-labelledby="breakdown-heading">
      <div class="wrap narrow-wrap">
        <h2 id="breakdown-heading">How the ${pages.length} guides break down</h2>
        <ul class="fit-facts">
${breakdown.map(([label, n]) => `          <li>${esc(label)}: ${n} ${n === 1 ? 'guide' : 'guides'}</li>`).join('\n')}
        </ul>
${callouts
  .map(
    (c) => `        <h3>${c.heading}</h3>
        <p class="muted">At least ${BRAND_CALLOUT_PCT}% of reviewers ${c.phrase}, for products with at least ${SMALL_SAMPLE} reviews.</p>
        <ul class="fit-list">
${c.items.map((page) => calloutItem(page, c.key, c.phrase)).join('\n')}
        </ul>`,
  )
  .join('\n')}
      </div>
    </section>

    <section class="section" aria-labelledby="guides-heading">
      <div class="wrap narrow-wrap">
        <h2 id="guides-heading">${esc(brand)} fit guides by type</h2>
${types
  .map(([type, items]) => {
    const group = combineReviews(items.map((p) => p.reviews));
    const summary =
      items.length >= TYPE_SUMMARY_MIN
        ? `\n        <p class="muted">Across these ${items.length} guides: ${group.trueToSizePct}% of reviews are counted as true to size, ${group.runsSmallPct}% as runs small, ${group.runsLargePct}% as runs large (${reviewCount(group.total)}).</p>`
        : '';
    return `        <h3 class="fit-type">${GARMENT_PLURAL[type]}</h3>${summary}
        <ul class="fit-list">
${items.map((page) => listItem(page, false)).join('\n')}
        </ul>`;
  })
  .join('\n')}
      </div>
    </section>

    <section class="section section-rule">
      <div class="wrap narrow-wrap">
        <p class="muted">Numbers as of ${formatDate(exportedOn)}. A brand’s shares combine its guides, weighted by how many reviews each has, and are rounded to whole percents. A review with no small or large comment is counted as true to size. The type of garment is read from the product name. <a href="${METHOD_PATH}">How these numbers are made</a> · <a href="/fit/">All fit guides</a></p>
      </div>
    </section>
  </main>
${FOOT}`;
}

/** fit/index.html: every page, under its brand. A brand with a page of its own shows its most reviewed guides, then a link. */
export function renderIndexPage(pages, brands, exportedOn) {
  const byBrand = new Map();
  for (const page of pages) byBrand.set(page.brand, [...(byBrand.get(page.brand) ?? []), page]);
  const own = new Map(brands.map((b) => [b.brand, b]));
  const title = 'Fit guides: does it run small? — Pearfit';
  const description = `How ${pages.length} products from ${byBrand.size} brands run, from the reviews Pearfit read: true to size, small or large, with size charts in centimetres.`;
  return `${head({
    title,
    description,
    canonical: `${ORIGIN}/fit/`,
    fitNavCurrent: true,
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
        <p class="muted narrow">Each guide gives the share of reviews that say true to size, runs small and runs large, and the size chart where Pearfit has one. A product needs at least ${MIN_REVIEWS} reviews to be listed. Numbers as of ${formatDate(exportedOn)}. <a href="${METHOD_PATH}">How these numbers are made</a>.</p>
      </div>
    </section>

    <section class="section section-alt">
      <div class="wrap">
${[...byBrand]
  .map(([brand, items]) => {
    const brandPage = own.get(brand);
    const shown = brandPage
      ? [...items].sort((a, b) => b.reviews.total - a.reviews.total || (a.slug < b.slug ? -1 : 1)).slice(0, INDEX_BRAND_SHOWN)
      : items;
    const more = brandPage
      ? `\n          <li><a href="/fit/brands/${brandPage.slug}.html"><span class="fit-list-name">All ${items.length} ${esc(brand)} fit guides</span><span class="fit-list-meta">Does ${esc(brand)} run small? ${esc(fitVerdict(combineReviews(items.map((p) => p.reviews))).label)}</span></a></li>`
      : '';
    return `        <h2 class="fit-brand" id="${slugify(brand)}">${esc(brand)}</h2>
        <ul class="fit-list fit-list-wide">
${shown.map((page) => listItem(page, false)).join('\n')}${more}
        </ul>`;
  })
  .join('\n')}
      </div>
    </section>
  </main>
${FOOT}`;
}

/**
 * fit/method.html: where the numbers come from and what they mean. The figures in it (counts, thresholds) are the
 * generator's own settings, so the page cannot drift from what the other pages do.
 */
export function renderMethodPage(pages, exportedOn) {
  const brands = new Set(pages.map((p) => p.brand)).size;
  const reviews = pages.reduce((sum, p) => sum + p.reviews.total, 0);
  const canonical = `${ORIGIN}${METHOD_PATH}`;
  const title = 'How the fit numbers are made — Pearfit';
  const description = 'Where Pearfit’s fit guide numbers come from, how each review is counted, how the answers are chosen, and what the numbers cannot tell you.';
  return `${head({
    title,
    description,
    canonical,
    jsonLd: crumbs([
      ['Pearfit', `${ORIGIN}/`],
      ['Fit guides', `${ORIGIN}/fit/`],
      ['How the fit numbers are made', canonical],
    ]),
  })}
  <main id="main" tabindex="-1">
    <section class="section fit-intro">
      <div class="wrap narrow-wrap">
        <nav class="fit-crumbs" aria-label="Breadcrumb"><a href="/">Pearfit</a> <span aria-hidden="true">›</span> <a href="/fit/">Fit guides</a></nav>
        <span class="kicker">Fit guides</span>
        <h1>How the fit numbers are made</h1>
        <p class="fit-answer">Every number in a fit guide is a count from real reviews or a size chart, and this page says how each is made and where it falls short.</p>
        <p>Today that is ${pages.length} guides from ${brands} ${brands === 1 ? 'brand' : 'brands'}, built from ${reviewCount(reviews)}, as of ${formatDate(exportedOn)}.</p>

        <h2>Where the numbers come from</h2>
        <p>Pearfit’s scraper opens the public product page of a store, reads the reviews and the size chart shown there, and keeps numbers. It reads up to about 300 reviews of a product, newest first where the store offers that sort, so a product with more reviews than that is sampled. The stores it can read are on the <a href="/stores.html">supported stores</a> page, with how many reviews were read against the total each store states. A store that refuses automated requests is left out, and the scraper does not work around it.</p>
        <p>The guides show numbers only. No review text, reviewer name or store link is published.</p>

        <h2>How a review is counted</h2>
        <p>Each review is counted as one of three things, by fixed rules in code and not by a language model. The rules look for phrases such as “runs small”, “too tight” or “size up”, for “runs large”, “too big”, “size down” or “bigger than expected”, and for the store’s own fit answer when its review form asks one, such as “a bit small”. The rules are written for English.</p>
        <p><strong>A review with no such phrase, including one that never mentions fit, is counted as true to size.</strong> So the true to size share is the share of reviews that do not call the fit small or large. It is not the share that say “true to size”.</p>
        <p>That makes the runs small and runs large shares the more telling numbers, because they only count reviews that said so. A high true to size share on a product that few reviews comment on is weak evidence that it is true to size.</p>

        <h2>How the answer is chosen</h2>
        <p>The one-line answer comes from the three shares by fixed rules, which are the same on every page:</p>
        <ul class="fit-facts">
          <li>True to size at ${CLEAR_TRUE_TO_SIZE_PCT}% or more is “true to size”.</li>
          <li>True to size ahead of the other two but below ${CLEAR_TRUE_TO_SIZE_PCT}% is “mostly true to size”, leaning small or large when one of those is at least ${LEAN_MARGIN_PCT} points ahead of the other.</li>
          <li>Runs small (or runs large) ahead of the others is “runs small” at ${CLEAR_RUNS_PCT}% or more, and “leans small” below that.</li>
          <li>A tie for the lead is “split”.</li>
        </ul>
        <p>The advice under the answer, such as taking the larger size when between two, is picked from the same rules. Shares are rounded to whole percents.</p>

        <h2>How listings are combined</h2>
        <p>A store can list one product under several codes, for example one per colour or season. Pearfit gives such a product one guide. Listings with identical review numbers are the same reviews and count once. Different ones are pooled, weighted by how many reviews each has, and the page says how many listings it combines. A guide needs at least ${MIN_REVIEWS} reviews after pooling, and a brand page needs at least ${MIN_BRAND_GUIDES} guides. Brand and garment-type figures pool their guides the same way. The type of garment is read from the product name, so a few are in the wrong group.</p>

        <h2>Size charts</h2>
        <p>Charts are in centimetres with the garment laid flat. Chest is pit to pit, which is half the measurement around, and it is the measurement Pearfit trusts across brands. Length and sleeve are measured from different points by different brands, so they are shown only when Pearfit has worked out how that brand’s chart differs from a ruler. Otherwise the cell says “unknown”. A number is never filled in, and a product with no chart says so.</p>

        <h2>What the numbers cannot tell you</h2>
        <ul class="fit-facts">
          <li>Reviews come from people who chose to write one, and they describe how a garment fit them, not you.</li>
          <li>The rules read phrases, so an unusual wording can be counted wrongly, and a review in another language is counted as true to size.</li>
          <li>A product can change between seasons or colours and keep its name. A guide reflects the reviews Pearfit read, as of the date shown.</li>
          <li>The guides do not know your measurements. Pearfit’s <a href="/app">size check</a> answers for you by comparing a garment with shirts you already own.</li>
        </ul>

        <h2>Freshness and corrections</h2>
        <p>The guides are rebuilt from a snapshot of the fit store taken on ${formatDate(exportedOn)}, and the snapshot is refreshed when Pearfit reads more products. If a guide looks wrong, tell us at <a href="mailto:customerservice@pearfit.app">customerservice@pearfit.app</a> and name the product.</p>
        <p><a class="btn" href="/fit/">See the fit guides</a></p>
      </div>
    </section>
  </main>
${FOOT}`;
}

/**
 * The block of fit guide links on the home page, between the markers in index.html: a link to each of the biggest
 * brand pages, then the most reviewed guides (at most HOME_GUIDES_PER_BRAND per brand, so one brand does not fill it).
 */
export function renderHomeBlock(pages, brands) {
  const guides = [];
  const perBrand = new Map();
  for (const page of [...pages].sort((a, b) => b.reviews.total - a.reviews.total || (a.slug < b.slug ? -1 : 1))) {
    if (guides.length >= HOME_GUIDES_SHOWN) break;
    if ((perBrand.get(page.brand) ?? 0) >= HOME_GUIDES_PER_BRAND) continue;
    perBrand.set(page.brand, (perBrand.get(page.brand) ?? 0) + 1);
    guides.push(page);
  }
  const brandItems = [...brands]
    .sort((a, b) => b.pages.length - a.pages.length || (a.brand < b.brand ? -1 : 1))
    .slice(0, HOME_BRANDS_SHOWN)
    .map((b) => `          <li><a href="/fit/brands/${b.slug}.html"><span class="fit-list-name">Does ${esc(b.brand)} run small?</span><span class="fit-list-meta">${esc(fitVerdict(combineReviews(b.pages.map((p) => p.reviews))).label)} · ${b.pages.length} guides</span></a></li>`);
  const guideItems = guides.map((page) => listItem(page, true));
  return `${HOME_START}
    <section id="fit-guides" class="section section-alt" aria-labelledby="fit-guides-heading">
      <div class="wrap">
        <h2 id="fit-guides-heading">Does it run small? Check before you buy.</h2>
        <p class="muted narrow">Fit guides built from the reviews Pearfit read: how each product runs, and its size chart where there is one. <a href="${METHOD_PATH}">How the numbers are made</a>.</p>
        <ul class="fit-list fit-list-wide">
${[...brandItems, ...guideItems].join('\n')}
        </ul>
        <p class="fit-more"><a class="btn btn-ghost" href="/fit/">See all ${pages.length} fit guides</a></p>
      </div>
    </section>
    ${HOME_END}`;
}

/** Puts `block` (which carries its own markers) into the home page in place of what is between the markers now. */
export function spliceHome(html, block) {
  const start = html.indexOf(HOME_START);
  const end = html.indexOf(HOME_END);
  if (start === -1 || end === -1 || end < start) throw new Error('website/index.html is missing the fit-guides start and end markers');
  return html.slice(0, start) + block + html.slice(end + HOME_END.length);
}

/** sitemap.xml for the whole site: the hand-written pages, then the fit guides with the snapshot's date. */
export function renderSitemap(pages, brands, exportedOn) {
  const entry = (loc, lastmod) => `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  const urls = [
    ...STATIC_PAGES.map((p) => entry(`${ORIGIN}${p}`)),
    entry(`${ORIGIN}/fit/`, exportedOn),
    entry(`${ORIGIN}${METHOD_PATH}`, exportedOn),
    ...brands.map((b) => entry(brandUrl(b), exportedOn)),
    ...pages.map((page) => entry(pageUrl(page), exportedOn)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/**
 * Every file this script owns, as { path relative to website/: contents }. Pass the current home page to include it
 * (only the block between its markers changes).
 */
export function buildFiles(catalog, homeHtml) {
  const pages = selectPages(catalog);
  const brands = selectBrands(pages);
  const own = new Map(brands.map((b) => [b.brand, b]));
  const files = {
    'sitemap.xml': renderSitemap(pages, brands, catalog.exported_on),
    'fit/index.html': renderIndexPage(pages, brands, catalog.exported_on),
    'fit/method.html': renderMethodPage(pages, catalog.exported_on),
  };
  for (const b of brands) files[`fit/brands/${b.slug}.html`] = renderBrandPage(b, catalog.exported_on);
  for (const page of pages) {
    const related = pages
      .filter((other) => other.brand === page.brand && other.slug !== page.slug)
      .sort((a, b) => b.reviews.total - a.reviews.total || (a.slug < b.slug ? -1 : 1))
      .slice(0, RELATED_SHOWN);
    files[`fit/${page.slug}.html`] = renderProductPage(page, related, catalog.exported_on, own.get(page.brand) ?? null, similarGuides(page, pages));
  }
  if (homeHtml !== undefined) files['index.html'] = spliceHome(homeHtml, renderHomeBlock(pages, brands));
  return { pages, brands, files };
}

// ---- Command line ----

function existingFitFiles() {
  const list = (dir, prefix) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.html')).map((name) => `${prefix}${name}`) : []);
  return [...list(OUT_DIR, 'fit/'), ...list(BRAND_DIR, 'fit/brands/')];
}

function main() {
  const check = process.argv.includes('--check');
  const catalog = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const { pages, brands, files } = buildFiles(catalog, readFileSync(HOME, 'utf8'));
  const extra = existingFitFiles().filter((file) => !(file in files));
  const stale = Object.entries(files)
    .filter(([file, contents]) => !existsSync(path.join(SITE, file)) || readFileSync(path.join(SITE, file), 'utf8') !== contents)
    .map(([file]) => file);

  if (check) {
    if (stale.length === 0 && extra.length === 0) return console.log(`Fit pages are up to date (${pages.length} guides, ${brands.length} brand pages).`);
    console.error(`Fit pages are stale: ${stale.length} to rewrite, ${extra.length} to remove. Run: node website/scripts/build-fit-pages.mjs`);
    process.exit(1);
  }

  for (const file of extra) rmSync(path.join(SITE, file));
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(SITE, file)), { recursive: true });
    writeFileSync(path.join(SITE, file), contents);
  }
  console.log(`Wrote ${pages.length} fit guides, ${brands.length} brand pages, fit/index.html, sitemap.xml and the home page block (${extra.length} old pages removed).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
