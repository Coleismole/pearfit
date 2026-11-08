# AGENTS.md

Rules for any AI coding agent (Claude Code, Cursor, Codex) and for humans working in this repo.
This file is the single source of truth. `CLAUDE.md` imports it; do not duplicate rules elsewhere.

## Product in one line
Store-agnostic clothing size predictor: tells a shopper what size to buy and which shirt they
already own it fits like ("Get the M, fits like your blue Uniqlo oxford"), with a confidence level.
Out of scope: avatars, 3D, Unity, SMPL-X, MediaPipe, cloth simulation. Do not add them.

## Architecture
- TypeScript everywhere except SQL.
- First MVP has no frontend: the matching engine runs from the terminal. Do not add a UI or API
  server unless the team decides to.
- `engine/src/` is the matching engine: pure functions, no I/O, no network, no LLM, no framework
  imports. Shared types live in `engine/src/types.ts`.
- `engine/cli/` does file loading/validation and the terminal runners. It calls the engine;
  the engine never calls it.
- `webscraper/` is a separate app with its own `package.json`. Don't mix its code into `engine/`.
- Later, when there is an API: endpoints exist only where there is a secret or real logic
  (`/recommend`, `/parse-product`, `/ingest-gmail`), and they import types from the engine.
- Supabase is the team's shared fit store (adopted Nov 2026). The scraper pushes fit values to
  the shared Supabase project via the `commit_fit_report` RPC. Review text and the engine's source
  data stay in SQLite (`webscraper/commercial_fit.db`); the engine stays pure and never touches
  Supabase. The publishable/anon key is safe to commit — tables have RLS and anon can only call the
  commit function; `SUPABASE_SECRET_KEY` goes in `.env.local`, never committed. Auth is not in use yet.

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
- Chest (pit-to-pit / body width) is the trusted dimension — consistent across sources. Length and sleeve
  are only comparable within one convention: prefer a per-brand offset calibrated from a shirt the user
  owns (hand-measure it, compare to that brand's chart at the known size, store the difference, and apply
  it to that brand's charts). When no offset is known and the chart's convention can't be confirmed, set
  that dimension to null rather than mixing conventions.
- `id`: lowercase, dashes, no spaces, unique per person.

Candidate garment (used by the Pilot 1 engine; sizes listed smallest to largest):
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
- Weights, thresholds and the % scale live in `engine/src/config.ts`, one config per garment
  category. No magic numbers elsewhere.
- Missing dimensions must not make a shirt look closer: normalize by the weights actually present.
- The review signal only breaks ties between close sizes; it never overrides measurements.
- Every engine change ships with a unit test using hand-computed numbers.

## Working rules
- Small PRs on a branch; never push to `main` directly.
- Run tests and the typecheck before claiming something works. Report failures as they are.
- No new dependency without a one-line reason in the PR.
- No secrets in code or commits. Keys go in `.env.local` (gitignored); list their names in `.env.example`.
- Prefer boring, readable code over clever code. Match the surrounding style.
- Don't touch `webscraper/` when working on the engine, or the reverse, unless the task says so.

## Commands (engine, run from `engine/`; Node 22.18+)
- Install dev deps: `npm install`
- Recommend: `npm run recommend -- <owner> [candidateId]`
- Eval against ground truth: `npm run eval`
- Tests: `npm test`
- Typecheck: `npm run typecheck`
