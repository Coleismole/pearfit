# Body-chart sizing: design

Status: PROPOSED, 2026-11-14. Not approved. Nothing here is built yet.

## Intent
Most stores publish only a body size chart ("M = 104 cm chest"), not garment measurements. Today
those stores produce no recommendation at all. Shoppers will not measure their shirts, so the product
has to work from "brand + size I own". This design adds a second sizing path for body-chart stores
that never invents a garment measurement and says plainly when it was used.

## What we found (2026-11-12 to 11-14)
- A chart was read for 17 of 163 stores that returned reviews (`webscraper/SUPPORTED_STORES.md`).
  Products with no garment chart are dropped at export (`engine/cli/candidate-source.ts:147-150`).
- The scraper nulls range cells and unlabeled chests (`webscraper/sizeChart.ts`, `parseCell`,
  `chestKind`, `chestCm`), so body charts are discarded. Body ranges are stored nowhere.
- Turning a body chart into garment numbers with a fit-word ease is good to about one size either
  way: published ranges overlap, 6 of 11 regular Pilot 1 shirts missed by more than 2.5 cm
  pit-to-pit, and Uniqlo "Regular" tees span +4 to +16 cm of ease at size M. The data is thin
  (14 hand-measured shirts, Uniqlo-only paired charts, third-party chart copies).
- Reviews are underused: height, weight and usual size are extracted then dropped, votes are pooled
  across sizes, and the engine reads one product-level signal only to break ties within 0.5 cm.

## Goals
1. A body-chart-only product gets a size recommendation from a wardrobe of "brand + size owned".
2. Every recommendation states which basis it used, so frontends can show a disclaimer.
3. Reviews carry more weight on the body path than on the garment path, within a hard limit.
4. First accuracy target: 85% on the eval set. The exact definition is an open decision (below).

## Non-goals
- No conversion between body and garment numbers in either direction (approach B, rejected).
- No change to the garment path: its scoring, tie-break and confidence stay as they are.
- No length or sleeve on the body path. Body charts do not carry them.
- No user body profile (height, weight) in this phase.

## Anti-goals
- A body number stored in `chest_cm`, or any other mixing of conventions.
- A body-path result that looks as certain as a garment-path result.
- Reviews moving a pick by more than one size, or moving it on a handful of votes.

## Approaches considered
- **A. Body-range matching.** Compare the body range of the sizes you own with the candidate's
  body ranges. Body to body, nothing invented. Blind to cut. **Chosen as the base.**
- **B. Estimate garment numbers** from body chart + fit-type ease, then run the existing engine.
  Keeps "fits like", but the research puts it at about one size of error and it breaks the rule
  against inventing measurements. **Rejected.**
- **C. Similar-reviewer matching** ("people your height who bought M said it fits"). Tracks cut
  best, but needs pipeline work and coverage we have not measured. **Its review data is layered
  onto A now (per-size votes); the reviewer-matching part is phase 2.**

## Design

### Data (additive; existing fields unchanged)
- Body range: `{ chest_cm: [min, max] }`, body chest circumference in cm. A chart that gives one
  number per size is stored as `[n, n]`. This is a new shape, never a `Measurements` value.
