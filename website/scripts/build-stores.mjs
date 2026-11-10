// Builds website/stores.json, the data behind stores.html, from webscraper/SUPPORTED_STORES.md.
//
//   node website/scripts/build-stores.mjs           write website/stores.json
//   node website/scripts/build-stores.mjs --check   exit 1 if the committed stores.json is stale (no write)
//
// The markdown stays the source of truth for now. Everything that reads it is in `loadSource` and the parser
// below, so switching to the machine-readable verified-stores list that is being built under webscraper/tools/
// means replacing those two and keeping `buildStores`' output shape. The output has no timestamp, so the same
// markdown always gives byte-identical JSON and a stale file shows up as a plain diff.
//
// Nothing is invented. A fact the markdown does not state is null (or "not_recorded" for the size chart): the
// supported-stores list records the review platform and whether reviews state the size bought and a fit
// answer for every store, but it records a size chart only for the size-chart-only store(s).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(root, 'webscraper', 'SUPPORTED_STORES.md');
const OUTPUT = path.join(root, 'website', 'stores.json');
const SOURCE_LABEL = 'webscraper/SUPPORTED_STORES.md';

// ---- Markdown reading ----

/** Drops the markdown the cells and notes use (bold, code) and collapses whitespace. */
export function clean(text) {
  return String(text).replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

/** Splits one table row on unescaped pipes. */
function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => clean(cell.replace(/\\\|/g, '|')));
}

const isSeparator = (cells) => cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));

/**
 * Every pipe table in the document with the heading it sits under: [{ heading, header, rows }].
 * Rows keep the header's column order; a short row is padded with empty strings.
 */
export function parseTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let heading = '';
  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      heading = clean(headingMatch[1]);
      continue;
    }
    if (!lines[i].trim().startsWith('|')) continue;
    const block = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      block.push(splitRow(lines[i]));
      i += 1;
    }
    i -= 1;
    if (block.length < 2 || !isSeparator(block[1])) continue;
    const header = block[0];
    const rows = block.slice(2).map((cells) => header.map((_, col) => cells[col] ?? ''));
    tables.push({ heading, header, rows });
  }
  return tables;
}

/** Bullet items ("- ..." with indented continuation lines) under each heading: [{ heading, text }]. Bold kept. */
export function parseBullets(markdown) {
  const items = [];
  let heading = '';
  let current = null;
  const flush = () => {
    if (current) items.push({ heading: current.heading, text: current.parts.join(' ').replace(/\s+/g, ' ').trim() });
    current = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      flush();
      heading = clean(headingMatch[1]);
    } else if (/^- /.test(line)) {
      flush();
      current = { heading, parts: [line.slice(2)] };
    } else if (current && /^\s+\S/.test(line)) {
      current.parts.push(line.trim());
    } else {
      flush();
    }
  }
  flush();
  return items;
}

// ---- Normalising what the cells say ----

/** "Uniqlo (CA)" -> "uniqlo-ca". Lowercase, dashes, as the site's other ids. */
export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const PLATFORMS = [
  [/bazaarvoice/i, 'Bazaarvoice'],
  [/yotpo/i, 'Yotpo'],
  [/okendo/i, 'Okendo'],
  [/stamped/i, 'Stamped'],
  [/klaviyo/i, 'Klaviyo Reviews'],
  [/powerreviews/i, 'PowerReviews'],
  [/turnto/i, 'TurnTo'],
  [/bayengage/i, 'BayEngage'],
  [/judge\.me/i, 'Judge.me'],
  [/junip/i, 'Junip'],
  [/reviews\.io/i, 'Reviews.io'],
];

/**
 * The review platform behind a "Reviews come from" cell. A named platform wins over wording about how the
 * reviews were reached ("through L.L.Bean's own endpoint" is still Bazaarvoice). Stores with no third-party
 * platform are "Store's own service", "Embedded in the page" or "Review pages"; anything else is "Other".
 */
export function platformOf(text) {
  for (const [pattern, name] of PLATFORMS) if (pattern.test(text)) return name;
  if (/embedded in the page|page markup|page's markup/i.test(text)) return 'Embedded in the page';
  if (/own (review )?(service|endpoint|data)/i.test(text)) return "Store's own service";
  if (/review pages/i.test(text)) return 'Review pages';
  return 'Other';
}

/** A "Size bought" or "Fit answer" cell as yes / sometimes / no (null when the cell says something else). */
export function answerLevel(text) {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (/^no\b/.test(value)) return 'no';
  if (/^yes\b/.test(value)) return 'yes';
  if (/rarely|few|some|from review text/.test(value)) return 'sometimes';
  return null;
}

/**
 * Why a store is not supported, as a kind. Refusals are checked first: those stores are never retried or got
 * around. kind is one of refused, unavailable, no_reviews, other.
 */
export function reasonKind(text) {
  if (/\b(403|418|429|503)\b|bot check|access denied|access to this page has been denied|does not allow automated|client challenge|challenge page/i.test(text)) return 'refused';
  if (/\b(404|500|502|504)\b|maintenance|did not answer|\bmoved\b/i.test(text)) return 'unavailable';
  if (/no reviews|no review data|no review text|no reviews yet/i.test(text)) return 'no_reviews';
  return 'other';
}

/** "A, B (x, y), C" -> ["A", "B (x, y)", "C"]: commas inside parentheses do not split. */
export function splitStoreList(text) {
  const names = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      names.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  names.push(current);
  return names.map((name) => name.trim()).filter(Boolean);
}

/** The name without a trailing "(...)", lowercased: how the same store in two rows is recognised. */
const looseName = (name) => name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

/**
 * Splits each "Known limits" bullet into sentences and gives every store named in bold (**Store**) the sentences
 * about it. A sentence with no bold name continues the previous sentence's stores. Returns Map(looseName -> notes[]).
 */
export function notesByStore(bullets) {
  const notes = new Map();
  const add = (key, sentence) => {
    const list = notes.get(key) ?? [];
    if (!list.includes(sentence)) list.push(sentence);
    notes.set(key, list);
  };
  for (const { text } of bullets) {
    let owners = [];
    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z*])/)) {
      const names = [...sentence.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1].trim().toLowerCase());
      if (names.length > 0) owners = names;
      for (const key of owners) add(key, clean(sentence));
    }
  }
  return notes;
}

