// Tests for the catalog search (src/lib/search.ts), the compare rows (src/lib/compare.ts) and the display
// formatting (src/lib/format.ts). Expected values are worked out by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { biggestDifference, compareRows, diffText } from "../src/lib/compare.ts";
import { formatCm, formatPercent, sizeRange } from "../src/lib/format.ts";
import { looksLikeLink, searchCandidates } from "../src/lib/search.ts";
import type { Measurements, PickerCandidate } from "../src/lib/types.ts";

const m = (chest: number | null, length: number | null, sleeve: number | null): Measurements => ({
  chest_cm: chest, length_cm: length, sleeve_cm: sleeve,
});
const candidate = (id: string, name: string): PickerCandidate => ({ id, name, garmentType: "tee", sizes: { M: m(53, null, null) } });

// Real names and SKUs from the scraper sample. Two products share a name, so the id has to be searchable too.
const catalog = [
  candidate("e465187-000", "Men's Dry Colour T-Shirt"),
  candidate("e483970-000", "Men's DRY-EX T-Shirt"),
  candidate("e482299-000", "Men's DRY-EX T-Shirt"),
  candidate("e482523-000", "Men's AIRism Cotton Crew Neck T-Shirt Short Sleeve"),
  candidate("muji-tee", "Muji crew tee"),
];
const ids = (query: string) => searchCandidates(catalog, query).map((c) => c.id);

// ---- search ----

test("an empty query returns the whole catalog in its original order", () => {
  assert.deepEqual(ids(""), ["e465187-000", "e483970-000", "e482299-000", "e482523-000", "muji-tee"]);
  assert.deepEqual(ids("   "), ids(""));
});

test("words match the name in any order and any case, ignoring apostrophes", () => {
  assert.deepEqual(ids("dry"), ["e465187-000", "e483970-000", "e482299-000"]);
  assert.deepEqual(ids("crew AIRISM"), ["e482523-000"]); // "Muji crew tee" has crew but not airism
  assert.deepEqual(ids("mens"), ["e465187-000", "e483970-000", "e482299-000", "e482523-000"]);
  assert.deepEqual(ids("men's"), ids("mens"));
  assert.deepEqual(ids("hoodie"), []);
});

test("a SKU finds its product with or without the dash", () => {
  assert.deepEqual(ids("E483970-000"), ["e483970-000"]);
  assert.deepEqual(ids("e483970000"), ["e483970-000"]);
  assert.deepEqual(ids("E4822"), ["e482299-000"]); // the start of a SKU is enough
});

test("a product link matches when it holds a known SKU as a whole part", () => {
  const link = "https://www.uniqlo.com/ca/en/products/E465187-000/00?colorDisplayCode=26&sizeDisplayCode=003";
  assert.deepEqual(ids(link), ["e465187-000"]);
  assert.deepEqual(ids("https://shop.example.com/search?q=shirt"), []); // no SKU we know
  assert.deepEqual(ids("https://www.uniqlo.com/ca/en/products/E4651870-000/00"), []); // a longer number is another product
});

test("looksLikeLink only says yes to one unbroken web address", () => {
  assert.equal(looksLikeLink("https://www.uniqlo.com/x"), true);
  assert.equal(looksLikeLink(" www.uniqlo.com/x "), true);
  assert.equal(looksLikeLink("dry ex"), false);
  assert.equal(looksLikeLink("http://a b"), false);
});

// ---- compare rows: b minus a, never a guess for a missing value ----

test("compareRows subtracts per measurement and leaves a missing side as null", () => {
  assert.deepEqual(compareRows(m(54, 72, 63), m(56, 72, null)), [
    { dim: "chest_cm", a: 54, b: 56, diff: 2 },
    { dim: "length_cm", a: 72, b: 72, diff: 0 },
    { dim: "sleeve_cm", a: 63, b: null, diff: null }, // not 0, and not -63
  ]);
});

test("compareRows rounds the difference to 1 decimal", () => {
  // 55.1 - 54 is 1.1000000000000014 in floating point
  assert.equal(compareRows(m(54, null, null), m(55.1, null, null))[0].diff, 1.1);
  assert.equal(compareRows(m(57.5, null, null), m(52.5, null, null))[0].diff, -5);
});

test("diffText writes the sign, the amount and, when asked, the direction", () => {
  const [chest, length, sleeve] = compareRows(m(54, 72, 63), m(56, 70.5, null));
  assert.equal(diffText(chest), "+2 cm");
  assert.equal(diffText(chest, true), "+2 cm looser");
  assert.equal(diffText(length), "−1.5 cm");
  assert.equal(diffText(length, true), "−1.5 cm shorter");
  assert.equal(diffText(sleeve), "Not measured");
  assert.equal(diffText(compareRows(m(54, 72, 63), m(54, 72, 63))[0], true), "Same");
});

test("biggestDifference names the largest gap in cm, with chest first on a tie", () => {
  assert.equal(
    biggestDifference(compareRows(m(54, 72, 63), m(56, 69, 63))), // chest +2, length -3, sleeve 0
    "Biggest difference: length. B is 3 cm shorter than A.",
  );
  assert.equal(
    biggestDifference(compareRows(m(54, 72, 63), m(56, 74, 63))), // chest +2, length +2: chest comes first
    "Biggest difference: chest width. B is 2 cm looser than A.",
  );
  assert.equal(biggestDifference(compareRows(m(54, 72, 63), m(54, 72, 63))), "Every measurement they share is the same.");
  assert.equal(
    biggestDifference(compareRows(m(54, null, null), m(54, 70, null))),
    "Chest width is the same on both. It is the only measurement they share.",
  );
  assert.equal(
    biggestDifference(compareRows(m(54, null, null), m(null, 70, null))),
    "These two have no measurement in common, so there is nothing to compare.",
  );
});

// ---- formatting ----

test("formatCm, formatPercent and sizeRange", () => {
  assert.equal(formatCm(54), "54 cm");
  assert.equal(formatCm(57.5), "57.5 cm");
  assert.equal(formatCm(null), "—");
  assert.equal(formatPercent(67.6), "68%");
  assert.equal(formatPercent(100), "100%");
  assert.equal(formatPercent(null), "—");
  assert.equal(sizeRange(["XS", "S", "M", "L"]), "XS to L");
  assert.equal(sizeRange(["M"]), "M");
  assert.equal(sizeRange([]), "No sizes");
});
