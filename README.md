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
