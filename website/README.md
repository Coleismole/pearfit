# Pearfit Marketing Site

Static landing page for **Pearfit**. No build step.

The page describes what exists today: a scraper that stores numerical fit values, and a separate comparison engine. The hero silhouette and the size matrix are samples. The ROI calculator uses the numbers a visitor types in.

## Contents
- `index.html` — Page markup.
- `styles.css` — Stylesheet, including a dark color scheme.
- `app.js` — Sample silhouette, sample size matrix, ROI model, mobile menu, and the inquiry form.
- `stores.html`, `stores.js`, `stores.json` — The supported-stores page and its data (see Supported stores).
- `fit/`, `sitemap.xml` — The fit guide pages and the sitemap, both generated (see Fit guides).
- `scripts/build-fit-pages.mjs` — Builds them from `data/fit-pages/catalog.json`.
- `robots.txt` — Lets crawlers read everything except `/api/`, and names the sitemap.
- `nav.js` — The mobile menu, shared by the pages.
- `scripts/build-stores.mjs` — Builds `stores.json` from `webscraper/SUPPORTED_STORES.md`.
- `demo.js` — The live size demo (`#try`): form, validation, the two API calls, the result card.
- `analytics.js` — The event layer: `PearfitAnalytics.track(name, props)` (see Analytics).
- `posthog-init.js`, `speed-insights-init.js` — Analytics loaders.
- `test/` — Unit tests: `npm test` in `website/` (Node 22, no dependencies).
- `scripts/audit-site.mjs` — Browser audit of the pages (see below).
- `scripts/verify-site.mjs` — Browser check of links, menu, footer, form messages and the 404 page (see Verify).
- `404.html` — The page Vercel shows for a missing path. Its links and assets are absolute, because it is served at any URL.

## Preview
Open `website/index.html` in a browser, or run `npx serve website`.

`website/vercel.json` is what `www.pearfit.app` deploys. `/` is this page and `/scraper` is the built scraper checked in under `website/scraper`. Refresh those files with `node scripts/assemble-site.mjs` from the repo root.

The shopper app (`app/`) is served at `/app`, built into `website/app` by the same command; run `(cd app && npm ci)` first, and commit the result.

The Vercel project now deploys from `Coleismole/pearfit`.

## Generated files
`api/recommend.js`, `api/candidates.js`, `api/scraper/`, `scraper/`, `stores.json`, `fit/` and `sitemap.xml` are build output, committed because the Vercel project is rooted at `website/`. Do not edit them by hand.

| Output | Rebuild with (repo root) |
| --- | --- |
| `api/recommend.js`, `api/candidates.js` | `(cd engine && npm run build:api)` |
| `scraper/`, `api/scraper/` | `node scripts/assemble-site.mjs` |
| `stores.json` | `node website/scripts/build-stores.mjs` (from `webscraper/SUPPORTED_STORES.md`) |
| `fit/`, `sitemap.xml` | `node website/scripts/build-fit-pages.mjs` (from `data/fit-pages/catalog.json`) |

Both need `npm ci` in `webscraper/` first (esbuild and vite are installed there). The `Check generated bundles` workflow (`.github/workflows/check-bundles.yml`) rebuilds both on every pull request and push to `main` and fails, listing the changed files and the diff stat, when the committed copies are stale. Run the same check locally with `node scripts/check-bundles.mjs` from a tree where those paths are committed. The Vite file names are content hashes, so with the lockfile installed the rebuild is byte-for-byte reproducible and a plain diff is a fair test.

## Inquiries
The form posts the inquiry to `customerservice@pearfit.app` through FormSubmit. The first submission asks that inbox to confirm the address. After that, each form send delivers the email.

## Live demo
The `#try` section calls the engine through the site's own API (built from `engine/api`, see Generated files): `GET /api/candidates` fills the product list and `POST /api/recommend` with `{ wardrobe, candidateId }` returns `{ size, confidence, matchPercent, fitsLike, verdict, notes, garmentType, sizes, similar, reviews }` (the demo does not use `sizes`, `similar` and `reviews`). Both are same-origin on `www.pearfit.app`; they need `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the Vercel project (see `.env.example`), and without them the demo shows its "size service had a problem" state with a retry button.

