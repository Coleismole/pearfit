# Stores confirmed scrapeable

Tested on 2026-11-09 and 2026-11-10 in seven rounds with one live product page per store, through `POST /api/scrape`. "Read / stated" is the
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

## Round 7: 163 more stores

Found by sitemap and product-feed discovery, then scraped with one real product each (a second and third product were tried
when the first showed no reviews). 161 are saved to the shared Supabase store and read back (catalog 440 SKUs); two
(CT Shirts, Reitmans.com) share a SKU with a sister store already saved (Charles Tyrwhitt, Reitmans.ca) and were not saved
twice. 118 of the 163 returned three or more reviews; the other 45 returned one or two, which was checked against the total
the store states for that product (most match: the product really has that few reviews). "Size bought" and "Fit answer" say
whether most reviews carry the field.

| Store | Product tested | Reviews come from | Read / stated | Size bought | Fit answer |
|---|---|---|---|---|---|
| Bad Birdie | Active Short - Black | Okendo | 142 / 172 | yes | yes |
| Balega US | Blister Resist Crew | Judge.me | 76 / not stated | no field | no field |
| Bluffworks | Ascender Chino Regular Fit - Aged Clay | Okendo | 280 / 1711 | yes | yes |
| Cariloha | Bamboo Comfort Crew Tee | Yotpo | 264 / 445 | rarely stated | no field |
| Collectif | Alda Ric Rac Black Top | Page markup | 206 / not stated | no field | no field |
| Cottonon | Men’s Black Easy Short | Bazaarvoice | 308 / 452 | no field | yes |
| Finisterre | Finisterre Official Store | The store's own review data (recommendations.ometria.com) | 58 / not stated | no field | no field |
| Folk | 1x1 Striped T-Shirt - Black / Charcoal | Judge.me | 202 / not stated | rarely stated | no field |
| Fresh Clean Threads | Active Essentials Performance Cool Polo 3-Pack | Okendo | 120 / 626 | yes | yes |
| Gorman | 70’s Patch Suede Jacket | The store's own review data (merchflow.factoryx.io) | 550 / not stated | rarely stated | no field |
| Greyson Clothiers | 15" Phoenix Skirt | Yotpo | 150 / 173 | yes | yes |
| halara | Basic Padded Workout Cropped Low Support Tank Top A-D Cups | Structured data in the page | 233 / 816 | yes | yes |
| Hot Topic | The Rolling Stones '89 Tongue T-Shirt | Bazaarvoice | 163 / 163 | rarely stated | yes |
| IZOD SPORTSWEAR | 5 POCKET SUPER SOFT PANT - NAVY BLAZER | Klaviyo Reviews | 117 / 118 | yes | rarely stated |
| NYDJ Apparel | Ami Skinny Jeans - Cooper | Yotpo | 168 / 168 | rarely stated | rarely stated |
| Kryptek | Aegis Jacket (Kryptek Highlander™ Camo) | Junip | 96 / 96 | rarely stated | no field |
| KUIU | Alpine Hooded Jacket / Ash | Yotpo | 201 / 459 | yes | yes |
| Le Col Cycling Apparel | ARC Cargo Bib Shorts | Yotpo | 141 / 141 | rarely stated | yes |
| Leonisa | 2-Pack Bra Extenders (3 Row) | Judge.me | 51 / 61 | no field | no field |
| Barbour | Barbour® Classic Beaufort Jacket | Yotpo | 181 / 181 | rarely stated | rarely stated |
| Posh Peanut | Agatha Convertible One Piece | Page markup | 51 / not stated | no field | no field |
| Primary.com | Baby bike short | Bazaarvoice | 101 / 101 | rarely stated | rarely stated |
| Reef | Anders Long Sleeve Woven Shirt | Page markup | 167 / not stated | no field | no field |
| RHOBACK | All-Active Short / Solid - Bunker Blue | Okendo | 75 / 75 | yes | yes |
| Rothy's | The Casual Clog - Blue Raffia-Knit | Yotpo | 180 / 11230 | yes | yes |
| Russell Athletic | DRI-POWER ® Unisex Sweatshirt | BayEngage | 303 / 758 | rarely stated | no field |
| Shapermint | Shapermint Essentials High-Waisted Butt-Lifting Shaping Jell | The store's own review data (cdn.shapermint.com) | 154 / 258 | no field | no field |
| Showpo | Arianae Top - High Neck Top in Black | Yotpo | 111 / 111 | rarely stated | yes |
| Sitka | Core Lightweight Crew LS | Yotpo | 300 / 916 | rarely stated | yes |
| ThirdLove | 24/7® Classic Adjustable Strap Wireless Bra | Yotpo | 165 / 735 | yes | rarely stated |
| TYR US | Airtec Men's Tank - Solid / Blue Moon | Okendo | 57 / 57 | yes | no field |
| Uniform Advantage | UA Best Buy Scrubs Women's 3-Pocket Moderate Flare Leg Draws | Yotpo | 197 / 197 | rarely stated | rarely stated |
| White Stuff | Selina Jersey Jumpsuit | Bazaarvoice | 308 / 603 | rarely stated | yes |
| Woolx | Addie Crew Neck | The store's own review data () | 178 / not stated | rarely stated | no field |
| Duck Head | 5" Gold School Chino Short | Yotpo | 49 / 49 | yes | no field |
| VOORMI | Camp Sweater | The store's own review data () | 47 / 47 | yes | no field |
| Suntect | 19th Hole / Men's Drive Long Sleeve Golf Polo / White | Yotpo | 41 / 41 | yes | rarely stated |
| HUK | A1A Performance Crew | Yotpo | 41 / 41 | yes | yes |
| Mott & Bow | 5 Pocket Travel Pants | Yotpo | 34 / 34 | no field | yes |
| Boody | Boody Baby Bodysuit | Yotpo | 32 / 32 | rarely stated | no field |
| 9.0 Swim | 9.0 Swim Bianca Green Floral Bikini Top | Yotpo | 29 / 29 | yes | yes |
| HATCH Collection | The All Tri Jumpsuit | Yotpo | 28 / 28 | yes | yes |
| Buffbunny-One More | Adventure Cargo Pant - Bone | Yotpo | 26 / 26 | yes | yes |
| YoungLA | 1002 - Naruto Sweat Shorts | The store's own review data () | 23 / 32 | no field | no field |
| Addition Elle | 24-7 Denim Jegging - Addition Elle | PowerReviews | 21 / 21 | no field | yes |
| T.M.Lewin | Max Performance White Twill Slim Fit Double Cuff Cutaway Col | Yotpo | 21 / 21 | no field | no field |
| Feetures | Elite Grip Max Cushion Mini Crew | Yotpo | 19 / 19 | yes | rarely stated |
| Toad&Co | Abele Dress | Okendo | 19 / 19 | yes | yes |
| Dockers® | All Seasons 5-Pocket Pant, Straight Fit | Bazaarvoice | 18 / 699 | no field | yes |
| Topo Designs | Alpine High Label Hoodie | Yotpo | 16 / 16 | yes | no field |
| Ben Davis Co | Bernal Jacket - Black | Reviews embedded in the page | 15 / 15 | rarely stated | no field |
| edikted | 06 Oversized Long Sleeve T Shirt | Yotpo | 14 / 14 | yes | rarely stated |
| Ryderwear | 3" Fleece Shorts - Black | Yotpo | 14 / 14 | yes | no field |
| Laura Canada | 'Allo Paris' T-Shirt | Yotpo | 13 / 13 | rarely stated | no field |
| PEARL iZUMi | Graphic Short Sleeve T-Shirt | Yotpo | 13 / 13 | yes | yes |
| Talbots | An Error Occurred! | The store's own review data () | 13 / not stated | no field | no field |
| Tracksmith | Session Shorts | Junip | 13 / 41 | yes | no field |
| CLUB MONACO | Baxter 7" Short | Reviews embedded in the page | 12 / 12 | no field | no field |
| Criquet | Ace Performance Hoodie - Dusty Blue | Klaviyo Reviews | 12 / 12 | yes | no field |
| Lole | Action Ankle Leggings | Reviews embedded in the page | 12 / 12 | yes | no field |
| Path Projects | Altira Short | Okendo | 12 / 12 | rarely stated | yes |
| Castelli | ALPHA 150 JACKET | Trustpilot | 10 / not stated | no field | no field |
| Darn Tough Vermont | Men's and Women's Knit to Give 2-Pack | Page markup | 10 / 15 | no field | no field |
| good american | ALWAYS FITS GOOD CLASSIC BOOTCUT JEANS LONG / INDIGO446 | Yotpo | 10 / 10 | yes | no field |
| Ingrid & Isabel | A-Line Sweater Knit Maternity Nursing Midi Dress | Bazaarvoice | 10 / 16 | no field | no field |
| KAPPA IT | 222 BANDA ANNISTON SLIM - Jacket - Fleece - Man - BLACK - PI | Reviews embedded in the page | 10 / 9 | no field | no field |
| Lorna Jane | 3/4 Dance pants | Yotpo | 10 / 10 | yes | yes |
| Mammut | Sender IN Hybrid Jacket Men | Page markup | 10 / 52 | no field | no field |
| Rapanui | Lightning Bolt T-Shirt | The store's own review data (rapanuiclothing.com) | 10 / 10 | no field | no field |
| Reitmans | 3/4-Sleeve Embroidered Blouse | PowerReviews | 10 / 10 | no field | yes |
| Reitmans | 3/4-Sleeve Embroidered Blouse | PowerReviews | 10 / 10 | no field | yes |
| Nathan Sports | AeroZip 1 Liter Unisex Hydration Race Vest | Bazaarvoice | 9 / 9 | no field | no field |
| Roller Rabbit | Alpha Chi Omega Monkey Polo Pajamas | Okendo | 9 / 9 | yes | yes |
| Trenery | Alpaca Merino Blend Polo | Bazaarvoice | 9 / 9 | no field | no field |
| Good Trust | AC Breeze Hoodie | Yotpo | 8 / 8 | yes | no field |
| MUD Jeans | Alex Mid Loose - Medium Stone | Structured data in the page | 8 / 8 | no field | no field |
| Negative Underwear | Airis Scoop Bra in Black | Okendo | 8 / 8 | yes | yes |
| Stetson | 1014 Rocker Fit Jeans | Yotpo | 8 / 8 | yes | no field |
| THINX | Butterfly Shorts | Yotpo | 8 / 8 | rarely stated | yes |
| Burt's Bees Baby | 2 Pack Pants - Bloodgood Maple | Page markup | 7 / 5 | no field | no field |
| Mountain Warehouse | Montana Half Zip Fleece Sweatshirt | Structured data in the page | 7 / 3 | no field | rarely stated |
| O'Neill | Baay Bikini Top | Yotpo | 7 / 7 | no field | no field |
| Peppermayo Exclusive | Aamari Maxi Dress - Red | Yotpo | 7 / 7 | yes | yes |
| Wolf & Shepherd | Crossover Track Jacket | Page markup | 7 / not stated | no field | no field |
| Brooklyn Cloth | 2 Pack 7" Fleece Shorts | Page markup | 6 / not stated | no field | no field |
| Dickies | 1/4 Zip Work Shirt | Yotpo | 6 / 6 | yes | yes |
| Filson | 11-oz. Denim Outfitter Jacket - Light Indigo | Klaviyo Reviews | 6 / 6 | yes | no field |
| Minus33 Merino Wool Clothing | Big Woods Bucks Heavyweight Wool Guide Shirt Jacket - 34.4oz | Judge.me | 6 / 6 | no field | no field |
| American Tall | 10 Pocket Hiking Short for Tall Men in Pebble Grey 30 / Tall | Reviews.io | 5 / 8 | no field | no field |
| Cherokee Uniforms | Men's 12-Pocket Scrub Pant | Yotpo | 5 / 5 | yes | rarely stated |
| https://www.injinji.com/ | Ultra Run Mini-Crew Wool | Structured data in the page | 5 / 5 | no field | no field |
| Judy Blue | Angelina Tailored Column Trouser | Reviews embedded in the page | 5 / 5 | rarely stated | no field |
| LAKE Pajamas | BalanceKnit™ Wave Tank Gown in Haven Blue — XS | Okendo | 5 / 5 | yes | yes |
| Little Sleepies | Little Sleepies Acorn Woods Relaxed Pocket Tee | Reviews embedded in the page | 5 / 7 | yes | no field |
| Nudie Jeans | Gunde Logo Hoodie Greymelange | Page markup | 5 / 14 | no field | no field |
| Oh Polly | 3D Embellished Bandeau Maxi Dress in Liquid Gold | Okendo | 5 / 80 | yes | rarely stated |
| DONNI. | The Baby Rib Baby Tee | Reviews embedded in the page | 5 / 5 | yes | yes |
| Charles Tyrwhitt | Double Breasted Tuxedo Jacket - Black | The store's own review data (api.feefo.com) | 4 / 41 | no field | no field |
| Christy Dawn | Half Moon Half Sun Long Sleeve Tee / Blue Tie Dye | Junip | 4 / 4 | no field | no field |
| Charles Tyrwhitt | Double Breasted Tuxedo Jacket - Black | The store's own review data (api.feefo.com) | 4 / 41 | no field | no field |
| Medelita Scrubs | Men's Anthony Flap Pocket 38" Lab Coat | Yotpo | 4 / 4 | yes | yes |
| Suzy Shier | 2-Fer Cotton-Blend Jumpsuit | Reviews embedded in the page | 4 / 4 | no field | no field |
| Black Diamond | Access Fund 2026 Anniversary Tee | Page markup | 3 / not stated | no field | no field |
| Café du Cycliste | Adrienne | Structured data in the page | 3 / not stated | no field | no field |
| Cosabella | Sanika Balconette Bra | Page markup | 3 / not stated | rarely stated | no field |
| First Lite | At First Lite 2.0 T-Shirt | Page markup | 3 / not stated | no field | no field |
| Houdini Sportswear | All Weather T-Neck - Baremark Green | Structured data in the page | 3 / not stated | no field | no field |
| MENS LS SHIRTS | 100% Linen Button-Down Shirt | Yotpo | 3 / 3 | yes | no field |
| Joe's® Jeans | ANDREA'S LOOKBOOK X JOE'S JEANS | Bazaarvoice | 3 / 3 | no field | yes |
| Klattermusen | Lödyn Hood Jacket Men's | Yotpo | 3 / 3 | yes | yes |
| Lilly Pulitzer | Finn Top | Page markup | 3 / not stated | no field | no field |
| RAILS | ADDY SWEATER - FLORAL CABLES | Bazaarvoice | 3 / 4 | no field | yes |
| Review Australia | Abbey Mini Dress | Klaviyo Reviews | 3 / 3 | yes | yes |
| Silver Jeans Co. | Women’s Crewneck Sweatshirt | Bazaarvoice | 3 / 3 | no field | rarely stated |
| Spiritual Gangster | Shop the 111 Lila Tee for Women | Yotpo | 3 / 5 | yes | yes |
| Stateandliberty | "The Amber" Grey & Light Green Mid Check | Okendo | 3 / 906 | yes | yes |
| Swiftwick | Aspire Crew 1 / Blue Gray / LG | Reviews.io | 3 / 215 | no field | no field |
| Tory Sport | French Terry Varsity Crewneck | Structured data in the page | 3 / 6 | no field | rarely stated |
| 7 For All Mankind | 3 Pack Luxe Performance Tee in Black | Yotpo | 2 / 2 | yes | yes |
| AFENDS | Abbie - Rib Cropped Tee - Black | Reviews embedded in the page | 2 / 2 | yes | no field |
| AG Jeans | Adam Jacket | Reviews embedded in the page | 2 / 2 | yes | yes |
| BoxLunch | Nintendo The Legend of Zelda Link Love Womens Tank Top | Bazaarvoice | 2 / 2 | no field | yes |
| Capezio | 3-Layer Tutu - Girls | Page markup | 2 / not stated | no field | no field |
| 404 | 404 Silhouette Pants Off White | Yotpo | 2 / 2 | yes | no field |
| GYMREAPERS | 1965 Vintage Olympia Tee | Reviews embedded in the page | 2 / 2 | yes | yes |
| Helikon-Tex | Covert Hoodie - Fullzip | The store's own review data (integrations.etrusted.com) | 2 / not stated | no field | no field |
| Johnston & Murphy | Fine-Stripe Polo | Bazaarvoice | 2 / 2 | no field | no field |
| Kit and Ace | Acadia Long Sleeve Poplin Shirt | Reviews embedded in the page | 2 / 2 | yes | yes |
| mnml | 994 Wolf L/S Tee - Black | Reviews embedded in the page | 2 / 2 | yes | yes |
| Primitiveskate | 5 POCKET DENIM PANT | Klaviyo Reviews | 2 / 2 | yes | no field |
| Rapha | Rapha - Women's Pro Team Cycling Bib Shorts III - Long - Bla | Reviews.io | 2 / 2 | no field | no field |
| Represent Clo | 247 Aero Shorts Jet Black | Page markup | 2 / not stated | no field | no field |
| Robert Graham | 52 PICK UP LONG SLEEVE BUTTON DOWN SHIRT | Yotpo | 2 / 2 | yes | yes |
| Saucony | Outpace 2.5" Split Short | Bazaarvoice | 2 / 2 | no field | yes |
| SPLITS59 | Airweight 3.5" Short Jumpsuit - Black | Yotpo | 2 / 2 | yes | yes |
| Stio | Grand Horizon Tee | Page markup | 2 / 1 | yes | no field |
| Sunice | Boy's Reign Ski Jacket | The store's own review data () | 2 / not stated | no field | no field |
| Barefootdreams | Bandeau Top | Yotpo | 1 / 1 | yes | no field |
| Berne | Berne Script Tee | Page markup | 1 / not stated | no field | no field |
| Bonobos | All Season Flannel | Page markup | 1 / not stated | yes | no field |
| Bally Total Fitness | 2 Pack Biker Shorts | Page markup | 1 / not stated | no field | no field |
| Frankies Bikinis | Academy Terry Mini Shorts - Cheer Team | Reviews embedded in the page | 1 / 1 | yes | yes |
| Giro | Giro d'Italia Tee | The store's own review data () | 1 / not stated | no field | no field |
| Haggar.com | Big & Tall Active Series™ Herringbone Suit Pant | Bazaarvoice | 1 / 1 | no field | yes |
| Hell Bunny | Abi 50's Skirt | Klaviyo Reviews | 1 / 1 | no field | no field |
| Hobbs | Philipa Knit Mittens With Wool | Page markup | 1 / 1 | no field | no field |
| Jaanuu | After-Hours Crewneck Sweatshirt - Black | Reviews embedded in the page | 1 / 1 | yes | yes |
| Johnnie-O | Auburn University Huronn Featherweight Performance Polo | Bazaarvoice | 1 / 1 | no field | no field |
| KNOWN SUPPLY | Ada Pullover - Black | Reviews embedded in the page | 1 / 1 | yes | no field |
| PACT Inc. | PACT Logo Shirt | Page markup | 1 / not stated | no field | no field |
| Papinelle Sleepwear AU | Amber Frill Short | Reviews embedded in the page | 1 / 1 | yes | no field |
| Raleigh Denim | Alexander Resin Rinse | Klaviyo Reviews | 1 / 1 | yes | no field |
| 0 | All Gender Graphic Tee / Mont Blanc | Page markup | 1 / 1 | no field | no field |
| Rusty | 18 Degrees Mock Layer Stripe Tee | Page markup | 1 / not stated | no field | no field |
| Seafolly Ladies | Bandeau Maxi Dress | Reviews embedded in the page | 1 / 1 | yes | yes |
| SimmsFishing | Headwaters Vest | Yotpo | 1 / 1 | yes | yes |
| Garneau | Active Shorts | Page markup | 1 / not stated | no field | no field |
| Tea Collection | 360 Twirl Dress | Reviews embedded in the page | 1 / 1 | no field | no field |
| Thrills Co. | A Haven for the Restless Merch Fit Tee - Aubergine | Reviews.io | 1 / 1 | no field | no field |
| On Running | 2 in 1 Performance Shorts | PowerReviews | 1 / 1 | yes | yes |
| Triangl | ALBI RUBY RED SPARKLE Skirt | Klaviyo Reviews | 1 / 1 | yes | no field |
| Lifestyle Group (UK) Ltd | Ambra nautical swing dress | Junip | 1 / 1 | no field | no field |
| Whistles | White Anna Dress | Page markup | 1 / not stated | no field | no field |

