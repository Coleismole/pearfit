# AGENTS.md

Rules for any AI coding agent (Claude Code, Cursor, Codex) and for humans working in this repo.
This file is the always-loaded core. Area rules and reference docs load only when you need them:
see "Where to read next". Each rule lives in exactly one file; do not duplicate rules elsewhere.
Each `CLAUDE.md` only imports the `AGENTS.md` beside it.

## Product in one line
Store-agnostic clothing size predictor: tells a shopper what size to buy and which shirt they
already own it fits like ("Get the M, fits like your blue Uniqlo oxford"), with a confidence level.
Out of scope: avatars, 3D, Unity, SMPL-X, MediaPipe, cloth simulation. Do not add them.

## Core design rule
LLMs do language only (messy text -> structured numbers). Code makes every decision and does all math.
Never ask an LLM "which size?". Never let an LLM or any code invent a measurement: missing = `null`.

## Architecture
- TypeScript everywhere except SQL.
- First MVP has no frontend of its own: the matching engine runs from the terminal, and from the demo
  frontend through the API layer below. Do not add a UI or a long-running API server unless the team
  decides to; the API is Vercel functions.
- `webscraper/` is a separate app with its own `package.json`. Don't mix its code into `engine/`.

## Working rules
- Small PRs on a branch; never push to `main` directly.
- Run tests and the typecheck before claiming something works. Report failures as they are.
- No new dependency without a one-line reason in the PR.
- No secrets in code or commits. Keys go in `.env.local` (gitignored); list their names in `.env.example`.
- Prefer boring, readable code over clever code. Match the surrounding style.
- Don't touch `webscraper/` when working on the engine, or the reverse, unless the task says so.

## Where to read next
Read the row that matches your task before you change anything. Skip the rest.

| If you are about to... | Read first |
| --- | --- |
| Change anything in `engine/`, including the API handlers in `engine/api/` | `engine/AGENTS.md` |
| Change anything in `webscraper/` | `webscraper/AGENTS.md` |
| Change anything in `app/` | `app/AGENTS.md` |
| Read, write or convert a measurement, wardrobe or candidate | `docs/data-format.md` |
| Touch Supabase, SQLite, `fit_store.sql` or any key | `docs/fit-store.md` |
| Edit the marketing site's pages, demo or analytics in `website/` | `website/README.md` |
| Touch a generated file under `website/`, `scripts/`, a `vercel.json` or a workflow in `.github/` | `docs/deploy.md` |
| Question why the product is shaped this way | `docs/project-background.md` |

`docs/README.md` lists every doc. When you add a rule, put it in the narrowest file that covers
it, and add a row here only if a new file needs a trigger.
