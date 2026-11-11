# Scraper tools

Command-line helpers around the local scraper (`webscraper/server.ts`, which assembles the modules in `webscraper/server/`). They live apart from the scraper's own
code and only talk to it over HTTP, the way the front end does. Run them from `webscraper/`.

| Tool | Command | What it does |
|---|---|---|
| Saved pages | `npm run saved-html -- <folder>` | Reads pages you saved from your own browser. See below. |
| Weekly check | `npm run verify-stores` | Re-scrapes one product per confirmed store and compares with what was expected. See below. |
| Store list | `npm run build-verified-list` | Builds `tools/verified-stores.json` from the tables in `SUPPORTED_STORES.md`. |
| Tables | `npm run render-supported-stores` | Checks (or with `--write` rewrites) the "Reviews and fit" tables from that list. |
| Discovery | `npm run discover-products -- <domain> ...` | Finds a real product page per store, refusing category, promo, cart, account and blog pages. See below. |

Two notes about the shared Supabase store are written down here and not run: `delete-skus.md` (how someone with the secret
key deletes three leftover rows) and `sku-keys.md` with `sku-keys.proposed.sql` (a store-scoped key for SKUs, a proposal).

All of them respect the scraper's rule: a store that refuses automated requests is reported, never worked around.
Tests for these tools are the `tools/*.test.ts` files; `npm test` runs them with the scraper's own.

## Reading pages you saved yourself (`npm run saved-html`)

Some stores answer 403, 429 or a bot check to any automated request (adidas, H&M, Levi's, lululemon, and the list in
`SUPPORTED_STORES.md` under "Refused or unavailable"). You can still use their reviews: open the product page in your
own browser, save it, and let the scraper read the saved file. The scraper never contacts the store for these pages.

### 1. Save the page

1. Open the product page in your normal browser.
2. Let it finish loading. Close or accept the cookie banner if one covers the page.
3. **Load the reviews.** Scroll to the reviews, open the "Reviews" tab if there is one, and click "Load more" / "Show
   more reviews" / the next-page arrows until the count you see is close to the total the page states. The scraper can
   only read what is in the saved file, and most review widgets add reviews to the page only when you ask for them.
4. Save the page with Ctrl+S (Cmd+S on a Mac) into a folder you keep for this, for example `saved-pages/`.
   In the "Save as type" box choose:
   - **Webpage, Complete** (Chrome, Edge, Firefox: "Web Page, complete"). This saves the page as it is on screen now,
     with the reviews you opened. Use this one by default. The browser also makes a `<name>_files` folder next to the
     file; the tool ignores it.
   - **Webpage, HTML only** saves the page as the store first sent it, before its scripts ran. It is smaller and is enough
     only when the reviews are already in that first HTML (a few stores put them there). If a "Complete" save is over
     4 MB and the tool says so, try "HTML only".
5. Optional but recommended for browsers that do not record where a page came from (Firefox, Safari): next to the file,
   make a text file with the same name plus `.url.txt` that holds the product URL on one line, for example
   `blue-tee.html` and `blue-tee.url.txt`.

One file per product. The page's address matters: the scraper builds the product's SKU from it when the page itself
states none, and two pages with no address would share one SKU.

### 2. Run it

```
cd webscraper
npm run saved-html -- ~/saved-pages
```

If no scraper is running, the tool starts one for the run and stops it at the end. To use a scraper you already started
(`npm run dev`), pass `--server http://127.0.0.1:3000`.

| Option | Meaning |
|---|---|
| `--commit` | Save the results to the database (local SQLite, and the shared store when configured). **Without it nothing is saved.** A page with no source address is never committed, even with this flag. |
| `--out <file>` | Where to write the results file. |
| `--server <url>` | Use a scraper that is already running. |
| `--no-start` | Fail rather than start a scraper. |
| `--concurrency <n>` | Pages read at once, 1 to 4 (default 1). |
| `--timeout <secs>` | Wait this long for one page (default 120). |
| `--json` | Print the results as JSON instead of the table. |

The tool reads the `.html` and `.htm` files directly inside the folder; it does not enter sub-folders.

### Where the address comes from

For each file the first of these that has an address is used:

