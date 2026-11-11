// Finds one real product page per store, for scrape batches and the store list.
//
//   npm run discover-products -- --domains domains.txt --out discovered.jsonl
//   npm run discover-products -- example.com other.com
//   npm run discover-products -- --classify https://example.com/products/blue-shirt
//
// For each store: its Shopify product feed if it has one, else its sitemap. Sitemap candidates are accepted
// only with a product signal (JSON-LD Product, og:type product, an add-to-cart control, or a product-shaped
// address) and never when the address or the page is a category, promo, cart, account, blog or search page,
// or on another site. Plain requests, a few stores at a time, one request at a time per store with a pause
// between, robots.txt honoured, and a 403 or 429 ends the visit: it is not retried.
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { classifyUrl, decideProduct, discoverDomain, pageSignals, registrableDomain, type DiscoverOptions, type DiscoveredStore } from './discoverProducts.ts';
import { runPool } from './verifyStores.ts';

const USAGE = `Usage: npm run discover-products -- [domain ...] [options]

  --domains <file>    a text file with one domain per line
  --out <file>        write one JSON line per store here (default: print them)
  --concurrency <n>   stores visited at once (default 4, at most 8)
  --want <n>          product addresses to find per store (default 3)
  --timeout <secs>    per request (default 15)
  --delay <ms>        pause between two requests to one store (default 1000)
  --classify <url>    fetch one page and say whether it is a product page`;

function makeFetch(timeoutMs: number): DiscoverOptions['fetch'] {
  return async (url, init) => {
    // A plain request: no browser headers. Only the kind of answer wanted, for the JSON feeds.
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: init?.accept ? { accept: init.accept } : undefined,
    });
    return {
      status: response.status,
      ok: response.ok,
      url: response.url,
      buffer: async () => Buffer.from(await response.arrayBuffer()),
    };
  };
}

function cleanDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').split('/')[0]!.toLowerCase();
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      domains: { type: 'string' },
      out: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      want: { type: 'string', default: '3' },
      timeout: { type: 'string', default: '15' },
      delay: { type: 'string', default: '1000' },
      classify: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const timeoutMs = Math.max(2, Number.parseInt(values.timeout, 10) || 15) * 1000;
  const fetcher = makeFetch(timeoutMs);

  if (values.classify) {
    const url = values.classify;
    const domain = registrableDomain(new URL(url).hostname);
    const verdict = classifyUrl(url, domain);
    console.log(`address: ${JSON.stringify(verdict)}`);
    if (verdict.kind === 'rejected') return 1;
    const response = await fetcher(url);
    console.log(`page: HTTP ${response.status}${response.url !== url ? ` (redirected to ${response.url})` : ''}`);
    if (!response.ok) return 1;
    const signals = pageSignals((await response.buffer()).toString('utf8'), response.url, domain);
    console.log(`signals: ${JSON.stringify(signals)}`);
    const decision = decideProduct(verdict, signals);
    console.log(`decision: ${JSON.stringify(decision)}`);
    return decision.accepted ? 0 : 1;
  }

  const domains = [...positionals.map(cleanDomain)];
  if (values.domains) {
    domains.push(...(await readFile(values.domains, 'utf8')).split('\n').map(cleanDomain).filter(Boolean));
  }
  const unique = [...new Set(domains.filter(Boolean))];
  if (unique.length === 0) {
    console.error(USAGE);
    return 1;
  }

  const concurrency = Math.min(8, Math.max(1, Number.parseInt(values.concurrency, 10) || 4));
  const want = Math.max(1, Number.parseInt(values.want, 10) || 3);
  const delayMs = Math.max(0, Number.parseInt(values.delay, 10) || 0);
  let done = 0;
  const results: DiscoveredStore[] = await runPool(unique, concurrency, async (domain) => {
    const store = await discoverDomain(domain, { fetch: fetcher, want, delayMs });
    console.error(`[${++done}/${unique.length}] ${domain}: ${store.kind}, ${store.urls.length} accepted${store.note ? ` (${store.note})` : ''}`);
    return store;
  });

  const lines = results.map((store) => JSON.stringify(store));
  if (values.out) await writeFile(values.out, `${lines.join('\n')}\n`);
  else console.log(lines.join('\n'));
  const found = results.filter((store) => store.urls.length > 0).length;
  console.error(`${found} of ${results.length} stores have at least one accepted product page.${values.out ? ` Written to ${values.out}.` : ''}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
