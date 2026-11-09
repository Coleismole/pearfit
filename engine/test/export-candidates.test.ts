// Seeds a small in-memory SQLite database shaped like the webscraper's (only the columns the
// exporter reads) and checks the exported Candidate objects against hand-computed values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildCandidates, readFromSqlite, readFromSupabase, readSupabaseEnv } from "../cli/export-candidates.ts";

function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE commercial_skus (
      sku TEXT PRIMARY KEY, brand TEXT NOT NULL, product_name TEXT NOT NULL, total_reviews INTEGER NOT NULL,
      runs_small_pct INTEGER NOT NULL, true_to_size_pct INTEGER NOT NULL, runs_large_pct INTEGER NOT NULL
    );
    CREATE TABLE size_chart (
      sku TEXT NOT NULL, size_code TEXT NOT NULL, sort_order INTEGER NOT NULL,
      chest_cm REAL, length_cm REAL, sleeve_cm REAL, PRIMARY KEY (sku, size_code)
    );
    CREATE TABLE brand_offsets (brand TEXT PRIMARY KEY, length_cm REAL, sleeve_cm REAL);

    INSERT INTO commercial_skus VALUES ('AB-100-WHT', 'Acme', 'Acme crew tee', 40, 60, 30, 10);
    INSERT INTO commercial_skus VALUES ('ZZ-200-BLK', 'Zed', 'Zed boxy tee', 12, 40, 40, 20);
    INSERT INTO commercial_skus VALUES ('NO-300-GRY', 'Acme', 'Acme no chart', 5, 0, 100, 0);

    -- rows are inserted out of order on purpose: sort_order decides the sequence
    INSERT INTO size_chart VALUES ('AB-100-WHT', 'M', 2, 53.2, 75.3, 21);
    INSERT INTO size_chart VALUES ('AB-100-WHT', 'S', 1, 50, 71, 20);
    INSERT INTO size_chart VALUES ('ZZ-200-BLK', 'L', 1, 58.04, 72, 24);

    INSERT INTO brand_offsets VALUES ('Acme', 2.5, NULL);
  `);
  return db;
}

test("export subtracts the brand offset from length and nulls an unconfirmed sleeve", () => {
  const { candidates } = buildCandidates(readFromSqlite(seed()));
  assert.deepEqual(candidates[0], {
    id: "ab-100-wht",
    name: "Acme crew tee",
    review: "runs_small", // 60 / 30 / 10
    garmentType: "tee", // "Acme crew tee"
    sizes: {
      // Offset +2.5 = Acme's chart runs bigger. S: 71 - 2.5 = 68.5. M: 75.3 - 2.5 = 72.8.
      // Sleeve offset is NULL, so sleeve is null.
      S: { chest_cm: 50, length_cm: 68.5, sleeve_cm: null },
      M: { chest_cm: 53.2, length_cm: 72.8, sleeve_cm: null },
    },
  });
});

test("brand with no offset row keeps chest and nulls length and sleeve; a review tie gives no signal", () => {
  const { candidates } = buildCandidates(readFromSqlite(seed()));
  assert.deepEqual(candidates[1], {
    id: "zz-200-blk",
    name: "Zed boxy tee",
    review: null, // 40 / 40 / 20 ties
    garmentType: "tee", // "Zed boxy tee"
    sizes: { L: { chest_cm: 58, length_cm: null, sleeve_cm: null } }, // chest 58.04 rounds to 58
  });
});

test("products without a size chart are skipped and reported", () => {
  const { candidates, skipped } = buildCandidates(readFromSqlite(seed()));
  assert.equal(candidates.length, 2);
  assert.deepEqual(skipped, ["NO-300-GRY"]);
});

// --- Supabase source: a stub fetch stands in for the REST endpoint ---

const ENV = { url: "https://example.supabase.co", key: "test-key" };

// Table name -> JSON rows (or a Response). Records every request so headers and URLs can be checked.
function stubFetch(tables: Record<string, unknown>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers ?? {} });
    const table = url.split("/rest/v1/")[1].split("?")[0];
    const body = tables[table];
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body ?? []), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// The same data the SQLite fixture holds, plus extra columns the exporter must ignore.
const remote = {
  commercial_skus: [
    { sku: "ZZ-200-BLK", brand: "Zed", product_name: "Zed boxy tee", total_reviews: 12, runs_small_pct: 40, true_to_size_pct: 40, runs_large_pct: 20, category: "T-Shirts & Tops" },
    { sku: "AB-100-WHT", brand: "Acme", product_name: "Acme crew tee", total_reviews: 40, runs_small_pct: 60, true_to_size_pct: 30, runs_large_pct: 10, category: "T-Shirts & Tops" },
    { sku: "NO-300-GRY", brand: "Acme", product_name: "Acme no chart", total_reviews: 5, runs_small_pct: 0, true_to_size_pct: 100, runs_large_pct: 0, category: "T-Shirts & Tops" },
  ],
  sku_size_chart: [
    { sku: "AB-100-WHT", size_code: "M", sort_order: 2, chest_cm: 53.2, length_cm: 75.3, sleeve_cm: 21, chest_basis: "flat" },
    { sku: "AB-100-WHT", size_code: "S", sort_order: 1, chest_cm: 50, length_cm: 71, sleeve_cm: 20, chest_basis: "flat" },
    { sku: "ZZ-200-BLK", size_code: "L", sort_order: 1, chest_cm: 58.04, length_cm: 72, sleeve_cm: 24, chest_basis: "flat" },
  ],
  brand_offsets: [{ brand: "Acme", length_cm: 2.5, sleeve_cm: null, note: "ignored" }],
};

test("supabase rows give the same candidates as the sqlite fixture, and extra columns are ignored", async () => {
  const { fn, calls } = stubFetch(remote);
  const rows = await readFromSupabase(ENV, fn);
  assert.deepEqual(buildCandidates(rows), buildCandidates(readFromSqlite(seed())));
  assert.equal(rows.charts[0].sku, "AB-100-WHT");
  assert.ok(!("chest_basis" in rows.charts[0]));
  assert.ok(!("category" in rows.products[0]));
  assert.deepEqual(calls.map((c) => c.url.split("?")[0]), [
    "https://example.supabase.co/rest/v1/commercial_skus",
    "https://example.supabase.co/rest/v1/sku_size_chart",
    "https://example.supabase.co/rest/v1/brand_offsets",
  ]);
  assert.ok(calls.every((c) => c.url.includes("select=*")));
  assert.equal(calls[0].headers.apikey, "test-key");
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
});

test("a table bigger than one page is fetched page by page", async () => {
  const many = Array.from({ length: 1001 }, (_, i) => ({
    sku: `S-${String(i).padStart(4, "0")}`, brand: "Acme", product_name: "Tee", total_reviews: 0,
    runs_small_pct: 0, true_to_size_pct: 0, runs_large_pct: 0,
  }));
  const ranges: string[] = [];
  const fn = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    if (url.includes("/sku_size_chart")) return new Response(JSON.stringify(remote.sku_size_chart), { status: 200 });
    if (url.includes("/brand_offsets")) return new Response("[]", { status: 200 });
    const range = init!.headers!.Range;
    ranges.push(range);
    return new Response(JSON.stringify(range === "0-999" ? many.slice(0, 1000) : many.slice(1000)), { status: 206 });
  }) as unknown as typeof fetch;
  const rows = await readFromSupabase(ENV, fn);
  assert.equal(rows.products.length, 1001);
  assert.deepEqual(ranges, ["0-999", "1000-1999"]);
});

test("a blocked read names row-level security instead of writing anything", async () => {
  const denied = new Response('{"message":"permission denied for table commercial_skus"}', { status: 401 });
  const { fn } = stubFetch({ ...remote, commercial_skus: denied });
  await assert.rejects(readFromSupabase(ENV, fn), /commercial_skus: HTTP 401[\s\S]*Row-level security/);
});

test("an empty products or chart table is an error, not an empty export", async () => {
  await assert.rejects(readFromSupabase(ENV, stubFetch({ ...remote, commercial_skus: [] }).fn), /commercial_skus returned no rows/);
  await assert.rejects(readFromSupabase(ENV, stubFetch({ ...remote, sku_size_chart: [] }).fn), /sku_size_chart returned no rows/);
});

test("a network failure is reported with the table name", async () => {
  const fn = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch;
  await assert.rejects(readFromSupabase(ENV, fn), /Supabase commercial_skus: request failed \(getaddrinfo ENOTFOUND\)/);
});

test("a row with a missing required field is rejected, not guessed", async () => {
  const bad = { ...remote, commercial_skus: [{ ...remote.commercial_skus[0], product_name: null }] };
  await assert.rejects(readFromSupabase(ENV, stubFetch(bad).fn), /row has no product_name/);
});

test("supabase env needs a url and a key, and a secret key wins over the publishable one", () => {
  assert.throws(() => readSupabaseEnv({}), /SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set/);
  assert.throws(() => readSupabaseEnv({ SUPABASE_URL: "https://x.supabase.co" }), /must be set/);
  assert.deepEqual(readSupabaseEnv({ SUPABASE_URL: "https://x.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "pub" }), {
    url: "https://x.supabase.co",
    key: "pub",
  });
  assert.equal(readSupabaseEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub", SUPABASE_SECRET_KEY: "sec" }).key, "sec");
});
