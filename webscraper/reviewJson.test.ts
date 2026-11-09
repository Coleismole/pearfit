import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectJsonReviews,
  extractReviewsFromJson,
  fitTagFromAnswer,
  keysFromUrl,
  normalizeRating,
  reviewMatchesProduct,
  sizeFromVariantTitle,
} from './reviewJson.ts';

// Trimmed copies of what each widget's own response looked like on a live product page.

test('Yotpo: size from the purchased variant, usual size and fit centred on 2', () => {
  const body = {
    pagination: { page: 1, perPage: 5, total: 18 },
    bottomline: { totalReview: 18, averageScore: 4.33 },
    reviews: [
      {
        id: 911780503,
        score: 5,
        content: 'Love this t-shirt! It is soft and comfy.',
        title: 'Great t-shirt',
        createdAt: '2026-10-26T19:44:00',
        verifiedBuyer: true,
        customFields: {
          '119743': { title: 'Fit', fieldType: 'Size', value: 2 },
          '120046': { title: 'Size Purchased', fieldType: 'CustomerFreeText', value: 'XXL only size available' },
          '120047': { title: 'Usual Size', fieldType: 'CustomerFreeText', value: 'Medium-large' },
        },
        user: { displayName: 'Maureen D.' },
        productVariants: { Size: 'XXL' },
      },
      {
        id: 2,
        score: 4,
        content: 'A bit snug in the chest.',
        title: 'Snug',
        customFields: { '1': { title: 'Fit rating / Fit', fieldType: 'Size', value: 1 } },
        user: { displayName: 'J M.' },
      },
    ],
  };
  const { reviews, reportedTotal } = extractReviewsFromJson(body);
  assert.equal(reportedTotal, 18);
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].author, 'Maureen D.');
  assert.equal(reviews[0].rating, 5);
  assert.equal(reviews[0].verifiedPurchase, true);
  // "Size Purchased" is free text ("XXL only size available"); the variant answer "XXL" is exact and wins.
  assert.equal(reviews[0].sizePurchased, 'XXL');
  assert.equal(reviews[0].usualSize, 'Medium-large');
  // 2 is the centre of Yotpo's size scale.
  assert.equal(reviews[0].declaredFitTag, 'True to Size');
  // 1 is one step below the centre on a half-width of 1: |1 - 2| / 1 = 1 >= 0.75, so "Runs".
  assert.equal(reviews[1].declaredFitTag, 'Runs Small');
});

test('Klaviyo: a 0 to 4 centred range and the size in the variant title', () => {
  const body = {
    reviews: [
      {
        id: 17283223,
        author: 'James L.',
        content: 'I am 6 feet, 160lbs, and the small is perfect!',
        title: 'TOO GOOD!',
        rating: 5,
        created_at: '2026-03-13T21:31:42Z',
        verified: true,
        question_answers: {
          q1: { label: 'How it fits', answer: ['2'], type: 'centered_range', values: { min: 'Too small', center: 'Just right', max: 'Too big' } },
        },
        product_variant: { title: 'Small / Navy Ski Print', product_external_id: '8016253780042' },
        product: { shopify_id: 8016253780042, name: 'Tahoe Fresh Tracks Flannel Shirt', review_count: 1 },
      },
      {
        id: 2,
        author: 'Kim',
        content: 'Way too roomy.',
        rating: 3,
        question_answers: {
          q1: { label: 'How it fits', answer: ['4'], type: 'centered_range', values: { min: 'Too small', center: 'Just right', max: 'Too big' } },
        },
        product_variant: { title: 'Large / Navy Ski Print' },
      },
    ],
    summary: { review_count: 15 },
    filtered_count: 15,
  };
  const { reviews, reportedTotal } = extractReviewsFromJson(body);
  assert.equal(reportedTotal, 15);
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].sizePurchased, 'Small');
  assert.equal(reviews[0].declaredFitTag, 'True to Size');
  assert.deepEqual(reviews[0].productKeys, ['8016253780042']);
  assert.equal(reviews[0].productName, 'Tahoe Fresh Tracks Flannel Shirt');
  // 4 on a 0..4 scale centred on 2: |4 - 2| / 2 = 1, toward "Too big".
  assert.equal(reviews[1].declaredFitTag, 'Runs Large');
  assert.equal(reviews[1].sizePurchased, 'Large');
});

