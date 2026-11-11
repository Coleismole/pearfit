# webscraper/AGENTS.md

Rules for work inside `webscraper/`. The repo-wide rules in `../AGENTS.md` still apply.
This is a separate app with its own `package.json`: an Express server plus a React/Vite page that
scrapes product pages into fit values, size charts and reviews.

## Layout
- `server.ts` (`createApp`) and `headlessFetch.ts` (the render functions) are the entry points.
  `vercelHandler.ts`, the tests and the site bundler import from them.
- `server/` holds the code behind the server and `render/` the code behind the headless render.
  `README.md` ("Code layout") says what each file does.
- Parsers and the page's components sit directly in `webscraper/`, each test beside the file it
  tests (`sizeChart.ts`, `sizeChart.test.ts`).
- `tools/` holds command-line helpers that only talk to the scraper over HTTP. They have their own
  `tools/README.md`.
- `scripts/assemble-site.mjs` is a copy of `../scripts/vercel-directory-build.mjs`. Edit the
  original; see `../docs/deploy.md`.

## Scraper rules
- The measurement rules in `../docs/data-format.md` apply to every value this app stores. A size
  chart is saved in centimeters with chest pit-to-pit, and a value the page does not state is `null`.
- A store that refuses automated requests is reported, never worked around or retried.
- Fit values go to Supabase and review text stays in SQLite. Read `../docs/fit-store.md` before you
  change `fit_store.sql`, `supabaseFit.ts`, `server/db.ts` or a key.
- Analytics events never carry review text, reviewer names, full product URLs, pasted HTML or error
  messages. `analyticsEvents.ts` builds each payload and its tests check this.
- `SUPPORTED_STORES.md` is the source for `../website/stores.json`. After you change it, rebuild
  that file (`../docs/deploy.md`).
- `.env.example` here is committed with the project URL and publishable key on purpose, and the
  Vercel build reads it. Keep `SUPABASE_SECRET_KEY` empty in it.
- A change to the page or the server reaches pearfit.app only after the bundles under `../website/`
  are rebuilt and committed. The `Check generated bundles` job fails until they are.

## Commands (run from `webscraper/`; Node 22)
- Install: `npm install`
- Run locally: `npm run dev`, then open http://127.0.0.1:3000
- Tests (the scraper's and the tools'): `npm test`
- Typecheck: `npm run lint`
- Build the page: `npm run build`

## Where to read next
| If you are about to... | Read first |
| --- | --- |
| Change how reviews are found, or set up the fit store | `README.md` |
| Add or re-test a store | `SUPPORTED_STORES.md` |
| Use or change a tool (saved pages, weekly store check, discovery) | `tools/README.md` |
| Rebuild what pearfit.app serves | `../docs/deploy.md` |
