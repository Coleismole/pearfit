// Runs the real recommend and eval scripts as child processes against temp files.
// Owner "sample" is data/wardrobes/sample.json: blue-uniqlo-oxford is great at chest 54, length 72, sleeve 63.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENGINE = join(import.meta.dirname, "..");
const CURATED = join(ENGINE, "data", "candidates.json");

function run(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [join(ENGINE, "cli", script), ...args], { cwd: ENGINE, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function scrapedFixture() {
  const dir = mkdtempSync(join(tmpdir(), "fit-cli-"));
  const candidates = join(dir, "candidates.generated.json");
  const cases = join(dir, "cases.json");
  // Engine picks M (ease +0.5 chest); the case says L is right, so this is a measurement miss driven by chest.
  writeFileSync(candidates, JSON.stringify([{
    id: "uniqlo-oxford", name: "Uniqlo oxford", review: null,
    sizes: {
      S: { chest_cm: 51, length_cm: 70, sleeve_cm: 62 },
      M: { chest_cm: 54.5, length_cm: 72, sleeve_cm: 63 },
      L: { chest_cm: 57, length_cm: 74, sleeve_cm: 64 },
    },
  }]));
  writeFileSync(cases, JSON.stringify([{ owner: "sample", candidate: "uniqlo-oxford", correctSize: "L" }]));
  return { candidates, cases };
}

test("eval --candidates --cases runs scraped candidates and explains the miss, leaving candidates.json alone", () => {
  const before = readFileSync(CURATED, "utf8");
  const { candidates, cases } = scrapedFixture();

  const r = run("eval.ts", ["--candidates", candidates, "--cases", cases]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /uniqlo-oxford/);
  assert.match(r.out, /MISS: wanted L, got M \(1 size too small\)/);
  assert.match(r.out, /chest\s+\+0\.5\s+\+3\.0\s+0\.29\s+1\.76\s+\+1\.47\s+<- driver/);
  assert.match(r.out, /size exact:\s+0\/1 \(0%\)/);
  assert.match(r.out, /chest_cm: 1/);
  assert.equal(readFileSync(CURATED, "utf8"), before);
});

test("eval prints which candidates file it used", () => {
  const { candidates, cases } = scrapedFixture();
  assert.match(run("eval.ts", ["--candidates", candidates, "--cases", cases]).out, /candidates: .*candidates\.generated\.json/);
});

test("recommend --candidates reads the given file", () => {
  const { candidates } = scrapedFixture();
  const r = run("recommend.ts", ["sample", "--candidates", candidates]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Candidate: Uniqlo oxford \(uniqlo-oxford\)/);
  assert.match(r.out, /Recommended: M/);
});

test("recommend still defaults to data/candidates.json", () => {
  const r = run("recommend.ts", ["sample", "cos-oxford"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Candidate: COS oxford/);
});

test("an unknown flag or missing file exits non-zero with a message", () => {
  const bad = run("eval.ts", ["--candidate", "x.json"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Unknown option/);
  const missing = run("eval.ts", ["--candidates", "/nonexistent/c.json"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /nonexistent/);
});
