# Body-Chart Sizing, Plan 1 of 3: Engine and API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine recommends a size for a candidate that has only a body size chart, from owned shirts known by brand and size, and every recommendation says which basis it used.

**Architecture:** A second, separate path in the pure engine (`engine/src/body.ts`) that compares body chest ranges with body chest ranges. `recommend()` chooses the garment path when garment measurements overlap and the body path otherwise. Nothing converts between body and garment numbers.

**Tech Stack:** TypeScript on Node 22.18+ with no build step, `node:test`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-body-chart-sizing-design.md` (status PROPOSED). Tracking: issue #40, umbrella #50.

**Scope:** The spec spans three subsystems, so it is three plans. This one is first because it runs from the terminal on hand-entered body charts and gives an accuracy number before any scraper work.
- Plan 2 (not written yet): scraper keeps body charts, `sku_body_chart`, per-size votes, export. Issues #41, #42, #44.
- Plan 3 (not written yet): frontend disclaimer and adding an owned shirt by brand and size.

## Global Constraints
- The engine (`engine/src/`) stays pure: no I/O, no network, no LLM, no framework imports.
- A body number never goes into `chest_cm` or any `Measurements` value. Body ranges are chest circumference in cm, in their own shape.
- Never invent a measurement. Missing is `null` or absent.
- Every tunable number lives in `engine/src/config.ts`. No magic numbers elsewhere.
- The garment path does not change: scoring, tie-break, confidence and wording stay as they are. All existing tests pass unchanged.
- Body-path confidence is never `high`.
- Reviews move a body-path pick by at most one size.
- Every engine change ships with a unit test using hand-computed numbers.
- No new dependency. Match the surrounding style. No em dashes in user-facing strings or docs.
- Run from `engine/`: `npm test` and `npm run typecheck` before any commit. After Task 5, `npm run build:api` and commit the rebuilt bundles.
- Work on branch `claude/modest-archimedes-bdwxwn`. Small commits, one per task.

## Review Focus
1. A wardrobe that mixes shirts with only garment measurements and shirts with only a body range: the body path uses the body shirts and ignores the rest without failing. (Task 3)
2. A candidate whose body ranges have gaps or share an edge (S 86-94, M 94-102, estimate exactly 94): one deterministic pick, stated in the notes. (Task 3)
3. A chart with one number per size (`[104, 104]`), as Gymshark publishes: the nearest size wins and the result is low confidence. (Task 3)
4. `sizeVotes` naming a size that is not in `bodySizes`, or a shift that would go past the smallest or largest size: ignored, no crash, no shift. (Task 4)
5. A body range entered in inches or as a flat width (`[40, 42]`): rejected at validation with a message naming the convention. (Task 1)

## File Structure
- `engine/src/types.ts` (modify): `BodyRange`, `SizeVotes`, `Basis`; optional fields on `OwnedShirt`, `Candidate`, `Recommendation`.
- `engine/src/config.ts` (modify): `BodyConfig` and `BODY_TOPS`.
- `engine/src/body.ts` (create): the body path. Pure functions only.
- `engine/src/recommend.ts` (modify): path choice and `basis` on every return; export `displayName` use stays.
- `engine/cli/validate.ts`, `engine/cli/load.ts` (modify): parse and check the new fields.
- `engine/api/recommend-api.ts` (modify): `basis` in the response, body-only candidates in the picker.
- `engine/test/body.test.ts`, `engine/test/body-validate.test.ts` (create); `engine/test/api.test.ts` (modify).
- Docs: `docs/data-format.md`, `engine/README.md`, `engine/AGENTS.md`, `app/README.md`.

---

### Task 1: Types and validation

**Files:**
- Modify: `engine/src/types.ts`, `engine/cli/validate.ts`, `engine/cli/load.ts`
- Test: `engine/test/body-validate.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export type BodyRange = { chest_cm: [number, number] }; // body chest circumference, cm, [min, max]; a single-number chart is [n, n]
  export interface SizeVotes { runs_small: number; true_to_size: number; runs_large: number; total: number } // counts for one size
  export type Basis = "garment_chart" | "body_chart";
  // OwnedShirt gains:      body?: BodyRange
  // Candidate gains:       bodySizes?: Record<string, BodyRange>; sizeVotes?: Record<string, SizeVotes>
  // Recommendation gains:  basis: Basis
  ```
- Produces, in `validate.ts`: `export function parseBodyRange(v: any, where: string): BodyRange` and `export function parseSizeVotes(v: any, where: string): SizeVotes`.
- `parseWardrobe` keeps `body` and `size` when present. `measurements` may be omitted when `body` is present; it then becomes all `null`.
- `loadCandidates` accepts `sizes: {}` only when `bodySizes` has at least one size; reads `bodySizes` and `sizeVotes`.

- [ ] **Step 1: Write the failing tests** in `engine/test/body-validate.test.ts`:

```ts
test("a body range is kept as [min, max]", () => {
  assert.deepEqual(parseBodyRange({ chest_cm: [96, 104] }, "t"), { chest_cm: [96, 104] });
  assert.deepEqual(parseBodyRange({ chest_cm: [104, 104] }, "t"), { chest_cm: [104, 104] });
});
test("a body range in inches or flat width is rejected", () => {
  assert.throws(() => parseBodyRange({ chest_cm: [40, 42] }, "t"), /body chest circumference in cm/);
});
test("a reversed or non-numeric body range is rejected", () => {
  assert.throws(() => parseBodyRange({ chest_cm: [104, 96] }, "t"), /min must not exceed max/);
  assert.throws(() => parseBodyRange({ chest_cm: [96] }, "t"));
  assert.throws(() => parseBodyRange({ chest_cm: ["96", 104] }, "t"));
});
test("a wardrobe shirt known only by brand size keeps body and size, with null measurements", () => {
  const w = parseWardrobe([{ id: "gymshark-charge", label: "great", size: "M", body: { chest_cm: [104, 104] } }], "t");
  assert.deepEqual(w[0].body, { chest_cm: [104, 104] });
  assert.equal(w[0].size, "M");
  assert.deepEqual(w[0].measurements, { chest_cm: null, length_cm: null, sleeve_cm: null });
});
test("a shirt with neither measurements nor body is still rejected", () => {
  assert.throws(() => parseWardrobe([{ id: "x", label: "great" }], "t"), /measurements must be an object/);
});
test("size votes must be whole counts that fit inside total", () => {
  assert.deepEqual(parseSizeVotes({ runs_small: 7, true_to_size: 3, runs_large: 0, total: 12 }, "t"),
    { runs_small: 7, true_to_size: 3, runs_large: 0, total: 12 });
  assert.throws(() => parseSizeVotes({ runs_small: 9, true_to_size: 3, runs_large: 1, total: 12 }, "t"), /more votes than total/);
  assert.throws(() => parseSizeVotes({ runs_small: 1.5, true_to_size: 0, runs_large: 0, total: 2 }, "t"));
});
```
Add one test that writes a temp candidates file with `sizes: {}` plus `bodySizes` and loads it with `loadCandidates`, and one that expects a throw when both are empty (follow the temp-file pattern at the top of `engine/test/engine.test.ts`).

- [ ] **Step 2: Run** `npm test` from `engine/`. Expected: the new file fails on missing exports.
- [ ] **Step 3: Implement.** Bounds for a body chest: each end a finite number from 50 to 200 inclusive, else fail with a message containing `body chest circumference in cm`. `min > max` fails with `min must not exceed max`. Votes: non-negative integers, `runs_small + true_to_size + runs_large <= total`, else `more votes than total`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass. `Recommendation.basis` is required, so the typecheck fails in `recommend.ts` until Task 4; for this task add `basis: "garment_chart"` to the shared `base` object in `recommend()` to keep it green.
- [ ] **Step 5: Commit** `engine: add body range, size votes and basis types with validation`.

### Task 2: Body config

**Files:**
- Modify: `engine/src/config.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BodyConfig {
    minSizeVotes: number;     // per-size votes needed before reviews may shift the pick
    shiftShare: number;       // share of those votes saying runs small (or large) that triggers a shift
    boundaryMarginCm: number; // estimate this close to the edge between two sizes counts as between them
    spreadLimitCm: number;    // owned shirts' body midpoints further apart than this disagree
  }
  export const BODY_TOPS: BodyConfig = { minSizeVotes: 10, shiftShare: 0.6, boundaryMarginCm: 1, spreadLimitCm: 4 };
  ```
- These are starting guesses, like `TOPS`. `spreadLimitCm` is 4 because one size step on the Gymshark chart is 5 cm, so an M and an L from one brand must count as disagreeing.

- [ ] **Step 1:** Add the interface and constant with the comments above. No test: Task 3 and 4 tests read these values.
- [ ] **Step 2: Run** `npm run typecheck`. Commit with Task 3.

### Task 3: Body estimate and size pick

**Files:**
- Create: `engine/src/body.ts`
- Test: `engine/test/body.test.ts`

**Interfaces:**
- Consumes: `BodyRange`, `OwnedShirt`, `Candidate` (Task 1), `BodyConfig` (Task 2).
- Produces:
  ```ts
  export function midpoint(r: BodyRange): number;
  // Median of the midpoints of the given shirts' body ranges (mean of the two middle values for an even count).
  // spreadCm = largest midpoint minus smallest. null when no shirt has a body range.
  export function bodyEstimate(shirts: OwnedShirt[]): { estimateCm: number; spreadCm: number; refs: OwnedShirt[] } | null;
  // 0 inside the range, else the distance to the nearer end.
  export function rangeDistance(valueCm: number, r: BodyRange): number;
  // The size with the smallest rangeDistance. An exact tie goes to the larger size. `tiedWith` is the runner-up size when its
  // rangeDistance is less than boundaryMarginCm above the pick's (strictly less; an exact tie counts); else null.
  export function pickBodySize(estimateCm: number, bodySizes: Record<string, BodyRange>, cfg: BodyConfig):
    { size: string; distanceCm: number; tiedWith: string | null };
  ```

- [ ] **Step 1: Write the failing tests** (`CH` is the chart used throughout):

```ts
const CH = { S: { chest_cm: [86, 94] }, M: { chest_cm: [94, 102] }, L: { chest_cm: [102, 110] }, XL: { chest_cm: [110, 118] } } as Record<string, BodyRange>;
const owned = (id: string, range: [number, number], label: OwnedShirt["label"] = "great", size?: string): OwnedShirt =>
  ({ id, label, size, body: { chest_cm: range }, measurements: { chest_cm: null, length_cm: null, sleeve_cm: null } });

