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
  if (/^\d{2,3}$/.test(cleaned)) return cleaned;
  return null;
}

function sortOrder(size: string, index: number): number {
  const letter = LETTERS.indexOf(size as (typeof LETTERS)[number]);
  if (letter >= 0) return letter;
  const numeric = Number(size);
  if (Number.isFinite(numeric)) return 1000 + numeric;
  return 2000 + index;
}

function unitInText(text: string): Unit | null {
  const h = text.toLowerCase();
  if (/\bcm\b|centimet(?:er|re)s?/.test(h)) return 'cm';
  if (/\binches\b|\binch\b|\(in\)|\bin\./.test(h)) return 'in';
  return null;
}

function parseCell(raw: string, tableUnit: Unit | null): { value: number; unit: Unit } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || /^(-|–|—|n\/a)$/i.test(text)) return null;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
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

function chestCm(value: number, unit: Unit, kind: ChestKind): number {
  const cm = toCm(value, unit);
  const flat = kind === 'flat' || (kind === 'unspecified' && cm <= 80);
  return round1(flat ? cm : cm / 2);
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
      any = true;
      if (col.kind === 'chest' && col.chest) row.chest_cm = chestCm(parsed.value, parsed.unit, col.chest);
      if (col.kind === 'length') row.length_cm = round1(toCm(parsed.value, parsed.unit));
      if (col.kind === 'sleeve') row.sleeve_cm = round1(toCm(parsed.value, parsed.unit));
    }
    if (!any) return;
    seen.add(size);
    rows.push(row);
  });
  return rows.length > 0 ? { rows } : null;
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
    const parsed = parseHtmlTable(grid[headerAt], grid.slice(headerAt + 1), unitInText(context));
    if (parsed && parsed.rows.length > best.length) best = parsed.rows;
  });
  return best;
}

/** Reads a size chart from product HTML. Returns [] when the page has no chart, or no stated unit. */
export function parseSizeChart(html: string): SizeChartRow[] {
  const rows = rowsFromTables(html);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}
