// Tests for the fit-catalog export (cli/export-fit-catalog.ts). The rows are written by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFitCatalog } from "../cli/export-fit-catalog.ts";
import type { SourceRows } from "../cli/db-types.ts";

const rows: SourceRows = {
  products: [
    { sku: "ZZ-200", brand: "Zed", product_name: "Zed polo shirt", total_reviews: 0, runs_small_pct: 0, true_to_size_pct: 0, runs_large_pct: 0 },
    { sku: "AB-100", brand: "Acme", product_name: "Acme crew tee", total_reviews: 40, runs_small_pct: 60, true_to_size_pct: 30, runs_large_pct: 10 },
  ],
  charts: [
    { sku: "AB-100", size_code: "M", sort_order: 1, chest_cm: 53.24, length_cm: 75.3, sleeve_cm: 21 },
    { sku: "AB-100", size_code: "S", sort_order: 0, chest_cm: 50, length_cm: 71, sleeve_cm: null },
  ],
  offsets: [{ brand: "Acme", length_cm: 2.5, sleeve_cm: null }],
};

test("the fit catalog lists every product by sku, with stored review numbers and the engine's chart", () => {
  assert.deepEqual(buildFitCatalog(rows, "2026-11-12"), {
    exported_on: "2026-11-12",
    products: [
      {
        sku: "AB-100",
        candidateId: "ab-100",
        brand: "Acme",
        name: "Acme crew tee",
        garmentType: "tee",
        reviews: { total: 40, runsSmallPct: 60, trueToSizePct: 30, runsLargePct: 10 },
        // Same conversion as the candidates: chest rounded to 1 decimal (53.24 -> 53.2), length minus the 2.5 offset
        // (71 -> 68.5, 75.3 -> 72.8), sleeve null because the brand has no sleeve offset. Sizes in sort order.
        sizes: {
          S: { chest_cm: 50, length_cm: 68.5, sleeve_cm: null },
          M: { chest_cm: 53.2, length_cm: 72.8, sleeve_cm: null },
        },
      },
      {
        sku: "ZZ-200",
        candidateId: "zz-200",
        brand: "Zed",
        name: "Zed polo shirt",
        garmentType: "polo",
        reviews: { total: 0, runsSmallPct: 0, trueToSizePct: 0, runsLargePct: 0 }, // no reviews: zeros as stored
        sizes: null, // no chart rows: null, not an empty chart
      },
    ],
  });
});
