import * as cheerio from 'cheerio';

/**
 * Measurements taken from a brand size chart.
 * chest_cm is pit-to-pit, flat. A chart that states a full circumference is halved.
 * Inches are converted here (× 2.54). A cell with no number stays null.
 */
export interface SizeChartRow {
  size: string;
  sortOrder: number;
  chest_cm: number | null;
  length_cm: number | null;
  sleeve_cm: number | null;
}

type Unit = 'cm' | 'in';
type ChestKind = 'flat' | 'circumference' | 'unspecified';
type MeasureCol = 'chest' | 'length' | 'sleeve';

const LETTERS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;

function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

function toCm(value: number, unit: Unit): number {
  return unit === 'in' ? value * 2.54 : value;
}

/** Letter sizes stay letters. A numeric label such as 46 stays 46, so rows are not merged. */
export function chartSizeCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!cleaned || cleaned.length > 24) return null;
  const letters: Record<string, string> = {
    XS: 'XS',
    'X-SMALL': 'XS',
    'XSMALL': 'XS',
    'EXTRA SMALL': 'XS',
    S: 'S',
    SM: 'S',
    SMALL: 'S',
    M: 'M',
    MED: 'M',
    MEDIUM: 'M',
    L: 'L',
    LG: 'L',
    LARGE: 'L',
    XL: 'XL',
    'X-LARGE': 'XL',
    XLARGE: 'XL',
    'EXTRA LARGE': 'XL',
    '1XL': 'XL',
    XXL: 'XXL',
    '2XL': 'XXL',
    'XX-LARGE': 'XXL',
    XXXL: 'XXXL',
    '3XL': 'XXXL',
  };
  if (letters[cleaned]) return letters[cleaned];
  const word = cleaned.match(/\b(XXXL|3XL|XXL|2XL|X-LARGE|EXTRA LARGE|EXTRA SMALL|X-SMALL|SMALL|MEDIUM|LARGE|XS|XL|S|M|L)\b/);
  if (word && letters[word[1]]) return letters[word[1]];
  // US women's sizes are one digit (2, 4, 6, 8). A chart that only kept 10+ dropped them.
  const numeric = cleaned.match(/^(?:US|UK|EU|IT|FR|JP)?\s*(\d{1,3})(?:\s*\((?:US|UK|EU|IT|FR|JP)\))?$/);
  if (numeric) return numeric[1];
  return null;
}

function sortOrder(size: string, index: number): number {
  const letter = LETTERS.indexOf(size as (typeof LETTERS)[number]);
  if (letter >= 0) return letter;
  // 00 is smaller than 0. Number("00") is 0, so it needs its own rank.
  if (size === '00') return 999;
  const numeric = Number(size);
  if (/^\d+$/.test(size) && Number.isFinite(numeric)) return 1000 + numeric;
  return 2000 + index;
}

function unitInText(text: string): Unit | null {
  const h = text.toLowerCase();
  if (/\bcm\b|centimet(?:er|re)s?/.test(h)) return 'cm';
  if (/\binches\b|\binch\b|\(in\)|\bin\./.test(h)) return 'in';
  return null;
}

/**
 * The unit a chart shows when its own text states none: the checked radio of its cm/inch toggle.
 * Looks only at radios whose name or id says they are a unit control, in the nearest enclosing
 * element that has one. If none is checked, or the checked ones disagree, the unit stays unknown.
 */
function unitFromToggle($: cheerio.CheerioAPI, node: unknown): Unit | null {
  for (const box of $(node as never).parents().toArray()) {
    const fromButtons = unitFromButtons($, box);
    if (fromButtons) return fromButtons;
    const checked = new Set<Unit>();
    let found = false;
    $(box)
      .find('input[type="radio"]')
      .each((_i, radio) => {
        const el = $(radio);
        const id = el.attr('id') ?? '';
        if (!/unit|measure/i.test(`${el.attr('name') ?? ''} ${id}`)) return;
        const label = [
          id,
          el.attr('value') ?? '',
          el.attr('aria-label') ?? '',
          id ? $(`label[for="${id}"]`).text() : '',
          el.closest('label').text(),
        ].join(' ');
        const isCm = /\b(cm|centimet(?:er|re)s?)\b/i.test(label);
        const isIn = /\b(in|inch|inches)\b/i.test(label);
        if (isCm === isIn) return; // neither, or both: not a usable unit radio
        found = true;
        const aria = el.attr('aria-checked');
        if (aria === undefined ? el.is('[checked]') : aria === 'true') checked.add(isCm ? 'cm' : 'in');
      });
    if (found) return checked.size === 1 ? [...checked][0] : null;
  }
  return null;
}

