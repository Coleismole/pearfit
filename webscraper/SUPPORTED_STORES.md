# Stores confirmed scrapeable

Tested on 2026-11-09 in six rounds with one live product page per store, through `POST /api/scrape`. "Read / stated" is the
number of reviews the scraper read against the total the store states for that product. Paging stops at about
300 reviews or when the render's time runs out (120 s locally, 50 s on Vercel), so a large total is sampled,
newest first where the store offers that sort.

## Reviews and fit

| Store | Product tested | Reviews come from | Read / stated | Size bought | Fit answer |
|---|---|---|---|---|---|
| Uniqlo (CA) | Men's AIRism Cotton Oversized T-Shirt, Men's DRY-EX Polo | Uniqlo's own review service | 300 / 7455, 88 / 88 | yes | yes (1–5 scale) |
| Arc'teryx | Cormac Crew Neck Shirt SS | Bazaarvoice (opened from the rating summary) | 84 / 84 | yes | yes |
| Gap | Classic T-Shirt | Bazaarvoice | 307 / 1460 | from review text only | no field |
| Roots (CA) | Organic Cooper Beaver Long Sleeve T | Bazaarvoice | 6 / 6 | from review text only | yes |
| Frank And Oak | Jasper Shirt | Yotpo | 26 / 26 | yes | yes |
| Everlane | Brushed Flannel Shirt, Tissue Crew | Yotpo | 4 / 4, 18 / 18 | yes | yes |
| Taylor Stitch | The Cutter Overshirt | Stamped | 24 / 24 | yes (variant) | no field |
| Tentree | Northern Aurora T-Shirt, Kessler Sweater | Okendo (first page in the HTML, rest as data) | 3 / 3, 13 / 13 | yes | yes |
| Duer | PurePima Only Tee | Okendo | 115 / 373 | yes | yes |
| Marine Layer | Tahoe Fresh Tracks Flannel Shirt | Klaviyo Reviews (colourways grouped) | 15 / 15 | yes (variant) | yes |
| Vuori | Strato Tech Tee | Vuori's own endpoint (Reviews.io data) | 274 / 14715 | yes | yes |
| Quince | Organic Cotton Heavyweight Tee | Quince's own review service | 157 / 610 | yes | yes (worded) |
| Nike | Sportswear Club Men's T-Shirt | TurnTo, on the product's own review page (followed from "See Reviews") | 311 / 2008 | rarely stated | some |
| L.L.Bean | Carefree Unshrinkable Tee | Bazaarvoice data through L.L.Bean's own endpoint ("Load 10 more" needs a real click) | 304 / 4402 | yes | yes |
| Vineyard Vines | Edgartown Short-Sleeve Pocket Tee | PowerReviews through Vineyard Vines' own endpoint | 16 / 16 | no field | yes |
| Eddie Bauer | Legend Wash Pocket T-Shirt | Yotpo | 200 / 341 | from review text only | few answer it |
| Faherty | The Movement Shirt | Yotpo | 21 / 1343 | yes | yes |
| Ten Thousand | Core Tee | Yotpo | 98 / 98 | yes | yes |
| Organic Basics | Waffle Raglan Long Sleeve | Yotpo | 14 / 14 | yes | yes |
| True Classic | White Stretch Oxford 2.0 | Okendo | 111 / 111 | yes | yes |
| Unbound Merino | Merino Knit Long Sleeve Polo | Okendo (first page in the HTML, rest as data) | 40 / 40 | yes | yes |
| NOBULL | Adapt Polo | Okendo | 129 / 129 | yes | no field |
| Alex Mill | Mill Shirt in Oxford | Klaviyo Reviews | 13 / 13 | yes | yes |
| adidas (at Zappos) | adidas Originals Essential Tee | Zappos' own review pages, followed page by page (`/product/review/<id>/page/N`) | 236 / 236 | rarely stated | rarely stated |
| Banana Republic | Authentic Supima Midweight T-Shirt | Bazaarvoice | 192 / 192 | from review text only | yes |
| Gap Factory | Everyday Soft Crewneck T-Shirt | Bazaarvoice | 305 / 2649 | from review text only | yes |
| Champion | Classic Graphic T-Shirt, Script Logo | Yotpo | 128 / 128 | yes | yes |
| Puma | Essentials No. 1 Logo Tee | TurnTo | 5 / 5 | no field | yes |
| Reebok | Identity Small Logo T-Shirt | Yotpo | 42 / 42 | yes | no field |
| Dickies | Heavyweight Heathered Pocket T-Shirt | Yotpo | 65 / 639 | yes | yes |
| Fruit of the Loom | Short Sleeve Crew T-Shirt (3 pack) | BayEngage | 83 / 83 | no field | no field |
| Quiksilver | Everyday UPF 50 Surf Tee | Yotpo | 12 / 12 | yes | yes |
| Target | Goodfellow & Co Crew Neck T-Shirt | Reviews embedded in the page (the headless browser gets HTTP 429) | 8 / not stated | no field | no field |
| Athleta | Move With Ease Tee | Bazaarvoice | 300 / 2798 | rarely stated | yes |
| Gymshark | Vengeance Long Sleeve T-Shirt | Gymshark's own review service | 8 / 8 | no field | no field |
| Alo Yoga | Airbrush Splendor Dress | Alo Yoga's own review service | 166 / 438 | rarely stated | rarely stated |
| Princess Polly | Hibiscus Haven Oversized Tee | Yotpo | 109 / 109 | yes | yes |
| Beyond Yoga | Featherweight On The Down Low Tee | Yotpo | 300 / 1620 | yes | yes |
| Outdoor Voices | ThinkFast Mesh Muscle Tank | Reviews embedded in the page | 4 / 4 | yes | yes |
| UNTUCKit | Wrinkle-Free Black Stone Shirt | Yotpo | 300 / 1555 | yes | no field |
| Chubbies | The Pit Stop Graphic T-Shirt | Yotpo (the page's review widget names the product) | 300 / 399 | yes | yes |
| Outerknown | Blanket Shirt | Yotpo | 300 / 1090 | yes | yes |
| Cuts Clothing | Riviera Knit Textured Tee | Okendo | 60 / 59 | yes | yes |
| Mack Weldon | Linen Jersey Crew Neck T-Shirt | Junip | 1 / 1 | yes | no field |
| Tommy Bahama | Big & Tall Nova Wave Cotton-Blend Long-Sleeve Shirt | Bazaarvoice | 4 / 4 | yes | yes |
| Cotopaxi | Sombra Long-Sleeve Sun Shirt | Yotpo | 7 / 7 | yes | yes |
| Girlfriend Collective | Black Meredith Bow Tank | Okendo | 24 / 24 | yes | yes |
| Naadam | Lightweight Brushed Relaxed Tee | Yotpo | 4 / 4 | yes | yes |
| Universal Standard | Roxy ComfortDenim Drawstring Jeans | Reviews in the page markup | 1 / 1 | no field | no field |
| Smartwool | Men's Merino Short Sleeve Tee | Yotpo | 185 / 372 | rarely stated | some |
| Icebreaker (North America) | Men's Merino 150 Tech Lite Short Sleeve T-Shirt | Yotpo | 135 / 134 | rarely stated | no field |
| Marmot | Men's Coastal Short-Sleeve T-Shirt | Bazaarvoice (first page only, see limits) | 8 / 23 | yes | yes |
| Summersalt | The High Neck Midi Sports Bra Tank | Yotpo, paged with the widget's "next page" button | 36 / 36 | rarely stated | no field |
| Knix | SculptRib Cotton Tank | Okendo | 144 / 371 | yes | yes |
| Spanx | BoostUp Strappy Tank | Spanx's own review data | 29 / 29 | yes | no field |
| Outdoor Research | Men's Astroman Short Sleeve Sun Shirt | Bazaarvoice | 4 / 4 | rarely stated | no field |
| Free Fly Apparel | Women's Sol Tee | Reviews embedded in the page | 7 / 7 | yes | yes |
| Janji | M's Circa Daily Tee | Judge.me | 66 / not stated | no field | no field |
| Honeylove | BlissWear Long Sleeve Top | Okendo | 10 / 10 | yes | no field |
| Lunya | Airy Cotton Tie Front Top | Reviews embedded in the page | 1 / 1 | yes | yes |
| MATE the Label | Men's Organic Heavyweight Cotton Relaxed Tee | Okendo | 8 / 8 | yes | yes |
| Ibex | Men's GOAT Long Sleeve Tee | Yotpo | 14 / 14 | yes | yes |
| Oak + Fort | "Refined" Baby Tee | Yotpo | 2 / 2 | yes | yes |
| Dudley Stephens | Cleo Top in French Terry | Yotpo | 10 / 10 | yes | yes |
| Oiselle | Float Tank | Page markup | 1 / not stated | no field | no field |

Known limits:

- **Quince** opens its review list on top-rated reviews and its sort control did not open for the headless
  browser, so a large product is sampled from the top-rated end (all 5 stars in the test). Treat its averages
  as biased upward.
- **Gap** and **Roots** reviews carry no size field; a size is taken only when the review text states it
  ("I ordered a large").
- **Frank And Oak** labels its own products with the brand "ThreadC" in its page data, and the scraper reports
  what the page states.
- **Faherty**'s "Load More Reviews" button loads nothing for the headless browser (script or real click), so a
  large product is read from its first page only.
- **Vineyard Vines** states no brand anywhere in its page, so the brand is reported as unknown.
- **Nike** shows a few reviews on the product page; the scraper follows the product's own review page
  (`/t/<product>/reviews`) and takes the product details from the product page.
- **adidas** refuses automated requests on adidas.com and adidas.ca, so its shirts are read at Zappos, whose
  review pages list adidas reviews (many syndicated from adidas, without size or fit answers).
- **Target** refuses the headless browser (HTTP 429), so only the reviews embedded in the page are read, and the
  page states no brand.
- **Quiksilver** names its products' brand "O5 Quiksilver" in its own data, and the scraper reports what the page states.
- **Chubbies** serves its page from chubbies.com and chubbiesshorts.com; the scraper follows the redirect.
- **Alo Yoga** sells mostly women's clothing, so the tested product is a dress. Few of its reviews state a size or fit.
- **Cuts Clothing** read 60 reviews against a stated 59: the store's total was one behind its list while the page loaded.
- **Gymshark**, **Mack Weldon** and **Outdoor Voices** had few reviews on the products tested, so those rows show the
  scraper working, not volume.
- **Marmot**: Bazaarvoice's review list opens behind a "Read N reviews" button and showed only its first page to the
  headless browser (8 of 23). **Sweaty Betty** uses the same widget and read 8 of 110 from the page markup only, so it is
  not in the table.
- **Summersalt** states no brand and no SKU anywhere in its page, so the brand is reported as unknown and the SKU is a hash of
  the URL. Its review requests name Yotpo's own product id, so reviews are matched by the one product id the page requests.
- **Universal Standard** had one review on the product tested.
- **Janji** is the first store tested on Judge.me; its page states no review total, so the 66 read cannot be checked.
  **Honeylove** states no SKU, so its SKU is a hash of the URL.
- **Lunya** and **Oiselle** had one review on the products tested, so those rows show the scraper working, not volume.

## Size chart only

| Store | Notes |
|---|---|
| Kotn | Product pages show no reviews. The size chart (flat chest and length, cm) is read. |

## Refused or unavailable (reported, not retried)

| Store | What happened |
|---|---|
| Old Navy | The page shows "1975 ratings", but no review data loads for the headless browser (Gap, on the same platform, works). |
| adidas (adidas.com, adidas.ca), H&M (US and CA), Garage (US and CA), Levi's, Tommy Hilfiger, Calvin Klein, Hanes, Wrangler, New Balance, Lacoste, lululemon (US and CA), Sport Chek, Kohl's, Express, Dick's Sporting Goods | HTTP 403 to the page request. |
| Under Armour | HTTP 418 to the page request. |
| Ralph Lauren | Redirects automated requests in a loop to a challenge page. |
| Hollister, Abercrombie & Fitch | Show the headless browser a "Client Challenge" bot check. |
| JCPenney | HTTP 502 to the headless browser. |
| ASOS | Did not answer. |
| FILA | Product pages answer HTTP 404 (site moved). |
| Duluth Trading, Lucky Brand | HTTP 403 ("Access Denied"). |
| Huckberry, Columbia, J.Crew, Rhone, The North Face | HTTP 403 to the page request. |
| Lululemon | HTTP 403 to the page request (tried again in round 4, US and CA: still 403). |
| Tommy John, Ministry of Supply, Fabletics, Hello Molly, Aritzia, Reformation, Madewell, Free People, Urban Outfitters, Macy's, Victoria's Secret, Guess | HTTP 403 to the page request. |
| Jockey, Vans, Eileen Fisher, Backcountry, prAna, Mountain Hardwear, Helly Hansen, Nautica, Eberjey | HTTP 403 to the page request. |
| Mizzen+Main | HTTP 429 to the page request. |
| Nordstrom, SHEIN | The page answers HTTP 200 with a short page saying it does not allow automated traffic. |
| Lane Bryant | Shows the headless browser an "Access to this page has been denied" block page. |
| Patagonia | Serves a "System maintenance is in progress" page (HTTP 200). Reported as down, not as a refusal. |
| Southern Tide, Psycho Bunny, Fashion Nova, White Fox, Stüssy, Kith, Forever 21 | The product pages tested showed no reviews (Psycho Bunny's own data states 0, Fashion Nova's page says "No reviews yet"). A product with reviews was not found in the time spent. |
| Billabong, Volcom | Both pages carry a Yotpo widget, but behind a cookie-consent dialog no review data loaded for the headless browser on the products tested. |
| Salty Crew, NVGTN, Southern Marsh, Hylete, Vollebak, Madhappy, Cotton Citizen, Carbon38, Cuyana | The product pages tested showed no reviews to the headless browser. A product with reviews was not found in the time spent. |
| J.Jill, Skims, Los Angeles Apparel, Vitamin A | The product pages tested showed no review text to the headless browser, or said "No reviews yet" (Vitamin A). A product with reviews was not found in the time spent. |
| Carhartt | HTTP 403 to the page request (reviews would come from TurnTo, which the reader supports). |
| Lands' End, Bombas, MEC, Todd Snyder | HTTP 403 or 429. |
| American Eagle | The page loads no review data for automated visitors. |

A store that answers 403, 418, 429 or 503, shows a bot check or access-denied page, or serves a short page that says it
does not allow automated traffic, is reported as refusing automated requests. The scraper does not try to get around it.

## Review platforms the reader understands

Tested live: Yotpo, Okendo, Stamped, Klaviyo Reviews, Bazaarvoice (both API styles, and through a store's own
endpoint at L.L.Bean), PowerReviews (through Vineyard Vines' endpoint), TurnTo (Nike, Puma), BayEngage (Fruit of
the Loom), Reviews.io data through a store's own endpoint (Vuori), the first-party review services of Uniqlo and
Quince, Gymshark and Alo Yoga, Junip (Mack Weldon) and review pages that page by link (Zappos). Judge.me (Janji). Loox
has card selectors but no store tested here showed its reviews. Any store's own review JSON with a star rating and review text is read by shape; review cards in
plain HTML and schema.org JSON-LD reviews are read too.
