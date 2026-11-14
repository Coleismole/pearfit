/** Turning one page of HTML into a product (name, brand, sku, price) and its reviews. */
import * as cheerio from 'cheerio';
import {
  parseRawReviewBatch,
  type ProductFitReport,
  type RawScrapedReview,
  type ScraperTelemetry,
} from '../fitAnalyzer.ts';
import { extractStructuredProduct, parseJsonLdScripts } from '../structuredData.ts';
import type { CapturedJson } from '../headlessFetch.ts';
import { collectJsonReviews, parseJsonBody, type JsonSource } from '../reviewJson.ts';
import { cleanProductTitle, productIdFromUrl, uniqloProductCode, decodeHtmlEntities } from '../pageHelpers.ts';
import { mergeScrapedReviews } from './reviewMerge.ts';
import { readDomReviewCards } from './domReviews.ts';

/** Stable short hash so the same URL always gets the same fallback SKU. */
function stableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase();
}

const VALID_CATEGORIES: ProductFitReport['category'][] = [
  'T-Shirts & Tops',
  'Outerwear',
  'Knitwear',
  'Trousers',
  'Fleece & Hoodies',
  'Shirting',
  'Dresses',
];

/** The commercial_skus.category value Supabase uses for t-shirts. */
export const TEE_CATEGORY = 'T-Shirts & Tops' as const;

const TEE_NAME = /\bt[\s-]?shirts?\b|\btees?\b/i;
const NOT_A_NAMED_TEE = /\b(hoodies?|sweatshirts?|jackets?|coats?|parkas?|pants|trousers|dresses|shorts)\b/i;

/**
 * Maps a free-text category or product name onto the fixed list stored in Supabase.
 * The product name is the last hint. A name that is a t-shirt stays in the t-shirt category
 * when an earlier hint is a mixed department ("T-Shirts, Sweats & Fleece").
 * "short-sleeve" is not shorts: the trousers rule ignores short when it introduces a sleeve.
 */
export function inferCategory(...hints: (string | null | undefined)[]): ProductFitReport['category'] {
  const name = hints.filter((hint): hint is string => Boolean(hint)).at(-1);
  if (name && TEE_NAME.test(name) && !NOT_A_NAMED_TEE.test(name)) return TEE_CATEGORY;
  for (const hint of hints) {
    if (!hint) continue;
    const exact = VALID_CATEGORIES.find((c) => c.toLowerCase() === hint.toLowerCase());
    if (exact) return exact;
    const h = hint.toLowerCase();
    if (/hoodie|sweatshirt|fleece|crewneck sweat/.test(h)) return 'Fleece & Hoodies';
    if (/jacket|coat|parka|puffer|blazer|outerwear|anorak|vest/.test(h)) return 'Outerwear';
    if (/sweater|knit|cardigan|jumper|pullover/.test(h)) return 'Knitwear';
    if (/\btrousers?\b|\bpants?\b|\bjeans?\b|\bchinos?\b|\bshorts?\b(?![\s-]*sleeve)|\bleggings?\b|\bjoggers?\b/.test(h)) return 'Trousers';
    if (/dress|skirt/.test(h)) return 'Dresses';
    if (/oxford|button[- ]?(down|up)|shirt(?!s? ?&)|flannel|overshirt/.test(h) && !/t-?shirt|tee/.test(h)) return 'Shirting';
    if (/t-?shirt|tee|tank|top|polo|henley/.test(h)) return TEE_CATEGORY;
  }
  return TEE_CATEGORY;
}

export function looksLikeFullHtmlDocument(input: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]/i.test(input.slice(0, 5000));
}

