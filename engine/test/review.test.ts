// Tests for the review signal (src/review.ts): the skew of the stored review shares, and the signal the scorer
// gets from it. Expected values are worked out by hand from the default TOPS settings:
// at least 10 reviews, and the "runs small" and "runs large" shares at least 10 points apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPS } from "../src/config.ts";
import { recommend } from "../src/recommend.ts";
import { reviewSignalFrom, reviewSkew } from "../src/review.ts";
import type { Candidate, Measurements, OwnedShirt, ReviewSummary } from "../src/types.ts";

const reviews = (total: number, runsSmallPct: number, trueToSizePct: number, runsLargePct: number): ReviewSummary => ({
  total, runsSmallPct, trueToSizePct, runsLargePct,
});

test("the settings this file's numbers are worked out from", () => {
  assert.equal(TOPS.reviewMinCount, 10);
  assert.equal(TOPS.reviewSkewMinPct, 10);
  assert.equal(TOPS.tieMarginCm, 0.5);
});

// ---- skew: runs large share minus runs small share, in points ----

test("reviewSkew is the runs large share minus the runs small share", () => {
  assert.equal(reviewSkew(reviews(40, 60, 30, 10)), -50); // 10 - 60: leans small
  assert.equal(reviewSkew(reviews(300, 0, 83, 17)), 17); // 17 - 0: leans large
  assert.equal(reviewSkew(reviews(55, 5, 90, 5)), 0); // balanced
  assert.equal(reviewSkew(reviews(20, 0, 100, 0)), 0); // nobody called it small or large
});

// ---- the signal ----

test("the reviews lean when the two shares are 10 points or more apart, whatever the true to size share is", () => {
  // True to size has by far the largest share in all four. That share also counts every review that says nothing
  // about fit, so it does not decide the direction.
  assert.equal(reviewSignalFrom(reviews(15, 20, 80, 0)), "runs_small"); // skew -20
  assert.equal(reviewSignalFrom(reviews(300, 0, 83, 17)), "runs_large"); // skew +17
  assert.equal(reviewSignalFrom(reviews(15, 20, 73, 7)), "runs_small"); // skew 7 - 20 = -13
  assert.equal(reviewSignalFrom(reviews(48, 4, 81, 15)), "runs_large"); // skew 15 - 4 = +11
  // And when one of the two is the largest share, as before.
  assert.equal(reviewSignalFrom(reviews(40, 60, 30, 10)), "runs_small"); // skew -50
});

test("the 10 point line is included, and 9 points is not a lean", () => {
  assert.equal(reviewSignalFrom(reviews(20, 15, 80, 5)), "runs_small"); // skew 5 - 15 = -10
  assert.equal(reviewSignalFrom(reviews(20, 5, 80, 15)), "runs_large"); // skew +10
  assert.equal(reviewSignalFrom(reviews(20, 14, 81, 5)), "true_to_size"); // skew -9
  assert.equal(reviewSignalFrom(reviews(20, 5, 81, 14)), "true_to_size"); // skew +9
});

test("enough reviews that do not lean give true_to_size", () => {
  assert.equal(reviewSignalFrom(reviews(55, 5, 91, 4)), "true_to_size"); // skew -1
  assert.equal(reviewSignalFrom(reviews(21, 0, 100, 0)), "true_to_size"); // skew 0
  assert.equal(reviewSignalFrom(reviews(30, 30, 40, 30)), "true_to_size"); // split evenly: skew 0
});

test("fewer than 10 reviews give no signal, however far they lean", () => {
  assert.equal(reviewSignalFrom(reviews(10, 20, 80, 0)), "runs_small"); // 10 reviews is enough
  assert.equal(reviewSignalFrom(reviews(9, 22, 78, 0)), null); // 9 is not
  assert.equal(reviewSignalFrom(reviews(5, 40, 60, 0)), null);
  assert.equal(reviewSignalFrom(reviews(3, 100, 0, 0)), null);
});

test("no reviews give no signal", () => {
  assert.equal(reviewSignalFrom(undefined), null);
  assert.equal(reviewSignalFrom(reviews(0, 0, 0, 0)), null);
});

