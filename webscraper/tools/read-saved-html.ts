// Reads a folder of pages saved from your own browser through the local scraper.
//
//   npm run saved-html -- <folder> [--server http://127.0.0.1:3000] [--commit] [--out file.json] [--concurrency 2]
//
// Nothing is written to the database unless --commit is passed. See tools/README.md.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { postScrape, serverIsUp, startScraperServer, type StartedScraper } from './scraperClient.ts';
import {
  buildResultsFile,
  defaultResultsPath,
  findSavedPages,
  formatSummaryTable,
  readSavedFolder,
} from './savedHtml.ts';

const USAGE = `Usage: npm run saved-html -- <folder> [options]

  <folder>            a folder of pages saved from your browser (.html or .htm)
  --server <url>      a scraper that is already running (default: SCRAPER_URL, or http://127.0.0.1:3000;
                      if none answers there, one is started for this run and stopped at the end)
  --no-start          do not start a scraper; fail if none answers
  --commit            save the results to the database (local SQLite and, if configured, the shared store).
                      Without it nothing is saved.
  --out <file>        where to write the results (default: <folder>.results.json, next to the folder)
  --concurrency <n>   pages read at once (default 1, at most 4)
  --timeout <secs>    wait for one page this long (default 120)
  --json              print the results as JSON instead of the table
  --help              this text`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      server: { type: 'string' },
      'no-start': { type: 'boolean', default: false },
      commit: { type: 'boolean', default: false },
      out: { type: 'string' },
      concurrency: { type: 'string', default: '1' },
      timeout: { type: 'string', default: '120' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const folder = positionals[0];
  if (!folder || positionals.length > 1) {
    console.error(USAGE);
    return 1;
  }
  const folderPath = path.resolve(folder);
  const info = await stat(folderPath).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`Not a folder: ${folderPath}`);
    return 1;
  }
  const pages = await findSavedPages(folderPath);
  if (pages.length === 0) {
    console.error(`No .html or .htm files in ${folderPath}. Save a product page from your browser into it first (see tools/README.md).`);
    return 1;
  }
  const concurrency = Math.min(4, Math.max(1, Number.parseInt(values.concurrency, 10) || 1));
  const timeoutMs = Math.max(5, Number.parseInt(values.timeout, 10) || 120) * 1000;

  let baseUrl = (values.server ?? process.env.SCRAPER_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
  let started: StartedScraper | null = null;
  if (!(await serverIsUp(baseUrl))) {
    if (values['no-start'] || values.server) {
      console.error(`No scraper answers at ${baseUrl}. Start one with "npm run dev" in webscraper/, or drop --server and --no-start.`);
      return 1;
    }
    console.error('No scraper is running; starting one for this run...');
    started = await startScraperServer({ blockSharedStore: !values.commit });
    baseUrl = started.baseUrl;
  }

  try {
    if (values.commit) console.error('--commit: results will be saved to the database.');
    const results = await readSavedFolder({
      folder: folderPath,
      commit: values.commit,
      concurrency,
      scrape: (request) => postScrape(baseUrl, request, timeoutMs),
      onResult: (result, done, total) => {
        console.error(`[${done}/${total}] ${result.file}: ${result.error ? `error: ${result.error}` : `${result.reviewsRead} reviews`}`);
      },
    });

    const file = buildResultsFile(folderPath, results, values.commit);
    const outPath = path.resolve(values.out ?? defaultResultsPath(folderPath));
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`);

    console.log(values.json ? JSON.stringify(file, null, 2) : formatSummaryTable(results));
    console.error(`\nResults written to ${outPath}`);
    if (!values.commit) console.error('Nothing was saved to the database (pass --commit to save).');
    return file.totals.read === 0 ? 1 : 0;
  } finally {
    await started?.stop();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