test('Reviews.io (Vuori): a five-point centred range with three labels, and reviewer height', () => {
  const body = {
    review_count: 14715,
    reviews: [
      {
        id: 'product_review-60166969',
        rating: 5,
        title: 'Great tee',
        comments: 'I love the Strato Tech Tee and have it in a number of colors.',
        author: {
          name: 'Michael A',
          attributes: [
            { label: 'What is your height?', type: 'choices', value: '5\'9" - 6\'0"' },
            { label: 'What is your body type?', type: 'choices', value: 'Average' },
          ],
        },
        date_created: '2026-11-07 23:55:09',
        sku: 'V126HAOMED',
        product_name: 'Strato Tech Tee | Acorn Heather',
        attributes: [{ label: 'How was the fit?', type: 'centered-range', options: ['They run small', 'True to size', 'They run big'], value: '2' }],
        product_options: [{ name: 'Color', value: 'Acorn Heather' }, { name: 'Size', value: 'M' }],
        verified: 1,
      },
    ],
  };
  const { reviews, reportedTotal } = extractReviewsFromJson(body);
  assert.equal(reportedTotal, 14715);
  const [r] = reviews;
  assert.equal(r.author, 'Michael A');
  assert.equal(r.sizePurchased, 'M');
  // 2 on 1..5 centred on 3: |2 - 3| / 2 = 0.5 < 0.75, so "Slightly".
  assert.equal(r.declaredFitTag, 'Slightly Small');
  assert.equal(r.reviewerHeight, '5\'9" - 6\'0"');
  assert.equal(r.reviewerBuild, 'Average');
  assert.equal(r.verifiedPurchase, true);
  assert.equal(r.productName, 'Strato Tech Tee | Acorn Heather');
});

test('Bazaarvoice: SecondaryRatings fit on its range, ContextDataValues size, and TotalResults', () => {
  const body = {
    TotalResults: 4747,
    Results: [
      {
        Id: '252884845',
        ProductId: '39031035',
        Rating: 5,
        Title: 'Good fabric',
        ReviewText: 'Too loose for me since I ordered size Large.',
        UserNickname: 'Marianes',
        SubmissionTime: '2026-07-17T12:32:43.000+00:00',
        ContextDataValues: {
          Age: { Value: '55to64', Id: 'Age' },
          SizePurchased: { Value: 'L', ValueLabel: 'Large', DimensionLabel: 'Size Purchased', Id: 'SizePurchased' },
        },
        SecondaryRatings: { Fit_22: { Value: 5, Id: 'Fit_22', ValueRange: 5, MinLabel: null, MaxLabel: null, Label: null } },
        Badges: { VerifiedPurchaser_1True: { Id: 'VerifiedPurchaser_1True' } },
      },
      {
        Id: '2',
        ProductId: '39031035',
        Rating: 4,
        ReviewText: 'Fits as expected.',
        UserNickname: 'Ann',
        SecondaryRatings: { Fit: { Value: 3, ValueRange: 5, MinLabel: 'Runs small', MaxLabel: 'Runs large' } },
      },
    ],
  };
  const { reviews, reportedTotal } = extractReviewsFromJson(body);
  assert.equal(reportedTotal, 4747);
  assert.equal(reviews[0].sizePurchased, 'Large');
  // 5 on 1..5 centred on 3: |5 - 3| / 2 = 1, toward large.
  assert.equal(reviews[0].declaredFitTag, 'Runs Large');
  assert.equal(reviews[0].verifiedPurchase, true);
  assert.deepEqual(reviews[0].productKeys, ['39031035']);
  assert.equal(reviews[1].declaredFitTag, 'True to Size');
});

