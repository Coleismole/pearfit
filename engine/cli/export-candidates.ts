// Reads products and size charts from the webscraper SQLite database and writes candidates in the
// engine's Candidate format. Kept outside src/ so the engine itself stays free of I/O.
//
//   node cli/export-candidates.ts [dbPath] [outPath]
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { round } from "../src/score.ts";
import type { Candidate, ReviewSignal } from "../src/types.ts";
import type { BrandOffsetRow, SizeChartRow } from "./db-types.ts";
import { DATA_DIR } from "./load.ts";

const DEFAULT_DB = join(import.meta.dirname, "..", "..", "webscraper", "commercial_fit.db");
// Not data/candidates.json: that file is hand-curated and must not be overwritten by accident.
const DEFAULT_OUT = join(DATA_DIR, "candidates.generated.json");

interface ProductRow {
  sku: string;
  brand: string;
  product_name: string;
  total_reviews: number;
  runs_small_pct: number;
  true_to_size_pct: number;
  runs_large_pct: number;
}

export interface ExportResult {
  candidates: Candidate[];
  skipped: string[]; // SKUs with no size-chart rows
}

export function buildCandidates(db: DatabaseSync): ExportResult {
  const products = db
    .prepare(
      `SELECT sku, brand, product_name, total_reviews, runs_small_pct, true_to_size_pct, runs_large_pct
       FROM commercial_skus ORDER BY sku`,
    )
    .all() as unknown as ProductRow[];
  const chartStmt = db.prepare(
    `SELECT sku, size_code, sort_order, chest_cm, length_cm, sleeve_cm
     FROM size_chart WHERE sku = ? ORDER BY sort_order`,
  );
  const offsetStmt = db.prepare(`SELECT brand, length_cm, sleeve_cm FROM brand_offsets WHERE brand = ?`);

  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  for (const p of products) {
    const chart = chartStmt.all(p.sku) as unknown as SizeChartRow[];
    if (chart.length === 0) {
      skipped.push(p.sku);
      continue;
    }
    // No offset row = convention unconfirmed, so length and sleeve stay null.
    const offset = (offsetStmt.get(p.brand) as unknown as BrandOffsetRow | undefined) ?? {
      brand: p.brand,
      length_cm: null,
      sleeve_cm: null,
    };
    const sizes: Candidate["sizes"] = {};
    for (const row of chart) {
      sizes[row.size_code] = {
        chest_cm: row.chest_cm === null ? null : round(row.chest_cm, 1), // trusted: no offset
        length_cm: applyOffset(row.length_cm, offset.length_cm),
        sleeve_cm: applyOffset(row.sleeve_cm, offset.sleeve_cm),
      };
    }
    candidates.push({ id: slug(p.sku), name: p.product_name, review: reviewSignal(p), sizes });
  }
  return { candidates, skipped };
}

// converted = chart - offset. A positive offset means the brand's chart runs bigger than our canonical ruler.
function applyOffset(chartCm: number | null, offsetCm: number | null): number | null {
  if (chartCm === null || offsetCm === null) return null;
  return round(chartCm - offsetCm, 1);
}

// The most common review verdict. A tie, or no reviews, gives no signal.
function reviewSignal(p: ProductRow): ReviewSignal {
  if (p.total_reviews === 0) return null;
  const votes: [Exclude<ReviewSignal, null>, number][] = [
    ["runs_small", p.runs_small_pct],
    ["true_to_size", p.true_to_size_pct],
    ["runs_large", p.runs_large_pct],
  ];
  const top = Math.max(...votes.map(([, pct]) => pct));
  const winners = votes.filter(([, pct]) => pct === top);
  return winners.length === 1 ? winners[0][0] : null;
}

function slug(sku: string): string {
  return sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

if (import.meta.main) {
  const dbPath = process.argv[2] ?? DEFAULT_DB;
  const outPath = process.argv[3] ?? DEFAULT_OUT;
  if (!existsSync(dbPath)) {
    console.error(`database not found: ${dbPath}`);
    process.exit(1);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const { candidates, skipped } = buildCandidates(db);
  db.close();
  writeFileSync(outPath, JSON.stringify(candidates, null, 2) + "\n");
  console.log(`wrote ${candidates.length} candidates to ${outPath}`);
  if (skipped.length > 0) console.warn(`skipped (no size chart): ${skipped.join(", ")}`);
}
