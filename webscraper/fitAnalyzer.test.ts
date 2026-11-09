import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSize,
  normalizeSizeOrNull,
  classifyReviewFitAndSentiment,
  parseRawReviewBatch,
  aggregateProductFitReport,
  generateSqlInsertDump,
  formatSigned,
  roundedShares,
} from './fitAnalyzer';

test('normalizeSize maps diverse size strings and numeric sizes into canonical XS-XXL', () => {
  assert.equal(normalizeSize('extra small'), 'XS');
  assert.equal(normalizeSize('Small'), 'S');
  assert.equal(normalizeSize('Med'), 'M');
  assert.equal(normalizeSize('Large'), 'L');
  assert.equal(normalizeSize('1XL'), 'XL');
  assert.equal(normalizeSize('2XL'), 'XXL');
  assert.equal(normalizeSize('28'), 'S');
  assert.equal(normalizeSize('32'), 'M');
  assert.equal(normalizeSize('36'), 'XL');
});

test('classifyReviewFitAndSentiment identifies fit direction, wash shrinkage, and fabric opacity cues', () => {
  const smallResult = classifyReviewFitAndSentiment(
    'This jacket runs very small! Way too tight across the shoulders and short in the sleeves. Definitely size up.',
    2
  );
  assert.equal(smallResult.fitDirection, 'runs_small');
  assert.ok(smallResult.fitSkew < -0.4);
  assert.equal(smallResult.sizedUpOrDownMention, 'sized_up');
  assert.ok(
    smallResult.anatomicalMentions.some(
      (m) => m.zone === 'shoulders' && m.tension === 'tight'
    )
  );

  const tshirtResult = classifyReviewFitAndSentiment(
    'Relaxed drop-shoulder fit that runs large out of the bag, but shrank half an inch in length after tumble drying. Thick 240 gsm heavyweight cotton that is completely opaque and not see-through.',
    4,
    'Slightly Large'
  );
  assert.equal(tshirtResult.mentionsShrinkage, true);
  assert.equal(tshirtResult.mentionsFabricOpacity, 'thick_opaque');

  const ttsResult = classifyReviewFitAndSentiment(
    'True to size and fits like a glove! Comfortable shoulders and great drape.',
    5
  );
  assert.equal(ttsResult.fitDirection, 'true_to_size');
  assert.ok(Math.abs(ttsResult.fitSkew) < 0.25);
  assert.equal(ttsResult.sentimentPolarity, 'positive');
});

test('parseRawReviewBatch parses both HTML review cards and plain text blocks', () => {
  const htmlSample = `
    <div class="review-card" data-size="L" data-rating="2" data-author="Maya K.">
      <h4>Way too tight in the chest</h4>
      <p>Ordered size L and it runs small. Pulls at the chest buttons and tight in the shoulders.</p>
    </div>
    <div class="review-card" data-size="S" data-rating="5" data-author="Elena R.">
      <h4>Perfect fit for S</h4>
      <p>True to size! Fits perfectly in the waist and length.</p>
    </div>
  `;
  const parsedHtml = parseRawReviewBatch(htmlSample);
  assert.equal(parsedHtml.length, 2);
  assert.equal(parsedHtml[0].sizePurchased, 'L');
  assert.equal(parsedHtml[0].author, 'Maya K.');

  const textSample = `
Size: XL | Rating: 2/5
Runs small and shrunk after wash. Tight across the shoulders.

Size: M | Rating: 5/5
True to size, fits perfectly and super soft knit.
  `;
  const parsedText = parseRawReviewBatch(textSample);
  assert.equal(parsedText.length, 2);
  assert.equal(parsedText[0].sizePurchased, 'XL');
  assert.equal(parsedText[1].sizePurchased, 'M');
});