test('Stamped: review fields, size from the variant name, and the product total (not totalAll)', () => {
  const body = {
    total: 24,
    totalAll: 44831,
    data: [
      {
        id: 155799289,
        author: 'scott k.',
        reviewTitle: 'Stunning Shirt Jacket',
        reviewMessage: 'Heavier than I expected.',
        reviewRating: 5,
        dateCreated: '2025-11-23T07:32:04Z',
        productId: 7454611800141,
        productName: 'The Cutter Overshirt in Timber Plaid',
        productVariantName: 'XL - 44',
        reviewOptionsList: [],
      },
    ],
  };
  const { reviews, reportedTotal } = extractReviewsFromJson(body);
  assert.equal(reportedTotal, 24);
  assert.equal(reviews[0].sizePurchased, 'XL');
  assert.equal(reviews[0].title, 'Stunning Shirt Jacket');
  assert.deepEqual(reviews[0].productKeys, ['7454611800141']);
});

test('a product or aggregate with a rating is not a review', () => {
  const body = { product: { name: 'Tee', star_rating: 4.9, review_count: 15, description: 'Soft tee' } };
  assert.deepEqual(extractReviewsFromJson(body).reviews, []);
  assert.equal(extractReviewsFromJson(body).reportedTotal, null);
});

test('ratings on 10- and 100-point scales become 1 to 5', () => {
  assert.equal(normalizeRating(4), 4);
  assert.equal(normalizeRating('4.5'), 4.5);
  assert.equal(normalizeRating(8), 4); // 8 / 2
  assert.equal(normalizeRating(90), 4.5); // 90 / 20
  assert.equal(normalizeRating({ ratingValue: 3, bestRating: 4 }), 3.8); // 3 / 4 × 5 = 3.75 → 3.8
  assert.equal(normalizeRating(0), null);
  assert.equal(normalizeRating('great'), null);
});

test('a fit answer on an unknown scale is not guessed', () => {
  assert.equal(fitTagFromAnswer({ label: 'Fit', value: '3', numeric: 3, scale: null }), null);
  assert.equal(fitTagFromAnswer({ label: 'Fit', value: 'Runs a bit small', numeric: null, scale: null }), 'Slightly Small');
  assert.equal(fitTagFromAnswer({ label: 'Fit', value: 'True to size', numeric: null, scale: null }), 'True to Size');
  assert.equal(fitTagFromAnswer({ label: 'Fit', value: 'Relaxed', numeric: null, scale: null }), null);
});

test('variant titles give a size only when a part is a size', () => {
  assert.equal(sizeFromVariantTitle('Small / Navy Ski Print'), 'Small');
  assert.equal(sizeFromVariantTitle('XL - 44'), 'XL');
  assert.equal(sizeFromVariantTitle('Slate Blue / M'), 'M');
  assert.equal(sizeFromVariantTitle('32 / 30'), '32');
  // "Slate" starts with S but is a colour.
  assert.equal(sizeFromVariantTitle('Slate Blue'), null);
  assert.equal(sizeFromVariantTitle('The Cutter Overshirt in Timber Plaid'), null);
});

test('reviews are matched to the page product by id, handle or name', () => {
  const product = { keys: ['8016253780042', 'fresh-tracks-stretch-selvage-shirt'], name: 'Strato Tech Tee' };
  assert.equal(reviewMatchesProduct({ productKeys: ['8016253780042'], productName: null }, [], product), true);
  assert.equal(reviewMatchesProduct({ productKeys: ['999'], productName: 'Other Shirt' }, [], product), false);
  // No key on the review: the response URL's keys stand in for it.
  assert.equal(reviewMatchesProduct({ productKeys: [], productName: null }, ['8016253780042'], product), true);
  assert.equal(reviewMatchesProduct({ productKeys: ['v126haomed'], productName: 'Strato Tech Tee | Acorn Heather' }, [], product), true);
  // Names nothing at all: unknown, left to the caller.
  assert.equal(reviewMatchesProduct({ productKeys: [], productName: null }, [], product), null);
});

test('product keys come from long numbers in a response URL', () => {
  assert.deepEqual(
    keysFromUrl('https://api-cdn.yotpo.com/v3/storefront/store/LvSb/product/10335544737878/reviews?page=1&perPage=5'),
    ['10335544737878'],
  );
  assert.deepEqual(keysFromUrl('https://api.example.com/reviews?Filter=ProductId:eq:795346'), ['795346']);
  assert.deepEqual(keysFromUrl('https://api.okendo.io/v1/stores/abc/products/shopify-7454611800141/reviews'), ['7454611800141']);
});