test("both numbers come from the config", () => {
  const strict = { ...TOPS, reviewMinCount: 50, reviewSkewMinPct: 30 };
  assert.equal(reviewSignalFrom(reviews(40, 60, 30, 10), strict), null); // 40 reviews, 50 needed
  assert.equal(reviewSignalFrom(reviews(300, 0, 83, 17), strict), "true_to_size"); // skew +17, 30 needed
  assert.equal(reviewSignalFrom(reviews(60, 45, 45, 10), strict), "runs_small"); // skew -35
  const loose = { ...TOPS, reviewMinCount: 5, reviewSkewMinPct: 5 };
  assert.equal(reviewSignalFrom(reviews(5, 40, 60, 0), loose), "runs_small");
});

// ---- what the scorer does with it: break a near-tie, and nothing else ----

const m = (chest: number | null, length: number | null, sleeve: number | null): Measurements => ({
  chest_cm: chest, length_cm: length, sleeve_cm: sleeve,
});
const ref: OwnedShirt = { id: "blue-shirt", label: "great", measurements: m(54, 72, 63) };
const cand = (sizes: Record<string, Measurements>, summary: ReviewSummary | undefined): Candidate => ({
  id: "test", name: "Test", review: reviewSignalFrom(summary), sizes, ...(summary ? { reviewSummary: summary } : {}),
});
// Weights 1.0 / 0.4 / 0.3 (sum 1.7). M: chest -0.3, d = 0.3 / 1.7 = 0.18. L: chest +0.4, d = 0.4 / 1.7 = 0.24.
// The gap is 0.06 cm, under the 0.5 cm margin: a near-tie that M wins on measurements alone.
const tied = { M: m(53.7, 72, 63), L: m(54.4, 72, 63) };

test("a near-tie goes to the larger size when the reviews lean small, even with true to size the largest share", () => {
  const r = recommend([ref], cand(tied, reviews(15, 20, 80, 0))); // skew -20
  assert.equal(r.size, "L");
  assert.equal(r.confidence, "medium"); // d = 0.24 is in the high band; the near-tie costs one level
  assert.deepEqual(r.notes, ["M and L are nearly tied; more reviews say it runs small than large, so L."]);
  assert.equal(r.ranking[0].matchPct, 92.5); // 100 * exp(-0.2353 / 3): the match itself is measurements only
});

test("a near-tie goes to the smaller size when the reviews lean large", () => {
  const r = recommend([ref], cand(tied, reviews(300, 0, 83, 17))); // skew +17
  assert.equal(r.size, "M");
  assert.deepEqual(r.notes, ["M and L are nearly tied; more reviews say it runs large than small, so M."]);
  assert.equal(r.ranking[0].matchPct, 94.3); // 100 * exp(-0.1765 / 3)
});

test("a near-tie stays with the closer size when the reviews do not lean, and the note says so", () => {
  const r = recommend([ref], cand(tied, reviews(55, 5, 91, 4))); // skew -1
  assert.equal(r.size, "M");
  assert.equal(r.confidence, "medium");
  assert.deepEqual(r.notes, ["M and L are nearly tied, and the reviews do not lean small or large."]);
});

test("a near-tie stays with the closer size when there are too few reviews, and the note says so", () => {
  for (const summary of [reviews(9, 22, 78, 0), undefined]) {
    const r = recommend([ref], cand(tied, summary));
    assert.equal(r.size, "M");
    assert.deepEqual(r.notes, ["M and L are nearly tied, and there are not enough reviews to break the tie."]);
  }
});

test("a review lean never moves a clear winner, and leaves the match and the confidence alone", () => {
  // M: d = 0. L: chest +2, d = 2 / 1.7 = 1.18. The gap is 1.18 cm, over the 0.5 cm margin.
  const clear = { M: m(54, 72, 63), L: m(56, 72, 63) };
  const leaning = recommend([ref], cand(clear, reviews(40, 100, 0, 0))); // every review says it runs small
  const silent = recommend([ref], cand(clear, undefined));
  assert.equal(leaning.size, "M");
  assert.equal(leaning.confidence, "high");
  assert.deepEqual(leaning.notes, []);
  assert.equal(leaning.ranking[0].matchPct, 100);
  // Size by size, the scores are the same with and without the reviews.
  assert.deepEqual(leaning.sizes, silent.sizes);
});