/**
 * A cm/inch toggle made of buttons: elements with a data-unit of cm or in (or in/inches), the active one
 * carrying an "active"/"selected" class or aria-pressed/aria-selected. Several controls that disagree stay unknown.
 */
function unitFromButtons($: cheerio.CheerioAPI, box: unknown): Unit | null {
  const active = new Set<Unit>();
  let found = 0;
  $(box as never)
    .find('[data-unit]')
    .each((_i, el) => {
      const raw = ($(el).attr('data-unit') ?? '').trim().toLowerCase();
      const unit: Unit | null = raw === 'cm' || raw === 'metric' ? 'cm' : raw === 'in' || raw === 'inch' || raw === 'inches' ? 'in' : null;
      if (!unit) return;
      found += 1;
      const aria = $(el).attr('aria-pressed') ?? $(el).attr('aria-selected');
      const isActive = aria !== undefined ? aria === 'true' : /\b(active|selected|is-active|current)\b/.test($(el).attr('class') ?? '');
      if (isActive) active.add(unit);
    });
  return found >= 2 && active.size === 1 ? [...active][0] : null;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** A tape-measure fraction: 1/2, 3/4, 5/8, 7/16. Anything else around a slash is not a fraction. */
function tapeFraction(num: string, den: string): number | null {
  const n = Number(num);
  const d = Number(den);
  if (![2, 4, 8, 16].includes(d) || n <= 0 || n >= d) return null;
  return n / d;
}

/**
 * Reads one stated measurement. "21 1/2" is 21.5. A truncated 21 would be a different size.
 * "56 / 22" is two values (often cm and inches side by side), not 56 divided by 22, so it is null.
 * A decimal comma is a decimal point: "55,5" is 55.5.
 */
function readMeasurement(raw: string): number | null {
  const text = raw.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
  const mixed = text.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) {
    const fraction = tapeFraction(mixed[2], mixed[3]);
    return fraction === null ? null : Number(mixed[1]) + fraction;
  }
  const unicode = text.match(/(\d+(?:\.\d+)?)\s*([½¼¾⅛⅜⅝⅞])/);
  if (unicode) return Number(unicode[1]) + UNICODE_FRACTIONS[unicode[2]];
  const bare = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (bare) return tapeFraction(bare[1], bare[2]);
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Number-unit pairs in a cell such as "61.5cm 24\"" (a cm/inch toggle renders both). */
const UNIT_PAIR = /(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+|\s*[½¼¾⅛⅜⅝⅞])?)\s*(cm|centimet(?:er|re)s?|in(?:ch(?:es)?)?\b|"|″)/gi;

function parseCell(raw: string, tableUnit: Unit | null): { value: number; unit: Unit } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || /^(-|–|—|n\/a|null|unknown)$/i.test(text)) return null;
  // A range is not one measurement. Leave it null instead of picking an end.
  if (/[\d½¼¾⅛⅜⅝⅞]\s*[-–—]\s*\d/.test(text)) return null;
  // The same measurement in two units: use the centimetre one, else the inch one.
  const pairs = [...text.matchAll(UNIT_PAIR)].map((m) => ({
    value: readMeasurement(m[1]),
    unit: (/^c/i.test(m[2]) ? 'cm' : 'in') as Unit,
  }));
  if (pairs.length > 1) {
    const pick = pairs.find((p) => p.unit === 'cm' && p.value !== null) ?? pairs.find((p) => p.value !== null);
    return pick && pick.value !== null && pick.value > 0 ? { value: pick.value, unit: pick.unit } : null;
  }
  const value = readMeasurement(text);
  if (value === null || value <= 0) return null;
  const unit = /cm\b/i.test(text)
    ? 'cm'
    : /in(?:ch(?:es)?)?\b|"|″/.test(text)
      ? 'in'
      : tableUnit;
  if (!unit) return null;
  return { value, unit };
}

