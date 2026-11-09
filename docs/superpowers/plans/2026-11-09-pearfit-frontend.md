# Pearfit Shopper App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the desktop shopper web app in `app/`: sign in, build a closet from product links, paste a product link, and see the engine's size answer in the Tailor design system.

**Architecture:** Next.js App Router app in `app/` that imports the pure engine from `engine/src` and reads the shared Supabase fit store through RPCs. It never calls the scraper; links the store does not have become `scrape_requests` rows. Every screen is a presentational view fed by props, rendered both by the real routes and by dev-only fixture routes so design checks run without a database.

**Tech Stack:** Node 22.18+, Next.js 16.4.5, React (version pinned by create-next-app), TypeScript, Tailwind CSS 4.3.5, @supabase/ssr 0.12.7 + @supabase/supabase-js, Vitest 5.1.0, Playwright (preinstalled in this environment; required by path, not added as a dependency), `next/font/google` for Martian Mono and Urbanist.

**Spec:** `docs/superpowers/specs/2026-11-09-pearfit-frontend-design.md` (read it first; this plan does not repeat it). Reference design: `docs/design/tailor/index.html`, canonical drawing `docs/design/tailor/shirt.svg`.

## Global Constraints

- Colours only from spec section 3: `--paper #F2EEE5`, `--paper-glass rgba(242,238,229,0.72)`, `--band #E8E2D5`, `--ink #1A1A17`, `--ink-2 #6E6A60` (on paper only, never on band), `--rule rgba(26,26,23,0.25)`, `--chalk #B42A1E`. No purple, no gradients, `box-shadow: none`, radius 0 except pills (999px) and the confidence circle.
- Type scale px: 280 (size hero only), 200, 112, 72, 48, 32, 22, 18, 16, 13. Display = Martian Mono, `font-stretch: 112%`, weights 100/300. Text = Urbanist 300/400/500. Letter-spacing 0. Mono only for numbers, sizes, cm, %, and section numbers `01`/`02`.
- Desktop grid: 12 columns, 30px gutters, column `min(1600px, 100vw - 2*margin)`, margin 160 (≥1800), 115 (1440-1799), 80 (1280-1439), 48 (1024-1279). Header aligned to the column. `html { overflow-x: clip }`.
- Copy: sentence case, full stops, no exclamation marks, no eyebrow/kicker labels, no subtitles, no helper text except errors, placeholders ≤ 4 words. Exact copy strings are the ones in spec sections 4 and 6.
- Motion: `ease` only; 300ms hover/state; 1000ms size-hero fade; all inside `prefers-reduced-motion: no-preference`.
- The UI never computes size, %, confidence or band. It formats what `recommend()` returns. Missing values render `—`.
- Engine stays pure (no I/O, no framework imports). Every engine change ships with a hand-computed unit test (AGENTS.md).
- The app never calls the scraper and never writes to `commercial_skus`, `sku_size_metrics` or `sku_size_chart`.
- No secrets committed. Env names go in `app/.env.example`. New dependencies get a one-line reason in the PR.
- Dev server: `cd app && npm run dev` on port 3001.
- Accessibility (spec section 8): 2px chalk focus outline with 2px offset on every interactive element; a real `<label>` on every input (link entry label visually hidden: "Product link"); `SizeHero` has `aria-label="Recommended size {size}"`; `Draft` has a text alternative listing the three differences; tape and pill glyphs are `aria-hidden`; `SizePicker` and `FitChoice` are radio groups; dialogs trap focus and close on Escape.

## Review Focus

1. **URL variants** of the same product (`www.`, `http`, query string, fragment, trailing slash, uppercase host) must find the same product. Test: Task 3 `normalizeProductUrl` cases, and Task 4 parity check against the SQL normaliser.
2. **Postgres `numeric` arriving as strings** (`"54.0"`) or `null` must map to numbers or `null`, never `NaN` or `0`. Test: Task 3 `toOwnedShirts` string and null cases.
3. **Double submit** of the same unknown link must leave one request row, and the pill is disabled while in flight. Test: Task 4 unique `(user_id, url)` + upsert; Task 8 action test calling `requestScrape` twice.
4. **A closet with only tight/loose shirts** must show "Add a shirt that fits you well." instead of the link entry, not an empty result. Test: Task 6 fixture `check-no-great` + design check text assertion.
5. **Long product and shirt names** (60+ characters) must wrap inside the column, not overflow the header readout or ranking rows. Test: Task 5 fixture with a 64-character name, checked by the design checker's overflow assertion.

## Execution and verification loop (applies to every task)

Each task is implemented by a fresh Sonnet subagent and then reviewed by the managing Opus session before the next task starts. A task is done only when:
1. Every command in its verification steps has been run and its output pasted in the task report (pass or fail, as it is).
2. For UI tasks, the design checker (Task 5) passes on the task's routes at 1280x800, 1440x900, 1920x1080 and 1024x768, and the screenshots it writes have been opened and looked at by the reviewer.
3. The reviewer has read the diff against this plan and the spec, and either approved it or sent back specific fixes.

