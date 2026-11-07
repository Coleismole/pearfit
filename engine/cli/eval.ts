// Usage: npm run eval -- [--candidates <path>] [--cases <path>]
// Scores every case in the cases file against what the person said is right, and explains each size miss:
// which dimension drove the wrong pick and by how much. Defaults: data/candidates.json, data/cases.json.
// Cases marked "holdout": true are reported separately: tune weights on the rest, then check holdout once.
import { resolve } from "node:path";
import { parseCliArgs } from "./args.ts";
import { evaluate, formatEval } from "./eval-report.ts";
import { DATA_DIR, loadCandidates, loadCases, loadWardrobe } from "./load.ts";

try {
  const opts = parseCliArgs(process.argv.slice(2));
  const candidates = loadCandidates(DATA_DIR, opts.candidatesPath);
  const cases = loadCases(DATA_DIR, opts.casesPath);
  const candidatesFile = opts.candidatesPath ? resolve(opts.candidatesPath) : "data/candidates.json";
  const casesFile = opts.casesPath ? resolve(opts.casesPath) : "data/cases.json";
  console.log(`candidates: ${candidatesFile} (${candidates.length})   cases: ${casesFile} (${cases.length})\n`);
  console.log(formatEval(evaluate({ cases, candidates, wardrobeFor: (owner) => loadWardrobe(owner) })).join("\n"));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
