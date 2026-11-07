// Expected values are computed by hand from the default TOPS weights:
// chest 1.0, length 0.4, sleeve 0.3 (sum 1.7). Reference shirt: chest 54, length 72, sleeve 63.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMiss } from "../src/analyze.ts";
import { recommend } from "../src/recommend.ts";
import type { Candidate, Measurements, OwnedShirt } from "../src/types.ts";

const m = (chest: number | null, length: number | null, sleeve: number | null): Measurements => ({
  chest_cm: chest, length_cm: length, sleeve_cm: sleeve,
});
const shirt = (id: string, label: OwnedShirt["label"], ms: Measurements): OwnedShirt => ({ id, label, measurements: ms });
const cand = (sizes: Record<string, Measurements>, review: Candidate["review"] = null): Candidate => ({
  id: "test", name: "Test", review, sizes,
});
const ref = shirt("blue-shirt", "great", m(54, 72, 63));

test("a correct pick is not a miss", () => {
  const r = recommend([ref], cand({ M: m(54, 72, 63) }));
  assert.equal(analyzeMiss(r, "M"), null);
});

test("per-dimension gap: chest drives a pick of M when L was right", () => {
  // M ease (+0.5, 0, 0): d = 0.5/1.7 = 0.2941.  L ease (+3, +2, +1): d = (3 + 0.8 + 0.3)/1.7 = 2.4118.
  const r = recommend([ref], cand({ S: m(51, 70, 62), M: m(54.5, 72, 63), L: m(57, 74, 64) }));
  assert.equal(r.size, "M");
  const a = analyzeMiss(r, "L")!;

  assert.equal(a.cause, "measurements");
  assert.equal(a.direction, "too_small");
  assert.equal(a.sizesOff, 1);
  assert.equal(a.chosenShirtId, "blue-shirt");
  assert.equal(a.correctShirtId, "blue-shirt");
  assert.equal(a.chosenDistance, 0.29);
  assert.equal(a.correctDistance, 2.41);
  assert.equal(a.margin, 2.12); // 2.4118 - 0.2941 = 2.1176

  // Share of each distance by dimension. Swing = correct share - chosen share (positive = pushed toward M).
  // chest: 3/1.7 - 0.5/1.7 = 1.4706   length: 0.8/1.7 = 0.4706   sleeve: 0.3/1.7 = 0.1765
  const chest = a.gaps.find((g) => g.dim === "chest_cm")!;
  assert.deepEqual(chest, { dim: "chest_cm", chosenEase: 0.5, correctEase: 3, chosenShare: 0.29, correctShare: 1.76, swing: 1.47 });
  assert.deepEqual(a.gaps.map((g) => g.swing), [1.47, 0.47, 0.18]);
  assert.equal(a.driver, "chest_cm");
});

test("two sizes off, picked too small", () => {
  const small = shirt("small-shirt", "great", m(51, 70, 62));
  const r = recommend([small], cand({ S: m(51, 70, 62), M: m(54.5, 72, 63), L: m(57, 74, 64) }));
  const a = analyzeMiss(r, "L")!;
  assert.equal(r.size, "S");
  assert.equal(a.sizesOff, 2);
  assert.equal(a.direction, "too_small");
});

test("a near-tie won by the review signal is labelled tie_break, with no measurement driver", () => {
  // M: d = 0.3/1.7 = 0.1765. L: d = 0.4/1.7 = 0.2353. Reviews push the pick to L, but M was right.
  const r = recommend([ref], cand({ M: m(53.7, 72, 63), L: m(54.4, 72, 63) }, "runs_small"));
  assert.equal(r.size, "L");
  const a = analyzeMiss(r, "M")!;
  assert.equal(a.cause, "tie_break");
  assert.equal(a.direction, "too_large");
  assert.equal(a.margin, -0.06); // 0.1765 - 0.2353 = -0.0588: measurements preferred the correct size
  assert.equal(a.driver, null);
});

test("a dimension missing on the chosen size has null ease and no share", () => {
  // S (54.5, 72, null) vs ref: chest +0.5, length 0, sleeve not compared. d = 0.5/1.4 = 0.3571.
  // L (57, 72, 63): d = 3/1.7 = 1.7647.
  const r = recommend([ref], cand({ S: m(54.5, 72, null), L: m(57, 72, 63) }));
  assert.equal(r.size, "S");
  const a = analyzeMiss(r, "L")!;
  const sleeve = a.gaps.find((g) => g.dim === "sleeve_cm")!;
  assert.equal(sleeve.chosenEase, null);
  assert.equal(sleeve.chosenShare, 0);
  assert.equal(sleeve.correctEase, 0);
  assert.equal(a.chosenDistance, 0.36);
  assert.equal(a.correctDistance, 1.76);
});

test("a correct size with nothing comparable is reported as unscorable", () => {
  const r = recommend([ref], cand({ M: m(54, 72, 63), L: m(null, null, null) }));
  const a = analyzeMiss(r, "L")!;
  assert.equal(a.cause, "correct_unscorable");
  assert.deepEqual(a.gaps, []);
  assert.equal(a.driver, null);
  assert.equal(a.margin, null);
});

test("no pick at all is reported as no_pick", () => {
  const r = recommend([shirt("a", "tight", m(50, 70, 60))], cand({ M: m(54, 72, 63) }));
  const a = analyzeMiss(r, "M")!;
  assert.equal(a.cause, "no_pick");
  assert.equal(a.chosenSize, null);
  assert.equal(a.direction, null);
});
