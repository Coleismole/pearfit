// Eval logic and report formatting, split from eval.ts so it can be unit tested. No file access here:
// the caller passes in already-loaded cases, candidates and a wardrobe lookup.
import type { MissAnalysis, MissCause } from "../src/analyze.ts";
import { analyzeMiss } from "../src/analyze.ts";
import type { ScorerConfig } from "../src/config.ts";
import { TOPS } from "../src/config.ts";
import { recommend } from "../src/recommend.ts";
import { round } from "../src/score.ts";
import type { Candidate, Dim, EvalCase, OwnedShirt, Recommendation } from "../src/types.ts";

export interface Tally {
  sizeExact: number;
  sizeNear: number;
  sizeTotal: number;
  top1: number;
  top3: number;
  shirtTotal: number;
}
const emptyTally = (): Tally => ({ sizeExact: 0, sizeNear: 0, sizeTotal: 0, top1: 0, top3: 0, shirtTotal: 0 });

export interface EvalRow {
  case: EvalCase;
  candidate: Candidate;
  rec: Recommendation;
  sizesOff: number | null; // null when the case has no correctSize; Infinity when nothing was recommended
  rank: number | null; // rank of closestShirt in the ranking, 0 = not ranked; null when the case has no closestShirt
  analysis: MissAnalysis | null; // null when the size was right or the case has no correctSize
}

export interface MissSummary {
  total: number;
  byCause: Partial<Record<MissCause, number>>;
  byDriver: Partial<Record<Dim, number>>;
  byDirection: Partial<Record<"too_small" | "too_large", number>>;
  meanMargin: number | null; // average margin (cm) over misses caused by measurements
}

export interface EvalSummary {
  rows: EvalRow[];
  skipped: EvalCase[]; // cases whose candidate is not in the candidates file
  tuning: Tally;
  holdout: Tally;
  missSummary: MissSummary; // tuning cases only, so holdout results never steer tuning
}

export interface EvalInput {
  cases: EvalCase[];
  candidates: Candidate[];
  wardrobeFor: (owner: string) => OwnedShirt[];
  cfg?: ScorerConfig;
}

export function evaluate({ cases, candidates, wardrobeFor, cfg = TOPS }: EvalInput): EvalSummary {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const rows: EvalRow[] = [];
  const skipped: EvalCase[] = [];
  const tuning = emptyTally();
  const holdout = emptyTally();

  for (const k of cases) {
    const c = byId.get(k.candidate);
    if (!c) {
      skipped.push(k);
      continue;
    }
    const rec = recommend(wardrobeFor(k.owner), c, cfg);
    const t = k.holdout ? holdout : tuning;
    const order = Object.keys(c.sizes);

    let sizesOff: number | null = null;
    let analysis: MissAnalysis | null = null;
    if (k.correctSize) {
      if (!order.includes(k.correctSize)) throw new Error(`cases: ${c.id} has no size "${k.correctSize}"`);
      t.sizeTotal++;
      sizesOff = rec.size ? Math.abs(order.indexOf(rec.size) - order.indexOf(k.correctSize)) : Infinity;
      if (sizesOff === 0) t.sizeExact++;
      if (sizesOff <= 1) t.sizeNear++;
      analysis = analyzeMiss(rec, k.correctSize, cfg);
    }

    let rank: number | null = null;
    if (k.closestShirt) {
      t.shirtTotal++;
      rank = rec.ranking.findIndex((x) => x.shirtId === k.closestShirt) + 1;
      if (rank === 1) t.top1++;
      if (rank >= 1 && rank <= 3) t.top3++;
    }
    rows.push({ case: k, candidate: c, rec, sizesOff, rank, analysis });
  }

  const tuningMisses = rows.filter((r) => !r.case.holdout && r.analysis !== null).map((r) => r.analysis!);
  return { rows, skipped, tuning, holdout, missSummary: summarizeMisses(tuningMisses) };
}

function summarizeMisses(misses: MissAnalysis[]): MissSummary {
  const byCause: MissSummary["byCause"] = {};
  const byDriver: MissSummary["byDriver"] = {};
  const byDirection: MissSummary["byDirection"] = {};
  const margins: number[] = [];
  for (const a of misses) {
    byCause[a.cause] = (byCause[a.cause] ?? 0) + 1;
    if (a.driver) byDriver[a.driver] = (byDriver[a.driver] ?? 0) + 1;
    if (a.direction) byDirection[a.direction] = (byDirection[a.direction] ?? 0) + 1;
    if (a.cause === "measurements" && a.margin !== null) margins.push(a.margin);
  }
  const meanMargin = margins.length ? round(margins.reduce((a, b) => a + b, 0) / margins.length, 2) : null;
  return { total: misses.length, byCause, byDriver, byDirection, meanMargin };
}

