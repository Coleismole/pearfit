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
  normalizeReviewRating,
  formatReviewStars,
  formatSentiment,
  meanOrNull,
  NO_RATING_DASH,
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
  assert.equal(parsed[0].rating, null);
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

test('a quantity after a buying verb is not a size, and "SIZE M" is not S', () => {
  const [a, b] = parseRawReviewBatch('I ordered 2 of these and love them, great shirt.\n\nI bought a medium and it fits well enough.');
  assert.equal(a.sizePurchased, '');
  assert.equal(b.sizePurchased, 'medium');
  assert.equal(normalizeSizeOrNull('SIZE M'), null);
  assert.equal(normalizeSizeOrNull('Small Tall'), 'S');
});

test('normalizeReviewRating returns a whole 1 to 5 rating, or null when there is none to read', () => {
  assert.equal(normalizeReviewRating(4), 4);
  assert.equal(normalizeReviewRating('4'), 4);
  assert.equal(normalizeReviewRating(' 3 '), 3);
  assert.equal(normalizeReviewRating(4.4), 4);
  assert.equal(normalizeReviewRating(4.5), 5);
  assert.equal(normalizeReviewRating(7), 5);
  // None of these is a rating, and none becomes a neutral 3.
  assert.equal(normalizeReviewRating(''), null);
  assert.equal(normalizeReviewRating('   '), null);
  assert.equal(normalizeReviewRating(null), null);
  assert.equal(normalizeReviewRating(undefined), null);
  assert.equal(normalizeReviewRating(NaN), null);
  assert.equal(normalizeReviewRating('abc'), null);
  assert.equal(normalizeReviewRating(0), null);
  assert.equal(normalizeReviewRating('0'), null);
  assert.equal(normalizeReviewRating(-2), null);
});

test('pasted reviews with no readable stars have a null rating; stated stars are still read', () => {
  const html = parseRawReviewBatch(
    `<div class="review-card" data-size="M" data-author="Ana"><p>Fits well enough, ordered my usual size.</p></div>
     <div class="review-card" data-size="L" data-rating="" data-author="Bo"><p>Runs a little small across the chest.</p></div>
     <div class="review-card" data-size="S" data-rating="4" data-author="Cy"><p>Fits as expected, nice cut.</p></div>`
  );
  assert.deepEqual(html.map((r) => r.rating), [null, null, 4]);

  const text = parseRawReviewBatch(
    'Size: M | Rating: 0\nFits fine overall.\n\nSize: S ★★★★ Nice cut and fabric.\n\nSize: L | Rating: 2/5\nToo big on me.'
  );
  assert.deepEqual(text.map((r) => r.rating), [null, 4, 2]);
});

test('a review with no rating has no sentiment score, but its fit direction still counts', () => {
  const unrated = classifyReviewFitAndSentiment('Runs small.', null);
  assert.equal(unrated.sentimentScore, null);
  assert.equal(unrated.sentimentPolarity, null);
  assert.equal(unrated.fitDirection, 'runs_small');
  assert.equal(unrated.fitSkew, -0.85);
  // Leaving the rating out is the same as null. It used to read as 4 stars.
  assert.equal(classifyReviewFitAndSentiment('Runs small.').sentimentScore, null);
  // 5 stars: ((5 - 1) / 4) * 76 + 12 = 88, and the wording has no sentiment words.
  assert.equal(classifyReviewFitAndSentiment('Standard cut, nothing unusual here.', 5).sentimentScore, 88);
});

const ratingMeta = {
  id: 'rating-tee',
  name: 'Rating Tee',
  brand: 'Example',
  category: 'T-Shirts & Tops' as const,
  sku: 'RATE-1',
  price: 'Unknown',
  fabricComposition: 'Unknown',
  sourceUrl: 'https://example.test/rating-tee',
};

const plainReview = (id: string, size: string, rating: number | null, body: string) => ({
  id,
  author: id,
  sizePurchased: size,
  rating,
  title: '',
  body,
  date: '',
  verifiedPurchase: false,
});

