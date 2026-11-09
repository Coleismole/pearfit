// Usage: npm run recommend -- <owner> [candidateId] [--candidates <path>]
// Omit candidateId to run every candidate. --candidates defaults to data/candidates.json; point it at the
// exporter's data/candidates.generated.json to run scraped data without merging it into the curated file.
import { garmentTypeOf, recommend } from "../src/recommend.ts";
import type { Candidate, OwnedShirt, Recommendation } from "../src/types.ts";
import { parseCliArgs } from "./args.ts";
import { DATA_DIR, listOwners, loadCandidates, loadWardrobe } from "./load.ts";

try {
  const opts = parseCliArgs(process.argv.slice(2));
  const [owner, candidateId] = opts.positionals;
  if (!owner) {
    console.error("Usage: npm run recommend -- <owner> [candidateId] [--candidates <path>]");
    console.error(`Owners found: ${listOwners().join(", ") || "(none in data/wardrobes/)"}`);
    process.exit(1);
  }
  const wardrobe = loadWardrobe(owner);
  const candidates = loadCandidates(DATA_DIR, opts.candidatesPath);
  const selected = candidateId ? candidates.filter((c) => c.id === candidateId) : candidates;
  if (selected.length === 0) {
    console.error(`No candidate "${candidateId}". Available: ${candidates.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  for (const c of selected) print(c, wardrobe, recommend(wardrobe, c));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

function print(c: Candidate, wardrobe: OwnedShirt[], r: Recommendation): void {
  console.log(`\nCandidate: ${c.name} (${c.id})  [type: ${garmentTypeOf(c)}]${c.review ? `  [reviews: ${c.review}]` : ""}`);
  console.log(`Recommended: ${r.size ?? "none"} (${r.confidence} confidence)`);
  console.log(`"${r.verdict}"`);
  for (const n of r.notes) console.log(`  note: ${n}`);

  if (r.size) {
    console.log(`\nYour shirts vs ${c.name} ${r.size}:`);
    r.ranking.forEach((m, i) => {
      const ease = Object.entries(m.ease)
        .map(([d, v]) => `${d.replace("_cm", "")} ${v! >= 0 ? "+" : ""}${v!.toFixed(1)}`)
        .join(", ");
      console.log(`  ${i + 1}. ${m.shirtId.padEnd(28)} ${m.matchPct.toFixed(1).padStart(5)}%   (${ease})`);
    });
    const unscored = wardrobe.filter(
      (s) => s.label === "great" && garmentTypeOf(s) === garmentTypeOf(c) && !r.ranking.some((m) => m.shirtId === s.id),
    );
    for (const s of unscored) console.log(`  -  ${s.id.padEnd(28)}   n/a   (no overlapping measurements)`);
  }

  const spread = r.sizes
    .map((s) => `${s.size} ${s.matches[0] ? `${s.matches[0].matchPct.toFixed(0)}%` : "n/a"}`)
    .join(" | ");
  console.log(`Size spread (best match per size): ${spread}`);
}
