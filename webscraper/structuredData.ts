import { REVIEW_SIZE_TOKEN, type RawScrapedReview } from './fitAnalyzer.ts';

/**
 * Product + reviews pulled from schema.org JSON-LD (<script type="application/ld+json">).
 * Most real storefronts (Shopify, Salesforce Commerce, BigCommerce, review apps that render
 * server-side) emit this, so it is the most reliable source on a fetched product page.
 * Any field the page does not state is null; nothing is guessed.
 */
export interface StructuredProduct {
  name: string | null;
  brand: string | null;
  sku: string | null;
  price: string | null;
  material: string | null;
  category: string | null;
  reviews: RawScrapedReview[];
  /** productID, sku, mpn, gtin and productGroupID values, plus each offer's sku. Lowercased. */
  identifiers: string[];
  /** The review count the page states (aggregateRating.reviewCount, else ratingCount), or null. */
  reportedReviewCount: number | null;
  /** The site's own name from an Organization node, used as the brand when the product names none. */
  organizationName: string | null;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function hasType(node: Json, type: string): boolean {
  return asArray(node['@type']).some((t) => typeof t === 'string' && t.toLowerCase() === type.toLowerCase());
}

function text(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.replace(/\s+/g, ' ').trim();
    return t || null;
  }
  if (typeof v === 'number') return String(v);
  if (isObject(v)) return text(v.name);
  if (Array.isArray(v)) return text(v[0]);
  return null;
}

/** Walks every object in the JSON-LD tree (handles @graph, arrays, nested nodes). */
function collectNodes(root: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(root)) {
    for (const item of root) collectNodes(item, out);
  } else if (isObject(root)) {
    out.push(root);
    for (const value of Object.values(root)) {
      if (typeof value === 'object' && value !== null) collectNodes(value, out);
    }
  }
  return out;
}

/** True when itemReviewed names a sku or product that is not this one. Unlinked reviews stay. */
function reviewIsForAnotherProduct(review: Json, product: Json): boolean {
  const reviewed = review.itemReviewed;
  if (!isObject(reviewed)) return false;
  const reviewedSku = text(reviewed.sku);
  const productSku = text(product.sku);
  if (reviewedSku && productSku) return reviewedSku !== productSku;
  const reviewedName = text(reviewed.name);
  const productName = text(product.name);
  if (reviewedName && productName) return reviewedName !== productName;
  return false;
}

function formatPrice(offersRaw: unknown): string | null {
  for (const offer of asArray(offersRaw)) {
    if (!isObject(offer)) continue;
    const amount = offer.price ?? offer.lowPrice ?? (isObject(offer.priceSpecification) ? offer.priceSpecification.price : undefined);
    const currency = text(offer.priceCurrency) ?? (isObject(offer.priceSpecification) ? text(offer.priceSpecification.priceCurrency) : null);
    const amountText = text(amount);
    if (amountText) return currency ? `${amountText} ${currency}` : amountText;
  }
  return null;
}

/** Rating normalized to the 1-5 scale, or null when the review has no rating. */
function parseRating(ratingRaw: unknown): number | null {
  if (!isObject(ratingRaw)) return null;
  const value = parseFloat(String(ratingRaw.ratingValue ?? ''));
  if (!Number.isFinite(value)) return null;
  const best = parseFloat(String(ratingRaw.bestRating ?? '5'));
  const worst = parseFloat(String(ratingRaw.worstRating ?? '1'));
  const scaled =
    Number.isFinite(best) && Number.isFinite(worst) && best > worst && best !== 5
      ? 1 + ((value - worst) / (best - worst)) * 4
      : value;
  return Math.min(5, Math.max(1, Math.round(scaled)));
}

/** Size the reviewer says they bought, if the review text states it. '' when unknown. */
export function extractSizeFromReviewText(body: string): string {
  const labeled = new RegExp(
    `\\bsize(?:\\s+(?:purchased|ordered|bought))?\\s*[:=-]\\s*(${REVIEW_SIZE_TOKEN})\\b`,
    'i',
  );
  // "Sized down to M" names the size bought, even when the review first names the usual size.
  const sizedTo = new RegExp(
    `\\b(?:sized|went)\\s+(?:up|down)\\s+(?:to|a size to)\\s+(?:a\\s+|an\\s+|size\\s+)?(${REVIEW_SIZE_TOKEN})\\b`,
    'i',
  );
  // "Wear" and "wearing" usually name the reviewer's usual size, and "got a small stain" is not a size.
  // Only verbs of buying count.
  // A bare number after a buying verb is a quantity ("bought 2 of these"). It is a size only after "size".
  const letterSize = REVIEW_SIZE_TOKEN.replace('|\\d{1,2}', '');
  const bought = new RegExp(
    `\\b(?:bought|ordered|purchased)\\s+(?:(?:a|an|the|my)\\s+)?(?:size\\s+(${REVIEW_SIZE_TOKEN})|(${letterSize}))\\b`,
    'i',
  );
  const wornIn = new RegExp(`\\bin\\s+(?:a\\s+|size\\s+)(${REVIEW_SIZE_TOKEN})\\b`, 'i');
  const match = body.match(labeled) || body.match(sizedTo) || body.match(bought) || body.match(wornIn);
  return match ? (match[1] ?? match[2] ?? '') : '';
}

