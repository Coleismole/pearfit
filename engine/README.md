# fit-engine (Pilot 1 scorer)

Compares a shirt you might buy against shirts you own. It outputs a recommended size, a % match
for each of your shirts, a one-line verdict and a confidence level. This is plain TypeScript math
with no AI involved.

Requires Node 22.18+ (runs `.ts` files directly, no build step).

```bash
cd engine
npm install          # only needed for typecheck
npm run recommend -- sample              # every candidate vs the sample wardrobe
npm run recommend -- sample cos-oxford   # one candidate
npm run eval         # check picks against data/cases.json, and explain every size miss
npm run eval:generated   # same, but with candidates from data/candidates.generated.json (the exporter's output)
npm test             # unit tests
npm run typecheck
```

## Running scraped data
The exporter writes `data/candidates.generated.json`. It never touches the hand-curated
`data/candidates.json`, and neither do the runners: they only read. Point them at the generated file:
```bash
node cli/export-candidates.ts [dbPath] [outPath]                        # webscraper DB -> data/candidates.generated.json
npm run recommend -- <owner> [candidateId] --candidates data/candidates.generated.json
npm run eval -- --candidates data/candidates.generated.json --cases data/<your-cases>.json
```
- `--candidates <path>` works on `recommend` and `eval`. `--cases <path>` works on `eval`, because
  scraped candidate ids (SKU slugs) won't match the ids in `data/cases.json`.
- A case whose candidate is not in the candidates file (for example a SKU the scraper has no size
  chart for yet) is listed as skipped. It does not stop the run.
- Unknown flags and unreadable files exit with an error. They never fall back to the default file.

## Reading the eval's miss analysis
Each size miss prints why it missed:
```
MISS: wanted L, got M (1 size too small)
why: measurements. M is 2.12cm closer than L (M 0.29 vs blue-shirt, L 2.41 vs blue-shirt)
dim       M ease  L ease  M share  L share   swing
chest       +0.5    +3.0     0.29     1.76   +1.47  <- driver
```
- Each size is compared with its own closest `great` shirt. **ease** is candidate minus shirt, in cm.
- **share** is the dimension's part of that size's distance (weight x |ease| / weights present), so
  the shares of a size add up to its distance.
- **swing** = correct share minus chosen share. The swings add up to the **margin** (correct distance
  minus chosen distance). Positive swing means that dimension pushed toward the wrong size. The
  **driver** is the dimension with the largest positive swing.
- **cause** is `measurements` (the chosen size really was closer), `tie_break` (the review signal or
  size order won a near-tie that measurements went the other way on), `correct_unscorable` (the right
  size shares no measurement with any great shirt) or `no_pick`.
- The end summary counts causes, drivers and direction (too small / too large) over **tuning cases
  only**. Holdout cases still print their own miss detail, so look at those once, not while tuning.

## Adding real data

**Your wardrobe:** `data/wardrobes/<yourname>.json`, as a JSON array in the team format:
```json
[
  { "id": "blue-uniqlo-oxford", "label": "great",
    "measurements": { "chest_cm": 54, "length_cm": 72, "sleeve_cm": 63 } }
]
```
- `label`: `great` / `tight` / `loose`. Only `great` shirts are used as fit references.
  `tight` and `loose` shirts are used as warnings.
- **chest_cm is pit-to-pit with the shirt laid flat**, which is half the circumference. If a
  chest value is over 80 the loader prints a warning, since it's probably a circumference.
- Unknown measurements are `null`. Never guess.

**Shirts to buy:** add them to `data/candidates.json`. List sizes **smallest to largest**, because
the review tie-break relies on that order:
```json
{ "id": "cos-oxford", "name": "COS oxford", "review": "runs_small",
  "sizes": { "S": { "chest_cm": 51, "length_cm": 70, "sleeve_cm": 62 }, "M": { ... } } }
```
`review` is `runs_small`, `true_to_size`, `runs_large` or `null`.

**Ground truth:** add cases to `data/cases.json`. **Write these down before you run the
scorer**, or the test is meaningless:
```json
{ "owner": "dima", "candidate": "cos-oxford", "correctSize": "M", "closestShirt": "blue-uniqlo-oxford" }
```
- `correctSize`: the size you know fits, because you own it or tried it on.
- `closestShirt`: which of your shirts it feels most like.
- `"holdout": true`: keep roughly a third of the cases as holdout. Tune `src/config.ts` using
  only the other cases, then check the holdout once at the end. Tuning against every case makes
  the results look better than they are.

## How it scores
1. For each size, against each `great` shirt: ease = candidate − owned, per measurement.
2. Distance = weighted mean of |ease| over the measurements both shirts have. Weights: chest 1.0,
   length 0.4, sleeve 0.3. Missing measurements are skipped, never counted as zero.
3. % match = 100 × e^(−distance / 3).
4. The size with the lowest distance wins. If the top two sizes are within 0.5 cm, the review
   signal breaks the tie.
5. Confidence: under 1.5 cm is high, under 3 cm is medium, anything else is low. It drops one
   level for each of: a near-tie, missing chest data, or the pick landing within 1 cm (chest) of
   a shirt marked tight or loose.

All numbers live in `src/config.ts`.

## Layout
- `src/`: the engine. Pure functions, no file or network access.
- `src/analyze.ts`: miss analysis (per-dimension gap, margin, cause) for one recommendation.
- `cli/`: file loading/validation, flag parsing, the `recommend` runner, `eval` and its report.
- `data/`: wardrobes, candidates, cases. The `sample` files are made-up demo data.
- `test/`: unit tests with hand-computed expected values.
- `docs/`: model decisions and the real Pilot 1 wardrobe data.