1. a sidecar file, `<name>.url.txt` (or `<name>.html.url.txt`), whose first line is the URL (a Windows `URL=` line works too);
2. a comment in the page, `<!-- url: https://... -->`; a `url:` line inside a longer comment also works (the header the SingleFile extension writes is of this form);
3. Chrome's own `<!-- saved from url=(0043)https://... -->` comment, written on every Ctrl+S in Chrome and Edge;
4. the page's `og:url` tag;
5. the page's canonical link.

Only `http` and `https` addresses count. A page that gives none still gets read; its row says so.

### What the output means

The table goes to the screen and the same data goes to `<folder>.results.json`, next to the folder (for
`~/saved-pages` that is `~/saved-pages.results.json`).

| Column | Meaning |
|---|---|
| File | The saved file. |
| Store | The host of the source address, without `www.` (`(unknown)` when there is no address). |
| Product | The product name the page states. |
| Reviews read / stated | Reviews the scraper read from the file, against the total the page states. `not stated` means the page gives no total. Fewer read than stated usually means the saved page did not have every review loaded: open more reviews and save again. |
| With size | Reviews that give the size the shopper bought, in a size the scraper recognises. |
| With fit answer | Reviews that carry the store's own fit answer ("runs small", "true to size", a fit scale). |
| Size chart rows | Rows of the size chart read from the page. 0 is common: many pages keep the chart behind a button or in an image. A chart is kept only when its convention is clear (flat chest in cm); see `AGENTS.md`. |
| Error | Why the page could not be read, for example "No reviews found on the page" (the reviews were not loaded when you saved it, or the page is not a product page). |

Below the table, "Notes" lists pages that need a look (fewer reviews than the page states, no source address, a
page that was too large and was trimmed). The last line counts pages and reviews. The exit code is 0 when at least one
page was read, and 1 when none were or the folder could not be used.

`results.json` has `generatedAt`, `folder`, `committed`, `totals` and one entry per file with every column above plus
`sku`, `brand`, `sourceUrl`, `urlFrom` (which of the five sources gave the address), `reviewSources`, `avgRating`,
`committed`, `sharedStore` (`saved` or `not saved`, only with `--commit`) and `notes`.

The tool sends each page to `POST /api/scrape` as `rawHtml` with the source address as `url`, `render: "never"`
and `commitToDb: false` unless `--commit` is given. A page larger than the scraper's 4 MB request limit has its
`<style>` blocks, inline SVG and base64 images removed before sending (scripts stay: review data is often in one).

## Weekly store check (`npm run verify-stores`)

`tools/verified-stores.json` lists one product page per confirmed store (`stores`), and the stores with no known address
(`needs_url`, each with a `reason`). Each entry has `id`, `name`, `status`, `domain`, `url`, `url_source`, `platform`,
`expected_min_reviews` (reviews read when the store was confirmed), `has_size_chart`, and the row of `SUPPORTED_STORES.md`
it came from, cell text as written (`product_tested`, `reviews_from`, `read_stated`, `size_bought_text`, `fit_answer_text`,
plus `table_section` and `table_row`, its place in the markdown). The names that the website's `stores.json` also has
(`id`, `name`, `status`, `platform`, `product_tested`, `reviews_from`, `read_stated`, `size_bought_text`, `fit_answer_text`)
mean the same thing there, and `platform` is computed by the same rules as `platformOf` in
`website/scripts/build-stores.mjs`, so that script can read this file instead of parsing the markdown. (Checked against
`website/stores.json`: for the 66 stores it lists, those eight fields are identical except that the cell text here is as
written in the markdown, with its backticks, where the script's `clean()` removes them. The script reads only the first
table, so the 163 round 7 stores in this file are not in `stores.json`.)
`verify-stores` starts the scraper, scrapes every
entry (two at a time, 240 s each, one retry for a store that read too few reviews or failed) with `commitToDb: false`,
and writes `verify-report.md` and `verify-report.json` to `tools/reports/` (ignored by git).

| Status | Meaning | Counts as a regression |
|---|---|---|
| `ok` | At least half of `expected_min_reviews` were read and the store did not refuse. | no |
| `fewer` | Fewer than half were read (or no reviews at all). For a size-chart-only store: no chart read. | yes |
| `refused` | The store now refuses automated requests (HTTP 403/406/418/429/503, a bot check, an access-denied page). Never retried. | yes |
| `error` | The scraper failed or did not answer in time. | yes |
| `stale` | The product page is gone (HTTP 404/410). Replace its `url`; the scraper did not break. | no, listed |
| `down` | The store shows a maintenance page or answers 500/502/504. | no, listed |