const FIT_TAG_REGEX = /\b(runs\s+small|true\s+to\s+size|runs\s+large|slightly\s+small|slightly\s+large)\b/i;

/**
 * Extracts the first Product node (and its reviews) from already-parsed JSON-LD blocks.
 * Returns null when no Product node exists.
 */
export function extractStructuredProduct(jsonLdBlocks: unknown[]): StructuredProduct | null {
  const nodes = collectNodes(jsonLdBlocks);
  const product = nodes.find((n) => hasType(n, 'Product') || hasType(n, 'ProductGroup'));
  if (!product) return null;

  // Reviews may sit on the Product, or on separate Review nodes for that same product.
  // Reviews nested on a different product, or whose itemReviewed names one, are left out.
  const reviewNodes = new Set<Json>();
  const ownedByAnotherProduct = new Set<Json>();
  for (const node of nodes) {
    if (node === product || (!hasType(node, 'Product') && !hasType(node, 'ProductGroup'))) continue;
    for (const review of asArray(node.review ?? node.reviews)) {
      if (isObject(review)) ownedByAnotherProduct.add(review);
    }
  }
  for (const r of asArray(product.review ?? product.reviews)) if (isObject(r)) reviewNodes.add(r);
  for (const n of nodes) {
    if (!hasType(n, 'Review') || ownedByAnotherProduct.has(n) || reviewIsForAnotherProduct(n, product)) continue;
    reviewNodes.add(n);
  }

  const reviews: RawScrapedReview[] = [];
  let idx = 0;
  for (const r of reviewNodes) {
    const body = text(r.reviewBody) ?? text(r.description);
    if (!body || body.length <= 8) continue;
    idx += 1;
    const rating = parseRating(r.reviewRating);
    const fitTag = body.match(FIT_TAG_REGEX)?.[1];
    reviews.push({
      id: `jsonld-rev-${idx}`,
      author: text(r.author) ?? 'Anonymous',
      sizePurchased: extractSizeFromReviewText(body),
      // A JSON-LD review with no rating has none: null, not a neutral 3.
      rating,
      title: text(r.name) ?? text(r.headline) ?? '',
      body,
      date: text(r.datePublished) ?? '',
      verifiedPurchase: false,
      declaredFitTag: fitTag,
    });
  }

  const identifiers = new Set<string>();
  const idFields = ['productID', 'productId', 'sku', 'mpn', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'productGroupID'];
  for (const node of [product, ...asArray(product.hasVariant), ...asArray(product.offers)]) {
    if (!isObject(node)) continue;
    for (const field of idFields) {
      const value = text(node[field]);
      if (value) identifiers.add(value.toLowerCase());
    }
  }
  const aggregate = isObject(product.aggregateRating) ? product.aggregateRating : null;
  const count = aggregate ? Number(aggregate.reviewCount ?? aggregate.ratingCount) : NaN;

  const organization = nodes.find((n) => hasType(n, 'Organization') || hasType(n, 'Corporation') || hasType(n, 'OnlineStore'));
  return {
    organizationName: organization ? text(organization.name) : null,
    identifiers: [...identifiers],
    reportedReviewCount: Number.isInteger(count) && count >= 0 ? count : null,
    name: text(product.name),
    brand: text(product.brand) ?? text(product.manufacturer),
    sku: text(product.sku) ?? text(product.mpn) ?? text(product.productGroupID),
    price: formatPrice(product.offers),
    material: text(product.material),
    category: text(product.category),
    reviews,
  };
}

/** Parses JSON-LD script contents, skipping blocks that are not valid JSON. */
export function parseJsonLdScripts(scriptContents: string[]): unknown[] {
  const blocks: unknown[] = [];
  for (const raw of scriptContents) {
    const cleaned = raw.trim().replace(/^<!--/, '').replace(/-->$/, '').trim();
    if (!cleaned) continue;
    try {
      blocks.push(JSON.parse(cleaned));
    } catch {
      // Some sites ship invalid JSON-LD; ignore that block rather than fail the scrape.
    }
  }
  return blocks;
}
