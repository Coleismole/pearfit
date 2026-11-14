import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMensShortSleeveTee, emptyTeeEvidence, extractTeeEvidence, TEE_CATEGORY, type TeeEvidence } from './mensTee.ts';
import { inferCategory } from './server/scrapeHtml.ts';

function evidence(partial: Partial<TeeEvidence>): TeeEvidence {
  return { ...emptyTeeEvidence(), ...partial };
}

test('a page that states men, short sleeve, and t-shirt is kept', () => {
  const decision = classifyMensShortSleeveTee(
    evidence({
      title: "Men's Supima Cotton Crew Neck Short Sleeve T-Shirt",
      breadcrumbs: ['MEN', 'T-Shirts'],
      genders: ['men'],
      sleeve: 'Short',
    }),
  );
  assert.equal(decision.keep, true);
  if (decision.keep) assert.equal(decision.unisex, false);
});

test('a t-shirt whose sleeve length is not stated is dropped', () => {
  const decision = classifyMensShortSleeveTee(
    evidence({
      title: "Nike Sportswear Club Men's T-Shirt",
      genders: ['MEN'],
      categories: ['Graphic Tees', "Men's T-Shirt"],
    }),
  );
  assert.deepEqual(decision, { keep: false, reason: 'ambiguous sleeve length' });
});

test('Uniqlo sleeve tag Long drops a crew-neck tee even when the breadcrumb only says T-Shirts', () => {
  const decision = classifyMensShortSleeveTee(
    evidence({
      title: 'Soft Brushed Crew Neck T-Shirt',
      breadcrumbs: ['MEN', 'T-Shirts, Sweats & Fleece', 'T-Shirts'],
      genders: ['men', 'MEN'],
      sleeve: 'Long',
      attributes: [{ name: 'Sleeve Length', value: 'Long' }],
    }),
  );
  assert.deepEqual(decision, { keep: false, reason: 'long sleeve' });
});

test('Gymshark SS Tops plus gender m is a short-sleeve men tee, and a season code is not', () => {
  const kept = classifyMensShortSleeveTee(
    evidence({
      title: 'Crest T-Shirt',
      genders: ['m'],
      categories: ['Mens>Apparel>SS Tops>t_shirt', 'ss tops', 't-shirt', 'ss22'],
    }),
  );
  assert.equal(kept.keep, true);
  const seasonOnly = classifyMensShortSleeveTee(
    evidence({
      title: 'Crest T-Shirt',
      genders: ['m'],
      categories: ['Mens>Apparel>Tops>t_shirt', 'ss22'],
    }),
  );
  assert.deepEqual(seasonOnly, { keep: false, reason: 'ambiguous sleeve length' });
});

test('women, kids, unisex-without-men, polo, henley, jersey, tank, and compression are dropped', () => {
  const cases: [Partial<TeeEvidence>, string][] = [
    [{ title: "Women's Short Sleeve T-Shirt", genders: ['women'], sleeve: 'Short' }, "women's"],
    [{ title: "Boys' Short Sleeve T-Shirt", genders: ['boys'], sleeve: 'Short' }, 'kids or youth'],
    [{ title: 'Short Sleeve T-Shirt', genders: ['unisex'], sleeve: 'Short' }, 'unisex, not sized for men'],
    [{ title: "Men's Short Sleeve Polo", genders: ['men'], sleeve: 'Short' }, 'polo'],
    [{ title: "Men's Short Sleeve Henley", genders: ['men'], sleeve: 'Short' }, 'henley'],
    [{ title: "Men's Short Sleeve Football Jersey", genders: ['men'], sleeve: 'Short' }, 'jersey'],
    [{ title: "Men's Sleeveless Tank", genders: ['men'], sleeve: 'Sleeveless' }, 'sleeveless or tank'],
    [{ title: "Men's Compression Short Sleeve T-Shirt", genders: ['men'], sleeve: 'Short' }, 'base layer or compression'],
    [{ title: 'AIRism Cotton Crew Neck T-Shirt', genders: ['men'], breadcrumbs: ['MEN', 'Innerwear & Underwear'], sleeve: 'Short' }, 'base layer or compression'],
    [{ title: "Men's 3/4 Sleeve T-Shirt", genders: ['men'], sleeve: '3/4' }, '3/4 sleeve'],
    [{ title: "Men's Hoodie", genders: ['men'] }, 'hoodie or sweatshirt'],
    [{ title: "Men's Button-Up Shirt", genders: ['men'] }, 'button-up'],
    [{ title: 'Crest T-Shirt' }, 'ambiguous audience'],
  ];
  for (const [partial, reason] of cases) {
    assert.deepEqual(classifyMensShortSleeveTee(evidence(partial)), { keep: false, reason }, reason);
  }
  const jerseyFabric = classifyMensShortSleeveTee(
    evidence({ title: "Men's Smooth Jersey Short Sleeve T-Shirt", genders: ['men'], sleeve: 'Short' }),
  );
  assert.equal(jerseyFabric.keep, true);
});

test("women's does not count as men's, and a unisex tee sized for men is kept and flagged", () => {
  const women = classifyMensShortSleeveTee(evidence({ title: "Women's Dri-FIT Short Sleeve T-Shirt", genders: ['WOMEN'], sleeve: 'Short' }));
  assert.deepEqual(women, { keep: false, reason: "women's" });
  const unisex = classifyMensShortSleeveTee(
    evidence({
      title: 'Short Sleeve T-Shirt',
      genders: ['unisex', 'men'],
      sleeve: 'Short',
      categories: ['t-shirt'],
    }),
  );
  assert.equal(unisex.keep, true);
  if (unisex.keep) assert.equal(unisex.unisex, true);
});

