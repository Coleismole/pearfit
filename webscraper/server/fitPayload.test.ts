import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProductFitReport } from '../src/utils/fitAnalyzer.ts';
import { fitPayloadFromReport } from './fitPayload.ts';

test('fit payload keeps numerical fit values and drops review text', () => {
  const report = {
    id: 'sku-1',
    name: 'Oxford',
    brand: 'COS',
    category: 'Shirting',
    sku: 'SKU-1',
    price: '$80',
    fabricComposition: 'Cotton',
    sourceUrl: 'https://example.com/oxford',
    totalReviews: 2,
    overallFitIndex: -0.4,
    overallVerdict: 'Runs Small',
    gradingDelta: 0.1,
    overallDistribution: {
      runsSmallPct: 100,
      trueToSizePct: 0,
      runsLargePct: 0,
      runsSmallCount: 2,
      trueToSizeCount: 0,
      runsLargeCount: 0,
    },
    overallSentimentScore: 70,
    overallAvgRating: 3.5,
    merchandisingTakeaway: 'do not send this prose',
    sizingGradingAlert: 'do not send this alert',
    tshirtSignals: {
      overallShrinkagePct: 50,
      shrinkageReviewCount: 1,
      fabricOpacityPct: 100,
      opaqueReviewCount: 2,
      sheerReviewCount: 0,
      gsmSpec: '200',
      washCareAdvisory: 'cold wash',
      fabricWeightConsensus: 'heavy',
    },
    sizeSummaries: [
      {
        size: 'M',
        reviewCount: 2,
        runsSmallCount: 2,
        trueToSizeCount: 0,
        runsLargeCount: 0,
        runsSmallPct: 100,
        trueToSizePct: 0,
        runsLargePct: 0,
        fitSkew: -0.4,
        verdict: 'Runs Small',
        avgRating: 3.5,
        sentimentScore: 70,
        returnRisk: 'High',
        primaryFitNote: '100% report small fit',
        trendSummary: 'skip',
        topKeywords: ['tight'],
        dominantZones: [],
        sampleQuote: 'SECRET QUOTE the chest was tight',
        shrinkageMentionPct: 50,
        shrinkageMentionCount: 1,
        fabricWeightNote: 'skip',
      },
    ],
    reviews: [
      {
        id: 'r1',
        author: 'Sam',
        title: 'Too tight',
        body: 'SECRET REVIEW the shoulders pulled',
        sizePurchased: 'M',
        normalizedSize: 'M',
        rating: 3,
        fitDirection: 'small',
        fitSkew: -1,
        sentimentScore: 40,
      },
    ],
    scraperTelemetry: {
      sourceUrl: 'https://example.com/oxford',
      scrapedAt: '2026-11-08T00:00:00.000Z',
      domNodesScanned: 10,
      reviewNodesMatched: 1,
      selectorsUsed: [],
      parseDurationMs: 1,
      engineMode: 'cheerio-dom+deterministic-nlp',
    },
  } as unknown as ProductFitReport;

  const payload = fitPayloadFromReport(report);
  const encoded = JSON.stringify(payload);

  assert.equal(payload.sku, 'SKU-1');
  assert.equal(payload.productId, 'sku-1');
  assert.equal(payload.runsSmallPct, 100);
  assert.equal(payload.shrinkageMentionPct, 50);
  assert.equal(payload.sizes.length, 1);
  assert.equal(payload.sizes[0].size, 'M');
  assert.equal(payload.sizes[0].fitSkew, -0.4);
  assert.equal(payload.sizes[0].primaryFitNote, '100% report small fit');
  assert.equal(encoded.includes('SECRET'), false);
  assert.equal(encoded.includes('reviews'), false);
  assert.equal(encoded.includes('sampleQuote'), false);
  assert.equal(encoded.includes('Sam'), false);
});
