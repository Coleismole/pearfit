import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSizeFromReviewText,
  extractStructuredProduct,
  parseJsonLdScripts,
} from './structuredData';

test('extractStructuredProduct reads Product + reviews from a JSON-LD @graph', () => {
  const blocks = parseJsonLdScripts([
    '{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}',
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Product',
          name: 'Oxford Shirt',
          brand: { '@type': 'Brand', name: 'COS' },
          sku: 'COS-123',
          material: '100% cotton',
          offers: [{ '@type': 'Offer', price: '89.00', priceCurrency: 'USD' }],
          review: [
            {
              '@type': 'Review',
              author: { '@type': 'Person', name: 'Sam' },
              reviewRating: { '@type': 'Rating', ratingValue: 4, bestRating: 5 },
              reviewBody: 'Size purchased: M. Runs small across the chest.',
              datePublished: '2026-09-01',
            },
            {
              '@type': 'Review',
              author: 'Kim',
              reviewRating: { ratingValue: '8', bestRating: '10', worstRating: '0' },
              reviewBody: 'Love the colour, true to size.',
            },
            { '@type': 'Review', reviewBody: 'ok' },
          ],
        },
      ],
    }),
    '{ not valid json',
  ]);

  const p = extractStructuredProduct(blocks)!;
  assert.equal(p.name, 'Oxford Shirt');
  assert.equal(p.brand, 'COS');
  assert.equal(p.sku, 'COS-123');
  assert.equal(p.price, '89.00 USD');
  assert.equal(p.material, '100% cotton');
  // The 2-character body is skipped.
  assert.equal(p.reviews.length, 2);
  assert.equal(p.reviews[0].author, 'Sam');
  assert.equal(p.reviews[0].rating, 4);
  assert.equal(p.reviews[0].sizePurchased, 'M');
  assert.equal(p.reviews[0].declaredFitTag, 'Runs small');
  // 8 on a 0-10 scale -> 1 + 0.8 * 4 = 4.2 -> 4
  assert.equal(p.reviews[1].rating, 4);
  assert.equal(p.reviews[1].sizePurchased, '');
});

test('reviews of a different product are not mixed into this one', () => {
  const product = extractStructuredProduct([
    {
      '@type': 'Product',
      name: 'Oxford Shirt',
      sku: 'OX-1',
      review: {
        '@type': 'Review',
        reviewBody: 'Size: M. Runs small in the chest.',
      },
    },
    {
      '@type': 'Product',
      name: 'Other Jacket',
      sku: 'JK-9',
      review: {
        '@type': 'Review',
        reviewBody: 'This jacket runs large and is a completely different product review.',
      },
    },
    {
      '@type': 'Review',
      itemReviewed: { '@type': 'Product', sku: 'JK-9', name: 'Other Jacket' },
      reviewBody: 'Another jacket review that should stay with the jacket.',
    },
    {
      '@type': 'Review',
      reviewBody: 'Unlinked note: true to size in the sleeves.',
    },
  ])!;
  assert.deepEqual(
    product.reviews.map((review) => review.body),
    ['Size: M. Runs small in the chest.', 'Unlinked note: true to size in the sleeves.']
  );
});

test('extractStructuredProduct returns null when there is no Product node', () => {
  assert.equal(extractStructuredProduct(parseJsonLdScripts(['{"@type":"WebSite","name":"x"}'])), null);
});

test('missing JSON-LD fields stay null', () => {
  const p = extractStructuredProduct([{ '@type': 'Product', name: 'Tee' }])!;
  assert.equal(p.brand, null);
  assert.equal(p.sku, null);
  assert.equal(p.price, null);
  assert.deepEqual(p.reviews, []);
});

test('extractSizeFromReviewText finds the stated size or returns empty', () => {
  assert.equal(extractSizeFromReviewText('I ordered a medium and it fits'), 'medium');
  assert.equal(extractSizeFromReviewText('Size: XL'), 'XL');
  assert.equal(extractSizeFromReviewText('Bought it in size L, perfect'), 'L');
  assert.equal(extractSizeFromReviewText('Great shirt overall'), '');
  assert.equal(extractSizeFromReviewText('Size: X-Large'), 'X-Large');
  assert.equal(extractSizeFromReviewText('I ordered a 3XL'), '3XL');
});
