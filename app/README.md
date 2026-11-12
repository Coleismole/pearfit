# Pearfit app

The shopper app for Pearfit. You add shirts you own, pick a shirt from the catalog, and the app shows what size
to buy and which of your shirts it fits like.

It is a static web app (Vite + React + TypeScript). It has no server of its own. All the size logic lives in the
hosted Pearfit API: this app only shows the answers.

The screens were built from the design in [`design/app-ui/`](../design/app-ui/README.md).

## Requirements

Node 22.18 or newer (the tests run TypeScript files directly with `node --test`).

## Install

```bash
cd app
npm install
```

## Run locally

```bash
npm run dev
```

Open **http://localhost:5173**. Use `localhost`, not `127.0.0.1`: the API only accepts browser requests from
`localhost` (see [CORS](#cors) below).

## Build

```bash
npm run build     # typecheck, then write the static files to dist/
npm run preview   # serve dist/ on http://localhost:4173 to check the build
```

`dist/` is plain static files. Asset paths are relative and the routes are in the URL hash (`#/wardrobe`), so
the build works at a domain root or under a sub-path, and needs no rewrite rules.

The app is served at **https://www.pearfit.app/app**. Rebuild and commit it from the repo root with `node scripts/assemble-site.mjs` (it runs `npm run build` here with `APP_BASE=/app/` and copies `dist/` to `website/app/`); the `check-bundles` CI job fails if `website/app/` is stale.

## Tests and typecheck

```bash
npm test            # unit tests (node --test)
npm run typecheck   # tsc
```

## The API

The app makes two calls to the API. Apart from those, the only network traffic is Sentry error reports
(`src/instrument.ts`): no analytics, no Session Replay, and the fonts are bundled with the app.

| Call | Used for | Answer |
| --- | --- | --- |
| `GET /api/candidates` | the catalog picker | `[{ id, name, garmentType, sizes }]` |
| `POST /api/recommend` with `{ wardrobe: [...], candidateId }` | the size suggestion | `{ size, confidence, matchPercent, fitsLike, verdict, notes, garmentType }` |

Both calls are in [`src/lib/api.ts`](src/lib/api.ts).

When `size` is `null` the API could not suggest a size and `verdict` says why (for example, the wardrobe has no
shirt of that kind). The app shows that verdict as a normal message, not as an error. Errors are only shown when a
request fails.

### Base URL

The API base URL is one setting, in [`src/config.ts`](src/config.ts). It is `https://www.pearfit.app`.

To point the app at another deployment, copy `.env.example` to `.env.local` and change `VITE_API_BASE_URL`.
It is not a secret. `.env.local` is gitignored.

### CORS

The API sends CORS headers only for these origins (`ALLOWED_ORIGINS` in `engine/api/config.ts`):

- `https://pearfit.app` and `https://www.pearfit.app`
- `http://localhost` on any port

So local development on `localhost` works. **A deploy on any other domain will be blocked by the browser** until
that origin is added to the API's allowed origins. That includes Vercel preview URLs, a subdomain such as
`app.pearfit.app`, and `http://127.0.0.1`. When that happens the app shows "Couldn't load the catalog".

If the app is served from `www.pearfit.app` itself (for example under `/app/`), its requests go to the same
origin and CORS does not apply.

## Where the data lives

There are no accounts yet, so nothing is stored on a server.

- The wardrobe and the "Planning to buy" list are saved in the browser (`localStorage`, keys starting with
  `pearfit.`). They stay on that device.
- The wardrobe leaves the browser only inside a `POST /api/recommend` request.
- The wardrobe uses the team's format, the same as `engine/data/wardrobes/person1.json`:
  `{ id, label, garmentType, measurements: { chest_cm, length_cm, sleeve_cm } }`. Centimetres, `null` for a
  measurement that was not taken. A missing measurement is never filled in.
- **Account → Import a wardrobe file** loads such a file (try `engine/data/wardrobes/person1.json`).
  **Export wardrobe as JSON** writes one. Import checks every shirt with the same rules the API uses. (The API
  also refuses a wardrobe of more than 200 shirts.)
- A shirt's name is its `id` written as words (`blue-uniqlo-oxford` shows as "Blue uniqlo oxford"). The format
  has no separate name field, and the API's verdict writes it the same way.
- Inches can be typed in the form. They are converted to centimetres when typed (× 2.54, 1 decimal).

## Mock data

No screen uses mock data. Every number and name on screen comes from the API or from what the person typed in.

The sample products, scores and reviews in the design (`design/app-ui/`) are not in the app. Parts of the
design that have no data behind them yet were left out or changed. They are listed below, so nobody takes a
missing piece for a bug.

## Design screens and what the app does with them

| # | Design screen | In the app | Where the data comes from |
| --- | --- | --- | --- |
| 1 | Onboarding | `#/welcome`, shown on the first visit | wardrobe on the device, catalog counts from `GET /api/candidates` |
| 2 | Home | `#/` | search over `GET /api/candidates` |
| 3 | Tag scanned | `#/add/item/<id>` ("Shirt found") | the catalog's size chart |
| 4, 10 | Wardrobe (owned, planning to buy) | `#/wardrobe`, `#/wardrobe/planned` | the device |
| 5 | Item page, planning to buy | `#/planned/<id>` | the saved answer of `POST /api/recommend` |
| 6 | Suitability analysis | `#/check/<id>` | `POST /api/recommend` |
| 7 | Side-by-side compare | `#/check/<id>/compare` | the catalog's size chart and the wardrobe |
| 8 | Couldn't read link | a message inside the search box on Home | (none) |
| 9 | Account | `#/account` | the device |
| 11 | Category page | `#/type/<garmentType>` | the device |
| 12 | Item page, owned | `#/owned/<id>` | the device |
| 13 | Add category | not built | (none) |
| 14 | Compare picker | the "Compare" sheet on an item page | the device |
| 15 | Wardrobe compare result | `#/compare?a=…&b=…` | the device |

Typing a shirt in by hand (`#/add/by-hand`) is not in the design. It was added because the catalog does not hold
every shirt a person owns.

### Changed or left out, and why

- **Product links.** The app cannot read a product page: that needs the planned `/parse-product` endpoint. The
  search box takes a name or a SKU. A pasted link works only when it contains the SKU of a catalog shirt (Uniqlo
  links do). Any other link gets the "Couldn't match this link" message.
- **Tag scanner.** There is no camera step. The SKU printed on the tag can be typed into the search box.
- **Fit score 0–100.** The wardrobe format has `label`: `great`, `tight` or `loose`. The app asks for that
  instead of a score.
- **Suitability per size.** The API returns one percentage, for the suggested size. The other sizes are listed
  without a percentage, and their measurements can be compared.
- **Most similar in your wardrobe.** The API returns one shirt (`fitsLike`), so one is shown, not a ranked list.
  The similarity percentage between two wardrobe shirts (screens 14 and 15) is left out for the same reason:
  the app does not compute scores itself.
- **Customer reviews.** The API does not return review data, so the section is not there.
- **Measurements.** Chest width, length and sleeve length only: those are the three in the data format. The
  design also shows shoulder, waist and hem.
- **Categories.** They are the engine's garment types (tee, long-sleeve tee, polo, button shirt, jacket, other).
  Custom categories with their own measurements (screen 13) and pants are not possible with the current format.
  Today the catalog only lists tees.
- **Account.** Sign-in, password, switching and deleting an account are not built, because auth is not in use
  yet. The screen has export, import and reset instead. The light/dark setting is not built: the design has no
  dark colours.
- **Photos.** The API has no product photos. A plain colour block with a shirt outline stands in for one.

## Code layout

```
src/
  config.ts            the API base URL (the only setting)
  lib/                 plain TypeScript, no React: API client, wardrobe rules, units, search, compare, storage
  store.tsx            wardrobe and planned list (React state, saved on the device)
  catalog.tsx          the list from GET /api/candidates, loaded once
  useRecommendation.ts POST /api/recommend for one catalog shirt
  components/          shared pieces (search box, compare table, messages, tab bar, the crash message)
  screens/             one file per screen or pair of screens
  styles.css           colours and sizes from the design
test/                  unit tests for lib/, with hand-computed expected values
```

The types in `src/lib/types.ts` repeat the API's shapes from `engine/src/types.ts` and
`engine/api/recommend-api.ts`. `app/` is its own package and does not import `engine/`. If the API contract
changes, update that file and `src/lib/api.ts`.
