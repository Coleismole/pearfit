# Deploy and generated files

Read this before you touch a generated file under `website/`, `scripts/`, a `vercel.json` or a
workflow in `.github/`.

## What deploys from where
| Target | Source | Config |
| --- | --- | --- |
| `www.pearfit.app` (Vercel project rooted at `website/`) | `website/` as committed; no build step | `website/vercel.json` |
| Vercel project rooted at the repo root | `scripts/assemble-site.mjs` builds `site/` and `api/` | `vercel.json` |
| GitHub Pages | `website/` uploaded as-is on a push to `main` that touches `website/**` | `.github/workflows/pages.yml` |

`/` is the marketing site, `/scraper` the scraper, `/app` the shopper app. `/api/recommend` and
`/api/candidates` are the engine's API, and `/scraper/api/*` is rewritten to the scraper function.

## Generated files (do not edit by hand)
They are committed because the `website/` project has no build step and cannot import the other folders.

| Output | Built from | Rebuild with (repo root) |
| --- | --- | --- |
| `website/api/recommend.js`, `website/api/candidates.js` | `engine/api`, `engine/src`, `engine/cli` | `(cd engine && npm run build:api)` |
| `website/scraper/`, `website/api/scraper/` | `webscraper/` | `node scripts/assemble-site.mjs` |
| `website/app/` | `app/` | `node scripts/assemble-site.mjs` |
| `website/stores.json` | `webscraper/SUPPORTED_STORES.md` | `node website/scripts/build-stores.mjs` |

- The generators need `npm ci` in `webscraper/` and in `app/` first.
- `website/api/posthog-config.js` is hand-written. It is not generated.
- `site/` and `/api/` at the repo root are gitignored build output.

## CI
| Workflow | Runs on | What it does |
| --- | --- | --- |
| `check-bundles.yml` | Every pull request and push to `main` | Rebuilds every generated file and fails when the committed copy is stale. Locally: `node scripts/check-bundles.mjs` |
| `verify-website.yml` | Pull requests and pushes to `main` touching `website/**` | Runs the website unit tests, `audit-site.mjs` and `verify-site.mjs` in Chromium. See `website/README.md` |
| `verify-stores.yml` | Mondays, or by hand | Re-scrapes one product per confirmed store, read-only. See `webscraper/tools/README.md` |
| `pages.yml` | Push to `main` touching `website/**` | Publishes `website/` to GitHub Pages |

## Rules
- Everything in `website/` is published. Do not put notes, agent files or secrets there.
- A change in `engine/`, `webscraper/` or `app/` is not live until its generated files are rebuilt
  and committed in the same pull request.
- `scripts/vercel-directory-build.mjs` is the original for two copies:
  `webscraper/scripts/assemble-site.mjs` and `website/scraper/scripts/assemble-site.mjs`. Edit the
  original; `scripts/assemble-site.mjs` rewrites the second copy.
- The root `vercel.json` and `website/vercel.json` carry the same rewrites and function settings.
  Change both together.
- The root `package.json` and `website/package.json` exist only to install the scraper function's
  native dependencies on Vercel. They are not a workspace.

## Related
- The marketing site, its demo, analytics and audit script: `website/README.md`.
- What the hosted scraper can and cannot do: `webscraper/README.md`.
- The API's allowed origins: `engine/api/config.ts`.
