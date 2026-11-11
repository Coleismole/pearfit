// Finding one real product page per store: from a Shopify product feed, or from the sitemap, with a check
// that the page is a product and not a category, promo, cart, account or blog page.
// The classifiers are pure; the fetching is in discoverDomain, which takes its fetch function as a parameter.
import * as cheerio from 'cheerio';
import zlib from 'node:zlib';

// ---- addresses ----

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

/** The registrable domain: "uniqlo.com" for "www.uniqlo.com", "collectif.co.uk" for "www.collectif.co.uk". */
export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) || clean.includes(':') || !clean.includes('.')) return clean;
  const parts = clean.split('.');
  const last = parts.at(-1)!;
  const second = parts.at(-2)!;
  if (last.length === 2 && SECOND_LEVEL.has(second) && parts.length >= 3) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

/** Whether a URL is on the store's own site (the same registrable domain). */
export function sameSite(storeDomain: string, url: string): boolean {
  try {
    return registrableDomain(new URL(url).hostname) === registrableDomain(storeDomain.replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!);
  } catch {
    return false;
  }
}

export type RejectReason = 'foreign-host' | 'not-http' | 'file' | 'home' | 'cart' | 'account' | 'blog' | 'category' | 'promo' | 'search';

export type UrlVerdict = { kind: 'rejected'; reason: RejectReason } | { kind: 'product-shaped' } | { kind: 'neutral' };

const CART_SEGMENTS = new Set(['cart', 'basket', 'bag', 'checkout', 'wishlist', 'wish-list', 'favorites', 'favourites']);
const ACCOUNT_SEGMENTS = new Set([
  'account', 'accounts', 'my-account', 'login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'orders', 'order-status',
  'customer', 'customers', 'profile', 'password', 'track-order', 'track-my-order',
]);
const BLOG_SEGMENTS = new Set([
  'blog', 'blogs', 'news', 'journal', 'stories', 'story', 'article', 'articles', 'press', 'about', 'about-us', 'contact', 'contact-us', 'help', 'faq',
  'faqs', 'support', 'store-locator', 'stores', 'pages', 'page', 'policies', 'policy', 'terms', 'privacy', 'careers', 'jobs', 'sustainability',
  'size-guide', 'size-chart', 'sizing', 'returns', 'shipping', 'gift-card', 'gift-cards', 'giftcard', 'giftcards', 'lookbook', 'lookbooks', 'sitemap',
]);
const CATEGORY_SEGMENTS = new Set([
  'category', 'categories', 'collection', 'collections', 'brands', 'brand', 'new-arrivals', 'new-arrival', 'new-in', 'whats-new', 'best-sellers',
  'bestsellers', 'best-seller', 'all-products', 'c', 'cat', 'cats', 'plp', 'department', 'departments', 'sale', 'clearance', 'outlet',
  'view-all', 'see-all', 'catalog-search',
]);
/** "shop-by-brand", "shop-all-brands", "featured", "featured-brands", "leading-lady-brands": listing words with a tail. */
const CATEGORY_SEGMENT_PATTERN = /^(shop-(all|by)(-.+)?|featured(-.+)?|.+-brands?|all-.+)$/;
const PRODUCT_QUERY_KEYS = new Set(['pid', 'productid', 'product_id', 'prodid', 'itemid', 'item_id', 'pdpid', 'styleid', 'style_id', 'sku']);
const SEARCH_SEGMENTS = new Set(['search', 'catalogsearch', 'results', 'find']);
const PRODUCT_SEGMENTS = new Set(['product', 'products', 'p', 'pd', 'pdp', 'item', 'items', 'dp', 'prd', 'productpage', 'prod']);
const PROMO_WORDS = /(^|-)(promo|promos|promotion|promotions|coupon|coupons|voucher|vouchers|credit|creditbox|threshold|calendar|campaign|giveaway|sweepstakes|flash-?sale|daily-?deals?|deals|offers?|rewards?|loyalty|referral|earn|cashback|bogo|doorbuster|black-?friday|cyber-?monday)(-|$)/i;
const FILE_EXTENSION = /\.(?:jpe?g|png|gif|webp|svg|pdf|xml|json|txt|css|js|mp4|zip)$/i;

/**
 * What the address alone says. A product marker segment (/products/x, /p/x, /pd/x), a "-p-123" slug, a long
 * numeric id or a style code makes it product-shaped; a cart, account, blog, category, promo or search word
 * rejects it. Everything else is neutral and needs a signal from the page.
 */
