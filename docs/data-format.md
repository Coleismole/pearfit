# Data format (fixed by the team; do not rename fields)

Read this before you read, write or convert a measurement, a wardrobe or a candidate.

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
- `garmentType` (optional, on owned shirts and candidates): one of `"tee"`, `"tee_long_sleeve"`, `"polo"`,
  `"button_shirt"`, `"jacket"`, `"other"`. Missing means `"tee"`. The engine only compares a candidate with owned
  shirts of the same type. The export derives it from the product name (`engine/cli/garment-type.ts`), not from the
  stored category, which is wrong too often to trust.
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
`review` is one of `"runs_small"`, `"true_to_size"`, `"runs_large"`, or `null`. It says which way the reviews lean:
`"runs_small"` or `"runs_large"` is a lean, `"true_to_size"` means they do not lean either way, and `null` means there
are no reviews, or too few to say. A hand-written candidate file states it. The export works it out from the skew of
`reviewSummary`: `runsLargePct` minus `runsSmallPct` (`engine/src/review.ts`; the two thresholds are `reviewMinCount`
and `reviewSkewMinPct` in `engine/src/config.ts`).

`reviewSummary` (optional, written by the export): `{ "total": 40, "runsSmallPct": 60, "trueToSizePct": 30, "runsLargePct": 10 }`,
the review count and shares as the scraper stored them. A review with no small or large comment is counted as true
to size (`webscraper/fitAnalyzer.ts`), so `trueToSizePct` is the share that do not call the fit small or large, not the
share that say "true to size". That is why the skew leaves it out. Missing means no reviews. The scorer reads
`review` and never `reviewSummary`: the summary is passed on so the numbers can be shown.

## Related
- Where each file goes and how to add real data: `engine/README.md`.
- Brand offsets calibrated so far: `engine/docs/model-decisions.md`.
- Input validation shared by the CLI and the API: `engine/cli/validate.ts`.