**Size charts.** A chart was read for 17 of the 163 stores that returned reviews (Ben Davis, Black Diamond, Bonobos, Cariloha,
Christy Dawn, Dickies, Folk, Fresh Clean Tees, Gorman, Gym Reapers, Halara, Helikon-Tex, Little Sleepies, Lorna Jane,
M.N.M.L., Shop Donni, Topo Designs). Most other stores' guides measure the body (ranges such as 36-38, "measure around"),
or give no convention, so under the chest rule the dimension stays empty rather than being guessed; some guides are images
only. Pit-to-pit chest is read for only Folk, Helikon-Tex and Christy Dawn; the others give length and/or sleeve. Charts that
were read wrongly (Filson, Simms, State and Liberty: the low end of a body range; Joe's Jeans: a men's shirt table for jeans;
Suzy Shier: a skirt table) were left out.

**Known limits of this round**
- **Nudie Jeans:** 9 of 14 reviews sit behind a control inside a dialog that is not paged.
- **Halara:** the same URL serves two layouts, both are read; the product page layout stops at about 230 reviews (time and 300 caps).
  Reviews whose stars cannot be read default to a rating of 3.
- **Phase Eight** was fixed (Salesforce review cards, numbered pager) but not re-run in the final pass; **Rawganique** shows
  "2 reviews" that were not found.
