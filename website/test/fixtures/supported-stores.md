# Stores confirmed scrapeable

Tested on 2026-11-09 in six rounds with one live product page per store.

## Reviews and fit

| Store | Product tested | Reviews come from | Read / stated | Size bought | Fit answer |
|---|---|---|---|---|---|
| Uniqlo (CA) | Men's AIRism Tee, Men's Polo | Uniqlo's own review service | 300 / 7455, 88 / 88 | yes | yes (1–5 scale) |
| Gap | Classic T-Shirt | Bazaarvoice | 307 / 1460 | from review text only | no field |
| L.L.Bean | Carefree Tee | Bazaarvoice data through L.L.Bean's own endpoint ("Load 10 more" needs a real click) | 304 / 4402 | yes | yes |
| Vuori | Strato Tech Tee | Vuori's own endpoint (Reviews.io data) | 274 / 14715 | yes (variant) | few answer it |
| adidas (at Zappos) | adidas Originals Tee | Zappos' own review pages, followed page by page (`/product/review/<id>/page/N`) | 236 / 236 | rarely stated | some |
| Target | Crew Neck T-Shirt | Reviews embedded in the page (the headless browser gets HTTP 429) | 8 / not stated | no field | no field |
| Oiselle | Float Tank | Page markup | 1 / not stated | no field | no field |
| Odd \| Pipe | A tee | A brand new widget | 1 / 1 | maybe | unclear |
| Gap | Duplicate row | Yotpo | 1 / 1 | yes | yes |

Known limits:

- **Gap** and **Roots** reviews carry no size field; a size is taken only when the review text states it
  ("I ordered a large"). Treat its averages as biased.
- **Target** refuses the headless browser (HTTP 429), so only the reviews embedded in the page are read, and the
  page states no brand.
- **Janji** is the first store tested on Judge.me; its page states no review total. **Honeylove** states no SKU,
  so its SKU is a hash of the URL.
- **Gymshark**, **Oiselle** and **Mack Weldon** had few reviews on the products tested.

## Size chart only

| Store | Notes |
|---|---|
| Kotn | Product pages show no reviews. The size chart (flat chest and length, cm) is read. |

## Refused or unavailable (reported, not retried)

| Store | What happened |
|---|---|
| Old Navy | The page shows "1975 ratings", but no review data loads for the headless browser. |
| adidas (adidas.com, adidas.ca), H&M (US and CA), Levi's | HTTP 403 to the page request. |
| Under Armour | HTTP 418 to the page request. |
| Ralph Lauren | Redirects automated requests in a loop to a challenge page. |
| Nordstrom, SHEIN | The page answers HTTP 200 with a short page saying it does not allow automated traffic. |
| JCPenney | HTTP 502 to the headless browser. |
| FILA | Product pages answer HTTP 404 (site moved). |
| Patagonia | Serves a "System maintenance is in progress" page (HTTP 200). |
| Southern Tide, Psycho Bunny | The product pages tested showed no reviews. |
| Lululemon | HTTP 403 to the page request (tried again in round 4: still 403). |
| lululemon (US and CA) | HTTP 403 to the page request. |
| Mystery Store | Something we have no wording for. |

A store that answers 403, 418, 429 or 503 is reported as refusing automated requests. The scraper does not try to get around it.

## Review platforms the reader understands

Tested live: Yotpo, Okendo, Bazaarvoice.
