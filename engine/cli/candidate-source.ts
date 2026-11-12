// Candidate building shared by the export script and the API: turns source rows (from the shared Supabase
// store, or from the local SQLite file via export-candidates.ts) into the engine's Candidate format.
// Kept outside src/ so the engine itself stays free of I/O and the network. It imports no SQLite, so a hosted
// function can load it without the experimental node:sqlite module.
import { round } from "../src/score.ts";
import type { Candidate, ReviewSignal } from "../src/types.ts";
import type { BrandOffsetRow, ProductRow, SizeChartRow, SourceRows } from "./db-types.ts";
import { garmentTypeFor } from "./garment-type.ts";

// Table names in the shared Supabase project (see webscraper/fit_store.sql).
const SUPABASE_TABLES = { products: "commercial_skus", charts: "sku_size_chart", offsets: "brand_offsets" };

export interface ExportResult {
  candidates: Candidate[];
  skipped: string[]; // SKUs with no size-chart rows
}


export interface SupabaseEnv {
  url: string;
  key: string;
}

export function readSupabaseEnv(env: NodeJS.ProcessEnv = process.env): SupabaseEnv {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const key = (env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY)?.trim() ?? "";
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in the environment or engine/.env.local (see engine/.env.example)",
    );
  }
  return { url, key };
}

// PostgREST caps a response at 1000 rows by default. Paging with Range means a bigger table is never silently cut off.
const PAGE_SIZE = 1000;

// A request with no answer after this long is given up, so a hung connection fails instead of holding the caller.
const REQUEST_TIMEOUT_MS = 10_000;

async function fetchTable(
  env: SupabaseEnv,
  table: string,
  order: string,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let res: Response;
    try {
      res = await fetchFn(`${env.url}/rest/v1/${table}?select=*&order=${order}`, {
        headers: {
          apikey: env.key,
          Authorization: `Bearer ${env.key}`,
          "Range-Unit": "items",
          Range: `${from}-${from + PAGE_SIZE - 1}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Supabase ${table}: request failed (${err instanceof Error ? err.message : String(err)})`);
    }
    if (res.status === 416 && from > 0) return rows; // the table held exactly a whole number of pages
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      const blocked = res.status === 401 || res.status === 403 || /permission denied|row-level security/i.test(body);
      throw new Error(
        `Supabase ${table}: HTTP ${res.status} ${body}` +
          (blocked
            ? "\n  Row-level security is blocking this key from reading the table. Set SUPABASE_SECRET_KEY in engine/.env.local, or add a read policy for the publishable key."
            : ""),
      );
    }
    const page: unknown = await res.json();
    if (!Array.isArray(page)) throw new Error(`Supabase ${table}: expected a JSON array of rows`);
    rows.push(...(page as Record<string, unknown>[]));
    if (page.length < PAGE_SIZE) return rows;
  }
}

function textField(row: Record<string, unknown>, key: string, table: string): string {
  const v = row[key];
  if (typeof v !== "string" || v === "") throw new Error(`Supabase ${table}: row has no ${key}: ${JSON.stringify(row)}`);
  return v;
}

function numberField(row: Record<string, unknown>, key: string, table: string): number {
  const v = row[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Supabase ${table}: ${key} is not a number: ${JSON.stringify(row)}`);
  }
  return v;
}

// A missing or non-numeric measurement stays null. Never invent one.
function measurementField(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Same shape as readFromSqlite. Columns beyond the ones mapped here (e.g. chest_basis) are ignored.
export async function readFromSupabase(env: SupabaseEnv, fetchFn: typeof fetch = fetch): Promise<SourceRows> {
  const t = SUPABASE_TABLES;
  const [products, charts, offsets] = await Promise.all([
    fetchTable(env, t.products, "sku.asc", fetchFn),
    fetchTable(env, t.charts, "sku.asc,size_code.asc", fetchFn),
    fetchTable(env, t.offsets, "brand.asc", fetchFn),
  ]);
  if (products.length === 0) throw new Error(`Supabase ${t.products} returned no rows, so there is nothing to export`);
  if (charts.length === 0) throw new Error(`Supabase ${t.charts} returned no rows, so there are no size charts to export`);
  return {
    products: products.map((r) => ({
      sku: textField(r, "sku", t.products),
      brand: textField(r, "brand", t.products),
      product_name: textField(r, "product_name", t.products),
      total_reviews: numberField(r, "total_reviews", t.products),
      runs_small_pct: numberField(r, "runs_small_pct", t.products),
      true_to_size_pct: numberField(r, "true_to_size_pct", t.products),
      runs_large_pct: numberField(r, "runs_large_pct", t.products),
    })),
    charts: charts.map((r) => ({
      sku: textField(r, "sku", t.charts),
      size_code: textField(r, "size_code", t.charts),
      sort_order: numberField(r, "sort_order", t.charts),
      chest_cm: measurementField(r, "chest_cm"),
      length_cm: measurementField(r, "length_cm"),
      sleeve_cm: measurementField(r, "sleeve_cm"),
    })),
    offsets: offsets.map((r) => ({
      brand: textField(r, "brand", t.offsets),
      length_cm: measurementField(r, "length_cm"),
      sleeve_cm: measurementField(r, "sleeve_cm"),
    })),
  };
}

export function buildCandidates(rows: SourceRows): ExportResult {
  const chartsBySku = new Map<string, SizeChartRow[]>();
  for (const row of rows.charts) {
    const list = chartsBySku.get(row.sku) ?? [];
    list.push(row);
    chartsBySku.set(row.sku, list);
  }
  const offsetsByBrand = new Map(rows.offsets.map((o) => [o.brand, o]));
  const products = [...rows.products].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  for (const p of products) {
    const chart = (chartsBySku.get(p.sku) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    if (chart.length === 0) {
      skipped.push(p.sku);
      continue;
    }
    // No offset row = convention unconfirmed, so length and sleeve stay null.
    const offset = offsetsByBrand.get(p.brand) ?? { brand: p.brand, length_cm: null, sleeve_cm: null };
    const sizes: Candidate["sizes"] = {};
    for (const row of chart) {
      sizes[row.size_code] = {
        chest_cm: row.chest_cm === null ? null : round(row.chest_cm, 1), // trusted: no offset
        length_cm: applyOffset(row.length_cm, offset.length_cm),
        sleeve_cm: applyOffset(row.sleeve_cm, offset.sleeve_cm),
      };
    }
    candidates.push({
      id: slug(p.sku),
      name: p.product_name,
      review: reviewSignal(p),
      garmentType: garmentTypeFor(p.product_name),
      sizes,
      // The stored numbers, passed on as they are. A product with no reviews gets no summary.
      ...(p.total_reviews > 0
        ? { reviewSummary: { total: p.total_reviews, runsSmallPct: p.runs_small_pct, trueToSizePct: p.true_to_size_pct, runsLargePct: p.runs_large_pct } }
        : {}),
    });
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

export function slug(sku: string): string {
  return sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}


// The whole Supabase path in one call, for callers that only want the candidates (the API). Products with no
// size chart are dropped. `env` should hold SUPABASE_URL and the publishable key only: a secret key in it would win.
export async function loadCandidatesFromSupabase(
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Candidate[]> {
  return buildCandidates(await readFromSupabase(readSupabaseEnv(env), fetchFn)).candidates;
}
