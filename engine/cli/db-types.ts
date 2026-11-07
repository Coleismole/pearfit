// Row shapes for the webscraper tables the export script reads. Kept outside src/ with the other I/O code.

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
