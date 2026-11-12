# engine/AGENTS.md

Rules for work inside `engine/`. The repo-wide rules in `../AGENTS.md` still apply.
The data format is fixed by the team: read `../docs/data-format.md` before you touch a measurement,
a wardrobe file or a candidate file.

## Architecture
- `engine/src/` is the matching engine: pure functions, no I/O, no network, no LLM, no framework
  imports. Shared types live in `engine/src/types.ts`.
- `engine/cli/` does file loading/validation and the terminal runners. It calls the engine;
  the engine never calls it.
- The API layer exists. `engine/api/` holds the handlers for `POST /recommend` and `GET /candidates`, and
  `engine/scripts/build-api.mjs` (`npm run build:api`) bundles them into `website/api/recommend.js` and
  `website/api/candidates.js`. The bundles are committed, like `website/api/scraper`, because the Vercel
  project is rooted at `website/` and cannot import `engine/`. The handlers read candidates from Supabase with
  `SUPABASE_URL` and the publishable key only (never the secret key), cache them in memory for 5 minutes
  (and keep serving the last list for up to an hour when Supabase cannot be read), validate input with `engine/cli/validate.ts`, call `recommend()`, and send CORS headers only for pearfit.app
  and this machine (`localhost`, `127.0.0.1`). The engine (`engine/src/`) stays pure: no I/O, no network, and it imports nothing from the API.
  `/parse-product` and `/ingest-gmail` are still future endpoints.

## Engine rules
- Weights, thresholds and the % scale live in `engine/src/config.ts`, one config per garment
  category. No magic numbers elsewhere.
- Missing dimensions must not make a shirt look closer: normalize by the weights actually present.
- The review signal only breaks ties between close sizes; it never overrides measurements.
- Every engine change ships with a unit test using hand-computed numbers.

## Commands (engine, run from `engine/`; Node 22.18+)
- Install dev deps: `npm install`
- Recommend: `npm run recommend -- <owner> [candidateId]`
- Eval against ground truth: `npm run eval`
- Tests: `npm test`
- Typecheck: `npm run typecheck`
- Rebuild the API bundles in `website/api/` after changing `engine/api`, `engine/src` or `engine/cli`: `npm run build:api`

## Where to read next
| If you are about to... | Read first |
| --- | --- |
| Run scraped data, read the eval's miss analysis, or add wardrobes, candidates or cases | `README.md` |
| Change what the engine optimizes for, or what counts as a correct eval case | `docs/model-decisions.md` |
| Use the team's real Pilot 1 wardrobes | `docs/wardrobe-test-data.md` |
| Read candidates from Supabase (the export, or the API handlers) | `../docs/fit-store.md` |
| Change the API's request or response shape | `../app/AGENTS.md` and `../website/README.md` ("Live demo"): both call it |
| Find out why the `Check generated bundles` job failed | `../docs/deploy.md` |
