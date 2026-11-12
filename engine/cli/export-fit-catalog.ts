// Writes data/fit-pages/catalog.json: every product in the shared Supabase store with its review numbers and,
// when it has one, its size chart. website/scripts/build-fit-pages.mjs turns that file into the fit guide pages.
// Read-only on Supabase, and it writes the one file.
//
//   npm run export-fit-catalog                 (needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or engine/.env.local)
//   npm run export-fit-catalog -- <out.json>
//
// The file is a snapshot, committed so the pages can be rebuilt and checked without the network. It holds numbers
// only: no review text, no reviewer names and no product URLs.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GarmentType, Measurements, ReviewSummary } from "../src/types.ts";
import { buildCandidates, readFromSupabase, readSupabaseEnv, slug } from "./candidate-source.ts";
import type { SourceRows } from "./db-types.ts";
import { garmentTypeFor } from "./garment-type.ts";

const ENGINE_DIR = join(import.meta.dirname, "..");
const DEFAULT_OUT = join(ENGINE_DIR, "..", "data", "fit-pages", "catalog.json");

export interface FitCatalogProduct {
  sku: string;
  candidateId: string; // the id GET /api/candidates uses for this product
  brand: string;
  name: string;
  garmentType: GarmentType;
  reviews: ReviewSummary; // as stored, also when total is 0
  sizes: Record<string, Measurements> | null; // null = no size chart. Same numbers as the engine's candidates.
}

export interface FitCatalog {
  exported_on: string; // YYYY-MM-DD
  products: FitCatalogProduct[]; // sorted by sku
}

// Pure: the same rows and date always give the same catalog. Charts go through buildCandidates, so a chart here is
// converted exactly like the one the engine scores (chest trusted, length and sleeve only with a brand offset).
export function buildFitCatalog(rows: SourceRows, exportedOn: string): FitCatalog {
  const charts = new Map(buildCandidates(rows).candidates.map((c) => [c.id, c.sizes]));
  const products = [...rows.products]
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))
    .map((p) => ({
      sku: p.sku,
      candidateId: slug(p.sku),
      brand: p.brand,
      name: p.product_name,
      garmentType: garmentTypeFor(p.product_name),
      reviews: { total: p.total_reviews, runsSmallPct: p.runs_small_pct, trueToSizePct: p.true_to_size_pct, runsLargePct: p.runs_large_pct },
      sizes: charts.get(slug(p.sku)) ?? null,
    }));
  return { exported_on: exportedOn, products };
}

async function main(): Promise<void> {
  const outPath = process.argv[2] ?? DEFAULT_OUT;
  const envFile = join(ENGINE_DIR, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const rows = await readFromSupabase(readSupabaseEnv());
  const catalog = buildFitCatalog(rows, new Date().toISOString().slice(0, 10));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(catalog, null, 1) + "\n");
  const withChart = catalog.products.filter((p) => p.sizes !== null).length;
  console.log(`wrote ${catalog.products.length} products (${withChart} with a size chart) to ${outPath}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`export failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