export function classifyUrl(url: string, storeDomain: string): UrlVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'rejected', reason: 'not-http' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'rejected', reason: 'not-http' };
  if (!sameSite(storeDomain, url)) return { kind: 'rejected', reason: 'foreign-host' };
  const path = decodeURIComponent(parsed.pathname).toLowerCase();
  if (FILE_EXTENSION.test(path)) return { kind: 'rejected', reason: 'file' };
  // Locale prefixes (/us/en/, /en_us/, /ca/fr/) are not part of the page's meaning.
  const segments = path.split('/').filter(Boolean).filter((s) => !/^(?:[a-z]{2}(?:[-_][a-z]{2})?)$/.test(s));
  if (segments.length === 0) return { kind: 'rejected', reason: 'home' };

  const markerAt = segments.findIndex((s) => PRODUCT_SEGMENTS.has(s));
  const hasProductMarker = markerAt >= 0 && markerAt < segments.length - 1;
  const last = segments.at(-1)!.replace(/\.html?$/, '');

  for (const segment of segments) {
    if (CART_SEGMENTS.has(segment)) return { kind: 'rejected', reason: 'cart' };
    if (ACCOUNT_SEGMENTS.has(segment)) return { kind: 'rejected', reason: 'account' };
    if (SEARCH_SEGMENTS.has(segment)) return { kind: 'rejected', reason: 'search' };
  }
  // /collections/shirts/products/blue-shirt is a product; /collections/shirts is a category.
  if (!hasProductMarker) {
    for (const segment of segments) {
      if (BLOG_SEGMENTS.has(segment)) return { kind: 'rejected', reason: 'blog' };
      if (CATEGORY_SEGMENTS.has(segment) || CATEGORY_SEGMENT_PATTERN.test(segment)) return { kind: 'rejected', reason: 'category' };
    }
  } else {
    for (const segment of segments.slice(0, markerAt)) {
      if (BLOG_SEGMENTS.has(segment)) return { kind: 'rejected', reason: 'blog' };
    }
  }
  if (PROMO_WORDS.test(last) || segments.slice(0, -1).some((s) => PROMO_WORDS.test(s))) return { kind: 'rejected', reason: 'promo' };

  if (hasProductMarker) return { kind: 'product-shaped' };
  // Gap-style /browse/product.do?pid=123 and other addresses that carry the product in a query parameter.
  if (/^(product|productdetail|productdisplay|pdp|item)(\.(do|jsp|aspx?|html?|php))?$/.test(last)) return { kind: 'product-shaped' };
  for (const key of parsed.searchParams.keys()) {
    if (PRODUCT_QUERY_KEYS.has(key.toLowerCase())) return { kind: 'product-shaped' };
  }
  if (/-p-\d{3,}/.test(last) || /(^|[-_/])p\d{5,}($|[-_])/.test(last)) return { kind: 'product-shaped' };
  if (/^\d{5,}$/.test(last) || /[-_]\d{6,}$/.test(last)) return { kind: 'product-shaped' };
  // A style code ("SUD50BLK", "E450179", "mn1234") or a bare number of four digits or more ("-0292"), but not a year.
  const tokens = last.split(/[-_]/);
  if (tokens.some((t) => /^(?=.*[a-z])(?=.*\d)[a-z0-9]{5,}$/i.test(t))) return { kind: 'product-shaped' };
  const tail = tokens.at(-1) ?? '';
  if (segments.length >= 2 && /^\d{4,}$/.test(tail) && !/^(19|20)\d{2}$/.test(tail)) return { kind: 'product-shaped' };
  const parent = segments.at(-2) ?? '';
  if (segments.length >= 2 && /^(?=.*[a-z])(?=.*\d)[a-z0-9]{5,}$/i.test(parent)) return { kind: 'product-shaped' };
  return { kind: 'neutral' };
}

// ---- the page ----

export interface PageSignals {
  /** JSON-LD with a Product or ProductGroup at its top level. */
  jsonLdProduct: boolean;
  /** og:type is product. */
  ogProduct: boolean;
  /** One to four add-to-cart controls. More than that is a listing's quick-add buttons. */
  addToCart: boolean;
  /** Evidence that this is a listing, not a product, with its reasons. */
  listing: boolean;
  listingReasons: string[];
}

