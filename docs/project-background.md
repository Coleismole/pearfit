# Size Predictor App — Project Background

This document is context for a backend engineer (and their AI assistant) joining the project. Read it before writing code.

## What we're building

A **store-agnostic clothing size predictor**. The user is shopping online, looking at a shirt. Our tool tells them what size to buy — and, crucially, anchors that answer to clothes they already own and trust: "Get the M, it fits like your blue Uniqlo oxford."

The core job is answering **"what size, will it actually fit"** — not showing a pretty picture. The output is a sentence with a confidence level, not a 3D render.

## What it is NOT (important — read this)

This project started as a 3D virtual try-on app (personalized avatar, body scanning, cloth physics, Unity, SMPL-X). **We abandoned that.** It was too hard, too expensive, and the "pretty avatar" was not the valuable part. If you see references to avatars, Unity, MediaPipe, SMPL-X, or cloth simulation in old notes, ignore them — none of that is in scope.

Why we pivoted: generative-AI 2D try-on already makes convincing images cheaply. What nobody solves well is the actual **fit answer** (which drives returns). That's a measurement + size-logic problem, buildable without any 3D.

## Why this can exist (the opening)

Existing size tools (True Fit, Fit Analytics, 3DLook) are all **B2B** — they integrate per-retailer and only work on big stores that pay for them. That leaves your measurements siloed per store, and leaves the indie / DTC / international stores (where the fit gamble hurts most) completely uncovered.

A **shopper-installed tool that works on any product page** is something the incumbents structurally can't sell, because their customer is the retailer, not the shopper. That's our wedge.

## How it works — two signals that calibrate each other

1. **The user's wardrobe** tells us how *they* fit relative to average (ideally built automatically from order-confirmation emails, so no manual entry).
2. **Review fit-signal** ("runs small / true to size / runs large") tells us how a given garment deviates from average.

Combined: reviews say how the garment runs; the wardrobe translates that onto the user's body. Then we rank which item in their closet the product is closest to and give a confidence-rated size recommendation. Either signal alone is weak; together they're genuinely better than a bare size chart.

## The division of labour between LLM and code (critical design rule)

- **The LLM handles language only**: turning messy text (a product page, review snippets, an order email) into structured numbers. It does extraction, not decisions.
- **Our own code handles the math**: comparing measurements and producing the size recommendation.

We do NOT ask the LLM "which size?" directly. Reasons: it's unreliable at arithmetic; it's a black box and our whole value prop is *trust* (a checkable "within 2cm of your Uniqlo" beats "the AI says M"); and a rules-based engine can be tuned against real keep/return outcomes over time, which a prompt can't.

## The matching / ranking logic

Built in layers, simplest first:

1. **Ease vectors** — for the candidate garment and a reference garment the user owns, compute the per-measurement difference (candidate − reference) at each point (chest, length, sleeve, etc.). This vector is the comparison.
2. **Distance score** — collapse the vector into one number: a weighted sum of absolute differences. Weights encode that some points matter more (chest/shoulder make or break a shirt; length is forgiving). Lower score = closer fit. To pick a size, score each available size and take the lowest.
3. **Thresholds → verdict + confidence** — turn the score into words ("fits like X, high confidence"). Confidence also drops when input data is low-quality (seller-reported vs brand-official) or when two sizes score almost the same.
4. **Review signal as a tie-breaker** — "runs small" only nudges the recommendation when sizes are close; it never overrides the measurements.

Starting weights/thresholds are educated guesses, tuned later against real keep/return outcomes. Weights and thresholds live **per garment category** (a +6cm chest reads as "slim" on a coat, "oversized" on a tee).

## The sizing standard (the common unit)

Everything — brand charts, seller flat-lays, the user's wardrobe — gets normalized into one schema so any two garments are comparable:

- A **fixed per-category dimension schema** (tops = pit-to-pit, body length, shoulder, sleeve; bottoms = waist, hip, inseam, rise, thigh).
- **One unit (cm), one measuring convention** (flat-lay vs body-circumference — must be consistent across every source, or the math compares apples to oranges). This is the #1 silent bug.
- **Ease vectors** (garment − body) as the real comparison unit, anchored to reference garments the user owns.
- Every stored measurement carries a **source tag** (brand-official / seller-reported / user-measured / estimated) so confidence can be weighted.

## Tech stack

- **Client**: Browser extension (TypeScript) — reads the product page the user is on; this is what makes it store-agnostic. Plus a thin Next.js site for onboarding/wardrobe/dashboard.
- **Styling**: Tailwind CSS
- **Product + review parsing**: read the page DOM, then one small LLM call to structure it
- **Wardrobe ingestion**: Gmail API (read-only) → same LLM to parse order emails; manual add as fallback
- **LLM**: one provider behind a thin adapter so it's a one-line swap; use a cheap small-tier model (not a flagship) — extraction doesn't need frontier reasoning
- **Matching engine**: TypeScript, rules-based (not ML)
- **Backend / DB / Auth**: Supabase (Postgres)
- **Hosting**: GitHub (code) → Vercel (web + API functions) → Supabase. All free tier.

Whole thing is TypeScript end to end except SQL.

## Architecture — the API contract is the center

The API contract is the seam between frontend and backend. We write it down first as a shared `types.ts` (the request/response shape of every endpoint plus the normalized garment record), both sides import it, and the TypeScript compiler enforces that they agree. This lets all five people build in parallel: frontend builds against stubbed responses, backend fills in the real handlers, and they meet in the middle.

Supabase SDK handles simple data directly from the client (wardrobe CRUD, profile, auth) — no custom endpoint needed. Build a custom endpoint only where there's a secret or real logic:

- `POST /parse-product` — page/URL → structured garment record (holds the LLM key)
- `POST /recommend` — user + parsed garment → size + confidence + reference item (the matching logic)
- `POST /ingest-gmail` — OAuth code → parsed wardrobe items (holds Gmail + LLM keys)

Design `/parse-product` to accept either a URL or raw HTML, so the extension needs no new backend later.

## Open questions still to validate

- **Coverage**: do the long-tail stores we're targeting actually have enough review and garment-measurement data to feed the prediction? If not, the wardrobe-comparison leg has to carry it alone. (30-min test: pull ~50 listings from target stores, count how many have usable measurements / fit signal.)
- **Which leg is primary**: reviews-primary (dies where reviews are thin) vs wardrobe-comparison-primary (needs the candidate garment's measurements on the page). This decides which parser we build first.

## Known gotchas

- **Flat-lay vs doubled**: pit-to-pit measured flat is usually *half* the chest circumference. Pick one convention and apply it to candidates and wardrobe alike.
- **Gmail read scope** needs Google's stricter OAuth verification — start it early, keep the scope as narrow as possible. (Likely out of the first pilot.)
- **Paste-a-link fetching**: some stores block automated fetches or render via JS the fetch won't see. Fallback is pasting page text/measurements directly.
- **Never let the LLM guess a measurement** — return null for missing fields. A hallucinated number poisons the whole fit calculation; a missing one just lowers confidence.

## Current pilot scope

Pilot 1 is **just the matching algorithm**, tested on the team's own shirts, run locally in a terminal — no database, no API, no frontend, no LLM (measurements typed in by hand). Goal: prove the scorer predicts fit correctly on shirts whose fit we already know. If it works, we greenlight the bigger MVP; if it doesn't, we fix the core before building anything around it.
