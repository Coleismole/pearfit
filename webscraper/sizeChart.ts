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

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** Reads one stated measurement. "21 1/2" is 21.5. A truncated 21 would be a different size. */
function readMeasurement(text: string): number | null {
  const mixed = text.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / den;
  }
  const unicode = text.match(/(\d+(?:\.\d+)?)\s*([½¼¾⅛⅜⅝⅞])/);
  if (unicode) return Number(unicode[1]) + UNICODE_FRACTIONS[unicode[2]];
  const bare = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (bare) {
    const den = Number(bare[2]);
    if (den === 0) return null;
    return Number(bare[1]) / den;
  }
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseCell(raw: string, tableUnit: Unit | null): { value: number; unit: Unit } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || /^(-|–|—|n\/a|null|unknown)$/i.test(text)) return null;
  // A range is not one measurement. Leave it null instead of picking an end.
  if (/[\d½¼¾⅛⅜⅝⅞]\s*[-–—]\s*\d/.test(text)) return null;
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

function chestKind(header: string): ChestKind | null {
  const h = header.toLowerCase();
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

/** A header that does not say flat or circumference gives null. We never guess the convention. */
function chestCm(value: number, unit: Unit, kind: ChestKind): number | null {
  if (kind === 'unspecified') return null;
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
      if (col.kind === 'chest' && col.chest) row.chest_cm = chestCm(parsed.value, parsed.unit, col.chest);
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
): ParsedTable | null {
  const sizes = headers.slice(1).map((cell) => chartSizeCode(cell));
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
      if (kind === 'chest' && chest) row.chest_cm = chestCm(parsed.value, parsed.unit, chest);
      if (kind === 'length') row.length_cm = round1(toCm(parsed.value, parsed.unit));
      if (kind === 'sleeve') row.sleeve_cm = round1(toCm(parsed.value, parsed.unit));
      if (row.chest_cm !== null || row.length_cm !== null || row.sleeve_cm !== null) any = true;
    });
  }
  return any ? { rows } : null;
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
          cells.push($(cell).text().replace(/\s+/g, ' ').trim());
        });
      if (cells.length > 0) grid.push(cells);
    });
  return grid;
}

function rowsFromTables(html: string): SizeChartRow[] {
  const $ = cheerio.load(html);
  let best: SizeChartRow[] = [];
  $('table').each((_i, table) => {
    const node = $(table);
    const grid = tableGrid($, table);
    if (grid.length < 2) return;
    const headerAt = grid.findIndex((cells) => cells.some((cell) => measureCol(cell)));
    if (headerAt < 0) return;
    const context = [node.find('caption').text(), node.attr('class') ?? '', node.prev().text(), grid[headerAt].join(' ')].join(' ');
    const unit = unitInText(context) ?? unitFromToggle($, table);
    const parsed = preferChart(
      parseHtmlTable(grid[headerAt], grid.slice(headerAt + 1), unit),
      parseTransposedTable(grid[0], grid.slice(1), unit),
    );
    if (parsed && parsed.rows.length > best.length) best = parsed.rows;
  });
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
    const parsed = preferChart(
      parseHtmlTable(grid[headerAt], grid.slice(headerAt + 1), unit),
      parseTransposedTable(grid[0], grid.slice(1), unit),
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
