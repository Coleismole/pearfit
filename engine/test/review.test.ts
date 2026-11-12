import test from "node:test";
import assert from "node:assert/strict";
import { reviewSignalFromShares } from "../src/review.ts";

// Defaults: minReviews 10, marginPct 15.
test("mostly true to size with no lean either way gives no signal", () => {
  assert.equal(reviewSignalFromShares(40, 5, 5), null); // 0 points apart
});

test("true_to_size being the largest share is not a signal, a clear small lead still is", () => {
  assert.equal(reviewSignalFromShares(40, 30, 10), "runs_small"); // 30 - 10 = 20 >= 15, though tts is 60
});

test("runs_large needs the same margin the other way", () => {
  assert.equal(reviewSignalFromShares(20, 5, 25), "runs_large"); // 25 - 5 = 20
});

test("margin boundary: exactly 15 points counts, 14 does not", () => {
  assert.equal(reviewSignalFromShares(20, 25, 10), "runs_small"); // 15
  assert.equal(reviewSignalFromShares(20, 24, 10), null); // 14
});

test("fewer than 10 reviews gives no signal even with a big lead", () => {
  assert.equal(reviewSignalFromShares(9, 60, 0), null);
  assert.equal(reviewSignalFromShares(10, 60, 0), "runs_small");
});

test("a custom config is honoured", () => {
  assert.equal(reviewSignalFromShares(5, 20, 0, { minReviews: 5, marginPct: 20 }), "runs_small");
});
