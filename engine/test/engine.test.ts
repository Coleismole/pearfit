// Expected values are computed by hand from the default TOPS weights:
// chest 1.0, length 0.4, sleeve 0.3 (sum 1.7); matchPct = 100 * exp(-d / 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { distance, easeVector, matchPct } from "../src/score.ts";
import { recommend } from "../src/recommend.ts";
import { TOPS } from "../src/config.ts";
import type { Candidate, Measurements, OwnedShirt } from "../src/types.ts";
import { loadWardrobe } from "../cli/load.ts";

const m = (chest: number | null, length: number | null, sleeve: number | null): Measurements => ({
  chest_cm: chest, length_cm: length, sleeve_cm: sleeve,
});
const shirt = (id: string, label: OwnedShirt["label"], ms: Measurements): OwnedShirt => ({ id, label, measurements: ms });
const cand = (sizes: Record<string, Measurements>, review: Candidate["review"] = null): Candidate => ({
  id: "test", name: "Test", review, sizes,
});
const ref = shirt("blue-shirt", "great", m(54, 72, 63));

test("ease and distance: +2cm chest only", () => {
  const ease = easeVector(m(56, 72, 63), ref.measurements);
  assert.deepEqual(ease, { chest_cm: 2, length_cm: 0, sleeve_cm: 0 });
  const d = distance(ease, TOPS.weights)!;
  assert.ok(Math.abs(d - 2 / 1.7) < 1e-9); // 1.1765
  assert.equal(matchPct(d, TOPS.matchScaleCm), 67.6);
});

test("missing measurement is skipped, not counted as a perfect match", () => {
  const d = distance(easeVector(m(56, 72, 63), m(54, 72, null)), TOPS.weights)!;
  assert.ok(Math.abs(d - 2 / 1.4) < 1e-9); // 1.4286, larger than with sleeve present
});

test("nothing comparable gives null distance", () => {
  assert.equal(distance(easeVector(m(null, 72, null), m(54, null, 63)), TOPS.weights), null);
});

test("identical shirt: 100%, high confidence, 'fits like'", () => {
  const r = recommend([ref], cand({ M: m(54, 72, 63) }));
  assert.equal(r.size, "M");
  assert.equal(r.ranking[0].matchPct, 100);
  assert.equal(r.confidence, "high");
  assert.equal(r.verdict, "Get the M, fits like your blue shirt.");
});

test("medium band names the gap that matters most", () => {
  const r = recommend([ref], cand({ M: m(57, 72, 63) })); // d = 3/1.7 = 1.76
  assert.equal(r.confidence, "medium");
  assert.equal(r.verdict, "Get the M, closest to your blue shirt, 3.0cm looser in the chest.");
});

test("over 3cm is low confidence, no close match", () => {
  const r = recommend([ref], cand({ M: m(60, 72, 63) })); // d = 6/1.7 = 3.53
  assert.equal(r.confidence, "low");
  assert.match(r.verdict, /^No close match/);
});

test("picks the closest size", () => {
  const r = recommend([ref], cand({ S: m(51, 70, 62), M: m(54.5, 72, 63), L: m(57, 74, 64) }));
  assert.equal(r.size, "M");
});

// M: d = 0.3/1.7 = 0.18, L: d = 0.4/1.7 = 0.24. Gap 0.06 < 0.5 margin = near-tie.
const tied = { M: m(53.7, 72, 63), L: m(54.4, 72, 63) };

test("near-tie + runs_small picks the larger size", () => {
  const r = recommend([ref], cand(tied, "runs_small"));
  assert.equal(r.size, "L");
  assert.equal(r.confidence, "medium"); // tie costs one level
});

test("near-tie + runs_large picks the smaller size", () => {
  assert.equal(recommend([ref], cand(tied, "runs_large")).size, "M");
});

test("near-tie without reviews keeps the measurement winner and drops confidence", () => {
  const r = recommend([ref], cand(tied));
  assert.equal(r.size, "M");
  assert.equal(r.confidence, "medium");
});

test("reviews never override a clear winner", () => {
  // M: d = 0, L: d = 1.18. Gap well over the margin.
  const r = recommend([ref], cand({ M: m(54, 72, 63), L: m(56, 72, 63) }, "runs_small"));
  assert.equal(r.size, "M");
  assert.equal(r.confidence, "high");
});

test("landing within 1cm chest of a tight shirt warns and drops confidence", () => {
  const tight = shirt("black-polo", "tight", m(54.5, 70, null));
  const r = recommend([ref, tight], cand({ M: m(54, 72, 63) }));
  assert.equal(r.confidence, "medium");
  assert.match(r.notes.join(" "), /black polo, which you marked tight/);
});

test("missing chest drops confidence", () => {
  const r = recommend([ref], cand({ M: m(null, 72, 63) }));
  assert.equal(r.ranking[0].distance, 0);
  assert.equal(r.confidence, "medium");
});

test("tight and loose shirts are never used as fit references", () => {
  const loose = shirt("big-shirt", "loose", m(58, 75, 65));
  const r = recommend([ref, loose], cand({ L: m(58, 75, 65) }));
  assert.deepEqual(r.ranking.map((x) => x.shirtId), ["blue-shirt"]);
});

test("no great shirts gives no size", () => {
  const r = recommend([shirt("a", "tight", m(50, 70, 60))], cand({ M: m(54, 72, 63) }));
  assert.equal(r.size, null);
  assert.equal(r.confidence, "low");
});

test("loader rejects bad labels and string numbers", () => {
  const dir = mkdtempSync(join(tmpdir(), "fit-"));
  mkdirSync(join(dir, "wardrobes"));
  const write = (data: unknown) => writeFileSync(join(dir, "wardrobes", "x.json"), JSON.stringify(data));

  write([{ id: "a", label: "good", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } }]);
  assert.throws(() => loadWardrobe("x", dir), /label must be/);

  write([{ id: "a", label: "great", measurements: { chest_cm: "54", length_cm: 72, sleeve_cm: 63 } }]);
  assert.throws(() => loadWardrobe("x", dir), /chest_cm must be a positive number or null/);

  write([{ id: "a", label: "great", measurements: { chest_cm: 54, length_cm: 72 } }]);
  assert.equal(loadWardrobe("x", dir)[0].measurements.sleeve_cm, null);
});

test("a near-tie between sizes that are not neighbours is not broken by the review signal", () => {
  const m = (chest: number) => ({ chest_cm: chest, length_cm: null, sleeve_cm: null });
  const wardrobe = [{ id: "great-tee", label: "great" as const, measurements: m(50) }];
  const candidate = { id: "x", name: "x", review: "runs_small" as const, sizes: { S: m(49.8), M: m(55), L: m(50.2) } };
  const r = recommend(wardrobe, candidate);
  assert.equal(r.size, "S");
  assert.deepEqual(r.notes, []);
});