- **Owned shirts**: name, how it fits (great, too tight, too loose) and chest, length and sleeve. Empty is unknown and goes to the API as `null`. Inches are converted once at input (x 2.54, one decimal). A chest over 80 cm is refused as a probable full circumference, the same limit `engine/cli/validate.ts` warns on. At least one shirt must fit great. "Fill in two example shirts" loads two shirts from `engine/data/wardrobes/sample.json`.
- **Product**: pick from the list (tees only, as the API offers), or paste a link. The API cannot read a link, so the page matches it in the browser against the candidate ids (lowercased SKUs, at least 5 characters, whole path words, longest wins). A link to a product the fit table does not hold says so with the hostname and points to the scraper; it never guesses. The link is not fetched or stored.
- **Result**: the engine's verdict is the headline ("Get the M, fits like your white gap tee."), with the size, a confidence badge (low is called out and framed as a hint), the match percent, the closest owned shirt, the engine's notes and the product's size chart. A missing measurement prints as "unknown". If the engine returns no size, the card says so instead of showing one.
- **States**: product list loading, failed (with retry) and empty; request in flight; failure by kind (network, timeout, rejected, not found, server, unreadable answer); a link that matches nothing. The result card takes focus when an answer arrives, errors are announced, and the whole form works from the keyboard.
- **Privacy**: the form has `ph-no-capture`, so PostHog autocapture skips it. Events carry the hostname of a pasted link, the public product id, the shirt count and the engine's size and confidence, never a shirt name, a measurement or a link (see Analytics).

The pure parts (parsing, wardrobe building, link matching, response checks, error mapping, the client with an injected `fetch`) are unit-tested in `test/demo.test.mjs` with a mocked `fetch`.

## Supported stores
`stores.html` lists the stores the scraper has read, from `stores.json`, with a search box and filters for the review platform, the size chart, whether reviews state the size bought, and whether they carry a fit answer. Stores that could not be read are under "Not supported yet", grouped by reason, with a note that refusals are never bypassed. It is linked from the header and the footer of both pages. It is a static file, so `vercel.json` needs no rewrite for it.

`stores.json` is generated and committed. The markdown `webscraper/SUPPORTED_STORES.md` stays the source of truth: after it changes, run

```sh
node website/scripts/build-stores.mjs          # writes website/stores.json
node website/scripts/build-stores.mjs --check  # exits 1 if the committed file is stale
```

The `Check generated bundles` workflow runs the same check. The output has no timestamp, so the same markdown always gives the same bytes. When the machine-readable verified-stores list under `webscraper/tools/` lands, switch `loadSource` and the parser in that script to it and keep the output shape.

What the markdown does not say is not made up. It records the review platform and the size bought and fit answer for every store, but a size chart only for the size-chart-only store, so every other store reads "Not recorded yet" for the size chart. "Read / stated" and the "Limits we found" notes are copied from the markdown's table and its "Known limits" list. The review platform is normalised from the "Reviews come from" cell (a named platform wins over wording about how it was reached); `node website/scripts/build-stores.mjs` warns, and a test fails, when a new store's platform is not recognised.

## Fit guides
`fit/<product>.html` is one page per product that answers "does it run small?" from the review numbers in the fit
store, with the size chart where there is one. `fit/index.html` lists them by brand and `sitemap.xml` lists every
page of the site. They exist so that a search for how a product fits can land on Pearfit; each page links into the
shopper app.

The pages are built from `data/fit-pages/catalog.json`, a committed snapshot of the fit store. To pick up newly
scraped products, refresh the snapshot and rebuild, from the repo root:

```sh
(cd engine && npm run export-fit-catalog)       # reads Supabase, writes data/fit-pages/catalog.json
node website/scripts/build-fit-pages.mjs          # writes website/fit/ and website/sitemap.xml
node website/scripts/build-fit-pages.mjs --check  # exits 1 if the committed pages are stale
```

The export needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (see `engine/.env.example`). The build needs nothing:
it reads the snapshot only, and the date on the pages is the snapshot's, so the same snapshot always gives the same
bytes. The `Check generated bundles` workflow rebuilds the pages and fails when they are stale.

Rules the script keeps, all set at the top of `scripts/build-fit-pages.mjs`:

- A product gets a page only with at least 10 reviews, a real brand and a name that reads as a product. The scraper
  stores what a store's page says, which is sometimes an error page's title.
- Every number is a stored number. The answer and the advice are picked from the shares by fixed thresholds
  (`fitVerdict`); no language model writes them. The shares count only reviews that say how the product fits, and
  the page says so.
- A chart cell with no trusted number prints "unknown". A product with no chart says it has none.
- No review text, reviewer name or store URL is published. The snapshot does not hold any.
- A tee with a size chart links straight to its check in the app (`/app/#/check/<id>`); anything else links to `/app`.

`test/fit-pages.test.mjs` covers the rules with a hand-written catalog and checks that the committed pages match the
committed snapshot. The audit and the verify script both cover `fit/index.html`, and the verify script follows its
links, so a missing guide page fails there.

## Analytics
PostHog is loaded by `posthog-init.js`, which reads `/api/posthog-config` (`POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` on Vercel). Every event goes through `PearfitAnalytics.track(name, props)` in `analytics.js`. It never throws and does nothing when PostHog is blocked, unconfigured or absent (the GitHub Pages copy has no `/api`): events queue (at most 50) until PostHog starts and are dropped once `posthog:unavailable` fires.

