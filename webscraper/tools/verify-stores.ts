// Re-scrapes one product per confirmed store and compares the result with what was expected.
//
//   npm run verify-stores -- [--only gap.com,nike.com] [--sample 20] [--limit 5] [--out-dir dir]
//
// Starts the local scraper (or uses --server), scrapes every store in tools/verified-stores.json with
// commitToDb false, and writes verify-report.md and verify-report.json. Exit code 1 when more than
// --threshold (default 20 percent) of the stores regressed. It never writes to the database: the scraper
// it starts has the Supabase variables blanked, and every request says commitToDb false.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { postScrape, serverIsUp, startScraperServer, type StartedScraper } from './scraperClient.ts';
import { buildReport, classifyOutcome, renderMarkdownReport, runPool, selectStores, type StoreResult, type StoreToCheck } from './verifyStores.ts';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));

interface ListFile {
  stores: StoreToCheck[];
}

const USAGE = `Usage: npm run verify-stores -- [options]

  --list <file>       the store list (default tools/verified-stores.json)
  --only <a,b>        only stores whose domain contains one of these
  --sample <n>        n stores spread evenly through the list
  --limit <n>         the first n stores (after --only and --sample)
  --concurrency <n>   stores scraped at once (default 2)
  --timeout <secs>    per-store limit (default 240)
  --max-minutes <n>   stop starting new stores after this long; the rest are reported as not checked
  --retries <n>       extra tries for a store that read too few reviews or failed (default 1).
                      A refusal is never retried.
  --threshold <x>     fail above this share of regressed stores (default 0.2)
  --out-dir <dir>     where the report goes (default tools/reports)
  --server <url>      use a scraper that is already running instead of starting one
  --dry-run           list the stores that would be checked and stop`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      list: { type: 'string', default: path.join(toolsDir, 'verified-stores.json') },
      only: { type: 'string' },
      sample: { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '2' },
      timeout: { type: 'string', default: '240' },
      retries: { type: 'string', default: '1' },
      'max-minutes': { type: 'string', default: '0' },
      threshold: { type: 'string', default: '0.2' },
      'out-dir': { type: 'string', default: path.join(toolsDir, 'reports') },
      server: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!existsSync(values.list)) {
    console.error(`No store list at ${values.list}. Build it with "npm run build-verified-list".`);
    return 2;
  }
  const list = JSON.parse(await readFile(values.list, 'utf8')) as ListFile;
  const stores = selectStores(list.stores, {
    only: values.only?.split(','),
    sample: values.sample ? Number.parseInt(values.sample, 10) : undefined,
    limit: values.limit ? Number.parseInt(values.limit, 10) : undefined,
  });
  if (stores.length === 0) {
    console.error('No stores selected.');
    return 2;
  }
  if (values['dry-run']) {
    for (const entry of stores) console.log(`${entry.domain}\t${entry.expected_min_reviews}\t${entry.url}`);
    console.log(`${stores.length} stores would be checked.`);
    return 0;
  }

  const concurrency = Math.max(1, Number.parseInt(values.concurrency, 10) || 2);
  const timeoutMs = Math.max(10, Number.parseInt(values.timeout, 10) || 180) * 1000;
  const retries = Math.max(0, Number.parseInt(values.retries, 10) || 0);
  const threshold = Number(values.threshold);
  const maxMinutes = Math.max(0, Number(values['max-minutes']) || 0);
  const deadline = maxMinutes > 0 ? Date.now() + maxMinutes * 60_000 : Number.POSITIVE_INFINITY;

  let baseUrl = values.server?.replace(/\/+$/, '') ?? '';
  let started: StartedScraper | null = null;
  if (baseUrl) {
    if (!(await serverIsUp(baseUrl))) {
      console.error(`No scraper answers at ${baseUrl}.`);
      return 2;
    }
  } else {
    console.error('Starting the scraper...');
    started = await startScraperServer({ blockSharedStore: true });
    baseUrl = started.baseUrl;
  }

  let done = 0;
  try {
    const outcomes = await runPool(stores, concurrency, async (entry): Promise<StoreResult | null> => {
      if (Date.now() > deadline) return null;
      let attempts = 0;
      let result: Omit<StoreResult, 'attempts'>;
      do {
        attempts++;
        const outcome = await postScrape(baseUrl, { url: entry.url, commitToDb: false }, timeoutMs);
        result = classifyOutcome(entry, outcome);
        // A refusal is never retried; a gone page or a down store will not change in a minute.
      } while ((result.status === 'fewer' || result.status === 'error') && attempts <= retries);
      done++;
      console.error(`[${done}/${stores.length}] ${entry.domain}: ${result.status} (${result.reviewsRead} read, ${Math.round(result.secs)} s)`);
      return { ...result, attempts };
    });

    const results = outcomes.filter((result): result is StoreResult => result !== null);
    const report = buildReport(results, threshold, new Date(), outcomes.length - results.length);
    await mkdir(values['out-dir'], { recursive: true });
    await writeFile(path.join(values['out-dir'], 'verify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const markdown = renderMarkdownReport(report);
    await writeFile(path.join(values['out-dir'], 'verify-report.md'), markdown);
    console.log(markdown);
    console.error(`Report written to ${path.join(values['out-dir'], 'verify-report.md')} and .json`);
    return report.passed ? 0 : 1;
  } finally {
    await started?.stop();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
