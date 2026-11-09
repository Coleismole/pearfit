# Pearfit Scraper

```bash
cd webscraper
npm install
npm run dev
```

Open http://127.0.0.1:3000 and scrape. Fit numbers go to the shared Supabase project. A size chart on the page is saved in the local `size_chart` table (pit-to-pit chest, centimeters). The project URL and publishable key are already in `.env.example`, which the server reads on its own. Review text stays in the local SQLite file.

On Vercel the marketing site is `pearfit.app` and this app is `pearfit.app/scraper`. That copy can still push fit numbers to Supabase. Review text lives only as long as the function instance does, because Vercel has nowhere to keep the SQLite file. Scrapes read the HTML the store returns, and a headless Chromium can still run there inside a 50 second budget.

If the terminal says the fit store is not writable, or the page says `list_fit_catalog` is missing, open the Supabase SQL editor and run `fit_store.sql` once. That is a one-time step for the project. After it, every teammate can clone, push, and read the same fit rows.

The five products shown on an empty local database are samples. They are not scrapes. A headless scrape stops after 120 seconds (50 on Vercel). Public product URLs stay allowed.

## How reviews are found

A scrape reads every place a product page keeps its reviews, then keeps only this product's reviews and counts each review once:

1. **Review data the page loads.** The headless browser opens the page like a shopper, scrolls the review widget into view, and clicks its "load more" / next-page controls. It keeps the JSON the widget receives. `reviewJson.ts` reads reviews from that JSON by their shape, so Yotpo, Okendo, Stamped, Klaviyo, Junip, Bazaarvoice, Reviews.io and a store's own review system all go through the same reader. The scraper never calls a review service itself.
2. **Data embedded in the page:** schema.org JSON-LD, `__NEXT_DATA__` and other `application/json` scripts.
3. **Review cards in the HTML**, for stores that render reviews as markup.

Size bought, usual size, fit, height and build come from each review's own answers ("Size purchased", "How was the fit?") or from the variant bought ("Small / Navy"). A fit answer becomes "runs small" or "runs large" only on a known scale; otherwise it is left empty. `scraperTelemetry.reportedReviewCount` is the total the store states, so a scrape can be checked against it. Paging stops at about 300 reviews.

Stores that refuse automated requests (HTTP 403/418/429/503, or a block page) are reported and not retried. See `SUPPORTED_STORES.md` for the stores this was tested on.

To see what a render does on a store (review data found, sort, each paging click), run the server with `SCRAPER_DEBUG=1`.

## Analytics (PostHog)

The page reports to PostHog when `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` are set (see `.env.example`; with either empty, nothing loads). The browser gets them from `/api/posthog-config`, so the build holds no keys. On pearfit.app the scraper shares the marketing site's origin and PostHog project, so one visitor is one person across both.

Events: `scrape_completed` (mode, store hostname, reviews read and stated, size chart rows, duration), `scrape_failed` (mode, hostname, reason `refused` / `no_reviews` / `other`), `sku_committed`, `sku_deleted`. Every event carries `app: pearfit-scraper` and `environment`. Review text, reviewer names, full product URLs, pasted HTML and error messages are never sent; `analyticsEvents.ts` builds each payload and its tests check this.
