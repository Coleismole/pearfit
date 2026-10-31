// Leave-one-out separation test on real wardrobes (no hand-authored candidates needed).
// Hypothesis: a shirt's weighted-distance to its owner's nearest GREAT shirt is
// smaller for great shirts than for tight/loose shirts. Also sweeps weights.
// Usage: node cli/loo.ts
import { loadWardrobe } from "./load.ts";
import { easeVector, distance } from "../src/score.ts";
import type { Dim } from "../src/types.ts";

const owners = ["person1", "person2", "person3"];

function nearestGreatDist(x: any, greats: any[], w: Record<Dim, number>): number | null {
  let best: number | null = null;
  for (const g of greats) {
    if (g.id === x.id) continue;
    const d = distance(easeVector(x.measurements, g.measurements), w);
    if (d === null) continue;
    if (best === null || d < best) best = d;
  }
  return best;
}

function evalWeights(w: Record<Dim, number>, verbose = false) {
  let pairs = 0, correct = 0, greatSum = 0, greatN = 0, badSum = 0, badN = 0;
  for (const owner of owners) {
    const wd = loadWardrobe(owner);
    const greats = wd.filter((s) => s.label === "great");
    const perShirt = wd.map((s) => ({ id: s.id, label: s.label, d: nearestGreatDist(s, greats, w) }));
    const g = perShirt.filter((p) => p.label === "great" && p.d !== null);
    const b = perShirt.filter((p) => p.label !== "great" && p.d !== null);
    for (const gg of g) { greatSum += gg.d!; greatN++; }
    for (const bb of b) { badSum += bb.d!; badN++; }
    for (const gg of g) for (const bb of b) { pairs++; if (gg.d! < bb.d!) correct++; else if (gg.d! === bb.d!) correct += 0.5; }
    if (verbose) {
      console.log(`\n  ${owner}:`);
      for (const p of [...perShirt].sort((a, b) => (a.d ?? 9) - (b.d ?? 9)))
        console.log(`    ${(p.d === null ? " n/a" : p.d.toFixed(2)).padStart(6)}  ${p.label.padEnd(5)} ${p.id}`);
    }
  }
  return { auc: pairs ? correct / pairs : 0, pairs, greatMean: greatSum / greatN, badMean: badSum / badN, margin: badSum / badN - greatSum / greatN };
}

console.log("=== BASELINE weights chest 1.0 / length 0.4 / sleeve 0.3 ===");
const base = evalWeights({ chest_cm: 1.0, length_cm: 0.4, sleeve_cm: 0.3 }, true);
console.log(`\n  separation AUC: ${(base.auc * 100).toFixed(0)}% over ${base.pairs} great-vs-bad pairs`);
console.log(`  mean dist  great ${base.greatMean.toFixed(2)}  bad ${base.badMean.toFixed(2)}  margin ${base.margin.toFixed(2)}`);

console.log("\n=== WEIGHT SWEEP (chest fixed 1.0; only ratios matter) ===");
let bestAuc = -1, bestMargin = -1, bestW: any = null;
const results: any[] = [];
for (let L = 0; L <= 2.01; L += 0.1)
  for (let S = 0; S <= 1.51; S += 0.1) {
    const w = { chest_cm: 1.0, length_cm: +L.toFixed(1), sleeve_cm: +S.toFixed(1) };
    const r = evalWeights(w);
    results.push({ w, ...r });
    if (r.auc > bestAuc || (r.auc === bestAuc && r.margin > bestMargin)) { bestAuc = r.auc; bestMargin = r.margin; bestW = w; }
  }
results.sort((a, b) => b.auc - a.auc || b.margin - a.margin);
console.log("top 8 by AUC then margin:");
console.log("  chest  len  slv   AUC   margin  greatMean badMean");
for (const r of results.slice(0, 8))
  console.log(`   1.0   ${r.w.length_cm.toFixed(1)}  ${r.w.sleeve_cm.toFixed(1)}   ${(r.auc * 100).toFixed(0)}%   ${r.margin.toFixed(2)}    ${r.greatMean.toFixed(2)}      ${r.badMean.toFixed(2)}`);
console.log(`\nBEST: chest 1.0 / length ${bestW.length_cm} / sleeve ${bestW.sleeve_cm}  (AUC ${(bestAuc * 100).toFixed(0)}%, margin ${bestMargin.toFixed(2)})`);
console.log("\n=== BEST weights, per-shirt detail ===");
evalWeights(bestW, true);