export function formatEval(s: EvalSummary): string[] {
  const out: string[] = [];
  out.push("owner      candidate              size (want/got)   closest shirt (want -> rank)   conf");
  for (const row of s.rows) {
    const { case: k, candidate: c, rec } = row;
    const sizeCol = k.correctSize ? `${k.correctSize}/${rec.size ?? "none"} ${row.sizesOff === 0 ? "ok" : "MISS"}` : "-";
    const shirtCol = k.closestShirt ? `${k.closestShirt} -> ${row.rank || "not ranked"}` : "-";
    const tag = k.holdout ? " [holdout]" : "";
    out.push(`${k.owner.padEnd(10)} ${c.id.padEnd(22)} ${sizeCol.padEnd(17)} ${shirtCol.padEnd(30)} ${rec.confidence}${tag}`);
    if (row.analysis) out.push(...formatMiss(row.analysis, rec));
  }

  if (s.skipped.length > 0) {
    const names = s.skipped.map((k) => `${k.owner}/${k.candidate}`).join(", ");
    out.push("", `Skipped ${s.skipped.length} case(s) whose candidate is not in the candidates file: ${names}`);
  }

  out.push(...formatTally("Tuning", s.tuning));
  out.push(...formatMissSummary(s.missSummary));
  if (s.holdout.sizeTotal + s.holdout.shirtTotal > 0) out.push(...formatTally("Holdout", s.holdout));
  return out;
}

const IND = "    ";

function formatMiss(a: MissAnalysis, rec: Recommendation): string[] {
  const plural = a.sizesOff === 1 ? "size" : "sizes";
  const direction = a.direction === "too_small" ? "too small" : "too large";
  const head = a.chosenSize === null
    ? `${IND}MISS: wanted ${a.correctSize}, got none`
    : `${IND}MISS: wanted ${a.correctSize}, got ${a.chosenSize} (${a.sizesOff} ${plural} ${direction})`;
  const out = [head, `${IND}why: ${explain(a)}`];

  if (a.gaps.length > 0) {
    const g = (n: number | null, d: number) => (n === null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}`);
    out.push(
      IND + "dim".padEnd(8) + `${a.chosenSize} ease`.padStart(8) + `${a.correctSize} ease`.padStart(8) +
        `${a.chosenSize} share`.padStart(9) + `${a.correctSize} share`.padStart(9) + "swing".padStart(8),
    );
    for (const gap of a.gaps) {
      out.push(
        IND + gap.dim.replace("_cm", "").padEnd(8) + g(gap.chosenEase, 1).padStart(8) + g(gap.correctEase, 1).padStart(8) +
          gap.chosenShare.toFixed(2).padStart(9) + gap.correctShare.toFixed(2).padStart(9) + g(gap.swing, 2).padStart(8) +
          (gap.dim === a.driver ? "  <- driver" : ""),
      );
    }
  }

  // Every size's best match, as before: shows whether a third size was also close.
  for (const sz of rec.sizes) {
    const best = sz.matches[0];
    if (!best) continue;
    const ease = Object.entries(best.ease).map(([d, v]) => `${d.replace("_cm", "")} ${v! >= 0 ? "+" : ""}${v!.toFixed(1)}`).join(", ");
    out.push(`${IND}${sz.size.padEnd(4)} dist ${best.distance.toFixed(2)} vs ${best.shirtId} (${ease})${sz.size === a.correctSize ? " <- correct" : ""}`);
  }
  return out;
}

function explain(a: MissAnalysis): string {
  switch (a.cause) {
    case "no_pick":
      return "no recommendation (no great shirts, or no overlapping measurements)";
    case "correct_unscorable":
      return `${a.correctSize} shares no measurement with any great shirt, so it could never be picked`;
    case "measurements":
      return `measurements. ${a.chosenSize} is ${a.margin!.toFixed(2)}cm closer than ${a.correctSize} ` +
        `(${a.chosenSize} ${a.chosenDistance!.toFixed(2)} vs ${a.chosenShirtId}, ${a.correctSize} ${a.correctDistance!.toFixed(2)} vs ${a.correctShirtId})`;
    case "tie_break":
      return a.margin === 0
        ? `tie-break. Measurements were tied, and ${a.chosenSize} won on review signal or size order`
        : `tie-break. Measurements preferred ${a.correctSize} by ${Math.abs(a.margin!).toFixed(2)}cm, ` +
          `but ${a.chosenSize} won a near-tie (review signal or size order)`;
  }
}

function formatMissSummary(m: MissSummary): string[] {
  if (m.total === 0) return ["", "No size misses in tuning cases."];
  const block = (title: string, counts: Record<string, number | undefined>) => {
    const entries = Object.entries(counts).filter(([, n]) => n);
    return entries.length === 0 ? [] : [`  ${title}`, ...entries.map(([k, n]) => `    ${k}: ${n}`)];
  };
  return [
    "",
    `Miss analysis (tuning cases, ${m.total} size miss${m.total === 1 ? "" : "es"}):`,
    ...block("cause", m.byCause),
    ...block("driver (dimension with the largest swing toward the wrong size)", m.byDriver),
    ...block("direction of the wrong pick", m.byDirection),
    ...(m.meanMargin === null ? [] : [`  mean margin on measurement misses: ${m.meanMargin.toFixed(2)}cm`]),
  ];
}

function formatTally(name: string, t: Tally): string[] {
  const pct = (a: number, b: number) => (b ? ` (${Math.round((100 * a) / b)}%)` : "");
  return [
    "",
    `${name}:`,
    `  size exact:        ${t.sizeExact}/${t.sizeTotal}${pct(t.sizeExact, t.sizeTotal)}`,
    `  size within one:   ${t.sizeNear}/${t.sizeTotal}${pct(t.sizeNear, t.sizeTotal)}`,
    `  closest shirt #1:  ${t.top1}/${t.shirtTotal}${pct(t.top1, t.shirtTotal)}`,
    `  closest in top 3:  ${t.top3}/${t.shirtTotal}${pct(t.top3, t.shirtTotal)}`,
  ];
}