/** Pit to pit in any of its spellings: pit-to-pit, armpit to armpit, underarm to underarm, P2P. */
const PIT_TO_PIT = /\b(?:arm)?pit[\s-]*(?:to|2)?[\s-]*(?:arm)?pit\b|\bunder[\s-]?arm[\s-]*(?:to|2)?[\s-]*under[\s-]?arm\b|\bp2p\b/;

function chestKind(header: string): ChestKind | null {
  const h = header.toLowerCase();
  if (PIT_TO_PIT.test(h)) return 'flat';
  if (!/\b(chest|bust|pit)\b|body width/.test(h)) return null;
  if (/pit[\s-]*to[\s-]*pit|body width|chest width|half chest|flat|across chest|laid flat/.test(h)) {
    return 'flat';
  }
  if (/circumference|all around|full chest|around bust|around chest/.test(h)) return 'circumference';
  return 'unspecified';
}

function measureCol(header: string): MeasureCol | null {
  if (chestKind(header)) return 'chest';
  const h = header.toLowerCase();
  if (/\bsleeve\b|\barm length\b/.test(h)) return 'sleeve';
  if (/\blength\b/.test(h) && !/\bsleeve\b/.test(h)) return 'length';
  return null;
}

function isSizeHeader(header: string): boolean {
  const h = header.toLowerCase().trim();
  return h === '' || h === 'size' || h === 'sizes' || h === 'size (us)' || /^size\b/.test(h);
}

/**
 * A header that does not say flat or circumference gives null. We never guess the convention,
 * unless the chart's own surroundings say the garment was measured lying flat (`flatDefault`).
 */
function chestCm(value: number, unit: Unit, kind: ChestKind, flatDefault = false): number | null {
  if (kind === 'unspecified') {
    if (!flatDefault) return null;
    return round1(toCm(value, unit));
  }
  const cm = toCm(value, unit);
  return round1(kind === 'flat' ? cm : cm / 2);
}

interface ParsedTable {
  rows: SizeChartRow[];
}

function parseHtmlTable(
  headers: string[],
  body: string[][],
  tableUnit: Unit | null,
  flatDefault = false,
): ParsedTable | null {
  let sizeIdx = headers.findIndex((h) => isSizeHeader(h));
  if (sizeIdx < 0) sizeIdx = 0;
  const cols: { index: number; kind: MeasureCol; chest: ChestKind | null }[] = [];
  headers.forEach((header, index) => {
    if (index === sizeIdx) return;
    const kind = measureCol(header);
    if (!kind) return;
    cols.push({ index, kind, chest: kind === 'chest' ? chestKind(header) : null });
  });
  if (cols.length === 0) return null;

  const rows: SizeChartRow[] = [];
  const seen = new Set<string>();
  let tableHasValue = false;
  body.forEach((cells, index) => {
    const size = chartSizeCode(cells[sizeIdx] ?? '');
    if (!size || seen.has(size)) return;
    const row: SizeChartRow = {
      size,
      sortOrder: sortOrder(size, index),
      chest_cm: null,
      length_cm: null,
      sleeve_cm: null,
    };
    let any = false;
    for (const col of cols) {
      const parsed = parseCell(cells[col.index] ?? '', tableUnit);
      if (!parsed) continue;
      if (col.kind === 'chest' && col.chest) row.chest_cm = chestCm(parsed.value, parsed.unit, col.chest, flatDefault);
      if (col.kind === 'length') row.length_cm = round1(toCm(parsed.value, parsed.unit));
      if (col.kind === 'sleeve') row.sleeve_cm = round1(toCm(parsed.value, parsed.unit));
      if (row.chest_cm !== null || row.length_cm !== null || row.sleeve_cm !== null) any = true;
    }
    if (any) tableHasValue = true;
    seen.add(size);
    rows.push(row);
  });
  return tableHasValue ? { rows } : null;
}

