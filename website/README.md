# Pearfit Marketing Site

Static landing page for **Pearfit**. No build step.

The page describes what exists today: a scraper that stores numerical fit values, and a separate comparison engine. The hero silhouette and the size matrix are samples. The ROI calculator uses the numbers a visitor types in.

## Contents
- `index.html` — Page markup.
- `styles.css` — Stylesheet, including a dark color scheme.
- `app.js` — Sample silhouette, sample size matrix, ROI model, and the inquiry form.

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


