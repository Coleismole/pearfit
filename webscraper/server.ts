import express from 'express';
import path from 'path';
import * as cheerio from 'cheerio';
import {
  aggregateProductFitReport,
  generateSqlInsertDump,
  parseRawReviewBatch,
  type DumpSizeChartRow,
  type ProductFitReport,
  type RawScrapedReview,
  type ScraperTelemetry,
} from './fitAnalyzer.ts';
import { extractSizeFromReviewText, extractStructuredProduct, parseJsonLdScripts } from './structuredData.ts';
import {
  closeHeadlessBrowser,
  fetchGuidePagesByHttp,
  renderChartOnly,
  renderPageHtml,
  REVIEW_CARD_SELECTOR,
  shouldUseHeadlessRender,
  type CapturedJson,
  type GuideFetchResult,
} from './headlessFetch.ts';
import { collectJsonReviews, parseJsonBody, type JsonSource } from './reviewJson.ts';
import type { SizeChartRow } from './sizeChart.ts';
import {
  cleanProductTitle,
  labelledValue,
  leafTexts,
  LABEL_LINE,
  longestFreeText,
  sizeChartFromPages,
  registrableDomain,
  looksLikeDate,
  isBadgeLine,
  dateFromAttribute,
  textOutsideLines,
  productIdFromUrl,
  blockPageTitle,
  describeFetchFailure,
  isBotCheckRedirect,
  ratingFromStarFills,
  isRefusalStatus,
  blockPageText,
  decodeHtmlEntities,
  ratingFromLabel,
  ratingFromStarIcons,
} from './pageHelpers.ts';
import {
  checkFitStore,
  deleteRemoteFitSku,
  listRemoteFitSkus,
  pushFitReports,
  type SupabaseSync,
} from './supabaseFit.ts';
import { blockedFetchTargetResolved } from './publicUrl.ts';
import { serverDir } from './server/env.ts';
import {
  db,
  hasStoredReviews,
  loadStoredReport,
  upsertReportTransaction,
  chartsBySku,
  saveSizeChart,
  getDatabaseSummary,
} from './server/db.ts';
import { mockStoreProduct, renderMockStoreHtml } from './server/mockStore.ts';
import { mergeScrapedReviews } from './server/reviewMerge.ts';

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

/** Maps a free-text category/product name onto the app's fixed category list. */
function inferCategory(...hints: (string | null | undefined)[]): ProductFitReport['category'] {
  for (const hint of hints) {
    if (!hint) continue;
    const exact = VALID_CATEGORIES.find((c) => c.toLowerCase() === hint.toLowerCase());
    if (exact) return exact;
    const h = hint.toLowerCase();
    if (/hoodie|sweatshirt|fleece|crewneck sweat/.test(h)) return 'Fleece & Hoodies';
    if (/jacket|coat|parka|puffer|blazer|outerwear|anorak|vest/.test(h)) return 'Outerwear';
    if (/sweater|knit|cardigan|jumper|pullover/.test(h)) return 'Knitwear';
    if (/trouser|pant|jean|chino|short|legging|jogger/.test(h)) return 'Trousers';
    if (/dress|skirt/.test(h)) return 'Dresses';
    if (/oxford|button[- ]?(down|up)|shirt(?!s? ?&)|flannel|overshirt/.test(h) && !/t-?shirt|tee/.test(h)) return 'Shirting';
    if (/t-?shirt|tee|tank|top|polo|henley/.test(h)) return 'T-Shirts & Tops';
  }
  return 'T-Shirts & Tops';
}

function looksLikeFullHtmlDocument(input: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]/i.test(input.slice(0, 5000));
}

function chartRowsFromClient(value: unknown): SizeChartRow[] {
  if (!Array.isArray(value)) return [];
  const rows: SizeChartRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.size !== 'string' || !row.size.trim()) continue;
    const measurement = (field: unknown) => (typeof field === 'number' && Number.isFinite(field) ? field : null);
    rows.push({
      size: row.size.trim(),
      sortOrder: typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) ? row.sortOrder : rows.length,
      chest_cm: measurement(row.chest_cm),
      length_cm: measurement(row.length_cm),
      sleeve_cm: measurement(row.sleeve_cm),
    });
  }
  return rows;
}