/** Sizes across the header, one measurement per row. Unknown cells stay null. */
function parseTransposedTable(
  headers: string[],
  body: string[][],
  tableUnit: Unit | null,
  flatDefault = false,
): ParsedTable | null {
  // A size that repeats (XL and 1XL) keeps its first column only, as the row layout does.
  // Two rows with one size would fail the (sku, size) key in the shared store.
  const seen = new Set<string>();
  const sizes = headers.slice(1).map((cell) => {
    const size = chartSizeCode(cell);
    if (!size || seen.has(size)) return null;
    seen.add(size);
    return size;
  });
  if (sizes.filter(Boolean).length < 2) return null;
  const rows: SizeChartRow[] = [];
  sizes.forEach((size, index) => {
    if (!size) return;
    rows.push({
      size,
      sortOrder: sortOrder(size, index),
      chest_cm: null,
      length_cm: null,
      sleeve_cm: null,
    });
  });
  let any = false;
  for (const cells of body) {
    const kind = measureCol(cells[0] ?? '');
    if (!kind) continue;
    const rowUnit = unitInText(cells[0] ?? '') ?? tableUnit;
    const chest = kind === 'chest' ? chestKind(cells[0] ?? '') : null;
    sizes.forEach((size, index) => {
      if (!size) return;
      const row = rows.find((item) => item.size === size);
      if (!row) return;
      const parsed = parseCell(cells[index + 1] ?? '', rowUnit);
      if (!parsed) return;
      if (kind === 'chest' && chest) row.chest_cm = chestCm(parsed.value, parsed.unit, chest, flatDefault);
      if (kind === 'length') row.length_cm = round1(toCm(parsed.value, parsed.unit));
      if (kind === 'sleeve') row.sleeve_cm = round1(toCm(parsed.value, parsed.unit));
      if (row.chest_cm !== null || row.length_cm !== null || row.sleeve_cm !== null) any = true;
    });
  }
  return any ? { rows } : null;
}

/** A cell's text with a space between elements, so <span>61.5cm</span><span>24"</span> stays two values. */
function cellText($: cheerio.CheerioAPI, cell: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    $(node as never)
      .contents()
      .each((_i, child) => {
        if (child.type === 'text') parts.push((child as unknown as { data: string }).data);
        else if (child.type === 'tag') walk(child);
      });
  };
  walk(cell);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * A cell that carries its own metric value (data-cm="50.0") states the unit outright, whatever the
 * cm/inch toggle shows. Otherwise the cell text is used.
 */
function cellValue($: cheerio.CheerioAPI, cell: unknown): string {
  const metric = ($(cell as never).attr('data-cm') ?? '').trim();
  if (/^\d+(?:\.\d+)?$/.test(metric)) return `${metric} cm`;
  return cellText($, cell);
}

function tableGrid($: cheerio.CheerioAPI, table: unknown): string[][] {
  const grid: string[][] = [];
  $(table as never)
    .find('tr')
    .each((_r, tr) => {
      const cells: string[] = [];
      $(tr)
        .children('th, td')
        .each((_c, cell) => {
          cells.push(cellValue($, cell));
        });
      if (cells.length > 0) grid.push(cells);
    });
  return grid;
}

/**
 * True when the text around a chart says the garment itself was measured lying flat ("we measure lying
 * flat"). Then an unlabeled "Chest" is a flat width. Any hint that the numbers are body measurements
 * or a circumference cancels it: the convention is not confirmed, so the chest stays null.
 */
export function saysMeasuredFlat(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  const flat = /(?:measure[sd]?|measuring|measurements?)[^.]{0,40}\bflat\b|\b(?:laid|lying|lays|laying) flat\b[^.]{0,30}measure|\bflat (?:garment )?measure/i.test(t);
  if (!flat) return false;
  return !/body measurements?|circumference|measure around|around the fullest|your (?:body|chest|bust) measure/i.test(t);
}

/** The chart's surroundings: the highest ancestor (up to 4 levels) that is still a small block. */
function surroundingBlock($: cheerio.CheerioAPI, node: unknown): ReturnType<cheerio.CheerioAPI> | null {
  let best: ReturnType<cheerio.CheerioAPI> | null = null;
  for (const parent of $(node as never).parents().toArray().slice(0, 4)) {
    if ($(parent).text().length > 4000) break;
    best = $(parent);
  }
  return best;
}

function surroundingText($: cheerio.CheerioAPI, node: unknown): string {
  return surroundingBlock($, node)?.text() ?? '';
}

/** The one unit a block of text names, or null when it names none or both. */
function soleUnitInText(text: string): Unit | null {
  const h = text.toLowerCase();
  const cm = /\bcm\b|centimet(?:er|re)s?/.test(h);
  const inch = /\binches\b|\binch\b|\(in\)|\bin\./.test(h);
  if (cm === inch) return null;
  return cm ? 'cm' : 'in';
}

