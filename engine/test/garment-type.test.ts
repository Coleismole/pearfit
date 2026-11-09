// Only like is compared with like. Expected values are computed by hand from the default TOPS weights:
// chest 1.0, length 0.4, sleeve 0.3 (sum 1.7); matchPct = 100 * exp(-d / 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { garmentTypeOf, recommend } from "../src/recommend.ts";
import type { Candidate, GarmentType, Measurements, OwnedShirt } from "../src/types.ts";
import { garmentTypeFor } from "../cli/garment-type.ts";
import { loadCandidates, loadWardrobe } from "../cli/load.ts";

const m = (chest: number | null, length: number | null, sleeve: number | null): Measurements => ({
  chest_cm: chest, length_cm: length, sleeve_cm: sleeve,
});
const shirt = (id: string, label: OwnedShirt["label"], ms: Measurements, garmentType?: GarmentType): OwnedShirt => ({
  id, label, measurements: ms, ...(garmentType ? { garmentType } : {}),
});
const cand = (sizes: Record<string, Measurements>, garmentType?: GarmentType): Candidate => ({
  id: "test", name: "Test", review: null, sizes, ...(garmentType ? { garmentType } : {}),
});

// A candidate M of 56 / 72 / 63 against a tee of 54 / 72 / 63: chest +2, nothing else.
//   distance = (1.0 * 2) / 1.7 = 1.1765 -> 1.18 (rounded to 2 decimals); matchPct = 100 * exp(-1.1765 / 3) = 67.6
// Against a polo of exactly 56 / 72 / 63 the distance would be 0 and the match 100%.
const blueTee = shirt("blue-tee", "great", m(54, 72, 63));
const greyPolo = (label: OwnedShirt["label"], type: GarmentType = "polo") => shirt("grey-polo", label, m(56, 72, 63), type);
const candidateM = { M: m(56, 72, 63) };

test("(a) a tee candidate ignores a polo in the wardrobe", () => {
  const r = recommend([blueTee, greyPolo("great")], cand(candidateM));
  assert.equal(r.size, "M");
  assert.deepEqual(r.ranking.map((x) => x.shirtId), ["blue-tee"]); // the polo is not even listed
  assert.equal(r.ranking[0].distance, 1.18);
  assert.equal(r.ranking[0].matchPct, 67.6);
  assert.equal(r.sizes[0].matches.length, 1);
  assert.equal(r.verdict, "Get the M, fits like your blue tee."); // 1.18 < 1.5 cm: high band
  assert.equal(r.confidence, "high");

  // Control: if the polo were a tee it would win outright at 100%, so the rule is what changed the answer.
  const control = recommend([blueTee, greyPolo("great", "tee")], cand(candidateM));
  assert.equal(control.ranking[0].shirtId, "grey-polo");
  assert.equal(control.ranking[0].matchPct, 100);
});

test("(b) a polo candidate with only tees in the wardrobe gets no recommendation", () => {
  const r = recommend([blueTee, shirt("red-tee", "tight", m(50, 70, 60))], cand(candidateM, "polo"));
  assert.equal(r.size, null);
  assert.equal(r.confidence, "low");
  assert.equal(r.verdict, "No comparable shirts in your wardrobe. This is a polo, and your wardrobe has none.");
  assert.deepEqual(r.ranking, []);
  assert.ok(r.sizes.every((s) => s.matches.length === 0)); // no size was scored against anything
});

test("(b2) an empty wardrobe also has nothing comparable", () => {
  const r = recommend([], cand(candidateM, "jacket"));
  assert.equal(r.size, null);
  assert.match(r.verdict, /^No comparable shirts in your wardrobe\. This is a jacket/);
});

test("(b3) same-type shirts that are all non-great still get the 'nothing labelled great' message", () => {
  const r = recommend([greyPolo("tight")], cand(candidateM, "polo"));
  assert.equal(r.size, null);
  assert.match(r.verdict, /No shirts labelled great/);
});

