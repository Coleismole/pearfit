// Decides whether a scraped product is an adult men's short-sleeve t-shirt.
// The engine only compares short-sleeve tees, so a page that does not say so is dropped.
// A missing sleeve, audience, or garment type is a rejection, never a guess.
import * as cheerio from 'cheerio';
import { inferCategory, TEE_CATEGORY } from './server/scrapeHtml.ts';

export { TEE_CATEGORY };

export interface TeeAttribute {
  name: string;
  value: string;
}

/** What the product page itself states. Navigation chrome is not included. */
export interface TeeEvidence {
  title: string | null;
  breadcrumbs: string[];
  categories: string[];
  /** Product gender field values as the page states them ("men", "m", "MEN", "unisex"). */
  genders: string[];
  /** The sleeve-length attribute, when the page has that field. Null when it does not. */
  sleeve: string | null;
  attributes: TeeAttribute[];
  /** schema.org suggestedMinAge, when the page states one. */
  minAge: number | null;
}

export type TeeRejectReason =
  | 'kids or youth'
  | "women's"
  | 'unisex, not sized for men'
  | 'ambiguous audience'
  | 'long sleeve'
  | '3/4 sleeve'
  | 'sleeveless or tank'
  | 'polo'
  | 'henley'
  | 'hoodie or sweatshirt'
  | 'button-up'
  | 'jersey'
  | 'base layer or compression'
  | 'not a t-shirt'
  | 'not the t-shirt category'
  | 'conflicting sleeve length'
  | 'ambiguous sleeve length';

export type TeeDecision =
  | { keep: true; unisex: boolean; because: string[] }
  | { keep: false; reason: TeeRejectReason };

type Audience = 'men' | 'women' | 'kids' | 'unisex';

const KIDS = /\b(kids?|boys?|girls?|youth|toddlers?|infants?|baby|babies|children|child|preschool|grade school|big kids|little kids)\b/i;
const WOMEN = /\b(women|woman|womens|ladies|female)\b/i;
const MEN = /\b(men|man|mens|male)\b/i;
const UNISEX = /\b(unisex|gender[\s-]?neutral)\b/i;
const LONG_SLEEVE = /\blong[\s-]*sleeves?\b/i;
const THREE_QUARTER = /\b(?:3\/4|three[\s-]?quarter)[\s-]*sleeves?\b/i;
const SLEEVELESS = /\bsleeveless\b|\btank(?:\s*tops?)?\b|\bmuscle tanks?\b/i;
const POLO = /\bpolos?\b/i;
const HENLEY = /\bhenleys?\b/i;
const HOODIE = /\bhoodies?\b|\bsweat\s?shirts?\b/i;
const BUTTON = /\bbutton[\s-]?(?:up|down|front)s?\b/i;
const JERSEY = /\bjerseys?\b/i;
const BASE = /\bbase[\s-]?layers?\b|\bcompression\b|\binnerwear\b|\bunderwear\b|\bundershirts?\b|\bthermals?\b/i;
const TEE = /\bt[\s-]?shirts?\b|\btees?\b|\bt_shirts?\b/i;
const SHORT_SLEEVE = /\bshort[\s-]*sleeves?\b/i;
const SS_TOP = /^ss tops?$/i;
const LS_TOP = /^ls tops?$/i;

export function emptyTeeEvidence(): TeeEvidence {
  return { title: null, breadcrumbs: [], categories: [], genders: [], sleeve: null, attributes: [], minAge: null };
}

/** Title, breadcrumbs, categories, the sleeve field, and product attributes. Not a description paragraph. */
function linesOf(evidence: TeeEvidence): string[] {
  return [evidence.title, evidence.sleeve, ...evidence.breadcrumbs, ...evidence.categories, ...evidence.attributes.map((a) => `${a.name} ${a.value}`)].filter(
    (line): line is string => Boolean(line && line.trim()),
  );
}

