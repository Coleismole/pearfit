// Builds tools/verified-stores.json from the tables in SUPPORTED_STORES.md.
//
//   npm run build-verified-list -- [--md SUPPORTED_STORES.md] [--hints file.jsonl ...] [--out tools/verified-stores.json]
//
// A store's product address is not in the markdown. It comes from, in this order: the list already written
// (so a rebuild keeps what is known), then --hints files. A hints file is JSON lines with `url` and `name` (the
// product name as the table gives it) and an optional `source`, `got` and `chart`; the scraper batch files
// of earlier rounds have this shape. Stores with no address go in `needs_url`; nothing is guessed.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildVerifiedList, parseStoreDoc, type UrlHint, type VerifiedList } from './verifiedList.ts';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMd = path.resolve(toolsDir, '..', 'SUPPORTED_STORES.md');
const defaultOut = path.join(toolsDir, 'verified-stores.json');

export function parseHintLines(text: string, fallbackSource: string): UrlHint[] {
  const hints: UrlHint[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    if (typeof row.url !== 'string' || typeof row.name !== 'string' || !/^https?:\/\//i.test(row.url)) continue;
    hints.push({
      source: typeof row.source === 'string' ? row.source : fallbackSource,
      url: row.url,
      name: row.name,
      got: typeof row.got === 'number' ? row.got : undefined,
      stated: typeof row.stated === 'number' ? row.stated : null,
      chart: typeof row.chart === 'number' ? row.chart : undefined,
    });
  }
  return hints;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      md: { type: 'string', default: defaultMd },
      hints: { type: 'string', multiple: true },
      out: { type: 'string', default: defaultOut },
      fresh: { type: 'boolean', default: false },
    },
  });
  const md = await readFile(values.md, 'utf8');
  const doc = parseStoreDoc(md);
  const hints: UrlHint[] = [];
  for (const file of values.hints ?? []) hints.push(...parseHintLines(await readFile(file, 'utf8'), path.basename(file)));
  const existing: VerifiedList | null = !values.fresh && existsSync(values.out) ? (JSON.parse(await readFile(values.out, 'utf8')) as VerifiedList) : null;

  const list = buildVerifiedList(doc, { hints, existing, source: path.basename(values.md) });
  await writeFile(values.out, `${JSON.stringify(list, null, 2)}\n`);

  console.log(`${doc.rows.length + doc.sizeChartOnly.length} rows in ${path.basename(values.md)}`);
  console.log(`${list.stores.length} stores with a product address, ${list.needs_url.length} in needs_url`);
  console.log(`${list.stores.filter((s) => s.has_size_chart).length} marked has_size_chart`);
  if (list.unmatched_chart_names.length > 0) console.log(`Size chart names in the markdown that matched no row: ${list.unmatched_chart_names.join(', ')}`);
  const reasons = new Map<string, number>();
  for (const entry of list.needs_url) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
  for (const [reason, count] of reasons) console.log(`  needs_url: ${count} x ${reason}`);
  console.log(`Wrote ${values.out}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
