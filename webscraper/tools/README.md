# Scraper tools

Command-line helpers around the local scraper (`webscraper/server.ts`). They live apart from the scraper's own
code and only talk to it over HTTP, the way the front end does. Run them from `webscraper/`.

| Tool | Command | What it does |
|---|---|---|
| Saved pages | `npm run saved-html -- <folder>` | Reads pages you saved from your own browser. See below. |

All of them respect the scraper's rule: a store that refuses automated requests is reported, never worked around.

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