`EVENTS` in `analytics.js` is the allow-list and the source of truth for this table. An event that is not listed is dropped, a property not listed for it is dropped, and a string that contains `://` or `@` is dropped. Names are snake_case, object then past-tense verb, like `scrape_completed` in `webscraper/analyticsEvents.ts`. Every event also carries `app: "pearfit-marketing-site"` and `environment`, which `posthog-init.js` registers (the scraper registers `app: "pearfit-scraper"`).

Privacy rule: hostnames and counts only. No review text, names, emails, full URLs that a visitor typed, or error messages. To add an event, add it to `EVENTS`, add a row below, and keep any value that a visitor typed out of its properties.

| Event | Properties | Sent when |
| --- | --- | --- |
| `section_viewed` | `section` (`hero`, `benefits`, `demo`, `try`, `how`, `roi`, `pilot`, `faq`, and `stores` on the stores page) | Any part of a section is in the top 60% of the screen, once per section per page view |
| `scraper_link_clicked` | `location` (`header`, `footer`, or a section id) | A link to `/scraper` is clicked |
| `stores_link_clicked` | `location` | A link to the supported-stores page is clicked |
| `demo_started` | `source`, `host`, `candidate_id`, `wardrobe_size` | The live demo sends a request (or a pasted link is checked) |
| `demo_completed` | the above plus `size`, `confidence`, `has_fits_like`, `duration_ms` | The engine answered. Shirt names and measurements are never sent |
| `demo_failed` | `source`, `host`, `candidate_id`, `reason`, `status`, `duration_ms` | The request failed, the link matched no product (`no_match`), or the product list did not load (`source: candidate_list`) |
| `store_search_used` | `query_length`, `host` (only when the query is a domain name), `result_count` | The visitor stops typing in the stores search. The text is not sent |
| `store_filter_used` | `filter`, `value`, `result_count` | A platform, size chart, size bought or fit answer filter changes |
| `fit_size_inspected` | `product_id`, `selected_size` | A size button in the sample product card is pressed |
| `fit_reference_selected` | `reference_garment_id` | The sample reference garment changes |
| `fit_recommendation_explored` | `interaction`, `usual_size`, `recommended_size` | The sample size matrix or usual-size picker is used |
| `stakeholder_audience_selected` | `audience` | The benefits filter changes |
| `roi_calculator_adjusted` | `input_name` | An ROI calculator field is changed (the value is not sent) |
| `inquiry_mode_selected` | `inquiry_mode` | The brand pilot and investor switch changes |
| `inquiry_submitted` | `inquiry_mode` | The inquiry was delivered (no form contents) |

## Audit
`node website/scripts/audit-site.mjs` (from the repo root, after `npm ci` in `webscraper/`) serves `website/` locally and checks each page in Chromium at 360, 390 and 1280 px, light and dark: horizontal overflow, clipped text, images without `alt`, links and buttons with no name, form controls with no label, heading order and a single `h1`, landmarks, ARIA misuse, tap targets under 44 px, text contrast measured on the rendered colors, a visible keyboard focus ring, `prefers-reduced-motion`, lazy images, layout shift, and the title, description, canonical, Open Graph and Twitter tags and the icon files. It exits 1 on any failure. Options: `--pages index.html,stores.html`, `--shots <dir>` for full-page screenshots, `--json`.

Layout shift is measured with the Google Fonts request blocked, so a shift caused by the web fonts swapping in is not covered. The share image is the 180 px app icon, so the Twitter card is `summary`; a 1200 x 630 image would allow `summary_large_image`.

## Verify
`node website/scripts/verify-site.mjs` (from the repo root, same setup as the audit) checks behaviour the audit does not: every link resolves, including a `#section` on another page; both logos link home; each footer has `customerservice@pearfit.app` as a link and the current year; no email address is shown without a link; no page scrolls sideways from 320 to 1280 px; the mobile menu opens and Escape or a link closes it; the inquiry form names a missing field, accepts a bare domain, and shows its success and error messages (FormSubmit is mocked, so nothing is sent); and a missing path answers 404 with `404.html`. Run locally, it also checks that the branch is pushed.

Give it a URL to check a deploy, and `--attempts`/`--wait` to retry while the deploy finishes:

```sh
node website/scripts/verify-site.mjs https://www.pearfit.app --attempts 10 --wait 30
```

The `Verify website` workflow (`.github/workflows/verify-website.yml`) runs the unit tests, the audit on the four hand-written pages and `fit/index.html`, and this check on every pull request that changes `website/`, and on pushes to `main`.