test('aggregateProductFitReport computes per-size sentiment and shrinkage', () => {
  const report = aggregateProductFitReport(
    {
      id: 'hm-tee-test',
      name: 'H&M Relaxed Fit Heavyweight Cotton T-Shirt',
      brand: 'H&M',
      category: 'T-Shirts & Tops',
      sku: 'HM-1096385',
      price: '$19.99',
      fabricComposition: '100% Heavyweight Cotton Jersey (240 GSM)',
      sourceUrl: 'https://www2.hm.com/en_us/productpage.1096385001.html',
    },
    [
      {
        id: '1',
        author: 'A',
        sizePurchased: 'L',
        rating: 2,
        title: 'Tight shoulders after dryer',
        body: 'Runs small after wash! Shrunk in the dryer and tight in the shoulders and chest. Size up.',
        date: '2026-10-01',
        verifiedPurchase: true,
      },
      {
        id: '2',
        author: 'B',
        sizePurchased: 'L',
        rating: 3,
        title: 'Snug fit',
        body: 'Runs small and narrow in the shoulders, though thick cotton is not see-through.',
        date: '2026-10-02',
        verifiedPurchase: true,
      },
      {
        id: '3',
        author: 'C',
        sizePurchased: 'S',
        rating: 5,
        title: 'Fits great',
        body: 'True to size, fits perfectly in the waist and sleeves. Heavyweight 240 gsm fabric is opaque.',
        date: '2026-10-03',
        verifiedPurchase: true,
      },
    ]
  );

  assert.equal(report.tshirtSignals.overallShrinkagePct, 33);
  assert.equal(report.tshirtSignals.fabricOpacityPct, 100);

  const sizeL = report.sizeSummaries.find((s) => s.size === 'L')!;
  assert.equal(sizeL.reviewCount, 2);
  assert.equal(sizeL.runsSmallPct, 100);
  assert.equal(sizeL.shrinkageMentionPct, 50);
  assert.equal(sizeL.verdict, 'Runs Small');

  assert.ok(typeof report.gradingDelta === 'number');
  const sqlDump = generateSqlInsertDump([report]);
  assert.ok(sqlDump.includes('CREATE TABLE IF NOT EXISTS commercial_skus'));
  assert.ok(sqlDump.includes('INSERT INTO commercial_skus'));
  assert.ok(sqlDump.includes('INSERT INTO sku_size_metrics'));
  assert.ok(sqlDump.includes('HM-1096385'));
});

test('normalizeSizeOrNull returns null for missing or unrecognized sizes instead of guessing', () => {
  assert.equal(normalizeSizeOrNull(''), null);
  assert.equal(normalizeSizeOrNull(undefined), null);
  assert.equal(normalizeSizeOrNull('one size'), null);
  assert.equal(normalizeSizeOrNull('Medium'), 'M');
  // Lenient UI variant still defaults to M.
  assert.equal(normalizeSize(''), 'M');
});

test('reviews with unknown size count toward overall stats but not any per-size bucket', () => {
  const report = aggregateProductFitReport(
    {
      id: 't',
      name: 'Tee',
      brand: 'B',
      category: 'T-Shirts & Tops',
      sku: 'T-1',
      price: 'Unknown',
      fabricComposition: 'Unknown',
      sourceUrl: 'https://example.test/tee',
    },
    [
      { id: '1', author: 'A', sizePurchased: '', rating: 4, title: '', body: 'Runs small, tight in the chest.', date: '', verifiedPurchase: false },
      { id: '2', author: 'B', sizePurchased: 'L', rating: 5, title: '', body: 'True to size, fits perfectly.', date: '', verifiedPurchase: false },
    ]
  );
  assert.equal(report.totalReviews, 2);
  const perSizeTotal = report.sizeSummaries.reduce((acc, s) => acc + s.reviewCount, 0);
  assert.equal(perSizeTotal, 1);
  assert.equal(report.sizeSummaries.find((s) => s.size === 'M')!.reviewCount, 0);
});

test('parseRawReviewBatch leaves size empty when the text does not state one', () => {
  const parsed = parseRawReviewBatch('Lovely shirt, great colour and soft fabric.\n\nRuns a bit long in the sleeves overall.');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sizePurchased, '');
  assert.equal(parsed[1].sizePurchased, '');
});

test('care instructions are not counted as shrinkage, and a drop-shoulder name is not looseness', () => {
  const hangDry = classifyReviewFitAndSentiment(
    'True to size. I hang dry it after a cold wash and it fits perfectly.',
    5
  );
  assert.equal(hangDry.mentionsShrinkage, false);
  assert.equal(hangDry.fitDirection, 'true_to_size');

  const shrunk = classifyReviewFitAndSentiment('It shrunk in the dryer after the first wash.', 2);
  assert.equal(shrunk.mentionsShrinkage, true);

  const dropShoulder = classifyReviewFitAndSentiment('True to size drop-shoulder tee.', 5);
  assert.equal(
    dropShoulder.anatomicalMentions.find((mention) => mention.zone === 'shoulders')?.tension,
    'optimal'
  );
});

