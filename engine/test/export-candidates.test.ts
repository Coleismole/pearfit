// Seeds a small in-memory SQLite database shaped like the webscraper's (only the columns the
// exporter reads) and checks the exported Candidate objects against hand-computed values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildCandidates } from "../cli/export-candidates.ts";

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
  const { candidates } = buildCandidates(seed());
  assert.deepEqual(candidates[0], {
    id: "ab-100-wht",
    name: "Acme crew tee",
    review: "runs_small", // 60 / 30 / 10
    sizes: {
      // Offset +2.5 = Acme's chart runs bigger. S: 71 - 2.5 = 68.5. M: 75.3 - 2.5 = 72.8.
      // Sleeve offset is NULL, so sleeve is null.
      S: { chest_cm: 50, length_cm: 68.5, sleeve_cm: null },
      M: { chest_cm: 53.2, length_cm: 72.8, sleeve_cm: null },
    },
  });
});

test("brand with no offset row keeps chest and nulls length and sleeve; a review tie gives no signal", () => {
  const { candidates } = buildCandidates(seed());
  assert.deepEqual(candidates[1], {
    id: "zz-200-blk",
    name: "Zed boxy tee",
    review: null, // 40 / 40 / 20 ties
    sizes: { L: { chest_cm: 58, length_cm: null, sleeve_cm: null } }, // chest 58.04 rounds to 58
  });
});

test("products without a size chart are skipped and reported", () => {
  const { candidates, skipped } = buildCandidates(seed());
  assert.equal(candidates.length, 2);
  assert.deepEqual(skipped, ["NO-300-GRY"]);
});
