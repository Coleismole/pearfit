# Pearfit

A store-agnostic clothing size predictor. It tells a shopper what size to buy and which shirt they
already own it fits like.

## Map
| Folder | What it is | Start with |
| --- | --- | --- |
| `engine/` | The matching engine, its terminal runners and the API handlers | `engine/README.md` |
| `webscraper/` | The scraper that collects fit values, size charts and reviews | `webscraper/README.md` |
| `app/` | The shopper app, served at pearfit.app/app | `app/README.md` |
| `website/` | The marketing site and everything pearfit.app serves, published as-is | `website/README.md` |
| `design/` | Screen designs the app was built from | `design/app-ui/README.md` |
| `brand/` | Provisional logo files | |
| `scripts/` | Build and check scripts for the deploy | `docs/deploy.md` |
| `data/samples/` | Sample scraper output, for reference only | |
| `docs/` | Background and cross-cutting reference | `docs/README.md` |

Working rules for people and AI agents are in `AGENTS.md`.

## Using each app as an AI agent

Rules for changing the code are in `AGENTS.md`. This section says how to use and check each part. Run every
command from the folder named in its row. Run the tests and the typecheck before you say something works.

| Part | What an agent uses it for | How |
| --- | --- | --- |
| `engine/` | Get a size recommendation from code, or change the matching | CLI: `npm run recommend -- sample [candidateId]` and `npm run eval`. Over HTTP: `GET https://www.pearfit.app/api/candidates`, then `POST https://www.pearfit.app/api/recommend` with `{ wardrobe, candidateId }`. The answer is `{ size, confidence, matchPercent, fitsLike, verdict, notes, garmentType, sizes, similar }`. `sizes` is `[{ size, matchPercent, fitsLike }]` for every size and `similar` is `[{ shirtId, matchPercent }]`, the great shirts against the suggested size, closest first. |
| `webscraper/` | Collect fit values, size charts and reviews from a store page | `npm run dev`, then use the page or the endpoints on http://127.0.0.1:3000. Helpers: `webscraper/tools/README.md`. |
| `app/` | See the shopper flow, or check a change to the API contract | `npm run dev`, then open http://localhost:5173 (not `127.0.0.1`: the API's CORS allows `localhost` only). |
| `website/` | Edit the marketing site and its demo | Edit the files as committed. `npm test` and `node scripts/audit-site.mjs` check it. |

Do:
- Let code decide the size. Ask the engine or the API, never a language model, and treat `null` as "not measured".
- Keep one part per change. A change in `engine/`, `webscraper/` or `app/` is not live until its generated files under
  `website/` are rebuilt and committed (`docs/deploy.md`).
- Check that error reports and analytics still arrive after you change them (`docs/observability.md`).

Do not:
- Call a store that refuses automated requests again, or work around it.
- Send anything to the API except `Content-Type`, or add a request the app does not already make.
- Put a key in code or a commit. Keys go in `.env.local`; names go in `.env.example`.
- Add avatars, 3D, cloth simulation or a server of your own.

Per-part detail: `engine/AGENTS.md`, `webscraper/AGENTS.md`, `app/AGENTS.md`, `website/README.md`.

## Run the scraper

```bash
cd webscraper
npm install
npm run dev
```

Open http://127.0.0.1:3000. Fit numbers are pushed to the shared Supabase project. See `webscraper/README.md`.

## Run the engine

```bash
cd engine
npm install
npm run recommend -- sample
```

## Run the app

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173.


Copyright (c) 2026 Jinyu Chen Jchen@pearfit.app
Copyright (c) 2026 Nicolas Roguski Croguski@pearfit.app
Copyright (c) 2026 Dima Sotnikov Dsotnikov@pearfit.app
Copyright (c) 2026 Alvin Sheng Asheng@pearfit.app
Copyright (c) 2026 Steven Liu Sliu@pearfit.app
All rights reserved.