The run exits 1 when more than 20 percent of the stores checked regressed (`--threshold` changes it). A store whose
`has_size_chart` is true but whose chart was not read is listed as a warning and does not count.
Useful options: `--only gap.com,nike.com`, `--sample 20` (spread evenly), `--limit 5`, `--dry-run` (list what would be
checked), `--server <url>` (use a scraper already running), `--max-minutes 270` (stop starting new stores after that long;
the rest are reported as not checked, so a slow run still ends with a report). A store takes about 90 s to scrape, so
the full list at two at a time is a few hours; the workflow sets that limit.

The scraper this tool starts has the Supabase variables blanked, and every request says `commitToDb: false`:
it cannot write to the shared store or to the local database.

`.github/workflows/verify-stores.yml` runs it every Monday and on demand (Actions, "Verify stores", Run workflow).
It does not run on pull requests, uses no secrets, installs Chromium with `npx playwright install --with-deps chromium`,
puts the report in the run summary, uploads it as the `verify-stores-report` artifact, and fails the run above the threshold.

### The store list

`npm run build-verified-list` parses the "Reviews and fit" tables (and the "Size chart only" table) of
`SUPPORTED_STORES.md`. The markdown has no product addresses, so they come from the list already written (a rebuild
keeps what is known) and from `--hints file.jsonl`: JSON lines with `url`, `name` (the product name as the table
gives it) and optionally `source`, `got`, `chart`. A hint is taken when its product name equals the row's (or one
name's words are all in the other and the host fits the store), and never when two stores answer to one name.
Stores with no address are listed under `needs_url` with the reason; nothing is guessed. To add one, add a hint line
and rebuild. `has_size_chart` comes from the "Size charts." paragraph of the round it names and from a hint's `chart`.

`npm run render-supported-stores` compares the markdown tables with the list; `--write` rewrites the table bodies from the
list (the list keeps each row's cell text, so the round trip is exact; the current file renders back byte for byte).
It refuses to write when the markdown has a row the list lacks, so a hand edit is never silently dropped.

## Finding product pages (`npm run discover-products`)

```
npm run discover-products -- --domains domains.txt --out discovered.jsonl
npm run discover-products -- example.com
npm run discover-products -- --classify https://example.com/products/blue-shirt
```

For each store: its Shopify feed (`/collections/all/products.json`, `/products.json`) if it has one (garments in
stock only), else its sitemap (from `robots.txt`, `sitemap.xml`, following an index to the product sitemaps).
Output is one JSON line per store with `urls` (the accepted product pages, the field scrape batches read),
`accepted` (each with its `signals` and `confidence`), `rejected` (each with the reason) and a `note` when nothing was found.

A sitemap candidate is **accepted** only when

- its address is on the store's own site (the same registrable domain; a sitemap that lists another site's pages, as
  Eloquii, Full Beauty, Woman Within and King Size did with `onestopplus.com`, gives nothing),
- its address is not a category, collection, promo, cart, account, blog, search or file address (`/featured/shop-by-brand/...`,
  `/collections/x`, `...-credit-threshold-75-earn-25-a-3996.html` as the Romwe promos were), and
- its page has a product signal: JSON-LD `Product` at the top level (products nested in an `ItemList` are a list, not
  the page's product), `og:type` product, or one to four add-to-cart controls (more is a list's quick-add buttons);
  a product-shaped address alone (`/products/x`, `/p/x`, `-p-123.html`, a style code, `?pid=`) is accepted as `weak`,
  and only when nothing on the page says it is a listing (JSON-LD collection or list, a collection page type or class,
  many product links on an `og:type` website page).

A feed product needs no page check: the feed is the signal. A candidate whose request is redirected to another site is rejected.

Politeness: plain `fetch` requests with no browser headers (the JSON feeds are asked for with `accept: application/json`);
four stores at a time by default (at most eight); one request at a time per store with a pause (default 1 s, or the larger of
that and the store's robots.txt `Crawl-delay`, up to 10 s); 15 s timeout; addresses that robots.txt disallows for `*`
are not requested; HTTP 401, 403, 418, 429 or 503 ends the visit to that store and is not retried.