test('missing opacity, weight, and reviews stay unstated', () => {
  const report = aggregateProductFitReport(
    {
      id: 'plain',
      name: 'Plain Tee',
      brand: 'Example',
      category: 'T-Shirts & Tops',
      sku: 'EX-1',
      price: 'Unknown',
      fabricComposition: '100% cotton',
      sourceUrl: 'https://example.test/plain',
    },
    [
      {
        id: '1',
        author: 'A',
        sizePurchased: 'M',
        rating: 4,
        title: '',
        body: 'True to size and fits perfectly.',
        date: '',
        verifiedPurchase: false,
      },
    ]
  );
  assert.equal(report.tshirtSignals.fabricOpacityPct, null);
  assert.equal(report.tshirtSignals.gsmSpec, null);
  assert.equal(report.tshirtSignals.fabricWeightConsensus, 'Reviews do not mention fabric weight or opacity.');
  assert.equal(report.tshirtSignals.washCareAdvisory, 'No reviewer mentioned shrinkage.');

  const empty = aggregateProductFitReport(
    {
      id: 'empty',
      name: 'Chart Only',
      brand: 'Example',
      category: 'Shirting',
      sku: 'EX-2',
      price: 'Unknown',
      fabricComposition: 'Unknown',
      sourceUrl: 'https://example.test/chart',
    },
    []
  );
  assert.equal(empty.totalReviews, 0);
  assert.equal(empty.overallVerdict, 'Insufficient Data');
  assert.equal(empty.merchandisingTakeaway, 'No reviews were found, so there is no fit verdict.');
  assert.equal(empty.sizingGradingAlert, 'No reviews, so grading was not compared.');
  assert.equal(empty.tshirtSignals.fabricOpacityPct, null);
  assert.equal(empty.scraperTelemetry.domNodesScanned, 0);
  assert.equal(empty.scraperTelemetry.parseDurationMs, 0);
  assert.deepEqual(empty.scraperTelemetry.selectorsUsed, []);
});

test('pasted reviews do not invent a date, a verified flag, or a star rating', () => {
  const parsed = parseRawReviewBatch('Lovely shirt, great colour and soft fabric.');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].date, '');
  assert.equal(parsed[0].verifiedPurchase, false);
  assert.equal(parsed[0].rating, 3);
});

test('rounded shares add to 100 when both ends round up', () => {
  assert.deepEqual(roundedShares(1, 1, 1), [33, 34, 33]);
  // 3/8 = 37.5 → 38 and 5/8 = 62.5 → 63 would print 101. The extra point comes off the larger end.
  assert.deepEqual(roundedShares(3, 0, 5), [38, 0, 62]);
});

test('pasted review sizes keep X-Large and 3XL instead of dropping them', () => {
  const parsed = parseRawReviewBatch(
    'Size: X-Large | Rating: 4/5\nRoomy through the chest but wearable.\n\nSize: 3XL | Rating: 3/5\nOrdered my usual 3XL.'
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sizePurchased, 'X-Large');
  assert.equal(parsed[1].sizePurchased, '3XL');
  assert.equal(normalizeSizeOrNull(parsed[0].sizePurchased), 'XL');
  assert.equal(normalizeSizeOrNull(parsed[1].sizePurchased), 'XXL');
});

test('sql dump stores unknown opacity as NULL and includes the size chart', () => {
  const report = aggregateProductFitReport(
    {
      id: 'plain',
      name: 'Plain Tee',
      brand: 'Example',
      category: 'T-Shirts & Tops',
      sku: 'EX-1',
      price: 'Unknown',
      fabricComposition: '100% cotton',
      sourceUrl: 'https://example.test/plain',
    },
    [
      {
        id: '1',
        author: 'A',
        sizePurchased: 'M',
        rating: 4,
        title: '',
        body: 'True to size and fits perfectly.',
        date: '',
        verifiedPurchase: false,
      },
    ]
  );
  assert.equal(report.tshirtSignals.fabricOpacityPct, null);
  const sql = generateSqlInsertDump(
    [report],
    [{ sku: 'EX-1', size: 'M', sortOrder: 2, chest_cm: 54, length_cm: null, sleeve_cm: 63.5 }]
  );
  assert.match(sql, /fabric_opacity_pct INT,/);
  assert.equal(sql.includes('fabric_opacity_pct INT NOT NULL'), false);
  assert.match(sql, /INSERT INTO sku_size_chart \(sku, size_code, sort_order, chest_cm, length_cm, sleeve_cm\) VALUES \('EX-1', 'M', 2, 54, NULL, 63\.5\);/);
});

test('formatSigned keeps a minus and adds a plus', () => {
  assert.equal(formatSigned(-0.4), '-0.40');
  assert.equal(formatSigned(0.25), '+0.25');
  assert.equal(formatSigned(0), '0.00');
});

test('mild fit answers ("A bit loose", "A little tight") skew less than "Runs large/small"', () => {
  const body = 'Nice parka.';
  const mildLoose = classifyReviewFitAndSentiment(body, 5, 'A bit loose').fitSkew;
  const runsLarge = classifyReviewFitAndSentiment(body, 5, 'Runs large').fitSkew;
  const mildTight = classifyReviewFitAndSentiment(body, 5, 'A little tight').fitSkew;
  assert.ok(mildLoose > 0 && mildLoose < runsLarge, `${mildLoose} vs ${runsLarge}`);
  assert.ok(mildTight < 0, String(mildTight));
});