test("(c) a missing garmentType is a tee, on both the candidate and the wardrobe", () => {
  assert.equal(garmentTypeOf({}), "tee");
  assert.equal(garmentTypeOf({ garmentType: "polo" }), "polo");

  const untyped = recommend([blueTee], cand(candidateM));
  const typed = recommend([shirt("blue-tee", "great", m(54, 72, 63), "tee")], cand(candidateM, "tee"));
  assert.deepEqual(untyped, typed); // identical in every field
  assert.equal(untyped.ranking[0].matchPct, 67.6);

  // An untyped wardrobe shirt is a tee, so an untyped candidate is compared with it but a polo candidate is not.
  assert.equal(recommend([blueTee], cand(candidateM, "polo")).size, null);
});

test("(d) a tight or loose shirt of another type does not trigger the chest guard", () => {
  // The loose polo's chest (56) is within 1 cm of the candidate's (56). Compared, it would add a warning and
  // drop confidence one level (high -> medium). It is a different type, so it is not compared.
  const r = recommend([blueTee, greyPolo("loose")], cand(candidateM));
  assert.deepEqual(r.notes, []);
  assert.equal(r.confidence, "high");

  // Control: a loose TEE at the same chest does trigger it.
  const control = recommend([blueTee, shirt("loose-tee", "loose", m(56, 72, 63))], cand(candidateM));
  assert.equal(control.notes.length, 1);
  assert.equal(control.confidence, "medium");
});

test("garmentTypeFor reads the product name, never the stored category", () => {
  const cases: [string, GarmentType][] = [
    ["Men's Crew Neck T-Shirt", "tee"],
    ["Strato Tech Tee", "tee"],
    ["Men's Midweight Crew in Natural", "tee"], // a bare "Crew" is a tee
    ["Women's Soft Knitted Fleece T-Shirt", "tee"], // an explicit T-Shirt beats "Fleece"
    ["Men's Turtleneck Long Sleeve T-Shirt", "tee_long_sleeve"],
    ["Mens Organic Cooper Beaver Long Sleeve T-shirt", "tee_long_sleeve"],
    ["Men's AIRism Cotton Polo Shirt", "polo"],
    ["Men's Souffle Yarn Polo Sweater", "other"], // a polo sweater is knitwear
    ["Men's Oxford Slim Fit Shirt", "button_shirt"],
    ["Brushed Flannel Shirt | Birch/Black", "button_shirt"],
    ["Super Non Iron Slim Fit Shirt Long Sleeve | Botton Down", "button_shirt"], // "down" in a shirt is not a down jacket
    ["Men's Ultra Light Down Jacket", "jacket"],
    ["Men's Seamless Down Parka", "jacket"],
    ["Men's MA-1 Blouson", "jacket"],
    ["Men's Washable 3D Knit Crew Neck Sweater", "other"], // "Crew" does not make a sweater a tee
    ["Men's Sweat Oversized Pullover Hoodie", "other"],
    ["Men's Wide Cargo Pants", "other"],
  ];
  for (const [name, expected] of cases) assert.equal(garmentTypeFor(name), expected, name);
});

test("the loader keeps garmentType, treats a missing one as absent, and rejects a typo", () => {
  const dir = mkdtempSync(join(tmpdir(), "fit-"));
  mkdirSync(join(dir, "wardrobes"));
  const sizes = { M: { chest_cm: 55, length_cm: 70, sleeve_cm: null } };
  writeFileSync(join(dir, "wardrobes", "p.json"), JSON.stringify([
    { id: "grey-polo", label: "great", garmentType: "polo", measurements: sizes.M },
    { id: "blue-tee", label: "great", measurements: sizes.M },
  ]));
  const wardrobe = loadWardrobe("p", dir);
  assert.equal(wardrobe[0].garmentType, "polo");
  assert.equal("garmentType" in wardrobe[1], false); // absent, not null or "tee": the engine defaults it

  writeFileSync(join(dir, "candidates.json"), JSON.stringify([{ id: "x", name: "X", sizes, garmentType: "polo" }, { id: "y", sizes }]));
  const [x, y] = loadCandidates(dir);
  assert.equal(x.garmentType, "polo");
  assert.equal("garmentType" in y, false);

  writeFileSync(join(dir, "candidates.json"), JSON.stringify([{ id: "z", sizes, garmentType: "pollo" }]));
  assert.throws(() => loadCandidates(dir), /garmentType must be one of tee, tee_long_sleeve, polo, button_shirt, jacket, other, got "pollo"/);
});