function scrapeHtmlWithCheerio(
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

  const domReviews: RawScrapedReview[] = [];
  const completeDomCards = new Set<number>();

  // 2. Review cards in the DOM (microdata and common review-widget markup).
  // JSON-LD often carries only a few reviews. The cards on the page are still read.
  {
    const reviewElements = $(REVIEW_CARD_SELECTOR);
    if (reviewElements.length > 0) {
      selectorsUsed.push('review-card DOM selectors');
      reviewElements.each((idx, el) => {
        const node = $(el);
        // Skip wrappers that contain another matched card (avoids double counting).
        if (node.find(REVIEW_CARD_SELECTOR).length > 0) return;
        const nodeText = node.text().replace(/\s+/g, ' ').trim();
        const lines = leafTexts($, node);

        const isDate = looksLikeDate;
        const author =
          node.attr('data-author') ||
          node.attr('data-reviewer') ||
          node.find('[itemprop="author"]').first().text().trim() ||
          node.find('[class*="feed-item-title"] .title').first().text().trim() ||
          // A hashed CSS-module class ends in "_author"; "_authorInfo" wraps the name and a "Verified Buyer" badge.
          node.find('[class$="_author"], [class*="_author "]').first().text().trim() ||
          node.find('[class*="reviewer-name"], .review-author, [class*="review-author"], .jdgm-rev__author, .yotpo-user-name, [class*="reviewUserInfo"] > :first-child, [class*="user-info" i] > :first-child').first().text().replace(/^[\s\u2014-]+/, '').trim() ||
          // A masked reviewer name ("1***3", "a***b") alone on its line.
          lines.find((l) => /^[\p{L}\p{N}]{1,4}\*{2,}[\p{L}\p{N}]{1,4}$/u.test(l)) ||
          'Anonymous';
        const body =
          node.find('[itemprop="reviewBody"], .review-body-copy, [class*="review-body"], [class*="review-content"], [class*="review-text"], [class*="reviewContent-body"], [class*="reviewBody"], [class*="review_body"], [class*="CommentWithEllipsis"], [class*="_reviewContent"], .main-text, [class*="review-message"], .jdgm-rev__body, .bv-content-summary-body-text, .pr-rd-description-text').first().text().replace(/\s+/g, ' ').trim() ||
          longestFreeText(lines, [author]) ||
          // Text written directly in the card. A card of only a rating, a date and a size has none: no review.
          textOutsideLines(nodeText, lines);
        // Unlabelled markup: the first short free-text line before the body is the title.
        const title =
          node.find('[itemprop="name"], [class*="review-title"], h3, h4').first().text().replace(/\s+/g, ' ').trim() ||
          lines.slice(0, Math.max(0, lines.indexOf(body))).find(
            (l) => l !== author && l.length <= 150 && !LABEL_LINE.test(l) && !isDate(l) && !isBadgeLine(l)
          ) ||
          '';
        const sizePurchased = stripSizeLabel(
          node.attr('data-size') ||
          node.find('.review-size-tag strong').text().trim() ||
          labelledValue(lines, /^(purchased size|size purchased|size ordered|size bought|size)$/i) ||
          // Loox "Item type: GLACIER / XX-LARGE": the size is the last part.
          node.find('.item-type-value').first().text().split('/').pop()?.trim() ||
          // Tags become spaces first: "<div>L</div><div>These..." must not read as "LThese".
          (node.html() ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/Size(?:\s+(?:Purchased|Ordered|Bought))?\s*:\s*([A-Za-z0-9]+)/i)?.[1] ||
          extractSizeFromReviewText(body)
        );
        const ratingStr =
          node.attr('data-rating') ||
          node.attr('data-score') ||
          node.find('[itemprop="ratingValue"]').attr('content') ||
          node.find('[itemprop="ratingValue"]').text().trim() ||
          node.find('[data-score]').attr('data-score') ||
          node.find('.review-rating').text().match(/(\d(?:\.\d)?)/)?.[1] ||
          // Accessible star widgets: aria-label/title like "4 out of 5 stars".
          ratingFromLabel(node.find('[aria-label*="out of 5" i], [title*="out of 5" i]').first().attr('aria-label') ?? node.find('[title*="out of 5" i]').first().attr('title')) ||
          ratingFromLabel(node.find('[aria-label*="/ 5" i]').first().attr('aria-label')) ||
          ratingFromStarIcons($, node) ||
          ratingFromStarFills($, node) ||
          // Screen-reader text such as "Rated 5 out of 5" (Okendo and others).
          nodeText.match(/\brated\s+(\d(?:\.\d)?)\s+out of\s+5\b/i)?.[1] ||
          '';
        const declaredFitTag =
          node.attr('data-fit') ||
          node.find('.review-fit-tag').text().replace(/^Fit:\s*/i, '').trim() ||
          labelledValue(lines, /^(how it fits|fit|overall fit|sizing)$/i) ||
          undefined;
        const date =
          dateFromAttribute(node.attr('data-date') ?? '') ||
          node.find('[itemprop="datePublished"]').attr('content') ||
          node.find('time').attr('datetime') ||
          lines.find(isDate) ||
          '';
        const reviewerHeight = labelledValue(lines, /^height$/i) || undefined;
        const reviewerBuild = labelledValue(lines, /^(weight|body type|build)$/i) || undefined;
        const usualSize = labelledValue(lines, /^(usual size|normally wears|usually wears)$/i) || undefined;
        const parsedRating = parseFloat(ratingStr);

        // Bazaarvoice's search-engine block renders debug text ("bvseo_bulk, prod_bvrr", "y_2026, m_11")
        // inside review markup. A card with no rating, no reviewer and mostly snake_case tokens is not a review.
        const words = body.split(/[\s,]+/).filter(Boolean);
        const tokenish = words.filter((w) => /_/.test(w) || /^[a-z]+\d+$/i.test(w)).length;
        // Share buttons and widget lines ("facebook Share Review by Anonymous User") are not reviews either.
        // Only a card made of such words: a real review can mention Facebook.
        const WIDGET_WORDS =
          /\b(facebook|twitter|pinterest|share (this )?review|share|copy link|was this (review )?helpful|report (this )?review|tweet|pin it|by|anonymous|user|yes|no)\b|\d+/gi;
        const widgetLine =
          /\b(facebook|twitter|pinterest|share (this )?review|copy link|was this (review )?helpful|report (this )?review)\b/i.test(body) &&
          body.replace(WIDGET_WORDS, ' ').split(/[^\p{L}]+/u).filter(Boolean).length <= 2;
        const debugText =
          !Number.isFinite(parsedRating) && author === 'Anonymous' && (tokenish * 2 >= words.length || widgetLine);
        if (body.length > 8 && !debugText) {
          // A card with a star rating in its markup and a named reviewer is a real review. Lines a widget
          // repeats around reviews ("Was this review helpful?") have neither.
          if (Number.isFinite(parsedRating) && author !== 'Anonymous') completeDomCards.add(domReviews.length);
          domReviews.push({
            id: `dom-rev-${idx + 1}`,
            author,
            sizePurchased,
            usualSize,
            // A card whose stars cannot be read has no rating. Never a stand-in such as 3.
            // (A widget that prints "0" has no rating to show either.)
            rating: Number.isFinite(parsedRating) && parsedRating > 0 ? Math.min(5, Math.max(1, Math.round(parsedRating))) : null,
            title,
            body,
            date,
            verifiedPurchase: false,
            reviewerHeight,
            reviewerBuild,
            declaredFitTag,
          });
        }
      });
    }
  }

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

type RenderMode = 'auto' | 'always' | 'never';

const PASTE_HINT =
  ' If the reviews show in your own browser, copy them (or View Source) and paste into the raw HTML box instead.';

/** Plain HTTP fetch. Returns the HTML, or a status + message describing the failure. */
interface StaticFetchError {
  status: number;
  message: string;
  blocked: boolean;
  /** The request itself failed (reset, oversized headers). A browser may still load the page. */
  retryInBrowser?: boolean;
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** "Size Purchased: L" -> "L": a card that keeps its label in the value. */
function stripSizeLabel(value: string): string {
  return value.replace(/^\s*(?:size|purchased|ordered|bought)(?:\s+(?:purchased|ordered|bought|size))?\s*[:\-]\s*/i, '').trim();
}

const MAX_STATIC_HTML_BYTES = 10_000_000;

async function fetchStaticHtml(
  url: string,
  options: { timeoutMs?: number; /** Refuse a redirect to another store (a size-guide page is read only on the product's own site). */ sameSite?: boolean } = {},
): Promise<{ html: string } | StaticFetchError> {
  const siteOf = (raw: string) => registrableDomain(new URL(raw).hostname);
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const blocked = await blockedFetchTargetResolved(current);
    if (blocked) return { status: 400, message: blocked, blocked: true };
    let response: Response;
    try {
      response = await fetch(current, {
        headers: FETCH_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      });
    } catch (fetchErr) {
      return describeFetchFailure(url, fetchErr);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location && isBotCheckRedirect(location)) {
        return { status: 400, message: `${url} sent the request to a bot check: the store refuses automated requests.`, blocked: true };
      }
      if (!location || hop === 5) {
        void response.body?.cancel().catch(() => {});
        return { status: 400, message: `Too many redirects while scraping ${url}.`, blocked: false };
      }
      void response.body?.cancel().catch(() => {});
      try {
        current = new URL(location, current).toString();
      } catch {
        return { status: 400, message: `${url} redirected to an invalid address.`, blocked: false };
      }
      if (options.sameSite && siteOf(current) !== siteOf(url)) {
        return { status: 400, message: `${url} redirected to another site (${new URL(current).host}).`, blocked: false };
      }
      continue;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      // 418 is what some stores (Under Armour) answer an automated request with; it is a refusal too.
      const refused = isRefusalStatus(response.status);
      return {
        status: 400,
        message: refused
          ? `${url} returned HTTP ${response.status}: the store refuses automated requests.`
          : `Remote server returned HTTP ${response.status} when scraping ${url}.`,
        blocked: refused,
      };
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_STATIC_HTML_BYTES) {
      void response.body?.cancel().catch(() => {});
      return { status: 400, message: `${url} is larger than the ${MAX_STATIC_HTML_BYTES / 1_000_000} MB the scraper reads.`, blocked: false };
    }
    const html = (await response.text()).slice(0, MAX_STATIC_HTML_BYTES);
    // A bot check served with HTTP 200 ("Just a moment...") is a refusal too, not a product page.
    const blockedBy = blockPageTitle(html);
    if (blockedBy) {
      return { status: 400, message: `${url} showed a block page ("${blockedBy}"): the store refuses automated requests.`, blocked: true };
    }
    const shortPage = blockPageText(html);
    if (shortPage === 'refused') {
      return { status: 400, message: `${url} says it does not allow automated traffic: the store refuses automated requests.`, blocked: true };
    }
    if (shortPage === 'maintenance') {
      return { status: 400, message: `${url} is showing a maintenance page. The store's site is down; try again later.`, blocked: false };
    }
    return { html };
  }
  return { status: 400, message: `Too many redirects while scraping ${url}.`, blocked: false };
}

