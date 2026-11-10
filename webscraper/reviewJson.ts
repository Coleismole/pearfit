/**
 * Reviews from JSON: review-widget responses a product page loaded, and data embedded in the page
 * (__NEXT_DATA__, application/json scripts). Pure functions, no I/O.
 *
 * Works on the shape of the data, not on a vendor list, so a store with its own review system is
 * read the same way as Yotpo, Okendo, Stamped, Klaviyo, Junip, Bazaarvoice or Reviews.io.
 * A review is an object with a star rating and review text (or a title).
 *
 * Nothing is guessed. A fit answer is turned into "runs small" / "runs large" only when its scale
 * is known (stated range, labelled ends, or a vendor scale checked against that vendor's widget).
 * A size is taken from an answer labelled as the size bought, or from the purchased variant.
 */
import type { RawScrapedReview } from './fitAnalyzer.ts';
import { extractSizeFromReviewText } from './structuredData.ts';

type Json = Record<string, unknown>;

export interface JsonReview extends RawScrapedReview {
  /** Product ids or handles this review names, lowercased. Empty when the review names none. */
  productKeys: string[];
  /** Product name the review names, when it names one. */
  productName: string | null;
}

export interface JsonReviewSet {
  reviews: JsonReview[];
  /** The review total the source states for its product (not shop-wide), or null. */
  reportedTotal: number | null;
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.replace(/\s+/g, ' ').trim();
    return t || null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

function first(obj: Json, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return undefined;
}

/** Reads a dotted path such as "user.displayName". */
function at(obj: Json, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (!isObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function firstPath(obj: Json, paths: string[]): unknown {
  for (const path of paths) {
    const v = at(obj, path);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const RATING_KEYS = ['rating', 'score', 'Rating', 'reviewRating', 'stars', 'starRating', 'star_rating', 'overallRating', 'ratingValue', 'reviewScore', 'rate'];
const BODY_KEYS = ['body', 'body_html', 'bodyHtml', 'content', 'comments', 'ReviewText', 'reviewText', 'reviewMessage', 'reviewBody', 'review_body', 'review_text', 'text', 'comment', 'review', 'message'];
const TITLE_KEYS = ['title', 'Title', 'reviewTitle', 'review_title', 'headline'];
const DATE_KEYS = ['createdAt', 'created_at', 'dateCreated', 'date_created', 'SubmissionTime', 'submissionTime', 'reviewDate', 'datePublished', 'publishedAt', 'published_at', 'submittedAt', 'createDate', 'dateCreatedMillis', 'createdDate', 'created_date', 'reviewed_at', 'reviewedAt', 'date', 'created'];
const ID_KEYS = ['id', 'Id', 'reviewId', 'review_id', 'ReviewId', 'ugc_id', 'uuid'];
const AUTHOR_PATHS = [
  'user.displayName', 'user.display_name', 'user.name', 'author.name', 'author.displayName', 'author.display_name',
  'reviewer.displayName', 'reviewer.display_name', 'reviewer.name', 'customer.name', 'UserNickname', 'userNickname',
  'nickname', 'reviewerName', 'reviewer_name', 'displayName', 'display_name', 'author', 'name',
];
/** Keys that make an object a product or an aggregate rather than one review. */
const AGGREGATE_KEYS = [
  'review_count', 'reviewCount', 'totalReviews', 'total_reviews', 'TotalReviewCount', 'rating_histogram', 'ratingHistogram',
  'averageScore', 'average_score', 'averageRating', 'average_rating', 'AverageOverallRating',
];

/** A 1–5 rating. Ten- and hundred-point scales are scaled down; a stated best rating wins. */
export function normalizeRating(raw: unknown, best?: unknown): number | null {
  let value: number | null;
  let scale = num(best);
  if (isObject(raw)) {
    value = num(first(raw, ['ratingValue', 'value', 'Value', 'rating']));
    scale = num(first(raw, ['bestRating', 'best', 'max', 'RatingRange'])) ?? scale;
  } else {
    value = num(raw);
  }
  if (value === null || value <= 0) return null;
  if (scale && scale > 0 && scale !== 5) value = (value / scale) * 5;
  else if (value > 5 && value <= 10) value = value / 2;
  else if (value > 10 && value <= 100) value = value / 20;
  if (value > 5) return null;
  return Math.round(value * 10) / 10;
}

function bodyOf(obj: Json): string | null {
  for (const key of BODY_KEYS) {
    const v = obj[key];
    if (typeof v === 'string') {
      const t = v.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length >= 2) return t;
    }
  }
  return null;
}

/**
 * PowerReviews nests one review's fields: { review_id, details: { comments, headline, nickname, properties },
 * metrics: { rating }, badges: { is_verified_buyer } }. Those are lifted into one object; other shapes pass through.
 */
function flattenReview(obj: Json): Json {
  if (!isObject(obj.details) || !isObject(obj.metrics)) return obj;
  const badges = isObject(obj.badges) ? obj.badges : {};
  return { ...obj, ...obj.details, ...obj.metrics, verifiedBuyer: badges.is_verified_buyer === true };
}

/** True when this object is one review: a rating plus text or a title, and not a product total. */
export function looksLikeReview(raw: Json): boolean {
  const obj = flattenReview(raw);
  if (AGGREGATE_KEYS.some((key) => key in obj)) return false;
  const rating = normalizeRating(first(obj, RATING_KEYS), obj.bestRating);
  if (rating === null) return false;
  if (bodyOf(obj) !== null) return true;
  // A title-only review still has a reviewer or a date; a question summary ({ title: "Fit", score: 2 }) has neither.
  if (str(first(obj, TITLE_KEYS)) === null) return false;
  return authorOf(obj) !== 'Anonymous' || str(first(obj, DATE_KEYS)) !== null;
}

// ---------------------------------------------------------------------------------------------
// Questions and answers attached to a review
// ---------------------------------------------------------------------------------------------

/** Where a numeric answer sits on its scale. */
interface Scale {
  center: number;
  half: number;
  /** True when the low end means "too small". */
  lowIsSmall: boolean;
}

export interface ReviewAnswer {
  label: string;
  value: string | null;
  numeric: number | null;
  scale: Scale | null;
}

const SMALL_WORDS = /small|tight|snug|short|narrow/i;
const LARGE_WORDS = /large|big|loose|roomy|long|baggy|wide/i;

/** Low end means small unless its label says large (or the high end says small). */
function directionFrom(lowLabel: unknown, highLabel: unknown): boolean | null {
  const low = str(lowLabel) ?? '';
  const high = str(highLabel) ?? '';
  if (SMALL_WORDS.test(low) || LARGE_WORDS.test(high)) return true;
  if (LARGE_WORDS.test(low) || SMALL_WORDS.test(high)) return false;
  return null;
}

/** Field ids as words: "SizePurchased" → "Size Purchased", "YourHeight_2024" → "Your Height". */
export function labelFromId(label: string): string {
  return label
    .replace(/_\d+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function answer(label: unknown, value: unknown, scale: Scale | null = null): ReviewAnswer | null {
  const raw = str(label);
  const l = raw ? labelFromId(raw) : null;
  if (!l) return null;
  const list = Array.isArray(value) ? value : [value];
  const text = list.map((v) => str(v)).filter(Boolean).join(', ') || null;
  const numeric = list.length === 1 ? num(list[0]) : null;
  if (text === null && numeric === null) return null;
  return { label: l, value: text, numeric, scale };
}

/** Collects every label/value answer a review carries, whatever the vendor's layout. */
export function reviewAnswers(review: Json): ReviewAnswer[] {
  const out: ReviewAnswer[] = [];
  const push = (a: ReviewAnswer | null) => {
    if (a) out.push(a);
  };

  // Yotpo: customFields / custom_fields { id: { title, value, fieldType } }.
  // Its "Size" field is centred on 2 ("True to size" for an average of 2), low end = runs small.
  for (const key of ['customFields', 'custom_fields']) {
    const fields = review[key];
    if (!isObject(fields)) continue;
    for (const field of Object.values(fields)) {
      if (!isObject(field)) continue;
      const type = str(first(field, ['fieldType', 'field_type'])) ?? '';
      const scale = /^size$/i.test(type) ? { center: 2, half: 1, lowIsSmall: true } : null;
      push(answer(first(field, ['title', 'question', 'label']), field.value, scale));
    }
  }

  // Klaviyo: question_answers { id: { label, answer: [..], type, values: { min, center, max } } }.
  // Its centered range runs 0 to 4 with 2 at the centre (the widget places the dot at answer / 4).
  if (isObject(review.question_answers)) {
    for (const qa of Object.values(review.question_answers)) {
      if (!isObject(qa)) continue;
      const type = str(qa.type) ?? '';
      const values = isObject(qa.values) ? qa.values : {};
      const lowIsSmall = directionFrom(values.min, values.max);
      const scale = /range/.test(type) && lowIsSmall !== null ? { center: 2, half: 2, lowIsSmall } : null;
      push(answer(qa.label, qa.answer, scale));
    }
  }

  // Reviews.io (and stores built on it): attributes [{ label, value, type, options }].
  // A centered range with three labels is a five-point scale: 1–2 small, 3 true, 4–5 large.
  const attrLists = [
    review.attributes, at(review, 'author.attributes'), at(review, 'reviewer.attributes'), review.productAttributes,
    review.attributesWithRating, review.reviewer_attributes, review.reviewAttributes,
  ];
  for (const list of attrLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isObject(item)) continue;
      const label = first(item, ['label', 'title', 'name', 'question', 'attributeName']);
      const type = str(item.type) ?? '';
      const options = Array.isArray(item.options) ? item.options : [];
      let scale: Scale | null = null;
      const min = num(first(item, ['minValue', 'min']));
      const max = num(first(item, ['maxValue', 'max']));
      const lowIsSmall = directionFrom(
        first(item, ['minLabel', 'min_label']) ?? options[0],
        first(item, ['maxLabel', 'max_label']) ?? options[options.length - 1],
      );
      if (min !== null && max !== null && max > min && lowIsSmall !== null) {
        scale = { center: (min + max) / 2, half: (max - min) / 2, lowIsSmall };
      } else if (/centered/i.test(type) && options.length === 3 && lowIsSmall !== null) {
        scale = { center: 3, half: 2, lowIsSmall };
      } else if (/centered/i.test(type) && 'midLabel' in item && lowIsSmall !== null) {
        // Okendo stores a centred range from -1 to 1 and shows it as "a scale of minus 2 to 2":
        // 0.5 is drawn at 75% ("Rated 1.0"). A value outside -1..1 is not on that scale.
        const v = num(item.value);
        if (v !== null && Math.abs(v) <= 1) scale = { center: 0, half: 1, lowIsSmall };
      }
      push(answer(label, first(item, ['value', 'answer', 'values', 'displayName']), scale));
    }
  }

  // Answers stated directly on the review: { heightRange: "6'2\" - 6'3\"", weightRange: "200lb or over" }.
  for (const [key, label] of [['heightRange', 'height'], ['height', 'height'], ['weightRange', 'weight'], ['weight', 'weight'], ['bodyType', 'body type'], ['usualSize', 'usual size'], ['usual_size', 'usual size']]) {
    const value = review[key];
    if (typeof value === 'string' || typeof value === 'number') push(answer(label, value));
  }
  // A fit word stated directly: { fit: "Runs small" }. A bare number needs a known scale (below).
  if (typeof review.fit === 'string' && !/^\d+(\.\d+)?$/.test(review.fit.trim())) push(answer('fit', review.fit));
  // Uniqlo's reviews ({ rate, purchasedSize, fit }) rate fit from 1 (tight) to 5 (loose), centred on 3;
  // the product summary averages it as "fit": 2.98, shown as true to size.
  if (typeof review.fit === 'number' && 'purchasedSize' in review && 'rate' in review) {
    push(answer('fit', review.fit, { center: 3, half: 2, lowIsSmall: true }));
  }

  // A size stated directly on the review: { size: "M" }, { sizePurchased: "L" }.
  for (const key of ['size', 'sizePurchased', 'size_purchased', 'purchasedSize', 'purchased_size', 'sizeOrdered', 'size_ordered', 'variantSize', 'variant_size']) {
    const value = review[key];
    if (typeof value === 'string' || typeof value === 'number') push(answer('size purchased', value));
  }

  // Variant options: product_options [{ name, value }], productVariants { Size: "M" }.
  if (Array.isArray(review.product_options)) {
    for (const item of review.product_options) {
      if (isObject(item)) push(answer(item.name ?? item.label, item.value));
    }
  }
  if (isObject(review.productVariants)) {
    for (const [name, value] of Object.entries(review.productVariants)) push(answer(name, value));
  }

  // Bazaarvoice: ContextDataValues, AdditionalFields { id: { Value, ValueLabel, DimensionLabel } }.
  for (const key of ['ContextDataValues', 'AdditionalFields']) {
    const fields = review[key];
    if (!isObject(fields)) continue;
    for (const [id, field] of Object.entries(fields)) {
      if (!isObject(field)) continue;
      push(answer(first(field, ['DimensionLabel', 'Label']) ?? id, first(field, ['ValueLabel', 'Value'])));
    }
  }
  // Bazaarvoice SecondaryRatings { Fit: { Value, ValueRange, MinLabel, MaxLabel } }.
  // The range runs 1..ValueRange. Without end labels the low end is Bazaarvoice's "Runs small".
  if (isObject(review.SecondaryRatings)) {
    for (const [id, field] of Object.entries(review.SecondaryRatings)) {
      if (!isObject(field)) continue;
      const range = num(field.ValueRange);
      const lowIsSmall = directionFrom(field.MinLabel, field.MaxLabel) ?? true;
      const scale = range && range >= 3 ? { center: (range + 1) / 2, half: (range - 1) / 2, lowIsSmall } : null;
      push(answer(first(field, ['Label']) ?? id.replace(/_\d+$/, ''), field.Value, scale));
    }
  }

  // TurnTo: dimensions [{ dimensionLabel, value, valueLabels }] and profileAttributes.custom [{ label, value }].
  // A dimension's number is used only through its own value labels (1-based), never on a guessed scale.
  if (Array.isArray(review.dimensions)) {
    for (const item of review.dimensions) {
      if (!isObject(item)) continue;
      const labels = Array.isArray(item.valueLabels) ? item.valueLabels.map((l) => str(isObject(l) ? first(l, ['label', 'value', 'name']) : l)) : [];
      const v = num(item.value);
      const worded = v !== null && Number.isInteger(v) && v >= 1 && v <= labels.length ? labels[v - 1] : null;
      push(answer(item.dimensionLabel, worded));
    }
  }
  const profile = at(review, 'profileAttributes.custom');
  if (Array.isArray(profile)) {
    for (const item of profile) if (isObject(item)) push(answer(item.label, item.value));
  }

  // Stamped and others: arrays of { k, v } / { key, value } / { question, answer } pairs.
  for (const key of ['reviewOptionsList', 'options', 'survey_answers', 'surveyAnswers', 'answers', 'customQuestions', 'properties']) {
    const list = review[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isObject(item)) continue;
      const label = first(item, ['label', 'k', 'question', 'title', 'name', 'key']) ?? at(item, 'survey_question.title') ?? at(item, 'question.title');
      push(answer(label, first(item, ['v', 'value', 'answer', 'response'])));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Turning answers into fields
// ---------------------------------------------------------------------------------------------

/** "Size", or a question about the size bought, with or without a prefix ("Mens What Size Did You Purchase"). */
const SIZE_BOUGHT_LABEL =
  /^(size|sizes?)\??$|\b(size (purchased|ordered|bought|worn|selected|chosen|received)|purchased size|ordered size|what size did you (buy|order|purchase|get|choose)|which size did you (buy|order|purchase|get|choose)|size you (bought|ordered|purchased))\b/i;
const USUAL_SIZE_LABEL = /usual(ly)? (wear|size)|normally wear|typical(ly)? (wear|size)|what size do you (usually|normally|typically)/i;
const FIT_LABEL = /\bfits?\b|sizing|true to size|how (did|does|do) (it|they|this|the \w+) fit|runs? (small|large|big)|size rating/i;
const HEIGHT_LABEL = /\bheight\b|how tall/i;
const BUILD_LABEL = /\bweight\b|body (type|shape)|\bbuild\b/i;

const STRICT_SIZE =
  /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|1X|2X|3X|SMALL|MEDIUM|LARGE|X-?SMALL|X-?LARGE|XX-?LARGE|EXTRA[ -]SMALL|EXTRA[ -]LARGE|ONE SIZE|\d{1,2}(\.\d)?)$/i;

/** The size token in a variant title such as "Small / Navy" or "XL - 44". Letter sizes win. */
export function sizeFromVariantTitle(title: string): string | null {
  const parts = title.split(/\s*[\/|,–—]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  const letter = parts.find((p) => STRICT_SIZE.test(p) && !/^\d/.test(p));
  if (letter) return letter;
  const numeric = parts.find((p) => STRICT_SIZE.test(p));
  return numeric ?? null;
}

/** "Runs Small", "Slightly Small", "True to Size", "Slightly Large", "Runs Large", or null. */
export function fitTagFromAnswer(a: ReviewAnswer): string | null {
  if (a.numeric !== null && a.scale) {
    const offset = a.numeric - a.scale.center;
    if (Math.abs(offset) < 1e-9) return 'True to Size';
    const towardLarge = a.scale.lowIsSmall ? offset > 0 : offset < 0;
    const strong = Math.abs(offset) / a.scale.half >= 0.75;
    return `${strong ? 'Runs' : 'Slightly'} ${towardLarge ? 'Large' : 'Small'}`;
  }
  const text = a.value ?? '';
  if (!text || /^\d+(\.\d+)?$/.test(text)) return null; // a bare number on an unknown scale
  if (/true to size|just right|perfect|as expected|fits? (as expected|well|great)|accurate/i.test(text)) return 'True to Size';
  const mild = /slightly|a bit|a little|somewhat|kind of|sort of/i.test(text);
  if (SMALL_WORDS.test(text) && !LARGE_WORDS.test(text)) return `${mild ? 'Slightly' : 'Runs'} Small`;
  if (LARGE_WORDS.test(text) && !SMALL_WORDS.test(text)) return `${mild ? 'Slightly' : 'Runs'} Large`;
  return null;
}

function fieldsFromAnswers(answers: ReviewAnswer[]): Partial<RawScrapedReview> {
  const out: Partial<RawScrapedReview> = {};
  for (const a of answers) {
    // An answer on a known scale is a fit rating, even when it is labelled "Size" (a Bazaarvoice or
    // Yotpo "Size" slider). Its number is never a size bought.
    if (a.scale && (FIT_LABEL.test(a.label) || /\bsize\b/i.test(a.label))) {
      if (!out.declaredFitTag) {
        const tag = fitTagFromAnswer(a);
        if (tag) out.declaredFitTag = tag;
      }
      continue;
    }
    if (!out.usualSize && USUAL_SIZE_LABEL.test(a.label) && a.value) {
      out.usualSize = a.value;
    } else if (/\bfits?\b/i.test(a.label) && FIT_LABEL.test(a.label)) {
      // "How did the size you ordered fit?" is a fit question, not the size bought.
      if (!out.declaredFitTag) {
        const tag = fitTagFromAnswer(a);
        if (tag) out.declaredFitTag = tag;
      }
    } else if (SIZE_BOUGHT_LABEL.test(a.label) && a.value) {
      // An exact size ("XXL") beats free text ("XXL only size available") from another answer.
      const exact = sizeFromVariantTitle(a.value);
      if (!out.sizePurchased || (exact && !sizeFromVariantTitle(out.sizePurchased))) out.sizePurchased = exact ?? a.value;
    } else if (!out.declaredFitTag && FIT_LABEL.test(a.label)) {
      const tag = fitTagFromAnswer(a);
      if (tag) out.declaredFitTag = tag;
    } else if (!out.reviewerHeight && HEIGHT_LABEL.test(a.label) && a.value) {
      out.reviewerHeight = a.value;
    } else if (!out.reviewerBuild && BUILD_LABEL.test(a.label) && a.value) {
      out.reviewerBuild = a.value;
    }
  }
  return out;
}

const PRODUCT_KEY_PATHS = [
  'productId', 'product_id', 'ProductId', 'productExternalId', 'product_external_id', 'productSKU', 'productHandle',
  'product_handle', 'product.shopify_id', 'product.external_id', 'product.shopify_handle', 'product.handle', 'product.id',
  'product_variant.product_external_id', 'shopProductId', 'catItem.sku', 'product_page_id', 'reviewed_product.product_id',
];
const PRODUCT_NAME_PATHS = ['productName', 'product_name', 'OriginalProductName', 'product.name', 'product.title', 'groupingData.productName', 'catItem.title', 'reviewed_product.title'];

function authorOf(obj: Json): string {
  for (const path of AUTHOR_PATHS) {
    const v = at(obj, path);
    const s = typeof v === 'string' ? str(v) : null;
    if (s) return s;
  }
  const firstName = str(firstPath(obj, ['customer.first_name', 'reviewer.first_name', 'first_name', 'user.firstName', 'firstName']));
  const lastName = str(firstPath(obj, ['customer.last_name', 'reviewer.last_name', 'last_name', 'user.lastName', 'lastName']));
  if (firstName) return lastName ? `${firstName} ${lastName.charAt(0)}.` : firstName;
  return 'Anonymous';
}

function verifiedOf(obj: Json): boolean {
  const v = first(obj, ['verifiedBuyer', 'verified_buyer', 'isVerifiedBuyer', 'verified', 'isVerified', 'verifiedPurchase']);
  if (v === true || v === 1 || v === 'true' || v === '1') return true;
  const badges = obj.Badges;
  if (isObject(badges) && Object.keys(badges).some((k) => /verified/i.test(k))) return true;
  return false;
}

/** A date as text. Unix timestamps (seconds or milliseconds) become ISO dates. */
function dateOf(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1e9) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  return str(v) ?? '';
}

/** One review object to a scraped review. */
export function reviewFromJson(raw: Json, index: number): JsonReview | null {
  if (!looksLikeReview(raw)) return null;
  const obj = flattenReview(raw);
  const rating = normalizeRating(first(obj, RATING_KEYS), obj.bestRating)!;
  const fields = fieldsFromAnswers(reviewAnswers(obj));
  const variantTitle = str(firstPath(obj, ['product_variant.title', 'productVariantName', 'variantName', 'variant_title', 'variant.title']));
  // Last, the size the review text states ("I ordered a large"), as for markup and JSON-LD reviews.
  const sizePurchased =
    fields.sizePurchased ?? (variantTitle ? sizeFromVariantTitle(variantTitle) : null) ?? extractSizeFromReviewText(bodyOf(obj) ?? '');
  const productKeys = PRODUCT_KEY_PATHS.map((p) => str(at(obj, p))?.toLowerCase().replace(/^shopify-/, '')).filter((k): k is string => !!k);
  return {
    id: str(first(obj, ID_KEYS)) ?? `json-${index}`,
    author: authorOf(obj),
    sizePurchased,
    usualSize: fields.usualSize,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    title: str(first(obj, TITLE_KEYS)) ?? '',
    body: bodyOf(obj) ?? str(first(obj, TITLE_KEYS)) ?? '',
    date: dateOf(first(obj, DATE_KEYS)),
    verifiedPurchase: verifiedOf(obj),
    reviewerHeight: fields.reviewerHeight,
    reviewerBuild: fields.reviewerBuild,
    declaredFitTag: fields.declaredFitTag,
    productKeys: [...new Set(productKeys)],
    productName: str(firstPath(obj, PRODUCT_NAME_PATHS)),
  };
}

/** The product review total a response states. Shop-wide totals (Stamped totalAll) are ignored. */
const TOTAL_PATHS = [
  'bottomline.totalReview', 'bottomline.total_review', 'TotalResults', 'response.TotalResults', 'pagination.total',
  'rollup.review_count', 'data.rollup.review_count', 'results.0.rollup.review_count',
  'summary.review_count', 'reviewAggregate.reviewCount', 'aggregate.reviewCount', 'total_reviews', 'totalReviews',
  'reviewCount', 'review_count', 'number_of_reviews', 'total',
];

function reportedTotalOf(root: unknown): number | null {
  if (!isObject(root)) return null;
  for (const path of TOTAL_PATHS) {
    const v = num(at(root, path));
    if (v !== null && v >= 0 && Number.isInteger(v)) return v;
  }
  return null;
}

/** Finds every review in a JSON value. Does not descend into a review once found. */
/** Totals stated beside a review list: { total: 2, items: [...] }. */
/** Not "count": it is often the page size, not the store's total. */
const CONTAINER_TOTAL_KEYS = ['total', 'totalCount', 'total_count', 'totalResults', 'TotalResults', 'totalReviews', 'total_reviews', 'reviewCount', 'review_count', 'numberOfReviews'];

export function extractReviewsFromJson(root: unknown): JsonReviewSet {
  const reviews: JsonReview[] = [];
  const seen = new Set<unknown>();
  let containerTotal: number | null = null;
  const walk = (v: unknown, depth: number, parent: Json | null = null) => {
    if (depth > 40 || v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      const before = reviews.length;
      for (const item of v) walk(item, depth + 1);
      if (reviews.length > before && parent && containerTotal === null) {
        for (const key of CONTAINER_TOTAL_KEYS) {
          const total = num(parent[key]);
          if (total !== null && Number.isInteger(total) && total >= 0) {
            containerTotal = total;
            break;
          }
        }
        // Nested beside the list: { pagination: { total }, reviews: [...] }.
        if (containerTotal === null) containerTotal = reportedTotalOf(parent);
      }
      return;
    }
    const review = reviewFromJson(v as Json, reviews.length);
    if (review) {
      reviews.push(review);
      return;
    }
    for (const child of Object.values(v)) walk(child, depth + 1, v as Json);
  };
  walk(root, 0);
  return { reviews, reportedTotal: reviews.length > 0 ? (reportedTotalOf(root) ?? containerTotal) : null };
}

/** Parses a response body, or null when it is not JSON. */
export function parseJsonBody(body: string): unknown {
  const t = body.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Keeping only this product's reviews
// ---------------------------------------------------------------------------------------------

export interface ProductIdentity {
  /** Ids, SKUs and handles the page states for its product, lowercased. */
  keys: string[];
  /** The product name on the page. */
  name: string | null;
  /**
   * Every long number in the page source (ids in framework state, analytics, widgets). Used only to
   * recognise the page's own review widget when the page states its product id nowhere else.
   */
  knownIds?: ReadonlySet<string>;
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[®™]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Same product: a shared id or handle, or one name that starts with the other ("Strato Tech Tee | Acorn"). */
export function reviewMatchesProduct(
  review: Pick<JsonReview, 'productKeys' | 'productName'>,
  responseKeys: string[],
  product: ProductIdentity,
): boolean | null {
  const keys = review.productKeys.length > 0 ? review.productKeys : responseKeys;
  if (keys.length > 0 && product.keys.length > 0) {
    if (keys.some((k) => product.keys.includes(k))) return true;
  }
  if (review.productName && product.name) {
    const a = normName(review.productName.split('|')[0]);
    const b = normName(product.name.split('|')[0]);
    if (a && b && (a.startsWith(b) || b.startsWith(a))) return true;
  }
  if (keys.length === 0 && !review.productName) return null; // names no product
  return false;
}

/** Long digit runs and path segments of a response URL, as product keys ("/product/8016253780042/reviews"). */
export function keysFromUrl(url: string): string[] {
  try {
    const u = new URL(url);
    const parts = [...u.pathname.split('/'), ...[...u.searchParams.values()].flatMap((v) => v.split(/[:,=]/))];
    return [...new Set(parts.map((p) => decodeURIComponent(p).toLowerCase()).filter((p) => /^\d{5,}$/.test(p) || /^shopify-\d+$/.test(p)).map((p) => p.replace(/^shopify-/, '')))];
  } catch {
    return [];
  }
}

export interface JsonSource {
  /** Where the JSON came from: a response URL, or "page:" + script id for data embedded in the page. */
  url: string;
  value: unknown;
}

export interface CollectedJsonReviews {
  reviews: JsonReview[];
  /** The largest product total stated by a source whose reviews were kept, or null. */
  reportedTotal: number | null;
  /** Hosts (or "page") whose reviews were kept. */
  sources: string[];
}

/**
 * A review's identity: its id, or the start of its text when it has none. Two reviews with different
 * ids are two reviews even when their text matches (a shopper who submitted twice): the store counts both.
 */
export function reviewIdentity(review: Pick<RawScrapedReview, 'id' | 'author' | 'body'>): string {
  if (!review.id.startsWith('json-')) return `id:${review.id}`;
  // No id: the reviewer and the text together. Two shoppers who both wrote "Great shirt!" are two reviews.
  const body = review.body.toLowerCase().replace(/\s+/g, ' ').trim();
  return `body:${review.author.toLowerCase()}:${body.slice(0, 60)}`;
}

function dedupeKey(review: JsonReview): string[] {
  return [reviewIdentity(review)];
}

/**
 * Reviews from every JSON source a page gave, kept only when they belong to the page's product.
 * A source whose reviews all name other products (a "recently viewed" or shop-wide carousel) is
 * dropped. A review that names no product is kept when its source names none either, or when the
 * source also holds reviews that match this product. The same review from two sources counts once.
 */
export function collectJsonReviews(sources: JsonSource[], product: ProductIdentity): CollectedJsonReviews {
  const kept: JsonReview[] = [];
  const seen = new Set<string>();
  const hosts = new Set<string>();
  let reportedTotal: number | null = null;
  const sets = sources.map((source) => {
    const set = extractReviewsFromJson(source.value);
    const urlKeys = source.url.startsWith('page:') ? [] : keysFromUrl(source.url);
    return { source, set, urlKeys, verdicts: set.reviews.map((r) => reviewMatchesProduct(r, urlKeys, product)) };
  });
  // When some response is known to be this product's, a response whose reviews name no product at
  // all is another widget on the page ("complete the look", recently viewed). Page data is kept.
  const someSourceMatches = sets.some((s) => s.verdicts.includes(true));
  // No response names this product by the page's ids, yet every review request the page made is for one
  // product, and that id is in the page source: that is the page's own review widget (the reviews carry
  // the review service's own product ids, which the page never states). A carousel asks for several.
  const requested = sets.filter((s) => s.set.reviews.length > 0 && s.urlKeys.length > 0);
  const requestedIds = new Set(requested.flatMap((s) => s.urlKeys));
  const widgetNamed =
    !someSourceMatches && requestedIds.size === 1 && !!product.knownIds && product.knownIds.has([...requestedIds][0]);
  // This product's own review list. Stores group reviews of colourways or editions under one product
  // (Okendo "areReviewsGrouped", Klaviyo grouped ids), so its reviews may name sibling products.
  // A list is this product's when its URL names the product, when it states a product total and
  // holds a review of this product, or when at least half its reviews are this product's. Later pages
  // of that list come from the same address path and are this product's too, whatever they hold.
  const ownListOf = ({ set, urlKeys, verdicts }: (typeof sets)[number]) => {
    const matched = verdicts.filter((v) => v === true).length;
    return (
      urlKeys.some((k) => product.keys.includes(k)) ||
      (widgetNamed && urlKeys.length > 0) ||
      (matched > 0 && set.reportedTotal !== null) ||
      (set.reviews.length > 0 && matched * 2 >= set.reviews.length)
    );
  };
  // Endpoints that serve many widgets from one address (GraphQL, batch calls) are not one list.
  const sharedEndpoint = (url: string) => /graphql|\/batch(\.json)?\/?$|\/widgets?\/fetch/i.test(pathOf(url));
  const ownPaths = new Set(
    sets.filter((s) => s.set.reviews.length > 0 && ownListOf(s) && !sharedEndpoint(s.source.url)).map((s) => pathOf(s.source.url)),
  );
  for (const entry of sets) {
    const { source, set, verdicts } = entry;
    if (set.reviews.length === 0) continue;
    const anyMatch = verdicts.includes(true);
    const anyOther = verdicts.includes(false);
    const ownList =
      ownListOf(entry) ||
      (!source.url.startsWith('page:') && !sharedEndpoint(source.url) && ownPaths.has(pathOf(source.url)));
    if (anyOther && !anyMatch && !ownList) continue;
    if (!anyMatch && !ownList && someSourceMatches && !source.url.startsWith('page:')) continue;
    let added = 0;
    set.reviews.forEach((review, i) => {
      if (!ownList && verdicts[i] === false) return;
      if (!ownList && verdicts[i] === null && anyOther) return;
      const keys = dedupeKey(review);
      if (keys.some((k) => seen.has(k))) return;
      keys.forEach((k) => seen.add(k));
      kept.push(review);
      added++;
    });
    if (added > 0 || anyMatch) {
      hosts.add(source.url.startsWith('page:') ? 'page' : safeHost(source.url));
      if (set.reportedTotal !== null) reportedTotal = Math.max(reportedTotal ?? 0, set.reportedTotal);
    }
  }
  return { reviews: kept, reportedTotal, sources: [...hosts] };
}

/** Origin and path of a URL, without its query: pages of one list share it. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
