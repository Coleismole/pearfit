# Stores confirmed scrapeable

Tested on 2026-11-09 with one live product page per store, through `POST /api/scrape`. "Read / stated" is the
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

Known limits:

- **Quince** opens its review list on top-rated reviews and its sort control did not open for the headless
  browser, so a large product is sampled from the top-rated end (all 5 stars in the test). Treat its averages
  as biased upward.
- **Gap** and **Roots** reviews carry no size field; a size is taken only when the review text states it
  ("I ordered a large").
- **Frank And Oak** labels its own products with the brand "ThreadC" in its page data, and the scraper reports
  what the page states.

## Size chart only

| Store | Notes |
|---|---|
| Kotn | Product pages show no reviews. The size chart (flat chest and length, cm) is read. |

## Refused or unavailable (reported, not retried)

| Store | What happened |
|---|---|
| Lululemon | HTTP 403 to the page request. |
| Carhartt | HTTP 403 to the page request (reviews would come from TurnTo, which the reader supports). |
| Lands' End, Bombas, MEC, Todd Snyder | HTTP 403 or 429. |
| American Eagle | The page loads no review data for automated visitors. |
| Patagonia | Served a "system maintenance" page to the headless browser. |

A store that answers 403, 429 or 503 is reported as refusing automated requests. The scraper does not try to
get around it.

## Review platforms the reader understands

Tested live: Yotpo, Okendo, Stamped, Klaviyo Reviews, Bazaarvoice (both API styles), Reviews.io data through a
store's own endpoint, and the first-party review services of Uniqlo and Quince. TurnTo's data shape is covered by a
unit test (Carhartt refused the page). Junip, Judge.me and Loox have card selectors but no store tested here showed
their reviews. Any store's own review JSON with a star rating and review text is read by shape; review cards in
plain HTML and schema.org JSON-LD reviews are read too.
