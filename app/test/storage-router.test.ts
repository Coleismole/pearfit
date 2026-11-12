// Tests for saving on the device (src/lib/storage.ts) and for the hash router (src/lib/router.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { link, parseHash } from "../src/lib/router.ts";
import {
  STORAGE_KEYS, loadOnboarded, loadPlanned, loadWardrobe, saveOnboarded, savePlanned, saveWardrobe,
} from "../src/lib/storage.ts";
import type { KeyValueStore } from "../src/lib/storage.ts";
import type { OwnedShirt, PlannedItem } from "../src/lib/types.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const wardrobe: OwnedShirt[] = [
  { id: "blue-tee", label: "great", garmentType: "tee", size: "M", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: null } },
];
const planned: PlannedItem[] = [
  {
    candidateId: "e100-000",
    name: "Test tee",
    garmentType: "tee",
    result: {
      size: "M", confidence: "high", matchPercent: 67.6, fitsLike: "blue-tee",
      verdict: "Get the M, fits like your blue tee.", notes: [], garmentType: "tee", sizes: [], similar: [],
    },
    measurements: { chest_cm: 56, length_cm: 72, sleeve_cm: null },
    savedAt: "2026-11-10T00:00:00.000Z",
  },
];

// ---- storage ----

test("the wardrobe, the planned list and the onboarding flag survive a save and a load", () => {
  const store = memoryStore();
  assert.deepEqual(loadWardrobe(store), []);
  assert.deepEqual(loadPlanned(store), []);
  assert.equal(loadOnboarded(store), false);

  saveWardrobe(store, wardrobe);
  savePlanned(store, planned);
  saveOnboarded(store, true);
  assert.deepEqual(loadWardrobe(store), wardrobe);
  assert.deepEqual(loadPlanned(store), planned);
  assert.equal(loadOnboarded(store), true);
  // The wardrobe is stored as the plain wardrobe-file array.
  assert.deepEqual(JSON.parse(store.data.get(STORAGE_KEYS.wardrobe)!), wardrobe);
});

test("saved data that is broken or no longer valid is ignored instead of crashing the app", () => {
  assert.deepEqual(loadWardrobe(memoryStore({ [STORAGE_KEYS.wardrobe]: "{not json" })), []);
  assert.deepEqual(loadWardrobe(memoryStore({ [STORAGE_KEYS.wardrobe]: JSON.stringify([{ id: "Bad Id", label: "great", measurements: {} }]) })), []);
  // One good planned item and three bad ones: only the good one is kept.
  const mixed = [planned[0], null, { candidateId: "x" }, { ...planned[0], result: { size: 5 } }];
  assert.deepEqual(loadPlanned(memoryStore({ [STORAGE_KEYS.planned]: JSON.stringify(mixed) })), planned);
  assert.deepEqual(loadPlanned(memoryStore({ [STORAGE_KEYS.planned]: '"text"' })), []);
});

test("a storage that throws, or no storage at all, falls back to empty values", () => {
  const broken: KeyValueStore = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
  };
  for (const store of [broken, null]) {
    assert.deepEqual(loadWardrobe(store), []);
    assert.deepEqual(loadPlanned(store), []);
    assert.equal(loadOnboarded(store), false);
    assert.doesNotThrow(() => { saveWardrobe(store, wardrobe); savePlanned(store, planned); saveOnboarded(store, true); });
  }
});

// ---- router ----

test("parseHash splits the path and the query", () => {
  assert.deepEqual(parseHash(""), { segments: [], query: {} });
  assert.deepEqual(parseHash("#/"), { segments: [], query: {} });
  assert.deepEqual(parseHash("#/wardrobe/planned"), { segments: ["wardrobe", "planned"], query: {} });
  assert.deepEqual(parseHash("#/check/e465187-000/compare?size=M&with=blue-tee"), {
    segments: ["check", "e465187-000", "compare"],
    query: { size: "M", with: "blue-tee" },
  });
});

test("link builds a hash that parseHash reads back, including odd characters", () => {
  assert.equal(link(), "#/");
  assert.equal(link("check", "e465187-000"), "#/check/e465187-000");
  assert.equal(link("check", "x", { size: undefined }), "#/check/x"); // an undefined value is left out
  const built = link("check", "a b/c", "compare", { size: "32/32", with: "blue-tee" }); // a size code can hold a slash
  assert.equal(built, "#/check/a%20b%2Fc/compare?size=32%2F32&with=blue-tee");
  assert.deepEqual(parseHash(built), { segments: ["check", "a b/c", "compare"], query: { size: "32/32", with: "blue-tee" } });
});

test("a broken percent sign in the address does not throw", () => {
  assert.deepEqual(parseHash("#/owned/50%"), { segments: ["owned", "50%"], query: {} });
});