test('extractTeeEvidence reads Uniqlo sleeve and gender, Gymshark type, and Nike taxonomy', () => {
  const uniqlo = extractTeeEvidence(
    `<html><script>window.__PRELOADED_STATE__ = ${JSON.stringify({
      entity: {
        pdpEntity: {
          'E1-000-00': {
            product: {
              name: 'AIRism Cotton T-Shirt',
              genderName: 'men',
              genderCategory: 'MEN',
              breadcrumbs: { gender: { locale: 'MEN' }, category: { locale: 'T-Shirts' } },
              tags: [{ group: 'sleeve', groupName: 'Sleeve Length', tag: 'short', tagName: 'Short' }],
            },
          },
        },
      },
    })};</script></html>`,
  );
  assert.equal(uniqlo.title, 'AIRism Cotton T-Shirt');
  assert.equal(uniqlo.sleeve, 'Short');
  assert.ok(uniqlo.genders.includes('men'));
  assert.deepEqual(classifyMensShortSleeveTee(uniqlo).keep, true);

  const gymshark = extractTeeEvidence(
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          productData: {
            product: { title: 'Crest T-Shirt', gender: ['m'], type: 'Mens>Apparel>SS Tops>t_shirt', category: 'ss tops', subcategory: 't-shirt' },
          },
        },
      },
    })}</script></html>`,
  );
  assert.equal(classifyMensShortSleeveTee(gymshark).keep, true);

  const nike = extractTeeEvidence(
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          productGroups: [
            {
              products: {
                'AR1-100': {
                  genders: ['MEN'],
                  isJerseyID: false,
                  taxonomyLabels: { Gender: ['Men'], 'Product Type': ['Graphic Tees'] },
                  productInfo: { fullTitle: "Nike Sportswear Club Men's T-Shirt", subtitle: "Men's T-Shirt" },
                },
              },
            },
          ],
        },
      },
    })}</script></html>`,
  );
  assert.equal(nike.title, "Nike Sportswear Club Men's T-Shirt");
  assert.deepEqual(classifyMensShortSleeveTee(nike), { keep: false, reason: 'ambiguous sleeve length' });
});

test('Supabase category T-Shirts & Tops is required, and short-sleeve is not classified as shorts', () => {
  assert.equal(TEE_CATEGORY, 'T-Shirts & Tops');
  assert.equal(inferCategory("Men's Short Sleeve T-Shirt"), 'T-Shirts & Tops');
  assert.equal(inferCategory('T-Shirts, Sweats & Fleece', 'Graphic T-Shirt'), 'T-Shirts & Tops');
  assert.equal(inferCategory("Men's Chino Shorts"), 'Trousers');
  assert.equal(inferCategory('Fleece Hoodie'), 'Fleece & Hoodies');
  const dropped = classifyMensShortSleeveTee(
    evidence({
      title: "Men's Knit Cardigan",
      genders: ['men'],
      sleeve: 'Short',
      attributes: [{ name: 'style', value: 'short sleeve t-shirt' }],
    }),
  );
  assert.deepEqual(dropped, { keep: false, reason: 'not the t-shirt category' });
});

test('a Shopify product page tag for men and short sleeve is enough to keep a crew', () => {
  const evidence = extractTeeEvidence(`<!doctype html><html><head>
    <meta property="og:title" content="Classic Curved Hem Crew 6-Pack">
    </head><body>
    <script>tags: ["dep_mens","Short Sleeve","SS Crew","SS/SL Tees","Packs"];
    var meta = {"product":{"type":"Short Sleeve Crew","handle":"classic-curved-hem-crews-6-pack"}};</script>
    </body></html>`);
  assert.equal(evidence.title, 'Classic Curved Hem Crew 6-Pack');
  assert.ok(evidence.genders.includes('men'));
  assert.equal(classifyMensShortSleeveTee(evidence).keep, true);

  const lengthNotSleeve = extractTeeEvidence(`<!doctype html><html><head>
    <meta property="og:title" content="Cabernet Crew Neck">
    </head><body><script>tags: ["Mens","short-length-tee","Tall Tee","Crew Necks"];
    var meta = {"product":{"type":"Crew","handle":"cabernet-crew-neck"}};</script></body></html>`);
  assert.deepEqual(classifyMensShortSleeveTee(lengthNotSleeve), { keep: false, reason: 'ambiguous sleeve length' });
});

test('a breadcrumb and a sleeve row in the page are read when no store blob is present', () => {
  const evidence = extractTeeEvidence(`<!doctype html><html><head><meta property="og:title" content="Crew Tee"></head><body>
    <nav aria-label="Breadcrumbs"><a>Men</a><a>Short Sleeve T-Shirts</a></nav>
    <table><tr><td>Sleeve length: Short</td></tr></table>
  </body></html>`);
  assert.equal(evidence.title, 'Crew Tee');
  assert.ok(evidence.breadcrumbs.includes('Men'));
  assert.equal(evidence.sleeve, 'Short');
  assert.equal(classifyMensShortSleeveTee(evidence).keep, true);
});