/** A chart found in a page, with the heading above it and whether it has a chest column at all. */
interface ChartCandidate {
  rows: SizeChartRow[];
  hasChestColumn: boolean;
  label: string;
}

function tableCandidates($: cheerio.CheerioAPI): ChartCandidate[] {
  const out: ChartCandidate[] = [];
  let heading = '';
  $('h1, h2, h3, h4, h5, h6, caption, table').each((_i, el) => {
    if (el.type !== 'tag') return;
    const node = $(el);
    if (el.name !== 'table') {
      if (el.name !== 'caption') heading = node.text().replace(/\s+/g, ' ').trim();
      return;
    }
    const grid = tableGrid($, el);
    if (grid.length < 2) return;
    const headerAt = grid.findIndex((cells) => cells.some((cell) => measureCol(cell)));
    if (headerAt < 0) return;
    const context = [node.find('caption').text(), node.attr('class') ?? '', node.prev().text(), grid[headerAt].join(' ')].join(' ');
    const block = surroundingBlock($, el);
    const around = block?.text() ?? '';
    // A unit toggle in view means the unit is whatever it shows: never read it from the words around it.
    const hasToggle = (block?.find('input[type="radio"], [data-unit]').length ?? 0) > 0;
    const unit = unitInText(context) ?? unitFromToggle($, el) ?? (hasToggle ? null : soleUnitInText(around));
    const flat = saysMeasuredFlat(around);
    const parsed = preferChart(
      parseHtmlTable(grid[headerAt], grid.slice(headerAt + 1), unit, flat),
      parseTransposedTable(grid[0], grid.slice(1), unit, flat),
    );
    if (!parsed) return;
    const hasChestColumn =
      grid[headerAt].some((cell) => chestKind(cell)) || grid.slice(1).some((cells) => chestKind(cells[0] ?? ''));
    const panel = node.closest('[id], [aria-labelledby]');
    const label = [heading, node.find('caption').text(), panel.attr('id') ?? '', node.attr('class') ?? '']
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ rows: parsed.rows, hasChestColumn, label });
  });
  return out;
}

function rowsFromTables(html: string): SizeChartRow[] {
  const $ = cheerio.load(html);
  let best: SizeChartRow[] = [];
  for (const candidate of tableCandidates($)) {
    if (candidate.rows.length > best.length) best = candidate.rows;
  }
  return best.length > 0 ? best : rowsFromDivCharts($);
}

function filledMeasurements(rows: SizeChartRow[] | undefined): number {
  if (!rows) return 0;
  return rows.reduce(
    (count, row) => count + [row.chest_cm, row.length_cm, row.sleeve_cm].filter((value) => value !== null).length,
    0,
  );
}

/** Row charts win a tie. A transposed chart is used only when it yields more numbers. */
function preferChart(byRow: ParsedTable | null, byColumn: ParsedTable | null): ParsedTable | null {
  if (filledMeasurements(byColumn?.rows) > filledMeasurements(byRow?.rows)) return byColumn;
  return byRow;
}

function cellTexts($: cheerio.CheerioAPI, node: unknown): string[] {
  const cells: string[] = [];
  $(node as never)
    .children()
    .each((_i, child) => {
      const text = $(child).text().replace(/\s+/g, ' ').trim();
      if (text) cells.push(text);
    });
  return cells;
}

/** Div and list charts, used when the brand did not mark the chart up as a table. */
function rowsFromDivCharts($: cheerio.CheerioAPI): SizeChartRow[] {
  let best: SizeChartRow[] = [];
  $('[class*="size-chart"], [class*="sizechart"], [class*="size-guide"], [class*="sizeguide"], [id*="size-chart"], [id*="size-guide"]').each((_i, box) => {
    if ($(box).is('table') || $(box).find('table').length > 0) return;
    const grid: string[][] = [];
    $(box)
      .find('li, [class*="row"]')
      .each((_r, row) => {
        const cells = cellTexts($, row);
        if (cells.length >= 2) grid.push(cells);
      });
    if (grid.length < 2) return;
    const context = [$(box).attr('class') ?? '', $(box).attr('id') ?? '', grid[0].join(' ')].join(' ');
    const unit = unitInText(context) ?? unitFromToggle($, box);
    const headerAt = grid.findIndex((cells) => cells.some((cell) => measureCol(cell)));
    if (headerAt < 0) return;
    const flat = saysMeasuredFlat(surroundingText($, box));
    const parsed = preferChart(
      parseHtmlTable(grid[headerAt], grid.slice(headerAt + 1), unit, flat),
      parseTransposedTable(grid[0], grid.slice(1), unit, flat),
    );
    if (parsed && parsed.rows.length > best.length) best = parsed.rows;
  });
  return best;
}

