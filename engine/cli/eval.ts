// Usage: npm run eval
// Scores every case in data/cases.json against what the person said is right.
// Cases marked "holdout": true are reported separately: tune weights on the rest, then check holdout once.
import { recommend } from "../src/recommend.ts";
import type { EvalCase } from "../src/types.ts";
import { loadCandidates, loadCases, loadWardrobe } from "./load.ts";

interface Tally { sizeExact: number; sizeNear: number; sizeTotal: number; top1: number; top3: number; shirtTotal: number }
const empty = (): Tally => ({ sizeExact: 0, sizeNear: 0, sizeTotal: 0, top1: 0, top3: 0, shirtTotal: 0 });

try {
  const candidates = new Map(loadCandidates().map((c) => [c.id, c]));
  const cases = loadCases();
  const tuning = empty();
  const holdout = empty();

  console.log("owner      candidate              size (want/got)   closest shirt (want -> rank)   conf");
  for (const k of cases) {
    const c = candidates.get(k.candidate);
    if (!c) throw new Error(`cases.json: unknown candidate "${k.candidate}"`);
    const r = recommend(loadWardrobe(k.owner), c);
    const t = k.holdout ? holdout : tuning;
    const order = Object.keys(c.sizes);

    let sizeCol = "-";
    if (k.correctSize) {
      if (!order.includes(k.correctSize)) throw new Error(`cases.json: ${c.id} has no size "${k.correctSize}"`);
      t.sizeTotal++;
      const off = r.size ? Math.abs(order.indexOf(r.size) - order.indexOf(k.correctSize)) : Infinity;
      if (off === 0) t.sizeExact++;
      if (off <= 1) t.sizeNear++;
      sizeCol = `${k.correctSize}/${r.size ?? "none"} ${off === 0 ? "ok" : "MISS"}`;
    }

    let shirtCol = "-";
    if (k.closestShirt) {
      t.shirtTotal++;
      const rank = r.ranking.findIndex((m) => m.shirtId === k.closestShirt) + 1;
      if (rank === 1) t.top1++;
      if (rank >= 1 && rank <= 3) t.top3++;
      shirtCol = `${k.closestShirt} -> ${rank || "not ranked"}`;
    }

    const tag = k.holdout ? " [holdout]" : "";
    console.log(`${k.owner.padEnd(10)} ${c.id.padEnd(22)} ${sizeCol.padEnd(17)} ${shirtCol.padEnd(30)} ${r.confidence}${tag}`);
    if (sizeCol.endsWith("MISS")) printMiss(k, r.sizes);
  }

  report("Tuning", tuning);
  if (holdout.sizeTotal + holdout.shirtTotal > 0) report("Holdout", holdout);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

function printMiss(k: EvalCase, sizes: ReturnType<typeof recommend>["sizes"]): void {
  for (const s of sizes) {
    const m = s.matches[0];
    if (!m) continue;
    const ease = Object.entries(m.ease).map(([d, v]) => `${d.replace("_cm", "")} ${v! >= 0 ? "+" : ""}${v!.toFixed(1)}`).join(", ");
    const mark = s.size === k.correctSize ? " <- correct" : "";
    console.log(`             ${s.size.padEnd(4)} dist ${m.distance.toFixed(2)} vs ${m.shirtId} (${ease})${mark}`);
  }
}

function report(name: string, t: Tally): void {
  const pct = (a: number, b: number) => (b ? ` (${Math.round((100 * a) / b)}%)` : "");
  console.log(`\n${name}:`);
  console.log(`  size exact:        ${t.sizeExact}/${t.sizeTotal}${pct(t.sizeExact, t.sizeTotal)}`);
  console.log(`  size within one:   ${t.sizeNear}/${t.sizeTotal}${pct(t.sizeNear, t.sizeTotal)}`);
  console.log(`  closest shirt #1:  ${t.top1}/${t.shirtTotal}${pct(t.top1, t.shirtTotal)}`);
  console.log(`  closest in top 3:  ${t.top3}/${t.shirtTotal}${pct(t.top3, t.shirtTotal)}`);
}
