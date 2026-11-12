# app/AGENTS.md

Rules for work inside `app/`. The repo-wide rules in `../AGENTS.md` still apply.
This is the shopper app: a static Vite + React + TypeScript app with no server of its own.
`README.md` is the full reference; the rules below are the ones that are easy to break.

## App rules
- The app does not compute sizes or scores. All size logic lives in the hosted API. The app makes
  two calls, `GET /api/candidates` and `POST /api/recommend`, both in `src/lib/api.ts`, and no other
  request to Pearfit. The one other network traffic is Sentry error reports (`src/instrument.ts`); keep it
  free of Session Replay and trace headers (`../docs/observability.md`).
- `app/` is its own package and does not import `engine/`. `src/lib/types.ts` repeats the API's
  shapes from `engine/src/types.ts` and `engine/api/recommend-api.ts`. If the API contract changes,
  update that file and `src/lib/api.ts`.
- No screen uses mock data. Every number and name on screen comes from the API or from what the
  person typed. A part of the design with no data behind it is left out and listed in `README.md`.
- The wardrobe uses the team's format (`../docs/data-format.md`). Inches are converted when typed,
  and a measurement that was not taken stays `null`.
- `src/lib/` is plain TypeScript with no React. Its unit tests in `test/` use hand-computed values.
- A change reaches pearfit.app/app only after `../website/app/` is rebuilt and committed
  (`../docs/deploy.md`). The `Check generated bundles` job fails until it is.

## Commands (run from `app/`; Node 22.18+)
- Install: `npm install`
- Run locally: `npm run dev`, then open http://localhost:5173
- Tests: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`

## Where to read next
| If you are about to... | Read first |
| --- | --- |
| Build or change a screen | `README.md` ("Design screens and what the app does with them") |
| Check what a screen should look like | `../design/app-ui/README.md` |
| Deploy the app on another origin | `README.md` ("CORS") |