---

### Task 1: Engine: shared review signal and structured verdict match

**Files:**
- Create: `engine/src/review.ts`
- Modify: `engine/src/types.ts` (add `MatchBand`, `VerdictMatch`; add `match` to `Recommendation`)
- Modify: `engine/src/recommend.ts` (populate `match`)
- Modify: `engine/cli/export-candidates.ts:79-89` (delete local `reviewSignal`, import the shared one)
- Test: `engine/test/review.test.ts` (new), `engine/test/engine.test.ts` (append)

**Interfaces:**
- Produces:
  - `export interface ReviewVotes { total_reviews: number; runs_small_pct: number; true_to_size_pct: number; runs_large_pct: number }`
  - `export function reviewSignal(v: ReviewVotes): ReviewSignal` in `engine/src/review.ts`
  - `export type MatchBand = 0 | 1 | 2;` and `export interface VerdictMatch { band: MatchBand; shirtId: string; gap: string | null }` in `engine/src/types.ts`
  - `Recommendation.match: VerdictMatch | null` (null exactly when `size` is null)

- [ ] **Step 1: Capture the eval baseline**

Run: `cd engine && npm run eval > /tmp/eval-before.txt; npm run eval:generated > /tmp/evalgen-before.txt 2>&1; echo done`
Expected: `done` (files written; exit status of eval may be non-zero if it reports misses; that is fine).

- [ ] **Step 2: Write the failing tests**

`engine/test/review.test.ts`:
```ts
test("no reviews -> null", () => assert.equal(reviewSignal(v(0, 60, 30, 10)), null));
test("clear runs small", () => assert.equal(reviewSignal(v(12, 60, 30, 10)), "runs_small"));
test("clear runs large", () => assert.equal(reviewSignal(v(12, 10, 20, 70)), "runs_large"));
test("clear true to size", () => assert.equal(reviewSignal(v(12, 20, 70, 10)), "true_to_size"));
test("tie at the top -> null", () => assert.equal(reviewSignal(v(12, 40, 40, 20)), null));
// v(total, small, tts, large) builds ReviewVotes
```

