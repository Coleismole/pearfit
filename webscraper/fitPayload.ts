import type { ProductFitReport } from './fitAnalyzer.ts';
import type { SizeChartRow } from './sizeChart.ts';

/** Fit numbers sent to Supabase. Review text is intentionally absent. */
export interface FitPayload {
  sku: string;
  productId: string;
  brand: string;
  name: string;
  category: string;
  price: string;
  fabricComposition: string;
  totalReviews: number;
  overallFitIndex: number;
  overallVerdict: string;
  gradingDelta: number;
  runsSmallPct: number;
  trueToSizePct: number;
  runsLargePct: number;
  shrinkageMentionPct: number;
  /** Null when reviews never mention opacity. */
  fabricOpacityPct: number | null;
  sentimentScore: number;
  avgRating: number;
  sourceUrl: string;
  scrapedAt: string;
  sizes: FitSizePayload[];
  /** Brand chart, pit-to-pit chest. A measurement the chart did not state is null. */
  chart: FitChartPayload[];
}

export interface FitChartPayload {
  size: string;
  sortOrder: number;
  chest_cm: number | null;
  length_cm: number | null;
  sleeve_cm: number | null;
}

export interface FitSizePayload {
  size: string;
  reviewCount: number;
  fitSkew: number;
  verdict: string;
  runsSmallPct: number;
  trueToSizePct: number;
  runsLargePct: number;
  shrinkagePct: number;
  sentimentScore: number;
  avgRating: number;
  returnRisk: string;
  primaryFitNote: string;
}

export function fitPayloadFromReport(report: ProductFitReport, chart: SizeChartRow[] = []): FitPayload {
  return {
    sku: report.sku,
    productId: report.id,
    brand: report.brand,
    name: report.name,
    category: report.category,
    price: report.price,
    fabricComposition: report.fabricComposition,
    totalReviews: report.totalReviews,
    overallFitIndex: report.overallFitIndex,
    overallVerdict: report.overallVerdict,
    gradingDelta: report.gradingDelta,
    runsSmallPct: report.overallDistribution.runsSmallPct,
    trueToSizePct: report.overallDistribution.trueToSizePct,
    runsLargePct: report.overallDistribution.runsLargePct,
    shrinkageMentionPct: report.tshirtSignals.overallShrinkagePct,
    fabricOpacityPct: report.tshirtSignals.fabricOpacityPct,
    sentimentScore: report.overallSentimentScore,
    avgRating: report.overallAvgRating,
    sourceUrl: report.sourceUrl,
    scrapedAt: report.scraperTelemetry.scrapedAt,
    sizes: report.sizeSummaries.map((size) => ({
      size: size.size,
      reviewCount: size.reviewCount,
      fitSkew: size.fitSkew,
      verdict: size.verdict,
      runsSmallPct: size.runsSmallPct,
      trueToSizePct: size.trueToSizePct,
      runsLargePct: size.runsLargePct,
      shrinkagePct: size.shrinkageMentionPct,
      sentimentScore: size.sentimentScore,
      avgRating: size.avgRating,
      returnRisk: size.returnRisk,
      primaryFitNote: size.primaryFitNote,
    })),
    chart: chart.map((row) => ({
      size: row.size,
      sortOrder: row.sortOrder,
      chest_cm: row.chest_cm,
      length_cm: row.length_cm,
      sleeve_cm: row.sleeve_cm,
    })),
  };
}
