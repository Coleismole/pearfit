// Tests for the wardrobe rules (src/lib/wardrobe.ts) and the unit conversion (src/lib/units.ts).
// Expected values are worked out by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OwnedShirt } from "../src/lib/types.ts";
import { fromCm, parseMeasurementInput, toCm } from "../src/lib/units.ts";
import { displayName, garmentTypeOf, hasAnyMeasurement, makeShirt, parseWardrobe, slugify, toApiWardrobe } from "../src/lib/wardrobe.ts";

// ---- ids ----

test("slugify turns a typed name into a lowercase-with-dashes id", () => {
  assert.equal(slugify("Blue Uniqlo Oxford"), "blue-uniqlo-oxford");
  assert.equal(slugify("  Café  tee (M) "), "cafe-tee-m"); // accent dropped, spaces and brackets become one dash
  assert.equal(slugify("Men's AIRism Cotton T-Shirt"), "mens-airism-cotton-t-shirt"); // apostrophe dropped, not dashed
  assert.equal(slugify("SUPIMA® Cotton"), "supima-cotton");
  assert.equal(slugify("---"), ""); // nothing usable: the form rejects it
  assert.equal(slugify("白"), "");
});

test("displayName writes an id the way the engine's verdict does", () => {
  assert.equal(displayName("blue-uniqlo-oxford"), "blue uniqlo oxford");
});

test("a shirt with no garmentType is a tee", () => {
  assert.equal(garmentTypeOf({}), "tee");
  assert.equal(garmentTypeOf({ garmentType: "polo" }), "polo");
});

// ---- validation: the API's rules (engine/cli/validate.ts) ----

const blueTee = { id: "blue-tee", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } };

test("parseWardrobe keeps nulls, turns a missing measurement into null and keeps garmentType only when given", () => {
  const polo = { id: "grey-polo", label: "tight", garmentType: "polo", measurements: { chest_cm: 55, length_cm: null }, fit_note: "x" };
  assert.deepEqual(parseWardrobe([blueTee, polo]), [
    { id: "blue-tee", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } },
    // length_cm was null and sleeve_cm missing: both are null, nothing is filled in. The unknown field is dropped.
    { id: "grey-polo", label: "tight", garmentType: "polo", measurements: { chest_cm: 55, length_cm: null, sleeve_cm: null } },
  ]);
});

test("parseWardrobe rejects what the API rejects and names the shirt", () => {
  const cases: [unknown, RegExp][] = [
    ["shirts", /must be a JSON array of shirts/],
    [[blueTee, { ...blueTee, id: "Blue Tee" }], /^Shirt 2: id must be lowercase words joined by dashes, got "Blue Tee"\.$/],
    [[blueTee, { ...blueTee }], /^Shirt 2: duplicate id "blue-tee"\.$/],
    [[{ ...blueTee, label: "ok" }], /^Shirt 1 \(blue-tee\): label must be "great", "tight" or "loose", got "ok"\.$/],
    [[{ ...blueTee, measurements: { chest_cm: "54" } }], /^Shirt 1 \(blue-tee\): chest_cm must be a positive number or null, got "54"\.$/],
    [[{ ...blueTee, measurements: { chest_cm: -3 } }], /chest_cm must be a positive number or null, got -3/],
    [[{ ...blueTee, measurements: { chest_cm: 0 } }], /chest_cm must be a positive number or null, got 0/],
    [[{ ...blueTee, measurements: null }], /measurements must be an object/],
    [[{ ...blueTee, garmentType: "pollo" }], /garmentType must be one of tee, tee_long_sleeve, polo, button_shirt, jacket, other, got "pollo"/],
    [[null], /^Shirt 1: must be an object\.$/],
  ];
  for (const [raw, expected] of cases) {
    // assert.throws would test the pattern against "Error: <message>", so the message is checked on its own.
    assert.throws(() => parseWardrobe(raw), (e: unknown) => e instanceof Error && expected.test(e.message), JSON.stringify(raw));
  }
});

test("toApiWardrobe sends id, label, garmentType and measurements, and keeps display details on the device", () => {
  const wardrobe: OwnedShirt[] = [
    { id: "dry-ex-m", label: "great", garmentType: "tee", brand: "UNIQLO", sku: "e483970-000", size: "M",
      measurements: { chest_cm: 53, length_cm: null, sleeve_cm: null } },
    { id: "old-tee", label: "loose", measurements: { chest_cm: 58, length_cm: 70, sleeve_cm: 22.5 } },
  ];
  assert.deepEqual(toApiWardrobe(wardrobe), [
    { id: "dry-ex-m", label: "great", garmentType: "tee", measurements: { chest_cm: 53, length_cm: null, sleeve_cm: null } },
    { id: "old-tee", label: "loose", measurements: { chest_cm: 58, length_cm: 70, sleeve_cm: 22.5 } }, // no garmentType added
  ]);
});