export function scrapeHtmlWithCheerio(
  html: string,
  sourceUrl: string,
  overrides?: {
    productName?: string;
    brand?: string;
    sku?: string;
    category?: ProductFitReport['category'];
  },
  jsonResponses: CapturedJson[] = [],
  /**
   * The product page, when the reviews were read on another page of the same product (Nike's
   * /t/<product>/reviews). Product details and ids come from it; reviews come from `html`.
   */
  productHtml: string | null = null,
  /**
   * The page source as the server sent it, when `html` is the rendered page. A rendered page can lose
   * the product ids that the source stated (framework state scripts); they still name this product.
   */
  sourceHtml: string | null = null,
) {
  const startTime = Date.now();
  const $ = cheerio.load(html);
  const $p = productHtml ? cheerio.load(productHtml) : $;
  const productPageHtml = productHtml ?? html;
  const domNodesScanned = $('*').length;
  const selectorsUsed: string[] = [];

  // 1. schema.org JSON-LD: the most reliable source on real storefronts.
  const jsonLdScripts = $p('script[type="application/ld+json"]')
    .map((_i, el) => $p(el).contents().text())
    .get();
  const structured = extractStructuredProduct(parseJsonLdScripts(jsonLdScripts));
  // On a separate review page, that page's own JSON-LD reviews count too.
  if (productHtml && structured) {
    const reviewPageLd = extractStructuredProduct(
      parseJsonLdScripts($('script[type="application/ld+json"]').map((_i, el) => $(el).contents().text()).get()),
    );
    if (reviewPageLd?.reviews.length) structured.reviews = mergeScrapedReviews(structured.reviews, reviewPageLd.reviews);
  }
  if (structured) selectorsUsed.push('script[type="application/ld+json"] Product');

  const meta = (selector: string) => $p(selector).attr('content')?.trim() || null;
  const firstText = (selector: string) => $p(selector).first().text().replace(/\s+/g, ' ').trim() || null;

  const extractedName =
    overrides?.productName ||
    (structured?.name ? decodeHtmlEntities(structured.name) : null) ||
    cleanProductTitle(meta('meta[property="og:title"]')) ||
    firstText('h1.product-title') ||
    cleanProductTitle($p('title').first().text()) ||
    firstText('h1') ||
    'Unknown product';

  const extractedBrand =
    overrides?.brand ||
    (structured?.brand ? decodeHtmlEntities(structured.brand) : null) ||
    meta('meta[name="product:brand"]') ||
    meta('meta[property="product:brand"]') ||
    meta('meta[property="og:site_name"]') ||
    firstText('.product-brand') ||
    // A single-brand store names itself; used only when nothing names the product's brand.
    structured?.organizationName ||
    'Unknown brand';

  const category =
    overrides?.category ||
    inferCategory(
      meta('meta[name="product:category"]'),
      meta('meta[property="product:category"]'),
      structured?.category,
      extractedName
    );

  const sku =
    overrides?.sku ||
    // uniqlo.com pages carry a colour/size variant id in their data (sometimes another article code), which
    // would save the product under a different SKU than the rows we already have. The URL's code is stable.
    uniqloProductCode(sourceUrl) ||
    structured?.sku ||
    meta('meta[name="product:sku"]') ||
    meta('meta[property="product:retailer_item_id"]') ||
    $p('[data-sku]').attr('data-sku') ||
    // No SKU on the page: derive a stable id from the URL so re-scrapes update the same row.
    productIdFromUrl(sourceUrl) ||
    // Shopify names its product in the analytics object: var meta = {"product":{"id":123,...
    shopifyProductId(productPageHtml) ||
    `URL-${stableHash(sourceUrl)}`;

  const priceAmount = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]');
  const priceCurrency = meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]');
  const price =
    structured?.price ||
    meta('meta[name="product:price"]') ||
    (priceAmount ? [priceAmount, priceCurrency].filter(Boolean).join(' ') : null) ||
    $p('[data-price]').attr('data-price') ||
    'Unknown';

  const fabricComposition =
    structured?.material ||
    meta('meta[name="product:fabric"]') ||
    $p('[data-fabric]').attr('data-fabric') ||
    'Unknown';

  // 2. Review cards in the DOM (microdata and common review-widget markup): see domReviews.ts.
  const { domReviews, completeDomCards } = readDomReviewCards($, selectorsUsed);

  // 3. Review JSON: what the page's review widget received while it rendered, and review data
  // embedded in the page (__NEXT_DATA__, application/json). Structured, so it comes first.
  const jsonSources: JsonSource[] = jsonResponses.map((r) => ({ url: r.url, value: parseJsonBody(r.body) }));
  $('script#__NEXT_DATA__, script[type="application/json"]').each((i, el) => {
    const raw = $(el).contents().text();
    if (raw.length > 0 && /review/i.test(raw)) {
      jsonSources.push({ url: `page:${$(el).attr('id') || `json-${i}`}`, value: parseJsonBody(raw) });
    }
  });
  // Judge.me writes the widget's first page into a hidden element's attribute, not a script.
  $('[data-jdgm-json]').each((i, el) => {
    const value = parseJsonBody($(el).attr('data-jdgm-json') ?? '');
    if (value !== null) jsonSources.push({ url: `page:jdgm-${i}`, value });
  });
  const fromJson = collectJsonReviews(
    jsonSources.filter((source) => source.value !== null),
    {
      keys: pageProductKeys($p, productPageHtml, sourceUrl, structured?.identifiers ?? [], sku, sourceHtml ?? ''),
      name: extractedName,
      knownIds: new Set(`${productPageHtml} ${sourceHtml ?? ''}`.match(/\d{9,}/g) ?? []),
    },
  );
  if (fromJson.reviews.length > 0) selectorsUsed.push(`review JSON (${fromJson.sources.join(', ')})`);
  const jsonReviews: RawScrapedReview[] = fromJson.reviews.map(({ productKeys: _k, productName: _n, ...review }) => review);

  // When the review widget's own data was read, only complete markup cards are added: a widget that
  // renders its first reviews in the page and loads the rest as JSON (Okendo) needs both, while a
  // "Was this review helpful?" line must not pass for a review. JSON-LD still merges with all cards.
  // Review data embedded in the page can be a single featured review; when the markup shows more
  // reviews than all the page data holds, the markup cards are the list.
  // Cards that read like reviews: complete, or a sentence of six words or more that is not a line the
  // widget repeats around reviews.
  const WIDGET_LINE = /was this (review )?helpful|write a review|report (this )?review|^[\w .'-]{1,30},$/i;
  const substantiveDom = domReviews.filter(
    (r, i) => completeDomCards.has(i) || (r.body.split(/\s+/).length >= 6 && !WIDGET_LINE.test(r.body)),
  );
  const onlyPageData = fromJson.sources.every((src) => src === 'page');
  const markupIsTheList = onlyPageData && substantiveDom.length > jsonReviews.length;
  const useDom = jsonReviews.length === 0 || markupIsTheList;
  const reviews = jsonReviews.length === 0
    ? mergeScrapedReviews(structured?.reviews ?? [], domReviews)
    : markupIsTheList
      ? mergeScrapedReviews(mergeScrapedReviews(structured?.reviews ?? [], substantiveDom), jsonReviews)
      : mergeScrapedReviews(
          mergeScrapedReviews(jsonReviews, structured?.reviews ?? []),
          domReviews.filter((_r, i) => completeDomCards.has(i)),
        );
  const reviewSources = [
    ...fromJson.sources,
    ...(structured?.reviews.length ? ['json-ld'] : []),
    ...((useDom ? domReviews.length : completeDomCards.size) ? ['dom'] : []),
  ];

  // 3. Free-text fallback, only for pasted review text/snippets. On a full fetched page it
  // would treat navigation and footer text as "reviews".
  if (reviews.length === 0 && !looksLikeFullHtmlDocument(html)) {
    selectorsUsed.push('fallback-text-blocks');
    reviews.push(...parseRawReviewBatch(html));
  }

  const parseDurationMs = Date.now() - startTime;

  return {
    meta: {
      id: sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: extractedName,
      brand: extractedBrand,
      category,
      sku,
      price,
      fabricComposition,
      sourceUrl,
      scraperTelemetry: {
        sourceUrl,
        scrapedAt: new Date().toISOString(),
        domNodesScanned,
        reviewNodesMatched: reviews.length,
        selectorsUsed,
        parseDurationMs,
        engineMode: 'cheerio-dom+deterministic-nlp' as ScraperTelemetry['engineMode'],
        reportedReviewCount: fromJson.reportedTotal ?? structured?.reportedReviewCount ?? null,
        reviewSources,
      },
    },
    reviews,
  };
}