test('a null rating is left out of the means, not counted as a 3', () => {
  // Size M: ratings 5, null, 4. None of the bodies has a fit cue or a sentiment word.
  // Stars: (5 + 4) / 2 = 4.5. A null read as 3 would give (5 + 3 + 4) / 3 = 4.0.
  // Sentiment per rated review: 5 stars -> ((5 - 1) / 4) * 76 + 12 = 88, 4 stars -> ((4 - 1) / 4) * 76 + 12 = 69.
  // Mean (88 + 69) / 2 = 78.5, rounded to 79. A null read as 3 (50) would give (88 + 50 + 69) / 3 = 69.
  // Size L: one review, no rating, says "Runs small." (fit skew -0.85).
  const report = aggregateProductFitReport(ratingMeta, [
    plainReview('r1', 'M', 5, 'Standard cut, nothing unusual here.'),
    plainReview('r2', 'M', null, 'Standard cut, nothing unusual here too.'),
    plainReview('r3', 'M', 4, 'Standard cut, nothing unusual here as well.'),
    plainReview('r4', 'L', null, 'Runs small.'),
  ]);

  assert.equal(report.totalReviews, 4);
  assert.equal(report.ratedReviewCount, 2);
  assert.equal(report.overallAvgRating, 4.5);
  assert.equal(report.overallSentimentScore, 79);

  const sizeM = report.sizeSummaries.find((s) => s.size === 'M')!;
  assert.equal(sizeM.reviewCount, 3);
  assert.equal(sizeM.ratedReviewCount, 2);
  assert.equal(sizeM.avgRating, 4.5);
  assert.equal(sizeM.sentimentScore, 79);
  assert.equal(sizeM.returnRisk, 'Low');

  // L has a review and no stars: both means are "none" (0, shown as a dash), not a 3 or a 50.
  const sizeL = report.sizeSummaries.find((s) => s.size === 'L')!;
  assert.equal(sizeL.reviewCount, 1);
  assert.equal(sizeL.ratedReviewCount, 0);
  assert.equal(sizeL.avgRating, 0);
  assert.equal(sizeL.sentimentScore, 0);
  assert.equal(sizeL.verdict, 'Runs Small');
  // No sentiment to weigh: risk comes from the fit skew alone (0.85 is at least 0.28) and never reaches High.
  // A made-up 3 stars would have scored sentiment 50, under 62, which is High.
  assert.equal(sizeL.returnRisk, 'Moderate');
  assert.equal(sizeL.trendSummary.includes('Sentiment'), false);
  assert.equal(meanOrNull(sizeL.avgRating, sizeL.ratedReviewCount), null);

  // The review itself keeps null, and has no score.
  const r2 = report.reviews.find((r) => r.id === 'r2')!;
  assert.equal(r2.rating, null);
  assert.equal(r2.sentimentScore, null);
  assert.equal(r2.sentimentPolarity, null);
  const r1 = report.reviews.find((r) => r.id === 'r1')!;
  assert.equal(r1.rating, 5);
  assert.equal(r1.sentimentScore, 88);
  assert.equal(r1.sentimentPolarity, 'positive');
});

test('a scraper that hands over "" or NaN for stars is read as no rating', () => {
  const messy = [
    { ...plainReview('a', 'M', 5, 'Standard cut, nothing unusual here.') },
    { ...plainReview('b', 'M', null, 'Standard cut, nothing unusual here too.'), rating: '' as unknown as null },
    { ...plainReview('c', 'M', null, 'Standard cut, nothing unusual here as well.'), rating: Number.NaN },
  ];
  const report = aggregateProductFitReport(ratingMeta, messy);
  assert.equal(report.ratedReviewCount, 1);
  assert.equal(report.overallAvgRating, 5);
  assert.deepEqual(report.reviews.map((r) => r.rating), [5, null, null]);
});

test('a report where no review has stars shows no rating anywhere and says nothing about sentiment', () => {
  const report = aggregateProductFitReport(ratingMeta, [
    plainReview('a', 'M', null, 'Standard cut, nothing unusual here.'),
    plainReview('b', 'M', null, 'Standard cut, nothing unusual here too.'),
  ]);
  assert.equal(report.totalReviews, 2);
  assert.equal(report.ratedReviewCount, 0);
  assert.equal(report.overallAvgRating, 0);
  assert.equal(report.overallSentimentScore, 0);
  assert.equal(report.overallVerdict, 'True to Size');
  assert.equal(report.merchandisingTakeaway, 'True to Size (100% of reviews, Fit Index 0.00).');
  const sizeM = report.sizeSummaries.find((s) => s.size === 'M')!;
  assert.equal(sizeM.ratedReviewCount, 0);
  assert.equal(sizeM.returnRisk, 'Low');
  assert.equal(sizeM.trendSummary, 'Size M tracks true to standard grading (Fit Index 0.00): 100% of reviewers report accurate proportions.');
});

test('the SQL dump writes NULL, not 0, for a rating and sentiment that do not exist', () => {
  const report = aggregateProductFitReport(ratingMeta, [
    plainReview('r1', 'M', 5, 'Standard cut, nothing unusual here.'),
    plainReview('r2', 'M', 4, 'Standard cut, nothing unusual here too.'),
    plainReview('r3', 'L', null, 'Runs small.'),
  ]);
  const dump = generateSqlInsertDump([report]);
  assert.ok(dump.includes('  avg_rating DECIMAL(3,1),'));
  assert.ok(dump.includes('  sentiment_score INT,'));
  // M: sentiment (88 + 69) / 2 = 78.5 -> 79, stars 4.5. L has no stars.
  assert.ok(dump.includes("0, 79, 4.5, 'Low'"));
  assert.ok(dump.includes("0, NULL, NULL, 'Moderate'"));
  // Overall: 2 of 3 reviews rated, so the SKU row keeps 79 and 4.5.
  assert.ok(dump.includes(', 79, 4.5, \'https://example.test/rating-tee\''));
  const noStars = generateSqlInsertDump([aggregateProductFitReport(ratingMeta, [plainReview('x', 'M', null, 'Runs small.')])]);
  assert.ok(noStars.includes(', NULL, NULL, \'https://example.test/rating-tee\''));
});

test('rating text helpers show a dash for a missing rating', () => {
  assert.equal(formatReviewStars(4), '4.0★');
  assert.equal(formatReviewStars(null), NO_RATING_DASH);
  assert.equal(formatReviewStars(undefined), NO_RATING_DASH);
  assert.equal(formatSentiment(79), '79/100');
  assert.equal(formatSentiment(null), NO_RATING_DASH);
  assert.equal(NO_RATING_DASH, '—');
  // 0 stored beside a count of 0 is "none". An older report with no count keeps its numbers.
  assert.equal(meanOrNull(0, 0), null);
  assert.equal(meanOrNull(4.5, 2), 4.5);
  assert.equal(meanOrNull(4.5, undefined), 4.5);
});