- Owned shirt gains optional `body` (the brand's body range at the size owned). `measurements`
  may be all null for a shirt known only by brand and size.
- Candidate gains optional `bodySizes` (size -> body range, smallest to largest) and optional
  `sizeVotes` (size -> `{ runs_small, true_to_size, runs_large, total }`, counts).
- Recommendation gains `basis: "garment_chart" | "body_chart"`.
- `docs/data-format.md` gets the new fields; that file is their one home.

### Scraper (`webscraper/`)
- `sizeChart.ts` returns body-chart rows as a separate result instead of dropping them: chest
  circumference ranges, read only when the chart is identifiably a body chart (says body
  measurements, or has range cells, or a chest/waist/hip layout). Garment parsing is untouched.
- Fix the suspected bug first, test first: a body chart with a "circumference" header may be
  halved and stored as flat garment chest (`sizeChart.ts`, `chestKind` / `chestCm`).
- Store: new table `sku_body_chart` in `fit_store.sql` (sku, size_code, sort_order,
  chest_min_cm, chest_max_cm), written through the existing commit function path, readable by
  anon like `sku_size_chart`. Per-size vote counts in `sku_size_metrics` become readable to the
  export (today anon cannot select that table). `docs/fit-store.md` rules apply.

### Export and API (`engine/cli/`, `engine/api/`)
- `candidate-source.ts` stops skipping a product that has a body chart but no garment chart; it
  emits `bodySizes` and `sizeVotes`. A product with neither chart is still skipped.
- `validate.ts` accepts and checks the new optional fields (range order, plausible bounds).
- The API response adds `basis`. Nothing is removed.

### Engine (`engine/src/`, pure)
`recommend()` picks the path:
1. Garment path (unchanged) when the candidate has garment sizes that overlap the wardrobe.
   `basis: "garment_chart"`.
2. Otherwise the body path, when the candidate has `bodySizes` and at least one `great` shirt of
   the same garment type has `body`. `basis: "body_chart"`.
3. Otherwise the existing "no overlap" result.

Body path, all numbers in `config.ts`:
- **Estimate.** Each `great` shirt with a body range contributes its midpoint. The estimate is
  the median of those midpoints.
- **Pick.** The candidate size whose range contains the estimate; if none does, the nearest
  range by distance to its closer edge. Distance is 0 inside a range.
- **Review shift.** If the picked size has at least `minSizeVotes` votes and the share saying
  runs small is at least `shiftShare`, move up one size; same for runs large, down one. Never
  more than one size. With too few per-size votes, the product-level signal applies only when
  the estimate sits within `boundaryMarginCm` of a range edge (the body-path version of today's
  tie-break).
- **Confidence.** Starts at medium, never high. Drops to low for any of: only one reference
  shirt; the owned ranges disagree by more than `spreadLimitCm` (the "M in one cut, L in
  another" case); the estimate falls outside every range; a review shift was applied.
- **Verdict and notes.** "Get the M, sized like your Gymshark Charge (M)." Notes state the
  disagreement between owned shirts, any review shift with its vote counts, and that the store
  publishes body measurements only. `tight` and `loose` shirts with a body range are reported
  in notes when the pick lands on their range, as the garment guard does today.
- Every change ships with unit tests using hand-computed numbers (`engine/AGENTS.md`).

### Frontends (`app/`, website demo)
When `basis` is `"body_chart"`, show a short disclaimer under the result: this brand publishes
body size charts only, so the result may be less accurate than usual. Adding an owned shirt by
brand and size (so it can carry `body`) is needed for the path to be usable; how the wardrobe
screen offers that is left to the builder, within `app/AGENTS.md`.

### Rule changes this needs (team sign-off)
- `engine/AGENTS.md`: "The review signal only breaks ties between close sizes; it never overrides
  measurements" stays for the garment path. The body path gets its own rule: reviews may shift
  the pick by at most one size, only with enough per-size votes.
- `engine/docs/model-decisions.md`: record the decision (in progress, proposed).

## Evaluation
- Eval cases gain body-chart candidates. Report exact-size accuracy and within-one-size accuracy,
  split by basis, next to the "buy your usual size" baseline.
- First real case: the 2026-11-12 wardrobe (Hollister M boxy, Gymshark Charge M, Banana Republic
  S, Gymshark Geo Seamless L) against an H&M tee. The two Gymshark sizes disagree, so this case
  must come out low confidence with the disagreement stated.
- Write the expected size down before running, as `engine/README.md` requires.

## Build order
1. Scraper: circumference bug (failing test, fix), then body-chart parsing with tests.
2. Store and export: `sku_body_chart`, per-size votes, `candidate-source.ts`, validation.
3. Engine: types, config, body path, `basis`, tests.
4. API field, rebuilt bundles (`docs/deploy.md`), frontend disclaimer and brand+size entry.
5. Eval cases and a first accuracy number.
6. Phase 2 (separate design): keep reviewer height, weight and usual size as structured fields,
   measure coverage with a fresh scrape, then decide on similar-reviewer matching.

## Open decisions (owner / team)
- **What "85%" measures.** Within one size is close to free: "buy your usual size" likely clears
  it. Exact size is the number that shows value. Proposal: target 85% within one size as the
  floor and judge the feature on exact-size accuracy against the usual-size baseline.
- **Reviews rule** for the body path, as written above.
- **Verdict wording** on the body path: "sized like your X" plus the disclaimer.

## Left to the builder
- Exact detection rules for a body chart, guided by the saved pages in the scraper tests.
- Starting values for `minSizeVotes`, `shiftShare`, `boundaryMarginCm`, `spreadLimitCm`; tune on
  tuning cases only, check the holdout once.
- Whether body charts are stored per SKU only or also deduplicated per brand.
