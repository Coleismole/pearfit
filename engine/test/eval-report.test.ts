// Reference shirt: chest 54, length 72, sleeve 63 (great). Hand-computed values use TOPS weights 1.0 / 0.4 / 0.3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, formatEval } from "../cli/eval-report.ts";
import type { Candidate, EvalCase, Measurements, OwnedShirt } from "../src/types.ts";

const m = (chest: number | null, length: number | null, sleeve: number | null): Measurements => ({
  chest_cm: chest, length_cm: length, sleeve_cm: sleeve,
});
const ref: OwnedShirt = { id: "blue-shirt", label: "great", measurements: m(54, 72, 63) };
const wardrobeFor = (owner: string): OwnedShirt[] => {
  if (owner !== "o") throw new Error(`no wardrobe "${owner}"`);
  return [ref];
};

// S ease (-3,-2,-1), M ease (+0.5,0,0), L ease (+3,+2,+1): the engine picks M.
const threeSizes = { S: m(51, 70, 62), M: m(54.5, 72, 63), L: m(57, 74, 64) };
const cand = (id: string, sizes: Candidate["sizes"]): Candidate => ({ id, name: id, review: null, sizes });
const candidates = [
  cand("exact", { M: m(54, 72, 63) }),
  cand("missed", threeSizes),
  cand("held", threeSizes),
];
const cases: EvalCase[] = [
  { owner: "o", candidate: "exact", correctSize: "M", closestShirt: "blue-shirt" },
  { owner: "o", candidate: "missed", correctSize: "L" },
  { owner: "o", candidate: "held", correctSize: "L", holdout: true },
  { owner: "o", candidate: "ghost", correctSize: "M" },
];

test("evaluate tallies tuning and holdout separately", () => {
  const s = evaluate({ cases, candidates, wardrobeFor });
  assert.deepEqual(s.tuning, { sizeExact: 1, sizeNear: 2, sizeTotal: 2, top1: 1, top3: 1, shirtTotal: 1 });
  assert.deepEqual(s.holdout, { sizeExact: 0, sizeNear: 1, sizeTotal: 1, top1: 0, top3: 0, shirtTotal: 0 });
});

test("a case naming an unknown candidate is skipped and reported, not fatal", () => {
  const s = evaluate({ cases, candidates, wardrobeFor });
  assert.deepEqual(s.skipped.map((k) => k.candidate), ["ghost"]);
  assert.equal(s.rows.length, 3);
});

test("a case asking for a size the candidate does not have still fails loudly", () => {
  const bad: EvalCase[] = [{ owner: "o", candidate: "exact", correctSize: "XL" }];
  assert.throws(() => evaluate({ cases: bad, candidates, wardrobeFor }), /exact has no size "XL"/);
});

test("miss summary counts tuning misses only, holdout is excluded", () => {
  const s = evaluate({ cases, candidates, wardrobeFor });
  assert.deepEqual(s.missSummary, {
    total: 1,
    byCause: { measurements: 1 },
    byDriver: { chest_cm: 1 },
    byDirection: { too_small: 1 },
    meanMargin: 2.12, // measurement misses only: 2.4118 - 0.2941
  });
});

test("report prints the miss with its per-dimension gap and margin", () => {
  const lines = formatEval(evaluate({ cases, candidates, wardrobeFor })).map((l) => l.replace(/\s+/g, " ").trim());
  const text = lines.join("\n");
  assert.ok(lines.includes("MISS: wanted L, got M (1 size too small)"), text);
  assert.ok(lines.includes("why: measurements. M is 2.12cm closer than L (M 0.29 vs blue-shirt, L 2.41 vs blue-shirt)"), text);
  assert.ok(lines.includes("chest +0.5 +3.0 0.29 1.76 +1.47 <- driver"), text);
  assert.ok(lines.includes("length +0.0 +2.0 0.00 0.47 +0.47"), text);
  assert.ok(lines.includes("sleeve +0.0 +1.0 0.00 0.18 +0.18"), text);
});

test("report ends with the accuracy tallies, the miss summary and the skipped cases", () => {
  const lines = formatEval(evaluate({ cases, candidates, wardrobeFor })).map((l) => l.replace(/\s+/g, " ").trim());
  const text = lines.join("\n");
  assert.ok(lines.includes("size exact: 1/2 (50%)"), text);
  assert.ok(lines.includes("size within one: 2/2 (100%)"), text);
  assert.ok(lines.includes("closest shirt #1: 1/1 (100%)"), text);
  assert.ok(lines.includes("chest_cm: 1"), text); // under the driver heading
  assert.ok(lines.includes("too_small: 1"), text);
  assert.ok(lines.some((l) => l.startsWith("Skipped 1 case") && l.includes("o/ghost")), text);
  assert.ok(lines.includes("Holdout:"), text);
});

test("a tie-break miss explains that measurements preferred the correct size", () => {
  // M: d = 0.3/1.7 = 0.1765, L: d = 0.4/1.7 = 0.2353; runs_small pushes the near-tie to L, but M was right.
  const tied: Candidate = {
    id: "tied", name: "tied", review: "runs_small", sizes: { M: m(53.7, 72, 63), L: m(54.4, 72, 63) },
  };
  const s = evaluate({ cases: [{ owner: "o", candidate: "tied", correctSize: "M" }], candidates: [tied], wardrobeFor });
  const text = formatEval(s).map((l) => l.replace(/\s+/g, " ").trim()).join("\n");
  assert.match(text, /MISS: wanted M, got L \(1 size too large\)/);
  assert.match(text, /why: tie-break\. Measurements preferred M by 0\.06cm, but L won a near-tie \(review signal or size order\)/);
  assert.deepEqual(s.missSummary.byCause, { tie_break: 1 });
  assert.deepEqual(s.missSummary.byDriver, {});
  assert.equal(s.missSummary.meanMargin, null); // no measurement-caused misses
});

test("a run with no misses says so", () => {
  const s = evaluate({ cases: [cases[0]], candidates, wardrobeFor });
  assert.equal(s.missSummary.total, 0);
  assert.match(formatEval(s).join("\n"), /No size misses/);
});
