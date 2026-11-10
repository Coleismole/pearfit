// Reads products and size charts from the webscraper data (local SQLite, or the shared Supabase store)
// and writes candidates in the engine's Candidate format. Kept outside src/ so the engine itself stays
// free of I/O and the network.
//
//   node cli/export-candidates.ts [--source sqlite|supabase] [dbPath] [outPath]
//
// dbPath is only read with --source sqlite (the default). --source supabase reads SUPABASE_URL and
// SUPABASE_PUBLISHABLE_KEY (or SUPABASE_SECRET_KEY) from the environment or engine/.env.local.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { buildCandidates, readFromSupabase, readSupabaseEnv } from "./candidate-source.ts";
import type { BrandOffsetRow, ProductRow, SizeChartRow, SourceRows } from "./db-types.ts";
import { DATA_DIR } from "./load.ts";

// The Supabase reading and the candidate building live in candidate-source.ts (shared with the API). Re-exported
// here so existing callers and tests keep importing them from this script.
export { buildCandidates, readFromSupabase, readSupabaseEnv } from "./candidate-source.ts";
export type { ExportResult, SupabaseEnv } from "./candidate-source.ts";

const ENGINE_DIR = join(import.meta.dirname, "..");
const DEFAULT_DB = join(ENGINE_DIR, "..", "webscraper", "commercial_fit.db");
// Not data/candidates.json: that file is hand-curated and must not be overwritten by accident.
const DEFAULT_OUT = join(DATA_DIR, "candidates.generated.json");

export function readFromSqlite(db: DatabaseSync): SourceRows {
  return {
    products: db
      .prepare(
        `SELECT sku, brand, product_name, total_reviews, runs_small_pct, true_to_size_pct, runs_large_pct
         FROM commercial_skus`,
      )
      .all() as unknown as ProductRow[],
    charts: db
      .prepare(`SELECT sku, size_code, sort_order, chest_cm, length_cm, sleeve_cm FROM size_chart`)
      .all() as unknown as SizeChartRow[],
    offsets: db.prepare(`SELECT brand, length_cm, sleeve_cm FROM brand_offsets`).all() as unknown as BrandOffsetRow[],
  };
}

// Reads KEY=value pairs from engine/.env.local. Variables already set in the environment win.
function loadEnvLocal(): void {
  const file = join(ENGINE_DIR, ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: { source: { type: "string", default: "sqlite" } },
  });
  if (values.source !== "sqlite" && values.source !== "supabase") {
    throw new Error(`--source must be "sqlite" or "supabase", got "${values.source}"`);
  }
  const outPath = positionals[1] ?? DEFAULT_OUT;

  let rows: SourceRows;
  if (values.source === "supabase") {
    loadEnvLocal();
    rows = await readFromSupabase(readSupabaseEnv());
  } else {
    const dbPath = positionals[0] ?? DEFAULT_DB;
    if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    rows = readFromSqlite(db);
    db.close();
  }

  const { candidates, skipped } = buildCandidates(rows);
  if (candidates.length === 0) throw new Error("no candidates to export (no product has a size chart); nothing written");
  writeFileSync(outPath, JSON.stringify(candidates, null, 2) + "\n");
  console.log(`wrote ${candidates.length} candidates to ${outPath} (source: ${values.source})`);
  if (skipped.length > 0) console.warn(`skipped (no size chart): ${skipped.join(", ")}`);
  if (rows.offsets.length === 0) console.warn("no brand offsets found: length and sleeve are null for every size");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`export failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
