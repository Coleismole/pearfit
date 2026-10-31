# AGENTS.md

Rules for any AI coding agent (Claude Code, Cursor, Codex) and for humans working in this repo.
This file is the single source of truth. `CLAUDE.md` imports it; do not duplicate rules elsewhere.

## Product in one line
Store-agnostic clothing size predictor: tells a shopper what size to buy and which shirt they
already own it fits like ("Get the M, fits like your blue Uniqlo oxford"), with a confidence level.
Out of scope: avatars, 3D, Unity, SMPL-X, MediaPipe, cloth simulation. Do not add them.

## Architecture
- TypeScript everywhere except SQL.
- Frontend and backend talk only through the API. Request/response types live in
  `shared/types.ts`; both sides import it. Change the contract there first, never ad hoc.
- Matching engine (`engine/`) is pure TypeScript: no I/O, no network, no LLM, no framework imports.
  The API layer calls the engine; the engine never calls the API.
- Endpoints (custom code only where there is a secret or real logic):
  - `POST /api/recommend`: wardrobe + candidate -> recommended size, % match ranking, verdict, confidence
  - `POST /api/parse-product` (later): URL or raw HTML -> candidate garment
  - `POST /api/ingest-gmail` (later)
- Supabase (auth, DB) is planned but not in use yet. Do not add it until the team decides to.

## Core design rule
LLMs do language only (messy text -> structured numbers). Code makes every decision and does all math.
Never ask an LLM "which size?". Never let an LLM or any code invent a measurement: missing = `null`.

## Data format (fixed by the team; do not rename fields)
Owned shirt:
```json
{
  "id": "blue-uniqlo-oxford",
  "label": "great",
  "measurements": { "chest_cm": 54, "length_cm": 72, "sleeve_cm": 63 }
}
```
- `label` is one of `"great"`, `"tight"`, `"loose"` (how the shirt fits its wearer).
- Centimeters, numbers not strings, rounded to 1 decimal. Inches are converted at input
  (x 2.54), never inside the engine.
- `chest_cm` is pit-to-pit measured flat (half the circumference). Every source must use this
  convention. Mixing flat and circumference is the #1 silent bug.
- Any measurement may be `null`. Code must handle `null` on every field.
- `id`: lowercase, dashes, no spaces, unique per person.

Candidate garment (proposal, not yet agreed by the team):
```json
{
  "id": "cos-oxford",
  "name": "COS oxford",
  "review": "runs_small",
  "sizes": { "M": { "chest_cm": 55, "length_cm": 73, "sleeve_cm": 64 } }
}
```
`review` is one of `"runs_small"`, `"true_to_size"`, `"runs_large"`, or `null`.

## Engine rules
- Weights, thresholds and the % scale live in one config file per garment category. No magic
  numbers elsewhere.
- Missing dimensions must not make a shirt look closer: normalize by the weights actually present.
- The review signal only breaks ties between close sizes; it never overrides measurements.
- Every engine change ships with a unit test using hand-computed numbers.

## Working rules
- Small PRs on a branch; never push to `main` directly.
- Run tests and the typecheck before claiming something works. Report failures as they are.
- No new dependency without a one-line reason in the PR.
- No secrets in code or commits. Keys go in `.env.local` (gitignored); list their names in `.env.example`.
- Prefer boring, readable code over clever code. Match the surrounding style.
- Don't touch frontend files when working on the engine, or the reverse, unless the task says so.

## Commands
TODO: fill in from the real `package.json` once the repo is set up.
- Install: `npm install`
- Dev server: `npm run dev`
- Tests: `npm test`
- Typecheck: `npx tsc --noEmit`
- Scorer eval: `npm run eval`