- Loox reviews render in an iframe; they are read after each "Show more" click (Voormi, YoungLA, Woolx).
- Review totals above about 300 are sampled.

**Refused or not scrapeable (not retried):** belk.com, bershka.com, bumblito.com, callawaygolf.com, coach.com, converse.com, davidsbridal.com, fredperry.com, glassons.com, hibbett.com, joefresh.com, katespade.com, kerrits.com, lulus.com, newbalance.ca, nextlevelapparel.com, pacsun.com, peakperformance.com, prettylittlething.com, pullandbear.com, sezane.com, sheplers.com, theory.com, topshop.com, veronicabeard.com, zaful.com, zara.com, plus Loft, Ann Taylor (PerimeterX challenge), Indochino, Hoka
(HTTP 406). Eloquii, Full Beauty, Woman Within and King Size serve category pages for the URLs discovery found, and Romwe
promo pages; no product was found.

**Product pages tested showed no reviews** (129 stores, so the pages show no review system, or the tested products have none): 3sixteen.com, aftco.com, agolde.com, aimeleondore.com, albamclothing.com, aliceandolivia.com, amiri.com, andieswim.com, anntaylor.com, asket.com, baabuk.com, bamboo-clothing.com, bape.com, barbour.com, beaumontorganic.com, bellacanvas.com, birdygrey.com, bluenotes.com, brixton.com, brownsfashion.com, buckmason.com, bustedtees.com, canadagoose.com, charlotterusse.com, cieleathletics.com, cinchjeans.com, cintas.com, citizensofhumanity.com, corteiz.com, cultgaia.com, cupshe.com, cutterbuck.com, dcshoes.com, didriksons.com, dissh.com.au, dl1961.com, ellesse.com, eloquii.com, endclothing.com, faithfullthebrand.com, footlocker.com, forcast.com.au, frame-store.com, fullbeauty.com, gallerydept.com, ganni.com, hellstar.com, hilarymacmillan.com, hiutdenim.co.uk, hoka.com, hudsonjeans.com, hufworldwide.com, hugoboss.com, hunzag.com, hurley.com, indochino.com, industryofallnations.com, janieandjack.com, jeanswest.com.au, kancan.com, kimesranch.com, kingsize.com, kitx.com.au, ksubi.com, lanius.com, littleadventures.com, loft.com, loveshackfancy.com, lyleandscott.com, mackage.com, malbongolf.com, mmlafleur.com, modcloth.com, motherdenim.com, motherhood.com, mudpie.com, nakedandfamousdenim.com, noahny.com, norseprojects.com, nydj.com, obeyclothing.com, on.com, onzie.com, palaceskateboards.com, pangaia.com, pasnormalstudios.com, phase-eight.com, pinkblushmaternity.com, pjharlow.com, propercloth.com, rag-bone.com, rawganique.com, rebeccaminkoff.com, rebeccataylor.com, reigningchamp.com, rhythmlivin.com, ripcurl.com, ripndip.com, romwe.com, rouje.com, rowingblazers.com, rvca.com, scrubsandbeyond.com, setactive.co, shopbop.com, sleepyjones.com, soarrunning.com, soffe.com, solidandstriped.com, stadiumgoods.com, stance.com, starter.com, staud.clothing, tedbaker.com, tibi.com, tigerlily.com.au, tinycottons.com, travismathew.com, undefeated.com, universalworks.co.uk, vanheusen.com, venroy.com, viktoriaandwoods.com.au, vince.com, wearethought.com, witchery.com.au, womanwithin.com, yearofours.com, zumiez.com.

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
| Patagonia | Served a "system maintenance" page to the headless browser. |

A store that answers 403, 418, 429 or 503, shows a bot check or access-denied page, or serves a short page that says it
does not allow automated traffic, is reported as refusing automated requests. The scraper does not try to get around it.

## Review platforms the reader understands

Tested live: Yotpo, Okendo, Stamped, Klaviyo Reviews, Bazaarvoice (both API styles, and through a store's own
endpoint at L.L.Bean), PowerReviews (through Vineyard Vines' endpoint), TurnTo (Nike, Puma), BayEngage (Fruit of
the Loom), Reviews.io data through a store's own endpoint (Vuori), the first-party review services of Uniqlo and
Quince, Gymshark and Alo Yoga, Junip (Mack Weldon) and review pages that page by link (Zappos). Judge.me (Janji). Loox (iframe and widget), Judge.me, AfterShip, Testfreaks, Trusted Shops and Stamped HTML widgets were read in round 7. Any store's own review JSON with a star rating and review text is read by shape; review cards in
plain HTML and schema.org JSON-LD reviews are read too.