/**
 * One size-guide page by plain fetch, under the same safeguards as the product page (public addresses only,
 * size cap, block pages), on the same site only. A refusal is reported as one so that no other guide is tried.
 */
async function fetchGuidePage(href: string, timeoutMs: number): Promise<GuideFetchResult> {
  const result = await fetchStaticHtml(href, { timeoutMs, sameSite: true });
  if (!('html' in result) && process.env.SCRAPER_DEBUG) console.error(`[guides] ${href}: ${result.message}`);
  return 'html' in result ? { html: result.html } : { refused: result.blocked };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Serve realistic mock e-commerce store pages for live scraping
  app.get('/api/mock-store/:slug', (req, res) => {
    const product = mockStoreProduct(req.params.slug);
    if (!product) {
      res.status(404).send('Product not found');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderMockStoreHtml(product));
  });

  app.get('/api/mock-store/:slug/raw', (req, res) => {
    const product = mockStoreProduct(req.params.slug);
    if (!product) {
      res.status(404).json({ error: 'Preset store page not found' });
      return;
    }
    res.json({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      sku: product.sku,
      category: product.category,
      html: renderMockStoreHtml(product),
    });
  });

  // Public PostHog settings for the browser (the project token is meant to be public). The page loads
  // them at start so the build holds no analytics keys. Empty when PostHog is not configured.
  app.get('/api/posthog-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      projectToken: process.env.POSTHOG_PROJECT_TOKEN || '',
      host: process.env.POSTHOG_HOST || '',
    });
  });

  // Commercial SQLite Database Query & Inspection Endpoints
  app.get('/api/db/remote', async (_req, res) => {
    try {
      res.json(await listRemoteFitSkus());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Could not list the shared fit store' });
    }
  });

  app.get('/api/db/records', (_req, res) => {
    res.json(getDatabaseSummary());
  });

  app.post('/api/db/commit', async (req, res) => {
    try {
      const { report, reports, charts: incomingCharts } = req.body as {
        report?: ProductFitReport;
        reports?: ProductFitReport[];
        charts?: Record<string, unknown>;
      };

      const list = reports || (report ? [report] : []);
      if (!Array.isArray(list) || list.some((r) => !r || typeof r !== 'object' || typeof r.sku !== 'string' || !r.sku)) {
        res.status(400).json({ error: 'Each report must be an object with a string sku.' });
        return;
      }
      if (list.length === 0) {
        res.status(400).json({ error: 'No scraped SKU report provided to dump into database.' });
        return;
      }

      for (const item of list) {
        upsertReportTransaction(item);
        const rows = chartRowsFromClient(incomingCharts?.[item.sku]);
        if (rows.length > 0) saveSizeChart(item.sku, rows);
      }

      const supabase = await pushFitReports(list, chartsBySku(list));
      res.json({
        committedCount: list.length,
        supabase,
        ...getDatabaseSummary(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Database commit failed',
      });
    }
  });

  const deleteSkuTransaction = db.transaction((sku: string) => {
    db.prepare(`DELETE FROM commercial_skus WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_size_metrics WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_reviews WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM size_chart WHERE sku = ?`).run(sku);
    db.prepare(`
      INSERT INTO ingestion_log (sku, product_name, action, rows_affected, committed_at)
      VALUES (?, ?, 'DELETE_SKU', 1, ?)
    `).run(sku, sku, new Date().toISOString());
  });

  app.delete('/api/db/sku/:sku', async (req, res) => {
    try {
      const sku = req.params.sku;
      deleteSkuTransaction(sku);

      const supabase = await deleteRemoteFitSku(sku);
      res.json({ supabase, ...getDatabaseSummary() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  app.get('/api/db/dump.sql', (_req, res) => {
    const { reports, charts } = getDatabaseSummary();
    const chartRows: DumpSizeChartRow[] = Object.entries(charts).flatMap(([sku, rows]) =>
      rows.map((row) => ({ sku, ...row })),
    );
    const sql = generateSqlInsertDump(reports, chartRows);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="pearfit_scraper_commercial_db_dump.sql"'
    );
    res.send(sql);
  });

  app.get('/api/db/dump.json', (_req, res) => {
    const skus = db.prepare(`SELECT sku, product_id, brand, product_name, category, retail_price, fabric_composition, total_reviews, overall_fit_index, overall_verdict, grading_delta, runs_small_pct, true_to_size_pct, runs_large_pct, shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating, source_url, scraped_at, committed_at FROM commercial_skus`).all();
    const sizeMetrics = db.prepare(`SELECT * FROM sku_size_metrics`).all();
    const reviews = db.prepare(`SELECT * FROM sku_reviews`).all();
    const sizeChart = db.prepare(`SELECT * FROM size_chart ORDER BY sku, sort_order`).all();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="pearfit_scraper_commercial_db_dump.json"'
    );
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          engine: 'Pearfit Scraper Commercial Apparel Fit Database (SQLite3 + Deterministic NLP)',
          tables: {
            commercial_skus: skus,
            sku_size_metrics: sizeMetrics,
            sku_reviews: reviews,
            size_chart: sizeChart,
          },
        },
        null,
        2
      )
    );
  });

  // Deterministic Web Scraper Endpoint (Zero LLM)
  app.post('/api/scrape', async (req, res) => {
    try {
      const {
        url,
        rawHtml,
        productName,
        brand,
        sku,
        category,
        commitToDb = true,
        render,
        chartRender = false,
      } = req.body as {
        url?: string;
        rawHtml?: string;
        productName?: string;
        brand?: string;
        sku?: string;
        category?: ProductFitReport['category'];
        commitToDb?: boolean;
        render?: RenderMode;
        /** Also run a short render for the size chart alone when nothing else found one (see below). Off by default. */
        chartRender?: boolean;
      };

      if ((url !== undefined && typeof url !== 'string') || (rawHtml !== undefined && typeof rawHtml !== 'string')) {
        res.status(400).json({ error: 'url and rawHtml must be strings.' });
        return;
      }

      const renderMode: RenderMode = render === 'always' || render === 'never' ? render : 'auto';
      let targetHtml = (rawHtml || '').trim();
      let renderedChartHtml: string | null = null; // headless snapshot from before the review steps
      let renderedFinalHtml: string | null = null; // headless page at the end, when the source page's reviews won
      let renderedGuidePages: string[] = []; // size guide pages the product page linked to, read by the headless browser
      let renderedChartJson: string[] = []; // size chart tables that arrived as HTML inside JSON the page received
      let sourceUrl = (url || 'batch://direct-review-payload').trim();
      let isRemoteUrl = false;
      let staticError: StaticFetchError | null = null;

      if (!targetHtml && url) {
        const mockMatch = url.match(/^(?:https?:\/\/[^/?#]+)?\/api\/mock-store\/([a-z0-9-]+)\/?(?:[?#].*)?$/i);
        const mockProd = mockMatch ? mockStoreProduct(mockMatch[1]) : undefined;
        if (mockProd) {
          targetHtml = renderMockStoreHtml(mockProd);
          sourceUrl = `https://storefront.pearfitscraper.local/api/mock-store/${mockProd.slug}`;
        } else if (/^https?:\/\//i.test(url)) {
          isRemoteUrl = true;
          const blocked = await blockedFetchTargetResolved(url);
          if (blocked) {
            res.status(400).json({ error: blocked });
            return;
          }
          if (renderMode !== 'always') {
            const result = await fetchStaticHtml(url);
            if ('html' in result) targetHtml = result.html;
            else staticError = result;
          }
        } else {
          res.status(400).json({
            error:
              'Provide a valid http(s):// URL, select a target SKU endpoint, or paste review HTML/text.',
          });
          return;
        }
      }

      const overrides = { productName, brand, sku, category };
      const staticHtml = targetHtml; // the page as the server sent it, before any render replaces targetHtml
      let scraped = targetHtml ? scrapeHtmlWithCheerio(targetHtml, sourceUrl, overrides) : null;
      let headlessNote: string | null = null;

      // Headless fallback for reviews loaded by JavaScript. A failed fetch is reported as
      // that failure. A refusal (403/429/503) is not retried in a browser.
      const needsRender = shouldUseHeadlessRender({
        isRemoteUrl,
        renderMode,
        staticFailed: staticError !== null && !staticError.retryInBrowser,
        reviewCount: scraped ? scraped.reviews.length : null,
        reportedReviewCount: scraped?.meta.scraperTelemetry.reportedReviewCount ?? null,
      });
      if (needsRender) {
        try {
          const rendered = await renderPageHtml(url!);
          const blockedBy = blockPageTitle(rendered.html);
          if (rendered.status !== null && rendered.status >= 400) {
            headlessNote = `Headless browser got HTTP ${rendered.status}.`;
          } else if (blockedBy) {
            // A bot check or access-denied page is a refusal, reported as one and not worked around.
            headlessNote = `The store showed the headless browser a block page ("${blockedBy}"): it refuses automated requests.`;
          } else if (blockPageText(rendered.html) === 'refused') {
            headlessNote = 'The store told the headless browser it does not allow automated traffic: it refuses automated requests.';
          } else if (blockPageText(rendered.html) === 'maintenance') {
            headlessNote = "The store's site is showing a maintenance page. It is down; try again later.";
          } else {
            // The render may end on the product's own review page; product details come from the
            // product page snapshot then.
            const leftProductPage = rendered.chartHtml !== null && new URL(rendered.finalUrl).pathname !== new URL(url!).pathname;
            const renderedScrape = scrapeHtmlWithCheerio(
              rendered.html,
              sourceUrl,
              overrides,
              rendered.jsonResponses,
              leftProductPage ? rendered.chartHtml : null,
              targetHtml,
            );
            // Earlier pages of a review list that pages by link each hold their own reviews. Merge them in
            // page order, then the last page, so the list keeps the store's order (newest first).
            if (rendered.extraHtml?.length) {
              let earlierReviews: RawScrapedReview[] = [];
              for (const pageHtml of rendered.extraHtml) {
                const earlier = scrapeHtmlWithCheerio(pageHtml, sourceUrl, overrides);
                earlierReviews = mergeScrapedReviews(earlierReviews, earlier.reviews);
                renderedScrape.meta.scraperTelemetry.reportedReviewCount ??= earlier.meta.scraperTelemetry.reportedReviewCount;
              }
              renderedScrape.reviews = mergeScrapedReviews(earlierReviews, renderedScrape.reviews);
            }
            renderedScrape.meta.scraperTelemetry.engineMode = 'headless-chromium+cheerio-dom';
            renderedScrape.meta.scraperTelemetry.selectorsUsed.unshift('headless-chromium render');
            // Keep the render when it found at least as many reviews as the page source, or when it read
            // the review widget's own data and the page source had only markup cards.
            const renderedHasData = renderedScrape.meta.scraperTelemetry.reviewSources.some((src) => src !== 'dom' && src !== 'json-ld');
            const staticHasData = (scraped?.meta.scraperTelemetry.reviewSources ?? []).some((src) => src !== 'dom' && src !== 'json-ld');
            // The render's size chart is kept whichever review set wins.
            renderedChartHtml = rendered.chartHtml;
            renderedFinalHtml = rendered.html;
            renderedGuidePages = rendered.guidePages ?? [];
            renderedChartJson = rendered.chartJson ?? [];
            if (process.env.SCRAPER_DEBUG) console.error(`[render] size chart JSON fragments: ${renderedChartJson.length}`);
            if (
              !scraped ||
              renderedScrape.reviews.length >= scraped.reviews.length ||
              (renderedHasData && !staticHasData && renderedScrape.reviews.length > 0)
            ) {
              scraped = renderedScrape;
              targetHtml = rendered.html;
            }
            if (renderedScrape.reviews.length === 0) {
              headlessNote = 'Rendered the page in a headless browser but still found no reviews.';
            }
          }
        } catch (renderErr) {
          const reason = renderErr instanceof Error ? renderErr.message.split('\n')[0] : String(renderErr);
          const missingLocalBrowser =
            !process.env.VERCEL &&
            /Executable doesn't exist|browserType\.launch|Cannot find (module|package) 'playwright'/i.test(reason);
          headlessNote = missingLocalBrowser
            ? 'Headless browser is not installed (run `npx playwright install chromium`).'
            : `Headless browser render failed: ${reason}`;
        }
      }

      if (!scraped) {
        const parts = [staticError?.message ?? 'No HTML or review content provided to scrape.', headlessNote].filter(Boolean);
        res.status(staticError?.status ?? 400).json({
          error: `${parts.join(' ')}${isRemoteUrl ? PASTE_HINT : ''}`,
        });
        return;
      }

      const { meta, reviews } = scraped;

      // A page whose reviews were all in its source needed no render, so its size guide was never opened.
      // Look for the chart anyway: first the size-guide pages the source links to (plain fetch, no browser, a
      // second or two). Only when the request asks for it (chartRender), a short render for the chart alone
      // follows: 15 to 45 seconds a page, and on 15 such stores it found no chart the plain fetch had missed.
      // A page the full render already read is not read again.
      if (isRemoteUrl && url && staticHtml && renderedFinalHtml === null) {
        const hint = { name: meta.name, url: sourceUrl };
        const chartFound = () => sizeChartFromPages([targetHtml, renderedChartHtml, renderedFinalHtml, ...renderedChartJson], renderedGuidePages, hint).length > 0;
        if (!chartFound()) {
          renderedGuidePages = await fetchGuidePagesByHttp(staticHtml, url, fetchGuidePage);
          if (process.env.SCRAPER_DEBUG) {
            console.error(`[guides] ${renderedGuidePages.length} linked guide page(s) read: ${renderedGuidePages.map((h) => `${h.length} chars, ${(h.match(/<table/gi) ?? []).length} tables`).join('; ')}`);
          }
          if (!chartFound() && chartRender === true && renderMode === 'auto' && !needsRender && !process.env.VERCEL) {
            try {
              const chartRender = await renderChartOnly(url);
              const refused = chartRender.html && (blockPageTitle(chartRender.html) || blockPageText(chartRender.html) === 'refused');
              // A store that answers the browser with a refusal is not asked again, and nothing from that page is used.
              if (chartRender.html && !refused && (chartRender.status === null || chartRender.status < 400)) {
                renderedChartHtml = chartRender.chartHtml;
                renderedFinalHtml = chartRender.html;
                renderedGuidePages = [...renderedGuidePages, ...(chartRender.guidePages ?? [])];
                renderedChartJson = chartRender.chartJson ?? [];
              }
            } catch {
              // No chart this time; the reviews were read and stand.
            }
          }
        }
      }

      if (reviews.length === 0) {
        const sizeChart = sizeChartFromPages([targetHtml, renderedChartHtml, renderedFinalHtml, ...renderedChartJson], renderedGuidePages, { name: meta.name, url: sourceUrl });
        // A chart with no parent SKU never shows up and never reaches Supabase.
        // Store an empty fit report so the chart has a row to hang on.
        if (commitToDb && sizeChart.length > 0) {
          const emptyReport = aggregateProductFitReport(meta, []);
          // The reviews may have failed to load this time. Keep the ones an earlier scrape stored,
          // and show that stored report rather than an empty one.
          const keptStoredReviews = hasStoredReviews(emptyReport.sku);
          if (!keptStoredReviews) upsertReportTransaction(emptyReport);
          saveSizeChart(emptyReport.sku, sizeChart);
          const supabase = await pushFitReports([emptyReport], { [emptyReport.sku]: sizeChart }, { chartOnly: true });
          res.json({
            report: (keptStoredReviews && loadStoredReport(emptyReport.sku)) || emptyReport,
            keptStoredReviews,
            sizeChart,
            committedToDb: true,
            supabase,
            dbState: getDatabaseSummary(),
          });
          return;
        }
        const chartNote =
          sizeChart.length > 0
            ? ` A size chart with ${sizeChart.length} sizes was read and not stored.`
            : '';
        res.status(422).json({
          error: `${
            isRemoteUrl || looksLikeFullHtmlDocument(targetHtml)
              ? `No reviews found on the page.${headlessNote ? ` ${headlessNote}` : ''}${PASTE_HINT}`
              : 'No recognizable clothing reviews were found in the pasted content.'
          }${chartNote}`,
          sizeChart,
        });
        return;
      }

      const report = aggregateProductFitReport(meta, reviews);
      const sizeChart = sizeChartFromPages([targetHtml, renderedChartHtml, renderedFinalHtml, ...renderedChartJson], renderedGuidePages, { name: meta.name, url: sourceUrl });

      let supabase: SupabaseSync | null = null;
      if (commitToDb) {
        upsertReportTransaction(report);
        saveSizeChart(report.sku, sizeChart);
        supabase = await pushFitReports([report], { [report.sku]: sizeChart });
      }

      res.json({
        report,
        sizeChart,
        committedToDb: commitToDb,
        supabase,
        dbState: getDatabaseSummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected scraper error';
      res.status(500).json({ error: message });
    }
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(serverDir(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      closeHeadlessBrowser().finally(() => process.exit(0));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pearfit Scraper listening on http://127.0.0.1:${PORT}`);
    checkFitStore().then((sync) => {
      if (sync.ok) {
        console.log('Supabase fit store is ready. Scrapes will push fit numbers.');
        return;
      }
      if ('skipped' in sync) {
        console.log(`Supabase fit store skipped: ${sync.reason}`);
        return;
      }
      console.log(`Supabase fit store is not writable yet: ${sync.error}`);
      console.log('One person runs webscraper/fit_store.sql once in the Supabase SQL editor. After that, every clone can push.');
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`Supabase fit store check failed: ${message}`);
    });
  });
}

if (!process.env.VERCEL) {
  startServer();
}