// ---- The documents ----

const column = (header, wanted) => header.findIndex((name) => name.toLowerCase() === wanted);

/**
 * Markdown in, the site's data out:
 * { source, tested_on, platforms, supported: [...], not_supported: [...] }
 */
export function parseSupportedStores(markdown) {
  const tables = parseTables(markdown);
  const bullets = parseBullets(markdown).filter((item) => /^reviews and fit/i.test(item.heading));
  const notes = notesByStore(bullets);
  const noteFor = (name) => notes.get(looseName(name)) ?? [];

  const supported = [];
  const seen = new Set();

  for (const table of tables) {
    if (/^reviews and fit/i.test(table.heading)) {
      const at = (row, name) => {
        const index = column(table.header, name);
        return index === -1 ? '' : row[index];
      };
      for (const row of table.rows) {
        const name = at(row, 'store');
        if (!name || seen.has(slugify(name))) continue;
        seen.add(slugify(name));
        const reviewsFrom = at(row, 'reviews come from');
        supported.push({
          id: slugify(name),
          name,
          status: 'reviews',
          product_tested: at(row, 'product tested') || null,
          reviews_from: reviewsFrom || null,
          platform: platformOf(reviewsFrom),
          read_stated: at(row, 'read / stated') || null,
          size_bought: answerLevel(at(row, 'size bought')),
          size_bought_text: at(row, 'size bought') || null,
          fit_answer: answerLevel(at(row, 'fit answer')),
          fit_answer_text: at(row, 'fit answer') || null,
          size_chart: 'not_recorded',
          notes: noteFor(name),
        });
      }
    } else if (/^size chart only/i.test(table.heading)) {
      const nameIndex = column(table.header, 'store');
      const noteIndex = column(table.header, 'notes');
      for (const row of table.rows) {
        const name = row[nameIndex];
        if (!name || seen.has(slugify(name))) continue;
        seen.add(slugify(name));
        supported.push({
          id: slugify(name),
          name,
          status: 'size_chart_only',
          product_tested: null,
          reviews_from: null,
          platform: null,
          read_stated: null,
          size_bought: null,
          size_bought_text: null,
          fit_answer: null,
          fit_answer_text: null,
          size_chart: 'yes',
          notes: [row[noteIndex], ...noteFor(name)].filter(Boolean),
        });
      }
    }
  }

  // Refused or unavailable: each row names one or more stores that share a reason. The same store in two rows is one entry.
  const notSupported = [];
  const byName = new Map();
  for (const table of tables.filter((t) => /^refused/i.test(t.heading))) {
    const nameIndex = column(table.header, 'store');
    const reasonIndex = column(table.header, 'what happened');
    for (const row of table.rows) {
      const reason = row[reasonIndex];
      for (const name of splitStoreList(row[nameIndex])) {
        const key = looseName(name);
        const existing = byName.get(key);
        if (existing) {
          // The same reason with more detail (in either row) is kept once, longest; a different reason is added.
          const had = existing.reason.replace(/\.$/, '');
          const now = reason.replace(/\.$/, '');
          if (now.startsWith(had)) existing.reason = reason;
          else if (!had.startsWith(now) && !existing.reason.includes(reason)) existing.reason = `${existing.reason} ${reason}`;
          existing.kind = reasonKind(existing.reason);
          continue;
        }
        const entry = { id: slugify(name), name, reason, kind: reasonKind(reason) };
        byName.set(key, entry);
        notSupported.push(entry);
      }
    }
  }

  const testedOn = markdown.match(/Tested on (\d{4}-\d{2}-\d{2})/);
  return {
    source: SOURCE_LABEL,
    tested_on: testedOn ? testedOn[1] : null,
    platforms: [...new Set(supported.map((store) => store.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    supported,
    not_supported: notSupported,
  };
}

/** Where the data comes from today. Swap this (and the parser) for the verified-stores list when it exists. */
export function loadSource(file = SOURCE) {
  if (!existsSync(file)) throw new Error(`${file} not found`);
  return parseSupportedStores(readFileSync(file, 'utf8'));
}

export function renderJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// ---- Command line ----

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = renderJson(loadSource());
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (current === json) {
      console.log('website/stores.json is up to date.');
    } else {
      console.error('website/stores.json is stale. Run: node website/scripts/build-stores.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(OUTPUT, json);
    const data = JSON.parse(json);
    const others = data.supported.filter((store) => store.platform === 'Other').map((store) => store.name);
    console.log(`Wrote website/stores.json: ${data.supported.length} supported, ${data.not_supported.length} not supported yet, ${data.platforms.length} platforms.`);
    if (others.length) console.warn(`No platform recognised for: ${others.join(', ')}. Add it to PLATFORMS in this script.`);
  }
}
