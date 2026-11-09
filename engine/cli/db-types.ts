// Row shapes for the webscraper tables the export script reads. Kept outside src/ with the other I/O code.

export interface ProductRow {
  sku: string;
  brand: string;
  product_name: string;
  total_reviews: number;
  runs_small_pct: number;
  true_to_size_pct: number;
  runs_large_pct: number;
}

export interface SizeChartRow {
  sku: string;
  size_code: string;
  sort_order: number; // smallest to largest
  chest_cm: number | null;
  length_cm: number | null;
  sleeve_cm: number | null;
}

// Offset is positive = the chart runs bigger than our canonical ruler, and is SUBTRACTED at export.
// No chest offset — chest is the trusted dimension.
export interface BrandOffsetRow {
  brand: string;
  length_cm: number | null;
  sleeve_cm: number | null;
}

// What a source (local SQLite or the shared Supabase store) hands to buildCandidates.
export interface SourceRows {
  products: ProductRow[];
  charts: SizeChartRow[];
  offsets: BrandOffsetRow[];
}