test("estimate is the median of midpoints", () => {
  // midpoints 98 and 102 -> (98 + 102) / 2 = 100, spread 102 - 98 = 4
  const e = bodyEstimate([owned("a", [96, 100]), owned("b", [100, 104])])!;
  assert.equal(e.estimateCm, 100); assert.equal(e.spreadCm, 4); assert.equal(e.refs.length, 2);
  // three shirts: midpoints 98, 104, 109 -> median 104, spread 11
  assert.equal(bodyEstimate([owned("a", [96, 100]), owned("b", [104, 104]), owned("c", [109, 109])])!.estimateCm, 104);
});
test("shirts without a body range are ignored; none gives null", () => {
  const garmentOnly: OwnedShirt = { id: "g", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 23 } };
  assert.equal(bodyEstimate([garmentOnly]), null);
  assert.equal(bodyEstimate([garmentOnly, owned("a", [96, 100])])!.refs.length, 1);
});
test("range distance", () => {
  assert.equal(rangeDistance(100, { chest_cm: [94, 102] }), 0);
  assert.equal(rangeDistance(120, { chest_cm: [110, 118] }), 2);
  assert.equal(rangeDistance(90, { chest_cm: [94, 102] }), 4);
});
test("pick: inside a range, clear of the edges", () => {
  assert.deepEqual(pickBodySize(98, CH, BODY_TOPS), { size: "M", distanceCm: 0, tiedWith: null });
});
test("pick: on a shared edge goes to the larger size and reports the tie", () => {
  assert.deepEqual(pickBodySize(102, CH, BODY_TOPS), { size: "L", distanceCm: 0, tiedWith: "M" });
});
test("pick: within 1 cm of an edge reports the neighbour", () => {
  assert.deepEqual(pickBodySize(101.5, CH, BODY_TOPS), { size: "M", distanceCm: 0, tiedWith: "L" });
});
test("pick: outside every range takes the nearest", () => {
  assert.deepEqual(pickBodySize(120, CH, BODY_TOPS), { size: "XL", distanceCm: 2, tiedWith: null });
});
test("pick: single-number chart, nearest wins, exact middle goes larger", () => {
  const pts = { M: { chest_cm: [104, 104] }, L: { chest_cm: [109, 109] } } as Record<string, BodyRange>;
  assert.deepEqual(pickBodySize(105, pts, BODY_TOPS), { size: "M", distanceCm: 1, tiedWith: null });
  assert.deepEqual(pickBodySize(106.5, pts, BODY_TOPS), { size: "L", distanceCm: 2.5, tiedWith: "M" });
});
test("pick: a gap between ranges", () => {
  const gap = { S: { chest_cm: [86, 91] }, M: { chest_cm: [96, 101] } } as Record<string, BodyRange>;
  assert.deepEqual(pickBodySize(93, gap, BODY_TOPS), { size: "S", distanceCm: 2, tiedWith: null }); // S 2, M 3
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, `body.ts` not found.
- [ ] **Step 3: Implement** the four functions in `engine/src/body.ts`. Size order is the key order of `bodySizes` (smallest to largest, as for `sizes`). Round distances with `round(n, 2)` from `score.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `engine: body estimate and size pick from body ranges`.

### Task 4: Body recommendation (review shift, confidence, wording) and path choice

**Files:**
- Modify: `engine/src/body.ts`, `engine/src/recommend.ts`
- Test: `engine/test/body.test.ts`

**Interfaces:**
- Consumes: Task 3 functions; `displayName`, `garmentTypeOf` from `recommend.ts`; `matchPct`, `round` from `score.ts`.
- Produces: `export function recommendBody(wardrobe: OwnedShirt[], candidate: Candidate, cfg: BodyConfig = BODY_TOPS): Recommendation` in `body.ts`.
- `recommend()` path choice: run the existing garment logic first. If it produced a size, return it with `basis: "garment_chart"`. Otherwise, if `candidate.bodySizes` has a size and `bodyEstimate` of the same-type `great` shirts is not null, return `recommendBody(...)`. Otherwise return the garment result as today, with `basis: "garment_chart"`.
- To avoid a circular import, move `displayName` and `garmentTypeOf` to a small `engine/src/names.ts` and re-export them from `recommend.ts` so existing imports keep working.

Rules for `recommendBody` (same-type shirts only, as the garment path filters):
1. `est = bodyEstimate(greats)`; `pick = pickBodySize(est.estimateCm, bodySizes, cfg)`.
2. Review shift: `v = candidate.sizeVotes?.[pick.size]`. If `v.total >= cfg.minSizeVotes` and `v.runs_small / v.total >= cfg.shiftShare`, move up one size if one exists. Same with `runs_large`, down one. A shift is applied at most once.
3. Boundary, only when no shift was applied and `pick.tiedWith` is set: `candidate.review === "runs_small"` picks the larger of the two, `"runs_large"` the smaller, anything else keeps `pick.size`.
4. Confidence is `"medium"`, or `"low"` when any of: `est.refs.length === 1`; `est.spreadCm > cfg.spreadLimitCm`; `pick.distanceCm > 0`; a shift was applied; `pick.tiedWith` is set; the guard in rule 6 fires.
5. `ranking`: one `ShirtMatch` per reference shirt, `distance = rangeDistance(midpoint(shirt.body), finalRange)`, `matchPct = matchPct(distance / 2, TOPS.matchScaleCm)` (halved to the flat scale; the API hides it, Task 5), `ease: {}`, closest first. `sizes`: every size in `bodySizes` order with `matches: []`.
6. Guard: a same-type shirt labelled `tight` or `loose` whose body midpoint has `rangeDistance` 0 to the final range adds a note.
7. Exact strings (`name = displayName(ranking[0].shirtId)`, `sz` is that shirt's `size` when set):
   - verdict, `distanceCm === 0`: `Get the ${size}, sized like your ${name}${sz ? ` (${sz})` : ""}.`
   - verdict, `distanceCm > 0`: `No size's body range covers you. Nearest is the ${size}.`
   - note, always first: `This store publishes body measurements only, so this is less certain than a garment comparison.`
   - one reference: `Only one of your shirts has a body size range to compare.`
   - spread: `Your shirts point to different body sizes (${min} to ${max} cm chest), so the cut matters here.` with the smallest and largest midpoints.
   - shift: `${n} of ${total} buyers of the ${from} say it runs small, so ${to}.` (or `runs large`).
   - boundary with a signal: `You sit between ${a} and ${b}; reviews say it runs small, so ${b}.` (or `runs large, so ${a}`); `a` is the smaller size.
   - boundary without: `You sit between ${a} and ${b} and there is no review signal to decide.`
   - guard: `Your ${name}, which you marked ${label}, has the same body size range as the ${size}.`

- [ ] **Step 1: Write the failing tests** (reuse `CH` and `owned`; `bodyCand(extra)` builds `{ id: "t", name: "T", review: null, sizes: {}, bodySizes: CH, ...extra }`):

```ts
test("two agreeing shirts: medium confidence, sized-like verdict", () => {
  // midpoints 98, 100 -> estimate 99, spread 2, inside M
  const r = recommend([owned("grey-tee", [96, 100], "great", "M"), owned("navy-tee", [98, 102], "great", "M")], bodyCand());
  assert.equal(r.basis, "body_chart"); assert.equal(r.size, "M"); assert.equal(r.confidence, "medium");
  assert.equal(r.verdict, "Get the M, sized like your grey tee (M).");
  assert.equal(r.notes[0], "This store publishes body measurements only, so this is less certain than a garment comparison.");
});
test("M in one cut and L in another: low confidence and the disagreement is stated", () => {
  // the 2026-11-12 case: 104 and 109 -> estimate 106.5, spread 5 > 4, inside L (102-110)
  const r = recommend([owned("gymshark-charge", [104, 104], "great", "M"), owned("gymshark-geo", [109, 109], "great", "L")], bodyCand());
  assert.equal(r.size, "L"); assert.equal(r.confidence, "low");
  assert.ok(r.notes.includes("Your shirts point to different body sizes (104 to 109 cm chest), so the cut matters here."));
});
test("one reference shirt is low confidence", () => {
  const r = recommend([owned("a", [96, 100])], bodyCand());
  assert.equal(r.confidence, "low");
  assert.ok(r.notes.includes("Only one of your shirts has a body size range to compare."));
});
test("per-size votes shift the pick by one size, never two", () => {
  const votes = { M: { runs_small: 7, true_to_size: 3, runs_large: 0, total: 10 }, L: { runs_small: 9, true_to_size: 1, runs_large: 0, total: 10 } };
  const r = recommend([owned("a", [96, 100]), owned("b", [98, 102])], bodyCand({ sizeVotes: votes }));
  assert.equal(r.size, "L"); assert.equal(r.confidence, "low");
  assert.ok(r.notes.includes("7 of 10 buyers of the M say it runs small, so L."));
});
test("too few votes, or a share under 60%, does not shift", () => {
  const few = { M: { runs_small: 9, true_to_size: 0, runs_large: 0, total: 9 } };
  const weak = { M: { runs_small: 5, true_to_size: 5, runs_large: 0, total: 10 } };
  for (const sizeVotes of [few, weak]) assert.equal(recommend([owned("a", [96, 100]), owned("b", [98, 102])], bodyCand({ sizeVotes })).size, "M");
});
test("a shift past the largest size, or votes for an unknown size, are ignored", () => {
  const top = { XL: { runs_small: 10, true_to_size: 0, runs_large: 0, total: 10 }, XXXL: { runs_small: 10, true_to_size: 0, runs_large: 0, total: 10 } };
  const r = recommend([owned("a", [112, 116]), owned("b", [112, 116])], bodyCand({ sizeVotes: top }));
  assert.equal(r.size, "XL");
});
test("between two sizes, the product review signal decides", () => {
  // midpoints 101 and 102 -> estimate 101.5, in M, within 1 cm of the M/L edge
  const w = [owned("a", [100, 102]), owned("b", [101, 103])];
  assert.equal(recommend(w, bodyCand({ review: "runs_small" })).size, "L");
  assert.equal(recommend(w, bodyCand({ review: "runs_large" })).size, "M");
  const none = recommend(w, bodyCand());
  assert.equal(none.size, "M");
  assert.ok(none.notes.includes("You sit between M and L and there is no review signal to decide."));
});
test("outside every range: nearest size, low confidence, different verdict", () => {
  const r = recommend([owned("a", [120, 120]), owned("b", [120, 120])], bodyCand());
  assert.equal(r.size, "XL"); assert.equal(r.confidence, "low");
  assert.equal(r.verdict, "No size's body range covers you. Nearest is the XL.");
});
test("a tight shirt with the picked body range is flagged", () => {
  const r = recommend([owned("a", [96, 100]), owned("b", [98, 102]), owned("old-polo", [97, 99], "tight")], bodyCand());
  assert.ok(r.notes.includes("Your old polo, which you marked tight, has the same body size range as the M."));
  assert.equal(r.confidence, "low");
});
test("mixed wardrobe: garment-only shirts are ignored on the body path", () => {
  const garmentOnly: OwnedShirt = { id: "g", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 23 } };
  assert.equal(recommend([garmentOnly, owned("a", [96, 100]), owned("b", [98, 102])], bodyCand()).size, "M");
});
test("garment path is untouched and says so", () => {
  const g: Candidate = { id: "g", name: "G", review: null, sizes: { M: { chest_cm: 54, length_cm: null, sleeve_cm: null } } };
  const w: OwnedShirt[] = [{ id: "ref", label: "great", measurements: { chest_cm: 54, length_cm: null, sleeve_cm: null } }];
  const r = recommend(w, g);
  assert.equal(r.basis, "garment_chart"); assert.equal(r.size, "M");
});
test("body candidate with no body shirts keeps today's no-overlap result", () => {
  const w: OwnedShirt[] = [{ id: "ref", label: "great", measurements: { chest_cm: 54, length_cm: null, sleeve_cm: null } }];
  const r = recommend(w, bodyCand());
  assert.equal(r.size, null); assert.equal(r.basis, "garment_chart");
});
```
Check `displayName("grey-tee")` in `recommend.ts` before trusting the expected names above; adjust the expected strings to what it returns, not the function.

- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `recommendBody` and the path choice in `recommend()`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS, including every pre-existing test without edits.
- [ ] **Step 5: Guard the eval report.** In `engine/cli/eval-report.ts`, skip `analyzeMiss` (leave `analysis: null`) when `rec.basis === "body_chart"`: the miss analysis is per garment dimension and has nothing to say here. Add one test in `engine/test/eval-report.test.ts` that a body-chart miss prints the MISS line without a dimension table.
- [ ] **Step 6: Commit** `engine: body-chart recommendation path with basis flag`.

### Task 5: API response and picker

**Files:**
- Modify: `engine/api/recommend-api.ts`, `engine/test/api.test.ts`, `app/README.md`
- Regenerate: `website/api/recommend.js`, `website/api/candidates.js`

**Interfaces:**
- `RecommendResponse` gains `basis: Basis`. When `basis` is `"body_chart"`, `matchPercent`, every `sizes[].matchPercent` and every `similar[].matchPercent` are `null`: a percentage would look as certain as a garment match.
- `PickerCandidate` gains optional `bodySizes`. `toPickerCandidates` keeps a candidate that has a garment measurement on some size or at least one `bodySizes` entry.

- [ ] **Step 1: Write the failing tests** in `engine/test/api.test.ts`: a body-chart recommendation maps to `basis: "body_chart"`, `matchPercent: null`, `fitsLike` equal to the closest shirt id; a garment one keeps its numbers and has `basis: "garment_chart"`; `toPickerCandidates` includes a body-only candidate and still drops one with all-null `sizes` and no `bodySizes`; `validateRecommendRequest` accepts a wardrobe shirt with `body` and no `measurements`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build:api`. Expected: PASS and the two bundles change.
- [ ] **Step 5:** Add `basis` to the `POST /api/recommend` row of the contract table in `app/README.md`, with one line: frontends show a disclaimer when it is `body_chart` (Plan 3).
- [ ] **Step 6: Commit** `api: report the recommendation basis; offer body-chart candidates` including the rebuilt bundles.

### Task 6: Sample data, docs and the first real case

**Files:**
- Create: `engine/data/wardrobes/sample-body.json`
- Modify: `engine/data/candidates.json`, `engine/data/cases.json`, `docs/data-format.md`, `engine/README.md`, `engine/AGENTS.md`

- [ ] **Step 1:** Add made-up demo data in the existing `sample` style: wardrobe `sample-body` with two `great` shirts (`grey-tee` M `[96, 100]`, `navy-tee` M `[98, 102]`); candidate `body-tee` with `sizes: {}` and the `CH` chart from Task 3 as `bodySizes`; case `{ "owner": "sample-body", "candidate": "body-tee", "correctSize": "M" }`.
- [ ] **Step 2: Run** `npm run recommend -- sample-body body-tee` and `npm run eval`. Expected: `Get the M, sized like your grey tee (M).`, medium confidence, and the eval counts one more exact hit. Fix any test that counted cases or candidates in the data files.
- [ ] **Step 3: Docs.**
  - `docs/data-format.md`: the `body`, `bodySizes`, `sizeVotes` fields and the rule that a body range is chest circumference in cm and never goes in `chest_cm`.
  - `engine/README.md`, "How it scores": a short "Body-chart path" section with the rules from Task 4 in plain words, and that all its numbers are `BODY_TOPS` in `src/config.ts`.
  - `engine/AGENTS.md`, Engine rules: keep the review tie-break line for garment charts and add: on the body-chart path, reviews may shift the pick by at most one size and only with enough per-size votes. This rule is the open team decision in issue #47; say so in the PR description and do not merge before sign-off.
- [ ] **Step 4:** The first real case (the 2026-11-12 wardrobe against the H&M tee) needs the H&M, Hollister and Banana Republic body charts, which those stores do not serve to automated requests. Do not fetch them. Leave a note in the PR that the owner has to supply the three charts and write down the expected size first; the Gymshark chart (M 104, L 109) is already known.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Commit `engine: sample body-chart data and docs`.

## Done when
- `npm test` and `npm run typecheck` pass in `engine/`; the `Check generated bundles` job passes.
- `npm run recommend -- sample-body body-tee` prints a body-chart recommendation with its disclaimer note.
- A garment-chart recommendation is byte-for-byte what it was, plus `basis: "garment_chart"`.
- The PR description lists the open decisions (#46, #47, #48) and the missing charts for the first real case.
