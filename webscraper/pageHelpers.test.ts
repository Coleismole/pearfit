import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  cleanProductTitle,
  isEmptyStarFill,
  labelledValue,
  leafTexts,
  longestFreeText,
  productIdFromUrl,
  ratingFromLabel,
  ratingFromStarIcons,
} from './pageHelpers.ts';

const FILLED = '<svg><path fill="currentColor" d="M0 0"></path></svg>';
const EMPTY = '<svg><path fill="#DADADA" d="M0 0"></path></svg>';

// Trimmed copy of a rendered UNIQLO review list item (class names shortened).
const UNIQLO_CARD = `<li>
  <div>
    <div class="content-alignment"><div>Great jacket but can't handle light rain</div><div>11/1/2026</div></div>
    <div class="rating" data-testid="ITORating">${FILLED}${FILLED}${FILLED}${FILLED}${EMPTY}</div>
    <div><p>Purchased size: XS</p><p>Purchased colour: 31 BEIGE</p><p>How it fits: A bit loose</p></div>
    <div class="add-word-break"><div>I love the light weight of this. It is not water resistant though.</div></div>
    <div class="reviewUserInfo"><span>LizM17</span><span>Female</span><span>Height: 5'4" - 5'5"</span><span>Weight: 120lb - 129lb</span></div>
  </div>
</li>`;

test('labelled fields, body and stars are read from unlabelled review-card markup', () => {
  const $ = cheerio.load(UNIQLO_CARD);
  const node = $('li');
  const lines = leafTexts($, node);

  assert.equal(labelledValue(lines, /^(purchased size|size)$/i), 'XS');
  assert.equal(labelledValue(lines, /^how it fits$/i), 'A bit loose');
  assert.equal(labelledValue(lines, /^height$/i), `5'4" - 5'5"`);
  assert.equal(labelledValue(lines, /^weight$/i), '120lb - 129lb');
  assert.equal(labelledValue(lines, /^usual size$/i), '');
  assert.equal(
    longestFreeText(lines, ['LizM17']),
    'I love the light weight of this. It is not water resistant though.'
  );
  // 4 filled (currentColor) + 1 empty (#DADADA)
  assert.equal(ratingFromStarIcons($, node), '4');
});

test('isEmptyStarFill treats light greys and transparent as empty, real colours as filled', () => {
  assert.equal(isEmptyStarFill('#DADADA'), true);
  assert.equal(isEmptyStarFill('#eee'), true);
  assert.equal(isEmptyStarFill('transparent'), true);
  assert.equal(isEmptyStarFill('#000000'), false);
  assert.equal(isEmptyStarFill('#FFC107'), false); // gold star: channels differ a lot
  assert.equal(isEmptyStarFill('currentColor'), false);
});

test('ratingFromLabel parses "x out of y" and rescales to 1-5', () => {
  assert.equal(ratingFromLabel('4.5 out of 5 stars'), '4.5');
  assert.equal(ratingFromLabel('Rated 10 out of 10'), '5');
  assert.equal(ratingFromLabel('no rating here'), '');
  assert.equal(ratingFromLabel(undefined), '');
});

test('cleanProductTitle strips "Reviews for" and the site suffix', () => {
  assert.equal(cleanProductTitle("Reviews for Women's Utility Cotton Blend Parka | UNIQLO CA"), "Women's Utility Cotton Blend Parka");
  assert.equal(cleanProductTitle('Oxford Shirt'), 'Oxford Shirt');
  assert.equal(cleanProductTitle(''), null);
});

test('productIdFromUrl finds product codes in common URL shapes', () => {
  assert.equal(productIdFromUrl('https://www.uniqlo.com/ca/en/products/E487396-000/00/reviews'), 'E487396-000');
  assert.equal(productIdFromUrl('https://shop.example/products/e487396-000'), 'e487396-000');
  assert.equal(productIdFromUrl('https://www.patagonia.com/product/mens-shirt/45215.html'), '45215');
  assert.equal(productIdFromUrl('https://example.com/about'), null);
});