Append to `engine/test/engine.test.ts` (uses the file's existing `m`, `shirt`, `cand`, `ref` helpers; `ref` is m(54,72,63) labelled great):
```ts
test("match: band 0, gap names the chest at exactly 0.5cm", () => {
  // d = (0.5*1 + 0.5*0.4 + 0.5*0.3)/1.7 = 0.5 -> band 0; chest has the largest weighted gap
  const r = recommend([ref], cand({ M: m(54.5, 72.5, 63.5) }));
  assert.deepEqual(r.match, { band: 0, shirtId: "blue-shirt", gap: "0.5cm looser in the chest" });
  assert.equal(r.verdict, "Get the M, fits like your blue shirt."); // unchanged wording
});
test("match: band 0 with no gap -> gap null", () => {
  const r = recommend([ref], cand({ M: m(54, 72, 63) }));
  assert.deepEqual(r.match, { band: 0, shirtId: "blue-shirt", gap: null });
});
test("match: band 1 at +3cm chest", () => {
  // d = 3/1.7 = 1.7647 -> 1.5 <= d < 3 -> band 1
  const r = recommend([ref], cand({ M: m(57, 72, 63) }));
  assert.deepEqual(r.match, { band: 1, shirtId: "blue-shirt", gap: "3.0cm looser in the chest" });
});
test("match: band 2 at +6cm chest", () => {
  // d = 6/1.7 = 3.5294 -> d >= 3 -> band 2
  const r = recommend([ref], cand({ M: m(60, 72, 63) }));
  assert.deepEqual(r.match, { band: 2, shirtId: "blue-shirt", gap: "6.0cm looser in the chest" });
});
test("match: null when there are no great shirts", () => {
  const r = recommend([shirt("x", "tight", m(54, 72, 63))], cand({ M: m(54, 72, 63) }));
  assert.equal(r.size, null);
  assert.equal(r.match, null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && npm test`
Expected: FAIL (`reviewSignal` not exported; `r.match` undefined).

- [ ] **Step 4: Implement**

`reviewSignal` is the body currently in `cli/export-candidates.ts:79-89`, moved unchanged. In `recommend.ts`, compute `gap` once with the existing `describeGap(best.ease, cfg)` (empty string -> `null`) and the existing `band`, return `match: { band, shirtId: best.shirtId, gap }`; both early `size: null` returns get `match: null`. `verdict()` keeps its current output. Fix any other `Recommendation` literals the typecheck reports by adding `match: null`.

- [ ] **Step 5: Verify**

Run: `cd engine && npm test && npm run typecheck && npm run eval > /tmp/eval-after.txt; npm run eval:generated > /tmp/evalgen-after.txt 2>&1; diff /tmp/eval-before.txt /tmp/eval-after.txt && diff /tmp/evalgen-before.txt /tmp/evalgen-after.txt && echo EVAL-UNCHANGED`
Expected: all tests pass, typecheck clean, `EVAL-UNCHANGED`.

- [ ] **Step 6: Commit**

`git add engine && git commit -m "Share the review-signal rule and expose the verdict match band from the engine"`

---

### Task 2: App scaffold, tokens, fonts, engine import

**Files:**
- Create: `app/` via create-next-app, then: `app/package.json`, `app/next.config.ts`, `app/tsconfig.json`, `app/vitest.config.ts`, `app/.env.example`, `app/.gitignore`, `app/README.md`
- Create: `app/src/styles/tokens.css`, `app/src/app/globals.css`, `app/src/app/layout.tsx`, `app/src/app/fonts.ts`
- Create: `app/src/app/dev/page.tsx` (dev index, imports from the engine)
- Create: `app/test/engine-import.test.ts`
- Modify: `AGENTS.md` (architecture and commands), root `.gitignore` if needed

**Interfaces:**
- Produces: import alias `@engine/*` -> `../engine/src/*` in TypeScript, Next and Vitest; alias `@/*` -> `src/*`; CSS custom properties from Global Constraints plus `--font-display`, `--font-text`, `--margin`, `--col` on `:root`; Tailwind `@theme` colours `paper, paper-glass, band, ink, ink-2, rule, chalk` and fonts `display, text`; npm scripts `dev` (`next dev -p 3001`), `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

- [ ] **Step 1: Scaffold**

Run (from repo root): `npx create-next-app@16.4.5 app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`
Then delete the generated demo content (default `page.tsx` body, `public/*.svg`, demo CSS). Pin exact versions in `package.json` for `next`, `tailwindcss`, `@supabase/ssr` (0.12.7), `@supabase/supabase-js`, `vitest` (5.1.0).

- [ ] **Step 2: Write the failing test**

`app/test/engine-import.test.ts`:
```ts
import { recommend } from "@engine/recommend.ts";
import { reviewSignal } from "@engine/review.ts";
test("engine is importable from the app", () => {
  const r = recommend(
    [{ id: "a", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } }],
    { id: "c", name: "C", review: null, sizes: { M: { chest_cm: 54.5, length_cm: 72.5, sleeve_cm: 63.5 } } },
  );
  expect(r.size).toBe("M");
  expect(r.match?.band).toBe(0);
  expect(reviewSignal({ total_reviews: 0, runs_small_pct: 0, true_to_size_pct: 0, runs_large_pct: 0 })).toBeNull();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd app && npx vitest run test/engine-import.test.ts`
Expected: FAIL (alias not resolved).

- [ ] **Step 4: Wire the alias, tokens and fonts**

- `tsconfig.json`: `paths` `@engine/*` -> `../engine/src/*`, `allowImportingTsExtensions: true`, include `../engine/src`.
- `next.config.ts`: allow importing TypeScript from outside `app/` (`experimental.externalDir: true` or the Next 16 equivalent) and resolve `@engine`.
- `vitest.config.ts`: same two aliases, `environment: "node"`.
- `fonts.ts`: `Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display" })`, `Urbanist({ subsets: ["latin"], weight: ["300","400","500"], variable: "--font-text" })`; attach both variables on `<html>` in `layout.tsx`.
- `tokens.css`: every value from Global Constraints and the margin media queries; `globals.css` imports Tailwind, `tokens.css`, maps them in `@theme`, sets `* { border-radius: 0; box-shadow: none }`, `html { overflow-x: clip; background: var(--paper) }`, body Urbanist 300 18px/1.3 ink.
- `dev/page.tsx`: server component that returns 404 (`notFound()`) when `process.env.NODE_ENV === "production"`, otherwise lists the fixture routes (filled in by later tasks) and prints `TOPS.highBelowCm` imported from `@engine/config.ts` to prove the bundle resolves the engine.

- [ ] **Step 5: Verify**

Run: `cd app && npm test && npm run typecheck && npm run lint && npm run build`
Expected: test passes; typecheck and lint clean; build succeeds. Then `npm run dev` and `curl -s localhost:3001/dev | grep -c "1.5"` prints `1`.

- [ ] **Step 6: Docs and commit**

`AGENTS.md`: replace "First MVP has no frontend..." with the spec's wording for `app/` (spec section 7, "Repo rule changes") and add `app/` commands (`npm run dev` on 3001, `npm test`, `npm run typecheck`, `npm run lint`, `npm run design-check`). `app/.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (only for `scripts/check-db.mjs`, never imported by app code). `app/README.md`: how to run.
`git add app AGENTS.md && git commit -m "Scaffold the shopper app with Tailor tokens and the engine import"`

---

### Task 3: Pure mapping libraries

**Files:**
- Create: `app/src/lib/url.ts`, `app/src/lib/catalog.ts`, `app/src/lib/closet.ts`, `app/src/lib/verdict.ts`, `app/src/lib/spread.ts`
- Test: `app/test/url.test.ts`, `app/test/catalog.test.ts`, `app/test/closet.test.ts`, `app/test/verdict.test.ts`, `app/test/spread.test.ts`
- Create: `app/test/url-cases.json` (shared with Task 4's SQL parity check)

**Interfaces:**
- Consumes: engine types `Candidate`, `OwnedShirt`, `Recommendation`, `FitLabel`; `reviewSignal`, `displayName`.
- Produces:
  - `normalizeProductUrl(raw: string): string | null`: trim; only `http:`/`https:`; result `https://` + lowercased host without leading `www.` + path without trailing slash; no query, no fragment; path case kept.
  - `interface ChartRow { size_code: string; sort_order: number; chest_cm: number | string | null; length_cm: number | string | null; sleeve_cm: number | string | null }`
  - `interface FitProduct { sku: string; brand: string; product_name: string; category: string; source_url: string | null; total_reviews: number; runs_small_pct: number; true_to_size_pct: number; runs_large_pct: number; chart: ChartRow[] }`
  - `isTop(category: string): boolean` (true only for `"T-Shirts & Tops"`)
  - `toCandidate(p: FitProduct): Candidate | null` (null when `chart` is empty; sizes ordered by `sort_order`; `id = sku`, `name = product_name`, `review = reviewSignal(p)`)
  - `interface ClosetRow { id: string; name: string; fit: FitLabel; sku: string | null; size_code: string | null; source_url: string; chest_cm: number | string | null; length_cm: number | string | null; sleeve_cm: number | string | null }`
  - `toOwnedShirts(rows: ClosetRow[]): OwnedShirt[]` (skips rows with `sku === null`; `id = row.id`; numeric strings parsed, rounded to 1 decimal; `null` stays `null`)
  - `verdictLine(rec: Recommendation, names: Record<string, string>): string` (spec section 4 wording; name falls back to `displayName(shirtId)`)
  - `sizeSpread(rec: Recommendation): { size: string; pct: number | null; chosen: boolean }[]` (best `matchPct` per size rounded to an integer; `null` when a size has no matches)

- [ ] **Step 1: Write the failing tests**

`url-cases.json` is an array of `[input, expected]`; `url.test.ts` loops over it:
```json
[
  ["HTTPS://WWW.Cos.com/en/Oxford-Shirt/?color=blue#reviews", "https://cos.com/en/Oxford-Shirt"],
  ["http://cos.com/a/", "https://cos.com/a"],
  ["  https://x.com  ", "https://x.com"],
  ["https://shop.example.co.uk/p/123?ref=ig", "https://shop.example.co.uk/p/123"],
  ["not a url", null],
  ["ftp://x.com/a", null]
]
```
`catalog.test.ts`:
```ts
test("chart rows become sizes in sort_order, review from votes", () => {
  const c = toCandidate(product({ chart: [row("L", 3, 57.5, 75, 65), row("S", 1, 51, 70, 62), row("M", 2, 54.5, 72.5, 63.5)], total_reviews: 10, runs_small_pct: 60, true_to_size_pct: 30, runs_large_pct: 10 }))!;
  expect(Object.keys(c.sizes)).toEqual(["S", "M", "L"]);
  expect(c.sizes.M).toEqual({ chest_cm: 54.5, length_cm: 72.5, sleeve_cm: 63.5 });
  expect(c.review).toBe("runs_small");
});
test("empty chart -> null", () => expect(toCandidate(product({ chart: [] }))).toBeNull());
test("null and string dims", () => {
  const c = toCandidate(product({ chart: [row("M", 1, "53.0", null, null)] }))!;
  expect(c.sizes.M).toEqual({ chest_cm: 53, length_cm: null, sleeve_cm: null });
});
test("isTop", () => { expect(isTop("T-Shirts & Tops")).toBe(true); expect(isTop("Dresses")).toBe(false); expect(isTop("Outerwear")).toBe(false); });
```
`closet.test.ts`:
```ts
test("skips pending rows, parses numeric strings, keeps nulls", () => {
  expect(toOwnedShirts([
    closetRow({ id: "r1", fit: "great", sku: "cos-1", chest_cm: "54.0", length_cm: 72, sleeve_cm: null }),
    closetRow({ id: "r2", fit: "tight", sku: null }),
  ])).toEqual([{ id: "r1", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: null } }]);
});
```
`verdict.test.ts` (build `Recommendation` literals with only the fields `verdictLine` reads):
```ts
const names = { r1: "Blue Uniqlo oxford" };
test("band 0", () => expect(verdictLine(rec("M", { band: 0, shirtId: "r1", gap: "0.5cm looser in the chest" }), names)).toBe("Fits like your Blue Uniqlo oxford."));
test("band 1 with gap", () => expect(verdictLine(rec("M", { band: 1, shirtId: "r1", gap: "3.0cm looser in the chest" }), names)).toBe("Closest to your Blue Uniqlo oxford, 3.0cm looser in the chest."));
test("band 1 without gap", () => expect(verdictLine(rec("M", { band: 1, shirtId: "r1", gap: null }), names)).toBe("Closest to your Blue Uniqlo oxford."));
test("band 2", () => expect(verdictLine(rec("M", { band: 2, shirtId: "r1", gap: null }), names)).toBe("No close match. Nearest is your Blue Uniqlo oxford."));
test("no size -> engine verdict", () => expect(verdictLine({ ...rec(null, null), verdict: "No measurements overlap between this shirt and your wardrobe." }, names)).toBe("No measurements overlap between this shirt and your wardrobe."));
test("unknown id falls back to displayName", () => expect(verdictLine(rec("M", { band: 0, shirtId: "blue-gap-tee", gap: null }), {})).toBe("Fits like your blue gap tee."));
```
`spread.test.ts`: the sample case (wardrobe `engine/data/wardrobes/sample.json`, candidate `cos-oxford` from `engine/data/candidates.json`, both read in the test) yields `[{size:"S",pct:70,chosen:false},{size:"M",pct:85,chosen:true},{size:"L",pct:35,chosen:false}]`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npm test`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the five modules** with the signatures above. One shared `toCm(v: number | string | null): number | null` in `catalog.ts`, exported and reused by `closet.ts`; non-finite parses become `null`.

- [ ] **Step 4: Verify**

Run: `cd app && npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

`git add app/src/lib app/test && git commit -m "Map fit-store rows and closet rows to engine types; phrase the verdict line"`

---

### Task 4: Supabase schema, RLS and the product lookup RPC

**Files:**
- Create: `app/supabase/001_app.sql`
- Create: `app/scripts/check-db.mjs`
- Modify: `app/README.md` (how to apply the SQL and run the check)

**Interfaces:**
- Consumes: `app/test/url-cases.json` (Task 3).
- Produces (SQL, all in `public`):
  - `normalize_product_url(raw text) returns text` (immutable; same rules as `normalizeProductUrl`; returns null for non-http(s))
  - `find_fit_product(url text) returns jsonb` (security definer, stable, `search_path = public`): one product whose `normalize_product_url(source_url) = normalize_product_url(url)`, newest `committed_at` first, shaped exactly like `FitProduct` (chart rows ordered by `sort_order`); `null` when none. Granted to `authenticated` only; revoked from `public` and `anon`.
  - Table `closet_shirts` and table `scrape_requests` exactly as spec section 7, plus `unique (user_id, url)` on `scrape_requests` and `check (status in ('pending','done','failed'))`.
  - RLS enabled on both; policies `select/insert/update/delete` where `user_id = auth.uid()`; `user_id default auth.uid()`.

- [ ] **Step 1: Write the check script first**

`check-db.mjs` reads `app/.env.local`; it exits with `SKIPPED: no SUPABASE_SECRET_KEY` and code 0 when the secret is absent. With the secret it:
1. Runs every `url-cases.json` input through `rpc("normalize_product_url")` and prints `PARITY PASS` only if all equal the expected output.
2. Creates two throwaway users with the admin API, signs in as each with the publishable key, inserts one `closet_shirts` row and one `scrape_requests` row per user, and asserts each user reads only their own rows (`RLS PASS`).
3. Asserts the anon client gets a permission error from `rpc("find_fit_product")` (`ANON BLOCKED PASS`).
4. Inserts the same request twice for one user via upsert on `(user_id, url)` and asserts one row (`UPSERT PASS`).
5. Deletes the throwaway users and their rows.

- [ ] **Step 2: Run it before the SQL exists**

Run: `cd app && node scripts/check-db.mjs`
Expected: `SKIPPED: no SUPABASE_SECRET_KEY` (no secret in this environment), or FAIL on missing functions if a secret is present.

- [ ] **Step 3: Write `001_app.sql`**, re-runnable (`create or replace`, `if not exists`, `drop policy if exists`), following the style of `webscraper/fit_store.sql`. Read and apply the `supabase:supabase-postgres-best-practices` skill rules for RLS, indexes (`closet_shirts(user_id)`, `scrape_requests(user_id, status)`) and security-definer functions before writing it.

- [ ] **Step 4: Apply and verify (needs a person with project access)**

The user (or anyone with the Supabase dashboard) pastes `001_app.sql` into the SQL editor and runs it, then puts `SUPABASE_SECRET_KEY` in `app/.env.local`.
Run: `cd app && node scripts/check-db.mjs`
Expected: `PARITY PASS`, `RLS PASS`, `ANON BLOCKED PASS`, `UPSERT PASS`. If no one can apply it yet, record "not applied, check skipped" in the task report; Tasks 5 and 6 do not depend on it.

- [ ] **Step 5: Commit**

`git add app/supabase app/scripts/check-db.mjs app/README.md && git commit -m "Add closet and scrape-request tables, RLS and the product lookup RPC"`

---

### Task 5: Design system components, fixture gallery and design checker

**Files:**
- Create: `app/src/components/` one file each: `Header.tsx`, `Pill.tsx`, `QuietLink.tsx`, `LinkEntry.tsx`, `SizeHero.tsx`, `ConfidenceNode.tsx`, `SizeSpread.tsx`, `ShirtRow.tsx`, `Draft.tsx`, `Tape.tsx`, `SectionNumber.tsx`, `ClosetItem.tsx`, `SizePicker.tsx`, `FitChoice.tsx`
- Create: `app/src/app/dev/components/page.tsx`
- Create: `app/scripts/design-check.mjs`; add `"design-check": "node scripts/design-check.mjs"` to `package.json`

**Interfaces:**
- Consumes: tokens (Task 2), `sizeSpread` output type (Task 3), engine `Ease`, `ShirtMatch`, `Confidence`, `FitLabel`.
- Produces: the components with the props in spec section 5 (exact prop names from that table; `SizeSpread` takes `items: ReturnType<typeof sizeSpread>`; `ShirtRow` takes `rank: number, name: string, match: ShirtMatch`; `Draft` takes `ease: Ease`). `design-check.mjs` CLI: `node scripts/design-check.mjs <path> [<path>...]` against `http://localhost:3001`, writing screenshots to `app/.design-check/<route>-<width>.png` (gitignored) and printing one PASS/FAIL line per check per size; exit 1 on any FAIL.

- [ ] **Step 1: Write the checker first**

Port `/tmp/.../mockups/verify/verify.js` and `desktop.js` logic (copied into the task prompt by the reviewer) into one script. Checks per route per size (1280x800, 1440x900, 1920x1080, 1024x768): fonts loaded (FontFace status `loaded` for both families), no `box-shadow`, no `gradient` background, no purple hue (HSL 250-320, saturation > 0.2), `scrollWidth <= innerWidth`, every text node's font-size in the scale (280 allowed), no element with text ≤ 16px immediately before an `h1`/`h2` unless it has `data-section-number`, every text node's contrast against its nearest opaque background ≥ 4.5, header wordmark left edge equals the content column's left edge ±1px.

- [ ] **Step 2: Run it against the empty gallery**

Run: `cd app && npm run dev & sleep 8; npm run design-check -- /dev/components`
Expected: FAIL (route not found).

- [ ] **Step 3: Build the components and the gallery.** Lift markup and CSS values from `docs/design/tailor/index.html`; `Draft` inlines `docs/design/tailor/shirt.svg` geometry unchanged, labels at the anchors in that file, a dimension whose ease is missing drawn at 25% opacity with `—`. The gallery renders every component in every state: confidence high/medium/low, spread with a `null` pct, a `ShirtRow` with a 64-character name and a missing sleeve, `Draft` with all three dims and with sleeve missing, `Pill` busy, `SizePicker` with 6 sizes, `FitChoice` each value, `ClosetItem` pending (domain name, size `—`).

- [ ] **Step 4: Verify**

Run: `cd app && npm run typecheck && npm run lint && npm run design-check -- /dev/components`
Expected: all PASS at all four sizes. Reviewer opens `.design-check/dev-components-1440.png` and `-1920.png` and compares them to the reference design.

- [ ] **Step 5: Commit**

`git add app && git commit -m "Add Tailor design system components, gallery and design checker"`

---

### Task 6: Screens as views, with fixtures and the golden check

**Files:**
- Create: `app/src/views/CheckView.tsx`, `ResultView.tsx`, `RequestedView.tsx`, `ClosetView.tsx`, `AddShirtView.tsx`, `SignInView.tsx`, `ErrorLine.tsx`
- Create: `app/src/fixtures/index.ts` (fixture data built from `engine/data` files and `recommend()`)
- Create: `app/src/app/dev/[screen]/page.tsx`
- Test: `app/test/golden.test.ts`

**Interfaces:**
- Consumes: Task 3 libs, Task 5 components.
- Produces: views that take plain props and callbacks, no data access:
  - `ResultView({ productName, sourceUrl, rec, names }: { productName: string; sourceUrl: string; rec: Recommendation; names: Record<string, string> })`
  - `CheckView({ closetNames, hasGreat, pending, onSubmit, error }: { closetNames: string[]; hasGreat: boolean; pending: { url: string; createdAt: string }[]; onSubmit: (url: string) => void; error?: ErrorKind })`
  - `ResultView` passes `productName` to `Header` as the readout.
  - `RequestedView({ url })`, `ClosetView({ shirts })` (each `ClosetItem` links to `/closet/new?edit=<id>`), `AddShirtView({ mode: "add" | "edit", step: "link" | "size", product?, initial?: { size_code: string; fit: FitLabel }, onSubmitLink, onSave, onDelete?, error? })` (edit mode starts at step `size`, shows the quiet `Delete` link, which opens a confirm dialog), `SignInView({ sent, onGoogle, onEmail })`
  - `type ErrorKind = "invalid_url" | "no_chart" | "scrape_failed" | "not_top" | "network"` and `ErrorLine({ kind })` with the exact copy from spec section 6.
  - Fixture screens at `/dev/<screen>`: `check`, `check-no-great`, `check-pending`, `result`, `result-low`, `result-null`, `requested`, `closet`, `closet-empty`, `add-shirt-link`, `add-shirt-size`, `edit-shirt`, `signin`, `signin-sent`, `errors`.

- [ ] **Step 1: Write the golden test**

`golden.test.ts` renders `ResultView` with the `result` fixture (sample wardrobe + `cos-oxford` through `recommend`) to static markup (`react-dom/server`) and asserts the text contains `M`, `Fits like your Blue Uniqlo oxford.` (names map gives the display names), `High`, `84.6%`, `S`, `70%`, `85%`, `35%`, and that `npm run recommend -- sample cos-oxford`'s ranking numbers (84.6, 49.0) all appear. A second test renders `CheckView` with `hasGreat: false` and asserts it contains `Add a shirt that fits you well.` and no `<input>` (Review Focus 4). A third renders `ErrorLine` for every `ErrorKind` and asserts the exact spec copy.

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run test/golden.test.ts`
Expected: FAIL (views missing).

- [ ] **Step 3: Build the views and fixture routes** following spec section 6 screen by screen. `dev/[screen]/page.tsx` 404s in production. `check-no-great` uses a closet with only tight/loose shirts.

- [ ] **Step 4: Verify**

Run: `cd app && npm test && npm run typecheck && npm run lint && npm run design-check -- /dev/check /dev/check-no-great /dev/check-pending /dev/result /dev/result-low /dev/result-null /dev/requested /dev/closet /dev/closet-empty /dev/add-shirt-link /dev/add-shirt-size /dev/edit-shirt /dev/signin /dev/signin-sent /dev/errors`
Expected: all PASS. Reviewer opens the 1440 and 1920 screenshots of `result`, `check`, `closet` and `add-shirt-size` and confirms: no text above headings except `01`/`02`, no helper text, first screen of `result` shows the hero and the top ranking row at 1440x900 and 1920x1080, `check-no-great` shows "Add a shirt that fits you well.".

- [ ] **Step 5: Commit**

`git add app && git commit -m "Build every screen as a view with fixtures and a golden result check"`

---

### Task 7: Auth: Google and email magic link

**Files:**
- Create: `app/src/lib/supabase/server.ts`, `app/src/lib/supabase/browser.ts`, session refresh file per the @supabase/ssr Next.js guide for Next 16 (`middleware.ts` or `proxy.ts`, whichever Next 16.4.5 uses)
- Create: `app/src/app/signin/page.tsx`, `app/src/app/auth/callback/route.ts`, `app/src/app/signout/route.ts`
- Test: `app/test/auth-guard.test.ts`

**Interfaces:**
- Produces: `createServerSupabase(): SupabaseClient` (cookies-based), `createBrowserSupabase(): SupabaseClient`, `requireUser(): Promise<User>` (redirects to `/signin` when signed out). `/`, `/closet`, `/closet/new`, `/result/[sku]` require a user; `/signin`, `/auth/callback`, `/dev/*` do not.

- [ ] **Step 1: Write the failing test**

`auth-guard.test.ts` tests a pure helper `isPublicPath(pathname: string): boolean` exported from the session-refresh file: true for `/signin`, `/auth/callback`, `/dev/result`; false for `/`, `/closet`, `/result/abc`.

- [ ] **Step 2: Run to verify it fails** (`npx vitest run test/auth-guard.test.ts`: FAIL).

- [ ] **Step 3: Implement.** Sign-in page renders `SignInView`; Google uses `signInWithOAuth({ provider: "google", options: { redirectTo: <origin>/auth/callback } })`; email uses `signInWithOtp({ email, options: { emailRedirectTo: <origin>/auth/callback } })`; callback exchanges the code and redirects to `/`. Use the `supabase:supabase` skill for current @supabase/ssr usage (getClaims/getUser, not getSession, on the server).

- [ ] **Step 4: Verify**

Run: `cd app && npm test && npm run typecheck && npm run lint && npm run build`, then with the dev server: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" localhost:3001/closet` prints `307 http://localhost:3001/signin` (or the 30x Next uses), and `npm run design-check -- /signin` passes.
Manual (needs the user): in the Supabase dashboard, add `http://localhost:3001/auth/callback` to Auth redirect URLs and enable the Google provider with a Google Cloud OAuth client. Then sign in once with each method and confirm landing on `/`. Record the outcome; if the dashboard steps are not done yet, record "manual sign-in not verified".

- [ ] **Step 5: Commit**

`git add app && git commit -m "Add Supabase auth with Google and email link"`

---

### Task 8: Wire the data: check, result, requests, closet

**Files:**
- Create: `app/src/server/actions.ts` (server actions), `app/src/server/data.ts` (Supabase reads/writes)
- Create: `app/src/app/page.tsx`, `app/src/app/result/[sku]/page.tsx`, `app/src/app/closet/page.tsx`, `app/src/app/closet/new/page.tsx`
- Test: `app/test/actions.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces (in `data.ts`, each takes a `SupabaseClient` first so tests pass a fake):
  - `findProduct(db, url: string): Promise<FitProduct | null>` (calls `find_fit_product` with the normalised URL)
  - `listCloset(db): Promise<ClosetRow[]>`
  - `saveShirt(db, input: { product: FitProduct; size_code: string; fit: FitLabel }): Promise<void>` (copies the chosen chart row's dims into the row)
  - `updateShirt(db, id: string, patch: { size_code?: string; fit?: FitLabel }): Promise<void>`, `deleteShirt(db, id: string): Promise<void>`
  - `requestScrape(db, url: string): Promise<void>` (upsert on `(user_id, url)`, `status: "pending"`)
  - `listPending(db): Promise<{ url: string; createdAt: string; status: string }[]>`
- Produces (in `actions.ts`): `checkLink(formData) -> { kind: "result", sku } | { kind: "requested", url } | { kind: "error", error: ErrorKind }` with this order: invalid URL -> `invalid_url`; found but `!isTop` -> `not_top`; found but `toCandidate` null -> `no_chart`; found -> `result`; not found -> `requestScrape` then `requested`; any thrown Supabase error -> `network`.

- [ ] **Step 1: Write the failing tests** (`actions.test.ts` with an in-memory fake client recording RPC calls and upserts):
```ts
test("invalid link never touches the database", ...)        // checkLink("not a url") -> invalid_url, 0 calls
test("found top with chart -> result", ...)                   // -> { kind: "result", sku: "cos-oxford" }
test("found dress -> not_top", ...)
test("found top, empty chart -> no_chart", ...)
test("unknown link -> one pending request, twice-submitted", ...) // two checkLink calls -> 2 upserts on the same normalised url, onConflict "user_id,url"
test("rpc throws -> network", ...)
test("saveShirt copies the chosen size's chart dims", ...)   // M row of cos-oxford -> chest 54.5, length 72.5, sleeve 63.5
```

- [ ] **Step 2: Run to verify they fail** (`npx vitest run test/actions.test.ts`: FAIL).

- [ ] **Step 3: Implement** `data.ts`, `actions.ts` and the four routes, each route a thin server component that loads data, maps with Task 3 libs, and renders the Task 6 view. `/result/[sku]` re-runs `recommend` on every load from the stored chart and the current closet (no cached result). `Check` lists pending requests and, on load, resolves any whose URL `findProduct` now returns (link to its result; mark the request done is the scraper's job, so the app only reads).

- [ ] **Step 4: Verify**

Run: `cd app && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. With the SQL applied and a signed-in session (manual, needs the user): add a closet shirt from a link that is in the fit store, check another stored product, confirm the result matches `cd engine && npm run recommend` for the same closet and candidate exported with `npm run export-candidates`; paste an unknown link and confirm one `scrape_requests` row. Record what was and was not verified.

- [ ] **Step 5: Commit**

`git add app && git commit -m "Wire check, result, requests and closet to Supabase"`

---

### Task 9: Whole-branch verification and local hosting

**Files:**
- Modify: `app/README.md` (final run instructions, manual Supabase steps, known gaps)

- [ ] **Step 1: Full verification**

Run: `cd engine && npm test && npm run typecheck && cd ../app && npm test && npm run typecheck && npm run lint && npm run build && npm run design-check -- /dev/components /dev/check /dev/check-no-great /dev/check-pending /dev/result /dev/result-low /dev/result-null /dev/requested /dev/closet /dev/closet-empty /dev/add-shirt-link /dev/add-shirt-size /dev/edit-shirt /dev/signin /dev/signin-sent /dev/errors /signin`
Expected: every command passes; paste the full PASS/FAIL output.

- [ ] **Step 2: Host locally**

Run `cd app && npm run dev` in the background, confirm `curl -s -o /dev/null -w "%{http_code}" localhost:3001/signin` prints `200`, and report port 3001 to the user.

- [ ] **Step 3: Report** which manual checks (SQL applied, Google and email sign-in, live check against the fit store) were done and which remain, with the README section that covers each.

- [ ] **Step 4: Commit** any README changes: `git commit -am "Document running the shopper app locally"`