/**
 * The product id in Shopify's analytics object (var meta = {"product":{"id":123,...), or else the first
 * such id on the page: later ones belong to recommendation blocks.
 */
function shopifyProductId(html: string): string | null {
  const match =
    html.match(/(?:var meta|ShopifyAnalytics\.meta)\s*=\s*\{\s*"product"\s*:\s*\{\s*"id"\s*:\s*"?(\d{5,})/) ??
    html.match(/"product"\s*:\s*\{\s*"id"\s*:\s*"?(\d{5,})/);
  return match ? match[1] : null;
}

/**
 * Ids, SKUs and handles that name this page's product, lowercased. Used to keep only this product's
 * reviews from review JSON. Product cards elsewhere on the page are not read: their ids would let
 * a "you may also like" carousel's reviews through.
 */
function pageProductKeys(
  $: cheerio.CheerioAPI,
  html: string,
  sourceUrl: string,
  structuredIds: string[],
  sku: string,
  sourceHtml = '',
): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    const t = String(value ?? '').trim().toLowerCase().replace(/^shopify-/, '');
    if (t.length >= 3) keys.add(t);
  };
  structuredIds.forEach(add);
  add(sku);
  add($('meta[property="product:retailer_item_id"]').attr('content'));
  add(shopifyProductId(html));
  $('form[action*="/cart/add"] [name="product-id"], form[action*="/cart/add"] input[name="product_id"]').each((_i, el) => {
    add($(el).attr('value'));
  });
  // The review widget names its product (Yotpo: data-yotpo-product-id, Okendo: data-oke-reviews-product-id).
  // One distinct id is this page's product. Several (a carousel of rated products) say nothing about it.
  const widgetIds = new Set<string>();
  $('[data-yotpo-product-id], [data-oke-reviews-product-id]').each((_i, el) => {
    const id = ($(el).attr('data-yotpo-product-id') ?? $(el).attr('data-oke-reviews-product-id') ?? '').trim().replace(/^shopify-/, '');
    if (/^\d{5,}$/.test(id)) widgetIds.add(id);
  });
  if (widgetIds.size === 1) widgetIds.forEach(add);
  // Shopify's own product reference ("gid://shopify/Product/123") in the page or its source. One distinct
  // id is this page's product; several (related products listed in the page) say nothing about it.
  const gids = new Set([...`${html} ${sourceHtml}`.matchAll(/gid:\/\/shopify\/Product\/(\d{5,})/g)].map((m) => m[1]));
  if (gids.size === 1) gids.forEach(add);
  try {
    const url = new URL(sourceUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    for (const segment of segments) if (/^\d{5,}$/.test(segment)) add(segment);
    const last = segments[segments.length - 1]?.replace(/\.html?$/, '');
    if (last) {
      add(last);
      // Trailing product number in a handle: "...-t-shirt-39031035" or "cormac-crew-neck-shirt-ss-0292".
      const tail = last.match(/(\d{4,})$/);
      if (tail) add(tail[1]);
    }
    for (const value of url.searchParams.values()) if (/^\d{5,}$/.test(value)) add(value);
  } catch {
    // not a URL (pasted HTML)
  }
  return [...keys];
}