function segmentsOf(evidence: TeeEvidence): string[] {
  return [...evidence.breadcrumbs, ...evidence.categories].flatMap((part) =>
    part
      .split(/\s*(?:>|\/|\|)\s*/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function textAudience(text: string): Set<Audience> {
  const found = new Set<Audience>();
  if (KIDS.test(text)) found.add('kids');
  if (WOMEN.test(text)) found.add('women');
  const withoutWomen = text.replace(/\bwomen(?:'s|s)?\b/gi, ' ');
  if (MEN.test(withoutWomen)) found.add('men');
  if (UNISEX.test(text)) found.add('unisex');
  return found;
}

/** A gender field value, not free text. "m" is men; the letter inside a sentence is not. */
function fieldAudience(raw: string): Audience | null {
  const value = raw.trim().toLowerCase();
  if (/^(m|male|man|men|mens)$/.test(value)) return 'men';
  if (/^(f|w|female|woman|women|womens)$/.test(value)) return 'women';
  if (/^(u|unisex|gender neutral|gender-neutral)$/.test(value)) return 'unisex';
  if (/^(kids?|boys?|girls?|youth|toddler|infant|baby)$/.test(value)) return 'kids';
  return null;
}

function audienceOf(evidence: TeeEvidence): Set<Audience> {
  const found = new Set<Audience>();
  for (const gender of evidence.genders) {
    const field = fieldAudience(gender);
    if (field) found.add(field);
    else for (const token of textAudience(gender)) found.add(token);
  }
  for (const text of [evidence.title, ...segmentsOf(evidence)].filter((t): t is string => Boolean(t))) {
    for (const token of textAudience(text)) found.add(token);
  }
  if (evidence.minAge !== null && evidence.minAge < 13) found.add('kids');
  return found;
}

function matches(re: RegExp, lines: string[]): boolean {
  return lines.some((line) => re.test(line));
}

function jerseyGarment(evidence: TeeEvidence): boolean {
  const title = evidence.title ?? '';
  if (TEE.test(title)) return false;
  if (JERSEY.test(title)) return true;
  return segmentsOf(evidence).some((segment) => /^jerseys?$/i.test(segment));
}

function sleeveValue(sleeve: string | null): 'short' | 'long' | 'three-quarter' | 'sleeveless' | 'other' | null {
  if (!sleeve) return null;
  const value = sleeve.trim().toLowerCase();
  if (/^(short|ss|short[\s-]*sleeve)$/.test(value)) return 'short';
  if (/^(long|ls|long[\s-]*sleeve)$/.test(value)) return 'long';
  if (/^(3\/4|three[\s-]?quarter|three[\s-]?quarter sleeve)$/.test(value)) return 'three-quarter';
  if (/^(sleeveless|none|tank)$/.test(value)) return 'sleeveless';
  return 'other';
}

/**
 * Keep only when the page confirms adult men's (or unisex sized as men's) short-sleeve t-shirt,
 * and the category stored in Supabase would be the t-shirt category (`T-Shirts & Tops`).
 * A tee whose sleeve length is not stated is dropped.
 */
export function classifyMensShortSleeveTee(evidence: TeeEvidence): TeeDecision {
  const lines = linesOf(evidence);
  const segments = segmentsOf(evidence);
  const audience = audienceOf(evidence);

  if (audience.has('kids')) return { keep: false, reason: 'kids or youth' };
  if (audience.has('women') && !audience.has('men')) return { keep: false, reason: "women's" };
  if (!audience.has('men') && audience.has('unisex')) return { keep: false, reason: 'unisex, not sized for men' };
  if (!audience.has('men')) return { keep: false, reason: 'ambiguous audience' };

  const sleeve = sleeveValue(evidence.sleeve);
  const long = sleeve === 'long' || matches(LONG_SLEEVE, lines) || segments.some((s) => LS_TOP.test(s));
  const threeQuarter = sleeve === 'three-quarter' || matches(THREE_QUARTER, lines);
  const sleeveless = sleeve === 'sleeveless' || matches(SLEEVELESS, lines);
  const short = sleeve === 'short' || matches(SHORT_SLEEVE, lines) || segments.some((s) => SS_TOP.test(s) || /^ss[- ](crew|v-?neck)s?$/i.test(s));

  if (long && short) return { keep: false, reason: 'conflicting sleeve length' };
  if (long) return { keep: false, reason: 'long sleeve' };
  if (threeQuarter) return { keep: false, reason: '3/4 sleeve' };
  if (sleeveless) return { keep: false, reason: 'sleeveless or tank' };
  if (matches(POLO, lines)) return { keep: false, reason: 'polo' };
  if (matches(HENLEY, lines)) return { keep: false, reason: 'henley' };
  if (matches(HOODIE, lines)) return { keep: false, reason: 'hoodie or sweatshirt' };
  if (matches(BUTTON, lines)) return { keep: false, reason: 'button-up' };
  // "Jersey" in a tee name is the fabric ("Smooth Jersey T-Shirt"). A jersey garment is not a tee.
  if (jerseyGarment(evidence)) return { keep: false, reason: 'jersey' };
  if (matches(BASE, lines)) return { keep: false, reason: 'base layer or compression' };
  if (!matches(TEE, lines)) return { keep: false, reason: 'not a t-shirt' };
  if (!short) return { keep: false, reason: 'ambiguous sleeve length' };
  // Same value commercial_skus.category gets. A department that also says fleece does not override a t-shirt name.
  const storedCategory = inferCategory(...evidence.categories, evidence.title);
  if (storedCategory !== TEE_CATEGORY) return { keep: false, reason: 'not the t-shirt category' };

  const because = ['adult men', 'short sleeve', 't-shirt'];
  const unisex = audience.has('unisex') || audience.has('women');
  if (unisex) because.push('flagged unisex; sized for men');
  return { keep: true, unisex, because };
}

// ---- reading the page ----

function parseAssignedJson(html: string, marker: string): unknown | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
}

function pushUnique(list: string[], value: string | null | undefined): void {
  if (!value) return;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text && !list.includes(text)) list.push(text);
}

function applyUniqlo(html: string, evidence: TeeEvidence): void {
  const state = asRecord(parseAssignedJson(html, 'window.__PRELOADED_STATE__'));
  const entities = asRecord(asRecord(state?.entity)?.pdpEntity);
  if (!entities) return;
  for (const entry of Object.values(entities)) {
    const product = asRecord(asRecord(entry)?.product);
    if (!product) continue;
    evidence.title = evidence.title ?? asText(product.name);
    for (const key of ['genderName', 'genderCategory', 'sizeGender']) pushUnique(evidence.genders, asText(product[key]));
    const tops = product.topCategories;
    if (Array.isArray(tops)) for (const top of tops) pushUnique(evidence.genders, asText(top));
    const crumbs = asRecord(product.breadcrumbs);
    if (crumbs) {
      for (const level of ['gender', 'class', 'category', 'subcategory']) {
        const name = asText(asRecord(crumbs[level])?.locale) ?? asText(asRecord(crumbs[level])?.name);
        pushUnique(evidence.breadcrumbs, name);
      }
    }
    const tags = product.tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        const row = asRecord(tag);
        if (!row) continue;
        const name = asText(row.groupName) ?? asText(row.group) ?? 'tag';
        const value = asText(row.tagName) ?? asText(row.tag);
        if (!value) continue;
        evidence.attributes.push({ name, value });
        if ((asText(row.group) ?? '').toLowerCase() === 'sleeve' && !evidence.sleeve) evidence.sleeve = value;
      }
    }
    return;
  }
}

function applyGymsharkState(state: Record<string, unknown>, evidence: TeeEvidence): void {
  const product = asRecord(asRecord(asRecord(asRecord(state.props)?.pageProps)?.productData)?.product);
  if (!product) return;
  evidence.title = evidence.title ?? asText(product.title);
  const genders = product.gender;
  if (Array.isArray(genders)) for (const gender of genders) pushUnique(evidence.genders, asText(gender));
  for (const key of ['type', 'category', 'subcategory']) {
    const value = asText(product[key]);
    pushUnique(evidence.categories, value);
  }
}

function applyNikeState(state: Record<string, unknown>, evidence: TeeEvidence): void {
  const groups = asRecord(state.props)?.pageProps;
  const pageProps = asRecord(groups);
  const productGroups = pageProps?.productGroups;
  if (!Array.isArray(productGroups)) return;
  for (const group of productGroups) {
    const products = asRecord(asRecord(group)?.products);
    if (!products) continue;
    const product = asRecord(Object.values(products)[0]);
    if (!product) continue;
    const info = asRecord(product.productInfo);
    const joined = [asText(info?.title), asText(info?.subtitle)].filter(Boolean).join(' ');
    evidence.title = evidence.title ?? asText(info?.fullTitle) ?? (joined || null);
    const genders = product.genders;
    if (Array.isArray(genders)) for (const gender of genders) pushUnique(evidence.genders, asText(gender));
    const labels = asRecord(product.taxonomyLabels);
    if (labels) {
      for (const [name, value] of Object.entries(labels)) {
        const values = Array.isArray(value) ? value.map((item) => asText(item)).filter((item): item is string => Boolean(item)) : [];
        if (name.toLowerCase() === 'gender') for (const gender of values) pushUnique(evidence.genders, gender);
        else for (const item of values) pushUnique(evidence.categories, item);
      }
    }
    if (product.isJerseyID === true) pushUnique(evidence.categories, 'jersey');
    const subtitle = asText(info?.subtitle);
    if (subtitle) pushUnique(evidence.categories, subtitle);
    return;
  }
}

function applyJsonLd(html: string, evidence: TeeEvidence): void {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes: unknown[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) for (const item of value) walk(item);
      else if (asRecord(value)) {
        nodes.push(value);
        for (const child of Object.values(asRecord(value)!)) walk(child);
      }
    };
    walk(parsed);
    for (const node of nodes) {
      const record = asRecord(node);
      if (!record) continue;
      const type = asText(record['@type'])?.toLowerCase();
      if (type !== 'product' && type !== 'productgroup') continue;
      evidence.title = evidence.title ?? asText(record.name);
      const category = record.category;
      if (typeof category === 'string') pushUnique(evidence.categories, category);
      else if (Array.isArray(category)) for (const item of category) pushUnique(evidence.categories, asText(item));
      const audience = asRecord(record.audience);
      const gender = asText(audience?.suggestedGender);
      if (gender) pushUnique(evidence.genders, gender.replace(/^https?:\/\/schema\.org\//i, ''));
      const minAge = audience?.suggestedMinAge;
      if (typeof minAge === 'number' && evidence.minAge === null) evidence.minAge = minAge;
      const props = record.additionalProperty;
      if (Array.isArray(props)) {
        for (const prop of props) {
          const row = asRecord(prop);
          if (!row) continue;
          const name = asText(row.name) ?? asText(row.propertyID);
          const value = asText(row.value);
          if (!name || !value) continue;
          evidence.attributes.push({ name, value });
          if (/sleeve/i.test(name) && !evidence.sleeve) evidence.sleeve = value;
        }
      }
    }
  }
}

function applyDom(html: string, evidence: TeeEvidence): void {
  const $ = cheerio.load(html);
  if (!evidence.title) {
    evidence.title =
      $('meta[property="og:title"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
      $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      null;
  }
  if (evidence.breadcrumbs.length === 0) {
    $('[aria-label="Breadcrumbs"] a, nav[aria-label="breadcrumb"] a').each((_i, el) => {
      pushUnique(evidence.breadcrumbs, $(el).text());
    });
  }
  if (!evidence.sleeve) {
    $('tr, li, dt').each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const match = text.match(/sleeve(?:\s*length)?\s*[:|]?\s*(short|long|sleeveless|3\/4|three[\s-]?quarter)\b/i);
      if (match && !evidence.sleeve) evidence.sleeve = match[1] ?? null;
    });
  }
}