/** Reads a size chart from product HTML. Returns [] when the page has no chart, or no stated unit. */
export function parseSizeChart(html: string): SizeChartRow[] {
  const rows = rowsFromTables(html);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The chart from the first page that has one. Later pages are fallbacks, e.g. a snapshot from before navigation. */
export function parseSizeChartFirst(...pages: (string | null | undefined)[]): SizeChartRow[] {
  for (const html of pages) {
    if (!html) continue;
    const rows = parseSizeChart(html);
    if (rows.length > 0) return rows;
  }
  return [];
}

export interface ProductHint {
  name?: string | null;
  url?: string | null;
}

const MEN = /\b(men|mens|man|male)\b/;
const WOMEN = /\b(women|womens|woman|ladies|female)\b/;
const TOP_WORDS = /\b(tee|tees|t-shirt|tshirt|shirt|shirts|top|tops|tank|polo|hoodie|sweatshirt|sweater|jacket|coat|vest|blouse|henley|crew|pullover|cardigan|jersey|bodysuit)\b/;
const BOTTOM_WORDS = /\b(pant|pants|jean|jeans|short|shorts|skirt|skirts|legging|leggings|trouser|trousers|chino|chinos|jogger|joggers|bottom|bottoms)\b/;

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ');
}

/**
 * A size guide on a page of its own usually holds the store's tables for every product: men's and
 * women's, tops and bottoms. Take a table only when it has a chest column and its heading does not
 * contradict the product (men's chart for a women's top, a bottoms chart for a shirt). If several
 * tables are left and they differ, the page does not say which one is this product's: no chart.
 */
export function parseGuidePageChart(html: string, hint: ProductHint): SizeChartRow[] {
  const $ = cheerio.load(html);
  const product = words(`${hint.name ?? ''} ${(hint.url ?? '').split('?')[0].split('/').pop() ?? ''}`.replace(/-/g, ' '));
  const productMen = MEN.test(product);
  const productWomen = WOMEN.test(product);
  const productTop = TOP_WORDS.test(product);
  const productBottom = BOTTOM_WORDS.test(product);
  const fits = tableCandidates($)
    .filter((c) => c.hasChestColumn)
    .map((c) => {
      const label = words(c.label);
      const labelMen = MEN.test(label);
      const labelWomen = WOMEN.test(label);
      if (productMen && !productWomen && labelWomen && !labelMen) return null;
      if (productWomen && !productMen && labelMen && !labelWomen) return null;
      if (productTop && !productBottom && BOTTOM_WORDS.test(label) && !TOP_WORDS.test(label)) return null;
      if (productBottom && !productTop && TOP_WORDS.test(label) && !BOTTOM_WORDS.test(label)) return null;
      // A heading that names the product's own gender or garment is a stronger match than a silent one.
      let score = 0;
      if ((productMen && labelMen) || (productWomen && labelWomen)) score += 1;
      if ((productTop && TOP_WORDS.test(label)) || (productBottom && BOTTOM_WORDS.test(label))) score += 1;
      return { rows: c.rows, score };
    })
    .filter((c): c is { rows: SizeChartRow[]; score: number } => c !== null);
  if (fits.length === 0) return [];
  const top = Math.max(...fits.map((c) => c.score));
  const best = fits.filter((c) => c.score === top);
  const first = JSON.stringify(best[0].rows);
  if (best.some((c) => JSON.stringify(c.rows) !== first)) return [];
  return best[0].rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The chart from the product pages, else from the size-guide pages the product page linked to. */
export function parseSizeChartWithGuides(
  pages: (string | null | undefined)[],
  guidePages: (string | null | undefined)[],
  hint: ProductHint,
): SizeChartRow[] {
  const own = parseSizeChartFirst(...pages);
  if (own.length > 0) return own;
  for (const html of guidePages) {
    if (!html) continue;
    const rows = parseGuidePageChart(html, hint);
    if (rows.length > 0) return rows;
  }
  return [];
}