test("makeShirt orders the keys like the wardrobe files and leaves out empty details", () => {
  const shirt = makeShirt({
    measurements: { chest_cm: 53, length_cm: null, sleeve_cm: null }, size: " M ", brand: "  ", label: "great", id: "dry-ex-m", garmentType: "tee",
  });
  assert.equal(
    JSON.stringify(shirt),
    '{"id":"dry-ex-m","label":"great","garmentType":"tee","measurements":{"chest_cm":53,"length_cm":null,"sleeve_cm":null},"size":"M"}',
  );
  // No garmentType given: none is written. The engine reads a missing one as a tee.
  assert.deepEqual(Object.keys(makeShirt({ id: "x", label: "tight", measurements: { chest_cm: 50, length_cm: null, sleeve_cm: null } })), ["id", "label", "measurements"]);
});

test("hasAnyMeasurement is false only when all three are null", () => {
  assert.equal(hasAnyMeasurement({ chest_cm: null, length_cm: null, sleeve_cm: null }), false);
  assert.equal(hasAnyMeasurement({ chest_cm: null, length_cm: 70, sleeve_cm: null }), true);
});

// The team's wardrobe files are the format. Every one of them must load unchanged and go to the API unchanged.
test("the wardrobe files in engine/data/wardrobes load and go to the API unchanged, keys in the same order", (t) => {
  const dir = fileURLToPath(new URL("../../engine/data/wardrobes/", import.meta.url));
  if (!existsSync(dir)) return t.skip("engine/data/wardrobes is not next to app/ in this checkout");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.includes("person1.json"), "person1.json should be there");
  for (const file of files) {
    const original = JSON.parse(readFileSync(dir + file, "utf8"));
    const loaded = parseWardrobe(original);
    assert.deepEqual(loaded, original, file);
    assert.deepEqual(toApiWardrobe(loaded), original, file);
    // deepEqual ignores key order, so compare the text as well: id, label, garmentType, measurements.
    assert.equal(JSON.stringify(loaded), JSON.stringify(original), file);
    assert.equal(JSON.stringify(toApiWardrobe(loaded)), JSON.stringify(original), file);
  }
});

// ---- units: inches are converted at input, x 2.54, rounded to 1 decimal ----

test("toCm converts inches and rounds to 1 decimal", () => {
  assert.equal(toCm(21.5, "in"), 54.6); // 21.5 * 2.54 = 54.61
  assert.equal(toCm(28, "in"), 71.1); // 71.12
  assert.equal(toCm(9, "in"), 22.9); // 22.86
  assert.equal(toCm(57.5, "cm"), 57.5);
  assert.equal(toCm(54.25, "cm"), 54.3); // already cm: only rounded
});

test("fromCm shows inches with 2 decimals, and switching back gives the same centimetres", () => {
  assert.equal(fromCm(54.6, "in"), 21.5); // 54.6 / 2.54 = 21.496...
  assert.equal(fromCm(71.1, "in"), 27.99); // 27.992...
  assert.equal(toCm(27.99, "in"), 71.1); // 71.0946
  assert.equal(fromCm(72, "cm"), 72);
});

test("parseMeasurementInput: empty means not measured, and only a positive number is accepted", () => {
  assert.deepEqual(parseMeasurementInput("", "cm"), { ok: true, cm: null });
  assert.deepEqual(parseMeasurementInput("   ", "in"), { ok: true, cm: null });
  assert.deepEqual(parseMeasurementInput("54", "cm"), { ok: true, cm: 54 });
  assert.deepEqual(parseMeasurementInput(" 54,5 ", "cm"), { ok: true, cm: 54.5 }); // comma as the decimal mark
  assert.deepEqual(parseMeasurementInput("21.5", "in"), { ok: true, cm: 54.6 });
  for (const text of ["abc", "-3", "5e2", "1.2.3", "54cm", "."]) {
    assert.deepEqual(parseMeasurementInput(text, "cm"), { ok: false, error: "Enter a number, or leave it empty." }, text);
  }
  for (const text of ["0", "0.0", "0.04"]) { // 0.04 rounds to 0.0
    assert.deepEqual(parseMeasurementInput(text, "cm"), { ok: false, error: "Enter a number above 0, or leave it empty." }, text);
  }
});