/** A JSON array that starts at `start` (the '['). Null when it is not a string array. */
function parseStringArray(html: string, start: number): string[] | null {
  if (html[start] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length && i < start + 8000; i++) {
    const ch = html[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(start, i + 1)) as unknown;
          if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return null;
          return parsed as string[];
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Shopify product tags and type embedded on the product page (var meta, the product's tags array).
 * A "ss-crew" tag is that store's short-sleeve crew. "short-length" is a body length, not a sleeve.
 */
function applyShopifyProduct(html: string, evidence: TeeEvidence): void {
  // The product object names the shirt. og:title on some pages is the store slogan.
  const predicted = asRecord(parseAssignedJson(html, 'var predictProduct = '));
  const predictedTitle = asText(predicted?.title);
  if (predictedTitle) evidence.title = predictedTitle;
  else if (!evidence.title) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og?.[1]) evidence.title = og[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  const meta = asRecord(parseAssignedJson(html, 'var meta = '));
  const metaProduct = asRecord(meta?.product);
  const productType = asText(metaProduct?.type);
  if (productType) pushUnique(evidence.categories, productType);

  const tagRe = /["']?tags["']?\s*:\s*\[/g;
  let tags: string[] | null = null;
  for (const match of html.matchAll(tagRe)) {
    const start = html.indexOf('[', match.index ?? 0);
    const parsed = parseStringArray(html, start);
    if (!parsed || parsed.length < 2 || parsed.length > 80) continue;
    const blob = parsed.join('\n').toLowerCase();
    if (/\bdep_mens\b|\bmens\b|\bmale\b|short sleeve|ss-crew|ss-v-neck|subcategory:/.test(blob)) {
      tags = parsed;
      break;
    }
  }
  for (const tag of tags ?? []) absorbShopifyTag(tag, evidence);
  if (productType) absorbShopifyType(productType, evidence);
}

function absorbShopifyTag(tag: string, evidence: TeeEvidence): void {
  const low = tag.trim().toLowerCase();
  if (low === 'mens' || low === 'men' || low === 'male' || low === 'dep_mens') {
    pushUnique(evidence.genders, 'men');
    return;
  }
  if (low === 'female' || low === 'women' || low === 'womens' || low === 'dep_womens' || low.startsWith("women's") || low.startsWith('womens ')) {
    pushUnique(evidence.genders, 'women');
    return;
  }
  if (low === 'ss-crew' || low === 'ss-v-neck' || low === 'ss-vneck') {
    pushUnique(evidence.categories, 'short sleeve');
    pushUnique(evidence.categories, 't-shirt');
    return;
  }
  if (low === 'short-length-tee' || low === 'short-length') return;
  if (low.startsWith('subcategory:')) {
    const sub = low.slice('subcategory:'.length).trim();
    if (sub === 'tees and tanks') {
      if (/\btank\b/i.test(evidence.title ?? '')) pushUnique(evidence.categories, 'tank');
      else pushUnique(evidence.categories, 't-shirt');
    } else if (/tee|t-shirt/.test(sub)) pushUnique(evidence.categories, sub);
    else if (/shirt|oxford|polo/.test(sub)) pushUnique(evidence.categories, sub);
    return;
  }
  if (/short sleeve|long sleeve|sleeveless|\bpolos?\b|\bhenleys?\b|\btanks?\b|\btees?\b|\bt-?shirts?\b/.test(low)) {
    pushUnique(evidence.categories, tag.trim());
  }
}

function absorbShopifyType(productType: string, evidence: TeeEvidence): void {
  if (/^short sleeve (?!polo|henley|shirt\b)/i.test(productType) && /crew|v-?neck|tee/i.test(productType)) {
    pushUnique(evidence.categories, 't-shirt');
  }
}

/** Product fields the page states, for the short-sleeve men's check. A field the page omits stays empty. */
export function extractTeeEvidence(html: string): TeeEvidence {
  const evidence = emptyTeeEvidence();
  applyUniqlo(html, evidence);
  // Gymshark and Nike both embed the product in __NEXT_DATA__. Parse that blob once.
  const nextData = asRecord(parseAssignedJson(html, '<script id="__NEXT_DATA__" type="application/json">'));
  if (nextData) {
    applyGymsharkState(nextData, evidence);
    applyNikeState(nextData, evidence);
  }
  applyJsonLd(html, evidence);
  applyShopifyProduct(html, evidence);
  const fromStore = Boolean(evidence.title) && evidence.genders.length > 0 && (evidence.categories.length > 0 || evidence.breadcrumbs.length > 0 || evidence.sleeve !== null);
  if (!fromStore) applyDom(html, evidence);
  return evidence;
}
