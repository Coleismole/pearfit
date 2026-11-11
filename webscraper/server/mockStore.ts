/** The built-in sample store pages the UI can scrape. */
import type { ProductFitReport, RawScrapedReview } from '../fitAnalyzer.ts';
import { HM_HEAVYWEIGHT_TEE_REVIEWS } from '../seedCatalog.ts';

export interface MockStoreProduct {
  slug: string;
  name: string;
  brand: string;
  category: ProductFitReport['category'];
  sku: string;
  price: string;
  fabricComposition: string;
  reviews: RawScrapedReview[];
}

/** Own keys only, so a slug like "constructor" is not found. */
export function mockStoreProduct(slug: string): MockStoreProduct | undefined {
  return Object.hasOwn(MOCK_STORE_PRODUCTS, slug) ? MOCK_STORE_PRODUCTS[slug] : undefined;
}

const MOCK_STORE_PRODUCTS: Record<string, MockStoreProduct> = {
  'hm-heavyweight-relaxed-tee': {
    slug: 'hm-heavyweight-relaxed-tee',
    name: 'H&M Relaxed Fit Heavyweight Cotton T-Shirt',
    brand: 'H&M (Blank Staples)',
    category: 'T-Shirts & Tops',
    sku: 'HM-1096385-WHT',
    price: '$19.99',
    fabricComposition: '100% Heavyweight Carded Cotton Jersey (240 GSM · Non-Sheer Opaque Knit)',
    reviews: HM_HEAVYWEIGHT_TEE_REVIEWS,
  },
  'hm-regular-fit-crew-tee': {
    slug: 'hm-regular-fit-crew-tee',
    name: 'H&M Regular Fit Crew-Neck Cotton Tee',
    brand: 'H&M Divided',
    category: 'T-Shirts & Tops',
    sku: 'HM-0685816-BLK',
    price: '$9.99',
    fabricComposition: '100% Lightweight Combed Cotton Jersey (160 GSM)',
    reviews: [
      {
        id: 'hmr-1',
        author: 'Kevin T.',
        sizePurchased: 'XS',
        rating: 4,
        title: 'Slimmer cut than Blank Staples',
        body: 'True to size in XS for a close standard fit, though the 160 gsm lightweight fabric is much thinner and slightly sheer in white.',
        date: '2026-10-28',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'hmr-2',
        author: 'Leo P.',
        sizePurchased: 'S',
        rating: 3,
        title: 'Shrunk a full size after first wash',
        body: 'Runs small after the first wash! Shrunk in both chest width and torso length in the dryer. Definitely size up.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-3',
        author: 'Samir B.',
        sizePurchased: 'S',
        rating: 3,
        title: 'Snug shoulders and thin jersey',
        body: 'Smaller than expected across the shoulders and sleeves. Paper-thin fabric compared to the heavyweight tee.',
        date: '2026-10-22',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-4',
        author: 'Andre M.',
        sizePurchased: 'M',
        rating: 2,
        title: 'Runs small and tight in the chest',
        body: 'Runs very small in size M! Tight across the chest and armholes, and shrank in length after washing. Order a size larger.',
        date: '2026-10-27',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-5',
        author: 'Jason K.',
        sizePurchased: 'M',
        rating: 3,
        title: 'Clings to midsection',
        body: 'Runs small through the waist and chest. Lightweight jersey shows everything and is slightly see-through.',
        date: '2026-10-19',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-6',
        author: 'Ryan D.',
        sizePurchased: 'L',
        rating: 2,
        title: 'L fits like a tight Medium after wash',
        body: 'Runs small! Shrunk in the dryer and now it is way too tight in the shoulders and short in the torso.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-7',
        author: 'Carter W.',
        sizePurchased: 'L',
        rating: 4,
        title: 'Sized up to L from M',
        body: 'Ordered a size up to L because H&M regular fit tees run small and shrink. Fits fine in the chest if you hang dry.',
        date: '2026-10-16',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-8',
        author: 'Nate H.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'Narrow shoulders and short sleeves in XL',
        body: 'Runs very small in XL. Way too tight across the upper back and shoulders, and thin sheer cotton.',
        date: '2026-10-24',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'hmr-9',
        author: 'Paul G.',
        sizePurchased: 'XXL',
        rating: 2,
        title: 'XXL is tight in the waist and short',
        body: 'Runs small in XXL! Tight around the midsection and shrunk in torso length after the first wash.',
        date: '2026-10-20',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
    ],
  },
  'solaris-linen-shirt': {
    slug: 'solaris-linen-shirt',
    name: 'Solaris Relaxed Belgian Linen Camp Shirt',
    brand: 'Atelier Côte',
    category: 'Shirting',
    sku: 'ATC-312-SND',
    price: '$165',
    fabricComposition: '100% Yarn-Dyed Belgian Flax Linen (195 gsm, Enzyme Washed)',
    reviews: [
      {
        id: 'sls-1',
        author: 'Henri L.',
        sizePurchased: 'XS',
        rating: 5,
        title: 'Breezy resort cut in XS',
        body: 'Runs large with a generous cut across the shoulders and chest. Great drape for summer wear.',
        date: '2026-10-24',
        verifiedPurchase: true,
        reviewerHeight: '5\'7"',
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-2',
        author: 'Matteo G.',
        sizePurchased: 'XS',
        rating: 4,
        title: 'Roomy sleeves and body',
        body: 'Bigger than expected in XS. Loose around the waist and wide sleeves, size down if between sizes.',
        date: '2026-10-19',
        verifiedPurchase: true,
        reviewerHeight: '5\'6"',
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-3',
        author: 'Sebastian V.',
        sizePurchased: 'S',
        rating: 5,
        title: 'Sized down to S from M — spot on',
        body: 'Runs large so I ordered a size down to S. Fits perfectly in the shoulders and chest now!',
        date: '2026-10-22',
        verifiedPurchase: true,
        reviewerHeight: '5\'9"',
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-4',
        author: 'Oliver W.',
        sizePurchased: 'S',
        rating: 4,
        title: 'Very relaxed boxy camp collar',
        body: 'Runs large through the waist and chest. Breathable linen fabric.',
        date: '2026-10-15',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-5',
        author: 'Adrian K.',
        sizePurchased: 'M',
        rating: 4,
        title: 'Generous sizing in M',
        body: 'Runs large! Loose in the waist and wide in the sleeves. Definitely a resort oversized fit.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-6',
        author: 'Felix N.',
        sizePurchased: 'M',
        rating: 5,
        title: 'True to camp shirt proportions',
        body: 'True to size if you like a relaxed coastal drape in the chest and shoulders.',
        date: '2026-10-12',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'sls-7',
        author: 'Damian R.',
        sizePurchased: 'L',
        rating: 3,
        title: 'Way too baggy in the midsection',
        body: 'Runs very large in size L. Swimming in it around the waist and chest. Size down one full size.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-8',
        author: 'Jonah P.',
        sizePurchased: 'L',
        rating: 4,
        title: 'Wide shoulders and long sleeves',
        body: 'Bigger than expected in the shoulders and sleeves. Super soft linen though.',
        date: '2026-10-17',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-9',
        author: 'Marcus B.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'Like a sail in XL',
        body: 'Runs extremely large! Way too boxy in the waist and hips, and sleeves reach past my elbows. Returning for L.',
        date: '2026-10-27',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-10',
        author: 'Grant T.',
        sizePurchased: 'XL',
        rating: 3,
        title: 'Excess fabric at waist and back',
        body: 'Runs large and loose around the waist and chest. Size down.',
        date: '2026-10-14',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
      {
        id: 'sls-11',
        author: 'Winston H.',
        sizePurchased: 'XXL',
        rating: 3,
        title: 'Very wide cut in XXL',
        body: 'Runs large with overly wide chest and waist proportions. Order a size smaller.',
        date: '2026-10-20',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Large',
      },
    ],
  },
  'corsa-sculpt-midi-dress': {
    slug: 'corsa-sculpt-midi-dress',
    name: 'Corsa Compression Rib Sculpt Midi Dress',
    brand: 'Studio Veloce',
    category: 'Dresses',
    sku: 'STV-904-BLK',
    price: '$245',
    fabricComposition: '78% Viscose Compact Rib, 22% High-Recovery Polyamide',
    reviews: [
      {
        id: 'cmd-1',
        author: 'Elena V.',
        sizePurchased: 'XS',
        rating: 4,
        title: 'Snug compression fit in XS',
        body: 'Runs small with strong compression in the waist and bust, but flattering if you like a sculpted look.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-2',
        author: 'Aria M.',
        sizePurchased: 'S',
        rating: 3,
        title: 'Very tight through ribcage and bust',
        body: 'Runs small! Way too tight in the chest and waist. Definitely size up if you want to breathe.',
        date: '2026-10-23',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-3',
        author: 'Nina C.',
        sizePurchased: 'S',
        rating: 5,
        title: 'Sized up to S from XS',
        body: 'Ordered a size up to S because it runs small. Now the hips and waist fit like a glove!',
        date: '2026-10-18',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-4',
        author: 'tessa_k',
        sizePurchased: 'M',
        rating: 2,
        title: 'Constricting in the hips and shoulders',
        body: 'Runs very small in size M. Pulls at the hips and tight across the shoulders and armholes. Returning to size up.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-5',
        author: 'Jade R.',
        sizePurchased: 'M',
        rating: 3,
        title: 'Smaller than expected',
        body: 'Smaller than expected around the waist and bust. Heavyweight rib has less stretch than anticipated.',
        date: '2026-10-16',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-6',
        author: 'Sophia L.',
        sizePurchased: 'L',
        rating: 2,
        title: 'L fits like a tight Small/Medium',
        body: 'Runs extremely small! Couldn’t get it over my shoulders comfortably and way too tight in the hips and waist.',
        date: '2026-10-27',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-7',
        author: 'Lauren B.',
        sizePurchased: 'L',
        rating: 3,
        title: 'Size up at least one size',
        body: 'Runs small through the bust, waist, and hips. Order a size larger.',
        date: '2026-10-19',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-8',
        author: 'Vanessa D.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'Unwearably tight in XL',
        body: 'Runs very small in XL. Way too tight in the chest, waist, and sleeves. Disappointed and returning.',
        date: '2026-10-24',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'cmd-9',
        author: 'Keira P.',
        sizePurchased: 'XXL',
        rating: 3,
        title: 'XXL works if you are normally L/XL',
        body: 'Runs small across the hips and bust, so sizing up to XXL was necessary for a comfortable drape.',
        date: '2026-10-14',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
    ],
  },
  'nordic-boiled-wool-overshirt': {
    slug: 'nordic-boiled-wool-overshirt',
    name: 'Nordic Boiled Wool Structured Overshirt',
    brand: 'Fjord & Loom',
    category: 'Outerwear',
    sku: 'FJL-508-GRY',
    price: '$275',
    fabricComposition: '100% Norwegian Felted Boiled Virgin Wool (420 gsm)',
    reviews: [
      {
        id: 'nwo-1',
        author: 'Soren A.',
        sizePurchased: 'XS',
        rating: 5,
        title: 'True to size Scandinavian tailoring',
        body: 'True to size in XS! Fits perfectly across the shoulders and torso length.',
        date: '2026-10-22',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'nwo-2',
        author: 'Freja M.',
        sizePurchased: 'S',
        rating: 5,
        title: 'Fits just right in S',
        body: 'Fits just right in the chest, shoulders, and sleeves. Warm boiled wool without bulk.',
        date: '2026-10-20',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'nwo-3',
        author: 'Lukas E.',
        sizePurchased: 'M',
        rating: 5,
        title: 'Exact usual size M',
        body: 'True to size and fits like a glove over a light knit. Shoulders and waist are balanced.',
        date: '2026-10-18',
        verifiedPurchase: true,
        declaredFitTag: 'True to Size',
      },
      {
        id: 'nwo-4',
        author: 'Henrik B.',
        sizePurchased: 'L',
        rating: 3,
        title: 'Runs small in L across upper back',
        body: 'Runs small in size L! Tight across the shoulders and sleeves have zero stretch. Size up if layering.',
        date: '2026-10-25',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'nwo-5',
        author: 'Magnus T.',
        sizePurchased: 'XL',
        rating: 2,
        title: 'XL chest and cuffs are way too tight',
        body: 'Runs very small in XL. Pulls at the chest buttons and tight in the shoulders and forearms. Returning.',
        date: '2026-10-26',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
      {
        id: 'nwo-6',
        author: 'Anders K.',
        sizePurchased: 'XXL',
        rating: 2,
        title: 'XXL grading is narrow in shoulders',
        body: 'Runs small! Smaller than expected in the shoulders, chest, and sleeve length for XXL. Size up.',
        date: '2026-10-24',
        verifiedPurchase: true,
        declaredFitTag: 'Runs Small',
      },
    ],
  },
};

export function renderMockStoreHtml(product: MockStoreProduct): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    brand: { '@type': 'Brand', name: product.brand },
    sku: product.sku,
    category: product.category,
  };

  const reviewHtml = product.reviews
    .map(
      (r) => `
      <article class="review-card" data-review-card="true" data-size="${r.sizePurchased}" data-rating="${r.rating}" data-fit="${r.declaredFitTag || ''}" data-author="${r.author}" data-date="${r.date}">
        <header>
          <span class="review-author">${r.author}</span>
          <span class="review-size-tag">Size Purchased: <strong>${r.sizePurchased}</strong></span>
          <span class="review-rating">${r.rating}/5 Stars</span>
          ${r.declaredFitTag ? `<span class="review-fit-tag">Fit: ${r.declaredFitTag}</span>` : ''}
        </header>
        <h4 class="review-title">${r.title}</h4>
        <p class="review-body-copy">${r.body}</p>
      </article>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${product.name} | ${product.brand}</title>
  <meta property="og:title" content="${product.name}" />
  <meta name="product:brand" content="${product.brand}" />
  <meta name="product:category" content="${product.category}" />
  <meta name="product:sku" content="${product.sku}" />
  <meta name="product:price" content="${product.price}" />
  <meta name="product:fabric" content="${product.fabricComposition}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <main data-product-container>
    <h1 class="product-title">${product.name}</h1>
    <p class="product-brand">${product.brand}</p>
    <p class="product-specs" data-fabric="${product.fabricComposition}" data-price="${product.price}" data-sku="${product.sku}">${product.fabricComposition}</p>
    <section id="customer-reviews" data-reviews-section>
      <h2>Verified Customer Fit Reviews (${product.reviews.length})</h2>
      ${reviewHtml}
    </section>
  </main>
</body>
</html>`;
}