test('collectJsonReviews keeps this product, drops a carousel of other products, and counts a review once', () => {
  const product = { keys: ['7454611800141'], name: 'The Cutter Overshirt' };
  const mine = (id: number, body: string) => ({ id, reviewRating: 5, reviewMessage: body, productId: 7454611800141 });
  const sources = [
    // The product's own list: 2 reviews, product total 24.
    { url: 'https://stamped.io/api/widget/reviews?productId=7454611800141', value: { total: 24, data: [mine(1, 'Warm and soft'), mine(2, 'Heavier than expected')] } },
    // The same first review again, from a "featured" request.
    { url: 'https://stamped.io/api/widget/reviews?productId=7454611800141&sortReviews=featured', value: { total: 24, data: [mine(1, 'Warm and soft')] } },
    // A shop-wide carousel: every review names another product.
    {
      url: 'https://stamped.io/api/widget/reviews/batch',
      value: { data: [{ id: 9, reviewRating: 4, reviewMessage: 'Great pants', productId: 111, productName: 'Chino' }] },
    },
  ];
  const out = collectJsonReviews(sources, product);
  assert.deepEqual(out.reviews.map((r) => r.id), ['1', '2']);
  assert.equal(out.reportedTotal, 24);
  assert.deepEqual(out.sources, ['stamped.io']);
});

test('collectJsonReviews keeps reviews that name no product when the source names none either', () => {
  const out = collectJsonReviews(
    [{ url: 'page:__NEXT_DATA__', value: { props: { reviews: [{ rating: 4, body: 'Nice weight, fits true to size.' }] } } }],
    { keys: ['x1'], name: 'Tee' },
  );
  assert.equal(out.reviews.length, 1);
  assert.deepEqual(out.sources, ['page']);
});

test('collectJsonReviews keeps reviews a store groups under this product (other colourways)', () => {
  // Klaviyo-style list for the page product 8016253780042: one review names it, two name sibling
  // colourways, and the list states a product total of 15. All three are this product's reviews.
  const product = { keys: ['8016253780042', 'fresh-tracks-stretch-selvage-shirt'], name: 'Tahoe Fresh Tracks Flannel Shirt' };
  const review = (id: number, shopifyId: number, name: string) => ({
    id, rating: 5, content: `Review ${id} of a flannel`, product: { shopify_id: shopifyId, name },
  });
  const list = {
    summary: { review_count: 15 },
    reviews: [
      review(1, 8016253780042, 'Tahoe Fresh Tracks Flannel Shirt'),
      review(2, 7795908608074, 'Fresh Tracks Flannel in Navy Plaid'),
      review(3, 7795908608075, 'Fresh Tracks Flannel in Olive'),
    ],
  };
  const out = collectJsonReviews([{ url: 'https://fast.a.klaviyo.com/reviews/api/client_reviews/7795908608074/', value: list }], product);
  assert.deepEqual(out.reviews.map((r) => r.id), ['1', '2', '3']);
  assert.equal(out.reportedTotal, 15);
});

test('a question summary with a score and a title is not a review', () => {
  // Yotpo bottomline: customFieldsBottomline { "--119743": { title: "Fit", type: "Size", averageScore: 2, score: 2 } }.
  const body = {
    bottomline: { totalReview: 18, customFieldsBottomline: { '--119743': { title: 'Fit', type: 'Size', averageScore: 2, score: 2 } } },
    reviews: [{ id: 1, score: 5, content: 'Soft tee', user: { displayName: 'Ana' } }],
    other: { title: 'Quality', score: 4 },
  };
  assert.deepEqual(extractReviewsFromJson(body).reviews.map((r) => r.id), ['1']);
  // A title-only review with a reviewer still counts.
  assert.equal(extractReviewsFromJson({ reviews: [{ score: 5, title: 'Great', user: { displayName: 'Bo' } }] }).reviews.length, 1);
});
