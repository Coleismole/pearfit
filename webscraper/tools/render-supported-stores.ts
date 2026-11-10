// Regenerates the "Reviews and fit" tables of SUPPORTED_STORES.md from tools/verified-stores.json.
//
//   npm run render-supported-stores            # check: says whether the tables match the list
//   npm run render-supported-stores -- --write # rewrite the tables
//
// Only the bodies of the review tables change; headings, paragraphs and the other tables are kept as they
// are. The rewrite is refused when the markdown has a row the list lacks (it would be lost), so a hand edit
// to the markdown is never silently dropped: add the row to the list first, or edit the list and render.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { renderReviewTables, tableLine, type VerifiedList } from './verifiedList.ts';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      md: { type: 'string', default: path.resolve(toolsDir, '..', 'SUPPORTED_STORES.md') },
      list: { type: 'string', default: path.join(toolsDir, 'verified-stores.json') },
      write: { type: 'boolean', default: false },
    },
  });
  const md = await readFile(values.md, 'utf8');
  const list = JSON.parse(await readFile(values.list, 'utf8')) as VerifiedList;
  const rendered = renderReviewTables(md, list);

  for (const section of rendered.untouchedSections) console.error(`Table under "${section}": the list has no rows for it, left as it is.`);
  if (rendered.missingFromList.length > 0) {
    console.error(`The markdown has ${rendered.missingFromList.length} row(s) the list lacks; writing would lose them:`);
    for (const row of rendered.missingFromList.slice(0, 20)) console.error(`  ${tableLine(row)}`);
    console.error('Add them to the list (npm run build-verified-list rebuilds it from the markdown), then render again.');
    return 1;
  }
  if (rendered.text === md) {
    console.log('The tables already match the list.');
    return 0;
  }
  if (!values.write) {
    console.log('The tables differ from the list. Run with --write to rewrite them.');
    return 1;
  }
  await writeFile(values.md, rendered.text);
  console.log(`Rewrote the review tables in ${values.md}.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
