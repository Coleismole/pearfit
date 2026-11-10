# Pearfit Marketing Site

Static landing page for **Pearfit**. No build step.

The page describes what exists today: a scraper that stores numerical fit values, and a separate comparison engine. The hero silhouette and the size matrix are samples. The ROI calculator uses the numbers a visitor types in.

## Contents
- `index.html` — Page markup.
- `styles.css` — Stylesheet, including a dark color scheme.
- `app.js` — Sample silhouette, sample size matrix, ROI model, mobile menu, and the inquiry form.
- `posthog-init.js`, `speed-insights-init.js` — Analytics loaders.
- `scripts/audit-site.mjs` — Browser audit of the pages (see below).

## Preview
Open `website/index.html` in a browser, or run `npx serve website`.

`website/vercel.json` is what `www.pearfit.app` deploys. `/` is this page and `/scraper` is the built scraper checked in under `website/scraper`. Refresh those files with `node scripts/assemble-site.mjs` from the repo root.

The Vercel project now deploys from `Coleismole/pearfit`.

## Generated files
`api/recommend.js`, `api/candidates.js`, `api/scraper/` and `scraper/` are build output, committed because the Vercel project is rooted at `website/`. Do not edit them by hand.

| Output | Rebuild with (repo root) |
| --- | --- |
| `api/recommend.js`, `api/candidates.js` | `(cd engine && npm run build:api)` |
| `scraper/`, `api/scraper/` | `node scripts/assemble-site.mjs` |

Both need `npm ci` in `webscraper/` first (esbuild and vite are installed there). The `Check generated bundles` workflow (`.github/workflows/check-bundles.yml`) rebuilds both on every pull request and push to `main` and fails, listing the changed files and the diff stat, when the committed copies are stale. Run the same check locally with `node scripts/check-bundles.mjs` from a tree where those paths are committed. The Vite file names are content hashes, so with the lockfile installed the rebuild is byte-for-byte reproducible and a plain diff is a fair test.

## Inquiries
The form posts the inquiry to `customerservice@pearfit.app` through FormSubmit. The first submission asks that inbox to confirm the address. After that, each form send delivers the email.

## Audit
`node website/scripts/audit-site.mjs` (from the repo root, after `npm ci` in `webscraper/`) serves `website/` locally and checks each page in Chromium at 360, 390 and 1280 px, light and dark: horizontal overflow, clipped text, images without `alt`, links and buttons with no name, form controls with no label, heading order and a single `h1`, landmarks, ARIA misuse, tap targets under 44 px, text contrast measured on the rendered colors, a visible keyboard focus ring, `prefers-reduced-motion`, lazy images, layout shift, and the title, description, canonical, Open Graph and Twitter tags and the icon files. It exits 1 on any failure. Options: `--pages index.html,stores.html`, `--shots <dir>` for full-page screenshots, `--json`.

Layout shift is measured with the Google Fonts request blocked, so a shift caused by the web fonts swapping in is not covered. The share image is the 180 px app icon, so the Twitter card is `summary`; a 1200 x 630 image would allow `summary_large_image`.