function typesOf(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const type = (node as Record<string, unknown>)['@type'];
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  return [];
}

/** The nodes at the top of a JSON-LD block: the root, a root array's items, and the items of an @graph. */
function topNodes(json: unknown): unknown[] {
  if (Array.isArray(json)) return json.flatMap(topNodes);
  if (json && typeof json === 'object') {
    const graph = (json as Record<string, unknown>)['@graph'];
    return Array.isArray(graph) ? [json, ...graph] : [json];
  }
  return [];
}

const ADD_TO_CART_TEXT = /\b(add to (cart|bag|basket|trolley|my bag)|buy now|add to shopping bag)\b/i;
const ADD_TO_CART_ATTRIBUTES = [
  'form[action*="/cart/add"]',
  'form[action*="add-to-cart" i]',
  'form[action*="addtocart" i]',
  '[data-add-to-cart]',
  '[data-action="add-to-cart"]',
  'button[name="add"]',
  '[id*="add-to-cart" i]',
  '[id*="addtocart" i]',
  '[class*="add-to-cart" i]',
  '[class*="addtocart" i]',
  '[class*="add-to-bag" i]',
  '[class*="product-form__submit" i]',
].join(', ');

/** Product signals and listing evidence in a page's HTML. */
export function pageSignals(html: string, url: string, storeDomain: string): PageSignals {
  const $ = cheerio.load(html);
  const listingReasons: string[] = [];

  let jsonLdProduct = false;
  let jsonLdListing = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text().trim();
    if (!text) return;
    try {
      for (const node of topNodes(JSON.parse(text))) {
        const types = typesOf(node);
        if (types.includes('Product') || types.includes('ProductGroup')) jsonLdProduct = true;
        if (types.some((t) => ['ItemList', 'CollectionPage', 'SearchResultsPage', 'OfferCatalog'].includes(t))) jsonLdListing = true;
      }
    } catch {
      // not JSON: ignore the block
    }
  });
  if (jsonLdListing && !jsonLdProduct) listingReasons.push('JSON-LD says collection or list');

  const ogType = ($('meta[property="og:type"], meta[name="og:type"]').first().attr('content') ?? '').toLowerCase();
  const ogProduct = /^(og:)?product(\.item)?$/.test(ogType) || ogType.startsWith('product:');

  let addToCartCount = 0;
  $(ADD_TO_CART_ATTRIBUTES).each(() => {
    addToCartCount++;
  });
  if (addToCartCount === 0) {
    $('button, input[type="submit"], input[type="button"], a[role="button"]').each((_, el) => {
      const label = (el.tagName === 'input' ? $(el).attr('value') : $(el).text()) ?? '';
      if (ADD_TO_CART_TEXT.test(label.replace(/\s+/g, ' '))) addToCartCount++;
    });
  }
  const addToCart = addToCartCount >= 1 && addToCartCount <= 4;
  if (addToCartCount > 4 && !jsonLdProduct && !ogProduct) listingReasons.push(`${addToCartCount} add-to-cart buttons (quick add on a list)`);

  const pageType = ($('meta[name="pagetype"], meta[name="page-type"], meta[property="page-type"]').first().attr('content') ?? '').toLowerCase();
  if (/collection|category|search|listing|plp/.test(pageType)) listingReasons.push(`page type "${pageType}"`);
  const bodyClass = ($('body').attr('class') ?? '').toLowerCase();
  if (/\btemplate-(collection|search|list-collections)\b|\b(collection|category|plp|search-results)-page\b|\bpage-type-(category|collection|search)\b/.test(bodyClass)) {
    listingReasons.push('body class says collection or category');
  }
  if (/pageType["']?\s*[:=]\s*["'](collection|category|search)["']/i.test(html.slice(0, 400_000))) listingReasons.push('analytics page type is collection or category');
  if (ogType === 'website' && !jsonLdProduct) {
    let productLinks = 0;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      try {
        if (classifyUrl(new URL(href, url).href, storeDomain).kind === 'product-shaped') productLinks++;
      } catch {
        // not a URL
      }
    });
    if (productLinks >= 12) listingReasons.push(`og:type is website and the page links to ${productLinks} product pages`);
  }

  const listing = listingReasons.length > 0 && !jsonLdProduct && !ogProduct;
  return { jsonLdProduct, ogProduct, addToCart, listing, listingReasons };
}

