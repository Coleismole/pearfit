// Tests for the wardrobe list entries (src/lib/items.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparableEntries, findEntry, ownedEntry, plannedEntry, plannedFrom } from "../src/lib/items.ts";
import type { OwnedShirt, PickerCandidate, PlannedItem, RecommendResponse } from "../src/lib/types.ts";

const blueTee: OwnedShirt = {
  id: "blue-tee", label: "great", garmentType: "tee", size: "M", brand: "UNIQLO",
  measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: null },
};
const oldTee: OwnedShirt = { id: "old-tee", label: "loose", measurements: { chest_cm: 58, length_cm: 70, sleeve_cm: 22.5 } }; // no type: a tee
const greyPolo: OwnedShirt = { id: "grey-polo", label: "tight", garmentType: "polo", measurements: { chest_cm: 51, length_cm: 68, sleeve_cm: null } };

const sized: RecommendResponse = {
  size: "M", confidence: "high", matchPercent: 67.6, fitsLike: "blue-tee",
  verdict: "Get the M, fits like your blue tee.", notes: [], garmentType: "tee",
};
const notSized: RecommendResponse = {
  size: null, confidence: "low", matchPercent: null, fitsLike: null,
  verdict: "No shirts labelled great in this wardrobe, so there is nothing to compare against.", notes: [], garmentType: "tee",
};
const plannedTee: PlannedItem = {
  candidateId: "e100-000", name: "Test tee", garmentType: "tee", result: sized,
  measurements: { chest_cm: 56, length_cm: 72, sleeve_cm: null }, savedAt: "2026-11-10T00:00:00.000Z",
};
const plannedNoSize: PlannedItem = { ...plannedTee, candidateId: "e300-000", name: "Unsized tee", result: notSized, measurements: null };

test("an owned shirt is listed by its id as words, with its type, size, brand and fit", () => {
  assert.deepEqual(ownedEntry(blueTee), {
    ref: "owned:blue-tee",
    kind: "owned",
    key: "blue-tee",
    title: "Blue tee",
    detail: "Tee · Size M · UNIQLO",
    badge: "Great fit",
    status: "You own · Great fit",
    garmentType: "tee",
    measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: null },
  });
  const plain = ownedEntry(oldTee);
  assert.equal(plain.detail, "Tee"); // no size, no brand, and a missing garmentType reads as a tee
  assert.equal(plain.badge, "Loose");
});

test("a planned shirt shows the API's match for the suggested size, rounded", () => {
  const entry = plannedEntry(plannedTee);
  assert.equal(entry.ref, "planned:e100-000");
  assert.equal(entry.title, "Test tee");
  assert.equal(entry.detail, "Tee · Suggested size M");
  assert.equal(entry.badge, "68% match"); // 67.6 rounded
  assert.deepEqual(entry.measurements, { chest_cm: 56, length_cm: 72, sleeve_cm: null });
});

test("a planned shirt with no suggested size has no percentage and no measurements", () => {
  const entry = plannedEntry(plannedNoSize);
  assert.equal(entry.detail, "Tee · No size yet");
  assert.equal(entry.badge, "No size yet");
  assert.equal(entry.measurements, null);
});

test("findEntry resolves a link reference, and gives null for something that is gone", () => {
  const wardrobe = [blueTee, greyPolo];
  const planned = [plannedTee];
  assert.equal(findEntry("owned:grey-polo", wardrobe, planned)?.title, "Grey polo");
  assert.equal(findEntry("planned:e100-000", wardrobe, planned)?.title, "Test tee");
  assert.equal(findEntry("owned:removed", wardrobe, planned), null);
  assert.equal(findEntry("planned:removed", wardrobe, planned), null);
  assert.equal(findEntry("nonsense", wardrobe, planned), null);
});

test("comparableEntries lists the other shirts of the same type that have measurements, owned first", () => {
  const wardrobe = [blueTee, greyPolo, oldTee];
  const planned = [plannedNoSize, plannedTee];
  const refs = comparableEntries(ownedEntry(blueTee), wardrobe, planned).map((e) => e.ref);
  // not itself, not the polo, not the planned shirt without a size
  assert.deepEqual(refs, ["owned:old-tee", "planned:e100-000"]);
  assert.deepEqual(comparableEntries(ownedEntry(greyPolo), wardrobe, planned), []);
});

// ---- what is saved under "Planning to buy" ----

const catalogTee: PickerCandidate = {
  id: "e100-000", name: "Test tee", garmentType: "tee",
  sizes: { S: { chest_cm: 53, length_cm: 70, sleeve_cm: null }, M: { chest_cm: 56, length_cm: 72, sleeve_cm: null } },
};
const now = new Date("2026-11-11T12:00:00.000Z");

test("plannedFrom keeps the answer and copies the chart row of the suggested size", () => {
  const item = plannedFrom({ candidateId: "e100-000", name: "Test tee", result: sized, candidate: catalogTee, previous: undefined, now });
  assert.deepEqual(item, {
    candidateId: "e100-000",
    name: "Test tee",
    garmentType: "tee",
    result: sized,
    measurements: { chest_cm: 56, length_cm: 72, sleeve_cm: null }, // the M row, with its null kept
    savedAt: "2026-11-11T12:00:00.000Z",
  });
});

test("plannedFrom saves no measurements when there is no suggested size, or the size is not in the chart", () => {
  assert.equal(plannedFrom({ candidateId: "e100-000", name: "Test tee", result: notSized, candidate: catalogTee, previous: plannedTee, now }).measurements, null);
  const xl = { ...sized, size: "XL" };
  assert.equal(plannedFrom({ candidateId: "e100-000", name: "Test tee", result: xl, candidate: catalogTee, previous: undefined, now }).measurements, null);
});

test("plannedFrom without the catalog keeps the saved row only when it is for the same size", () => {
  const same = plannedFrom({ candidateId: "e100-000", name: "Test tee", result: sized, candidate: undefined, previous: plannedTee, now });
  assert.deepEqual(same.measurements, plannedTee.measurements);
  const other = plannedFrom({ candidateId: "e100-000", name: "Test tee", result: { ...sized, size: "S" }, candidate: undefined, previous: plannedTee, now });
  assert.equal(other.measurements, null); // the saved row was size M: not reused for S
});
