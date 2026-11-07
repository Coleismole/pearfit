import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArgs } from "../cli/args.ts";
import { loadCandidates, loadCases } from "../cli/load.ts";

const chart = { M: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } };

test("parseCliArgs splits positionals from --candidates and --cases", () => {
  assert.deepEqual(parseCliArgs(["dima", "cos-oxford"]), { positionals: ["dima", "cos-oxford"] });
  assert.deepEqual(parseCliArgs(["--candidates", "data/candidates.generated.json", "dima"]), {
    positionals: ["dima"],
    candidatesPath: "data/candidates.generated.json",
  });
  assert.deepEqual(parseCliArgs(["--cases=data/uniqlo-cases.json"]), {
    positionals: [],
    casesPath: "data/uniqlo-cases.json",
  });
});

test("parseCliArgs rejects unknown flags and a flag with no value", () => {
  assert.throws(() => parseCliArgs(["--candidate", "x.json"]), /Unknown option/);
  assert.throws(() => parseCliArgs(["--candidates"]), /argument missing/i);
});

test("loadCandidates reads the given file instead of data/candidates.json, and never writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "fit-"));
  mkdirSync(join(dir, "wardrobes"));
  const curated = JSON.stringify([{ id: "curated", name: "Curated", review: null, sizes: chart }]);
  const generated = join(dir, "candidates.generated.json");
  writeFileSync(join(dir, "candidates.json"), curated);
  writeFileSync(generated, JSON.stringify([{ id: "scraped", name: "Scraped", review: "runs_small", sizes: chart }]));

  assert.deepEqual(loadCandidates(dir).map((c) => c.id), ["curated"]);
  const fromFile = loadCandidates(dir, generated);
  assert.deepEqual(fromFile.map((c) => c.id), ["scraped"]);
  assert.equal(fromFile[0].review, "runs_small");
  assert.equal(readFileSync(join(dir, "candidates.json"), "utf8"), curated); // curated file untouched
});

test("loadCandidates validates a custom file the same way", () => {
  const dir = mkdtempSync(join(tmpdir(), "fit-"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify([{ id: "x", review: "huge", sizes: chart }]));
  assert.throws(() => loadCandidates(dir, bad), /review must be/);
});

test("loadCases reads the given file", () => {
  const dir = mkdtempSync(join(tmpdir(), "fit-"));
  const file = join(dir, "my-cases.json");
  writeFileSync(file, JSON.stringify([{ owner: "a", candidate: "b", correctSize: "M" }]));
  assert.deepEqual(loadCases(dir, file), [{ owner: "a", candidate: "b", correctSize: "M" }]);
});

test("a missing custom file names the path in the error", () => {
  assert.throws(() => loadCandidates(tmpdir(), join(tmpdir(), "nope-does-not-exist.json")), /nope-does-not-exist\.json/);
});