export type Decision =
  | { accepted: true; signals: string[]; confidence: 'strong' | 'weak' }
  | { accepted: false; reason: string };

/**
 * Accepts a candidate only with a product signal and no sign of a listing: JSON-LD Product, og:type product,
 * an add-to-cart control, or (alone, "weak") a product-shaped address. A cart, account, blog, category, promo or
 * search address is refused whatever the page says.
 */
export function decideProduct(urlVerdict: UrlVerdict, page: PageSignals | null): Decision {
  if (urlVerdict.kind === 'rejected') return { accepted: false, reason: urlVerdict.reason };
  if (page?.listing) return { accepted: false, reason: `category page: ${page.listingReasons.join('; ')}` };
  const signals: string[] = [];
  if (page?.jsonLdProduct) signals.push('json-ld-product');
  if (page?.ogProduct) signals.push('og-type-product');
  if (page?.addToCart) signals.push('add-to-cart');
  if (signals.length > 0) return { accepted: true, signals: [...signals, ...(urlVerdict.kind === 'product-shaped' ? ['product-url'] : [])], confidence: 'strong' };
  if (urlVerdict.kind === 'product-shaped') return { accepted: true, signals: ['product-url'], confidence: 'weak' };
  return { accepted: false, reason: 'no product signal in the page or the address' };
}

// ---- robots.txt ----

export interface RobotsRules {
  disallow: string[];
  allow: string[];
  /** Seconds between requests, capped at 10. */
  crawlDelay: number;
  sitemaps: string[];
}

/** The rules for the `*` group (and the sitemaps listed anywhere). */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelay: 0, sitemaps: [] };
  let inStar = false;
  let groupHasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'sitemap') {
      if (value) rules.sitemaps.push(value);
    } else if (field === 'user-agent') {
      if (!groupHasAgent) inStar = false;
      groupHasAgent = true;
      if (value === '*') inStar = true;
    } else {
      groupHasAgent = false;
      if (!inStar) continue;
      if (field === 'disallow' && value) rules.disallow.push(value);
      else if (field === 'allow' && value) rules.allow.push(value);
      else if (field === 'crawl-delay') rules.crawlDelay = Math.min(10, Math.max(0, Number.parseFloat(value) || 0));
    }
  }
  return rules;
}

function robotsPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped.endsWith('\\$') ? escaped.slice(0, -2) + '$' : escaped}`);
}

/** The longest matching rule wins; Allow wins a tie. No rule means allowed. */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best = { length: -1, allow: true };
  const consider = (patterns: string[], allow: boolean) => {
    for (const pattern of patterns) {
      if (robotsPattern(pattern).test(pathAndQuery) && (pattern.length > best.length || (pattern.length === best.length && allow))) {
        best = { length: pattern.length, allow };
      }
    }
  };
  consider(rules.disallow, false);
  consider(rules.allow, true);
  return best.allow;
}

// ---- sitemaps and feeds ----

/** The addresses in a sitemap or sitemap index. */
export function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
}

export function isSitemapIndex(locs: string[]): boolean {
  return locs.length > 0 && locs.every((loc) => /\.xml(\.gz)?(\?|$)/i.test(loc));
}

export function gunzipIfNeeded(buffer: Buffer, url: string): Buffer {
  return url.endsWith('.gz') || (buffer[0] === 0x1f && buffer[1] === 0x8b) ? zlib.gunzipSync(buffer) : buffer;
}

const CLOTHES = /\b(tee|t-shirt|tshirt|shirt|polo|henley|tank|top|blouse|dress|skirt|jacket|coat|vest|hoodie|sweater|sweatshirt|pullover|cardigan|pant|pants|trouser|jean|denim|short|shorts|legging|jogger|bra|bodysuit|jumpsuit|romper|tunic|crew|long-sleeve|short-sleeve|flannel|overshirt|knit)s?\b/i;
const NOT_CLOTHES = /gift|card|sock|hat|cap\b|beanie|bag|tote|wallet|belt|candle|sticker|poster|mug|bottle|pin\b|keychain|mask|towel|blanket|pillow|sheet|bundle|set\b|kit\b|sample|swatch|insurance|warranty|shipping|donat|membership/i;

/** Words in a product's name or address that say it is a garment, and not an accessory or a bundle. */
export function looksLikeGarment(text: string): boolean {
  const words = text.replace(/[-_/+]/g, ' ');
  return CLOTHES.test(words) && !NOT_CLOTHES.test(words);
}

interface ShopifyProduct {
  title?: string;
  handle?: string;
  product_type?: string;
  variants?: { available?: boolean }[];
}

/** Garments in stock from a Shopify products.json feed. */
export function shopifyPicks(feed: unknown, origin: string, limit: number): { urls: string[]; total: number } | null {
  const products = (feed as { products?: ShopifyProduct[] } | null)?.products;
  if (!Array.isArray(products) || products.length === 0) return null;
  const picks = products.filter(
    (p) => p.handle && looksLikeGarment(`${p.title ?? ''} ${p.handle} ${p.product_type ?? ''}`) && (p.variants ?? []).some((v) => v.available !== false),
  );
  return { urls: picks.slice(0, limit).map((p) => `${origin}/products/${p.handle}`), total: products.length };
}

/** n addresses spread evenly through the list, first one included. */
export function pickSpread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]!);
}

// ---- discovering ----

export interface DiscoverOptions {
  fetch: (url: string, init?: { accept?: string }) => Promise<{ status: number; ok: boolean; url: string; buffer: () => Promise<Buffer> }>;
  /** How many accepted product addresses to return. */
  want?: number;
  /** How many candidate pages to look at before giving up. */
  maxCandidates?: number;
  /** Milliseconds to wait between requests to this store (the larger of this and the robots Crawl-delay). */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Use this instead of https://<domain> as the store's origin (for tests). */
  origin?: string;
}

export interface Candidate {
  url: string;
  /** Where the address ended up after redirects, when that differs from `url`. */
  finalUrl?: string;
  accepted: boolean;
  signals: string[];
  confidence: 'strong' | 'weak' | null;
  reason: string | null;
}

export interface DiscoveredStore {
  domain: string;
  kind: 'shopify' | 'sitemap' | 'none';
  origin: string;
  /** The accepted product addresses (the form the scrape batches read). */
  urls: string[];
  total: number;
  accepted: Candidate[];
  rejected: Candidate[];
  /** Why nothing was found, when nothing was. */
  note: string | null;
}

function isRefusalStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 401 || status === 418 || status === 503;
}

/**
 * One store: a Shopify feed if it has one, else its sitemap. Every sitemap candidate is judged on its address
 * and its page; a 403 or 429 from the store ends the visit (no retry, no other route).
 */
export async function discoverDomain(domain: string, options: DiscoverOptions): Promise<DiscoveredStore> {
  const want = options.want ?? 3;
  const maxCandidates = options.maxCandidates ?? 9;
  const origin = options.origin ?? `https://${domain}`;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const result: DiscoveredStore = { domain, kind: 'none', origin, urls: [], total: 0, accepted: [], rejected: [], note: null };
  let refused = false;
  let delayMs = options.delayMs ?? 0;
  let lastRequest = Number.NEGATIVE_INFINITY;

  const get = async (url: string, accept?: string) => {
    const wait = lastRequest + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const response = await options.fetch(url, accept ? { accept } : undefined);
      if (isRefusalStatus(response.status)) refused = true;
      return response;
    } catch {
      return null;
    }
  };

  // robots.txt: the rules for everyone, the delay, the sitemaps.
  let rules: RobotsRules = { disallow: [], allow: [], crawlDelay: 0, sitemaps: [] };
  const robots = await get(`${origin}/robots.txt`);
  if (robots?.ok) {
    rules = parseRobots((await robots.buffer()).toString('utf8'));
    delayMs = Math.max(delayMs, rules.crawlDelay * 1000);
  }
  if (refused) return { ...result, note: 'the store refuses automated requests (robots.txt): not visited further' };
  const allowed = (url: string) => {
    try {
      const parsed = new URL(url);
      return robotsAllows(rules, `${parsed.pathname}${parsed.search}`);
    } catch {
      return false;
    }
  };

  // Shopify feed.
  for (const feedPath of ['/collections/all/products.json?sort_by=best-selling&limit=80', '/products.json?limit=250']) {
    if (!allowed(`${origin}${feedPath}`)) continue;
    const response = await get(`${origin}${feedPath}`, 'application/json');
    if (refused) return { ...result, note: `the store refuses automated requests (HTTP ${response?.status}): not visited further` };
    if (!response?.ok) continue;
    let feed: unknown = null;
    try {
      feed = JSON.parse((await response.buffer()).toString('utf8'));
    } catch {
      continue;
    }
    const picks = shopifyPicks(feed, new URL(response.url).origin, want);
    if (picks && picks.urls.length > 0) {
      return {
        ...result,
        kind: 'shopify',
        origin: new URL(response.url).origin,
        urls: picks.urls,
        total: picks.total,
        accepted: picks.urls.map((url) => ({ url, accepted: true, signals: ['shopify-feed'], confidence: 'strong' as const, reason: null })),
      };
    }
  }

  // Sitemap.
  const sitemapRoots = rules.sitemaps.length > 0 ? rules.sitemaps : [`${origin}/sitemap.xml`];
  const queue = sitemapRoots.slice(0, 4);
  const urls: string[] = [];
  let fetched = 0;
  while (queue.length > 0 && fetched < 6 && urls.length < 4000) {
    const sitemapUrl = queue.shift()!;
    fetched++;
    const response = await get(sitemapUrl);
    if (refused) return { ...result, note: `the store refuses automated requests (HTTP ${response?.status}): not visited further` };
    if (!response?.ok) continue;
    let locs: string[] = [];
    try {
      locs = extractLocs(gunzipIfNeeded(await response.buffer(), sitemapUrl).toString('utf8'));
    } catch {
      continue;
    }
    if (isSitemapIndex(locs)) {
      // Match on whole words of the file name: "sitemap" itself contains "item".
      const productMaps = locs.filter((loc) => /(^|[^a-z])(products?|items?|pdp|catalog|skus?|clothing|apparel)([^a-z]|$)/i.test(loc.split('/').pop() ?? ''));
      queue.unshift(...(productMaps.length > 0 ? productMaps : locs).slice(0, 3));
    } else {
      urls.push(...locs);
    }
  }
  if (urls.length === 0) return { ...result, note: 'no sitemap with addresses' };

  // Address-level filter first (no request), then the page check on a spread of what is left.
  const rejectedByUrl = new Map<string, number>();
  const candidates: string[] = [];
  for (const url of urls) {
    const verdict = classifyUrl(url, domain);
    if (verdict.kind === 'rejected') {
      rejectedByUrl.set(verdict.reason, (rejectedByUrl.get(verdict.reason) ?? 0) + 1);
      continue;
    }
    if (!looksLikeGarment(decodeURIComponent(new URL(url).pathname))) continue;
    candidates.push(url);
  }
  result.total = candidates.length;
  const note = [...rejectedByUrl].map(([reason, count]) => `${count} ${reason}`).join(', ');
  if (candidates.length === 0) return { ...result, kind: 'sitemap', note: `no garment product address in ${urls.length} sitemap addresses${note ? ` (rejected: ${note})` : ''}` };

  result.kind = 'sitemap';
  for (const url of pickSpread(candidates, maxCandidates)) {
    if (result.accepted.length >= want) break;
    if (!allowed(url)) {
      result.rejected.push({ url, accepted: false, signals: [], confidence: null, reason: 'robots.txt disallows this address' });
      continue;
    }
    const response = await get(url);
    if (refused) return { ...result, urls: result.accepted.map((c) => c.url), note: `the store refuses automated requests (HTTP ${response?.status}): stopped` };
    let page: PageSignals | null = null;
    if (!response || !response.ok) {
      result.rejected.push({ url, accepted: false, signals: [], confidence: null, reason: `page answered HTTP ${response?.status ?? 'no answer'}` });
      continue;
    }
    const finalUrl = response.url || url;
    // A redirect to another site, or to a path that is not a product, is not this product.
    if (!sameSite(domain, finalUrl)) {
      result.rejected.push({ url, accepted: false, signals: [], confidence: null, reason: `redirects to another site (${new URL(finalUrl).hostname})` });
      continue;
    }
    page = pageSignals((await response.buffer()).toString('utf8'), finalUrl, domain);
    const verdict = classifyUrl(finalUrl, domain);
    const decision = decideProduct(verdict, page);
    if (decision.accepted) {
      result.accepted.push({ url, ...(finalUrl !== url ? { finalUrl } : {}), accepted: true, signals: decision.signals, confidence: decision.confidence, reason: null });
    }
    else result.rejected.push({ url, accepted: false, signals: [], confidence: null, reason: decision.reason });
  }
  result.urls = result.accepted.map((c) => c.url);
  if (result.urls.length === 0) result.note = `${result.rejected.length} candidate pages looked at, none was a product page`;
  return result;
}
