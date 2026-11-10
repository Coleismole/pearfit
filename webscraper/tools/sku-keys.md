# SKU keys: one SKU, two stores

Status: a design note. Nothing here is applied or implemented. `sku-keys.proposed.sql` is a proposed migration, kept out of
`fit_store.sql` on purpose. Line numbers are from commit `16e3abb`.

## What happened

Round 7 did not save two stores because their SKU was already in the shared store: CT Shirts (SKU `SUD50BLK`, Charles
Tyrwhitt's) and Reitmans.com (SKU `8522040574052`, Reitmans.ca's). `commercial_skus.sku` is the only key
(`fit_store.sql:10`, `server.ts:75`), and both writers replace on a clash: `on conflict (sku) do update` (`fit_store.sql:186`) and
`INSERT OR REPLACE` (`server.ts:239`). Saving the second would have overwritten the first, so it was skipped.

Looking at the saved reports, neither pair was two products:

| Pair | SKU | What the reports say |
|---|---|---|
| CT Shirts / Charles Tyrwhitt | `SUD50BLK` | The same page. Discovery found `ctshirts.com`'s URL on `charlestyrwhitt.com` (its sitemap lists that site's pages), so both scrapes read `https://www.charlestyrwhitt.com/us/double-breasted-tuxedo-jacket---black/SUD50BLK.html`. |
| Reitmans.com / Reitmans.ca | `8522040574052` | The same Shopify product id and 10 reviews each, at `reitmans.com/products/...-497824` and `reitmans.ca/products/...-497824`: two domains of one catalog. |

So the single key did its job there: one product, one row. `tools/discover-products.ts` now rejects a sitemap address on another site, which is
what produced the CT Shirts duplicate. What the single key cannot do is tell apart two different products that share a short SKU
string (a style code like `1000` at two brands): the second silently replaces the first. No such case is known in the 440
SKUs, but nothing would catch it.

## Choices

**A. No migration: detect, do not overwrite.** Before a commit, if the shared store (or the local copy) has the SKU and its
`source_url` is on another host with another product name or brand, stop and say so. A real clash then commits under a SKU
the scraper already accepts as an override (`sku` in `POST /api/scrape`, `server.ts:1715`), such as `acme.com:1000`. Same product
on two domains (Reitmans) stays one row. This touches `server.ts` (the commit paths) and its tests only.

**B. Store-scoped key (the proposal below).** Every row gets a `store` and a `product_key = lower(store || ':' || sku)` that is the primary key.
The same SKU at two stores is two rows. Cost: a schema change, new candidate ids in the engine and API, rebuilt bundles. And
Reitmans.com and Reitmans.ca become two rows of one product unless a store alias maps one domain to the other (the SQL takes an
explicit `store` in the payload for that; the alias list is a decision, see the end).

A is the cheaper way to make a clash visible. B is worth it if the team wants identity by store from now on, for example
because the same SKU at different retailers should stay separate (a brand sold at its own site and at a department store).

## B in detail

`store` is the host of the final product address, lower case, without a leading `www.` (`reitmans.ca`, `charlestyrwhitt.com`,
`us.puma.com`). `product_key` is `store:sku`, lower case, so it matches how the engine already lower-cases ids. `sku` stays a plain column.

`sku-keys.proposed.sql` (one transaction; safe to run twice):

1. `fit_store_of(address)`: host without `www.` from a URL or a bare host, `unknown` for null.
2. Adds `store` and `product_key` to `commercial_skus` and fills them from `source_url`, adds `product_key` to `sku_size_metrics` and
   `sku_size_chart` and fills it from the parent, sets them not null.
3. Drops the foreign keys and primary keys by looking their names up, and adds `primary key (product_key)` on the parent,
   `primary key (product_key, size_code)` on both children, foreign keys on `product_key` with `on delete cascade`, and an index on `sku`.
4. Replaces the three functions with the same names and grants. `commit_fit_report` takes the store from `payload.store`, or from
   `payload.sourceUrl` when it is missing (every payload already has it, so scraper copies that were not updated keep working),
   and upserts on `product_key`. `delete_fit_sku(target)` takes a `product_key`; a bare SKU is accepted only when exactly one row
   has it, so an old client can never delete another store's row. `list_fit_catalog` returns `productKey` and `store`.

Tried on a throwaway PostgreSQL 16 (not Supabase) with the `anon`, `authenticated` and `service_role` roles, after loading `fit_store.sql` and
nine seed rows (including the three leftover SKUs): every old row got a store and key; running the file twice was safe; the same SKU
from `reitmans.ca` and `reitmans.com` gave two rows with their own size rows and charts; a re-commit replaced only its own children;
a payload with `store: charlestyrwhitt.com` and a `ctshirts.com` source address updated the one row; `delete_fit_sku('497824')` was refused with two
stores and `delete_fit_sku('reitmans.com:497824')` removed one row with its children; `anon` could commit and list but not delete,
`service_role` could delete; an empty payload still raised `sku is required`, which `interpretFitStoreProbe` (`supabaseFit.ts:41`) relies on.
Not tested: Supabase itself, its PostgREST layer, or any client code.

## Code touchpoints for B

| Where | What changes |
|---|---|
| `webscraper/fit_store.sql` | Fold the migration in once it is applied: the three tables (`:9`, `:33`, `:53`), `commit_fit_report` (`:120`, conflict targets `:159`, `:186`, child deletes `:208`, `:237`), `delete_fit_sku` (`:264`), `list_fit_catalog` (`:275`, joins `:306`, `:323`). |
| `webscraper/server.ts` SKU choice | Add a `storeOf(finalUrl)` next to the `sku` chain (`:1101`-`:1111`). `fetchStaticHtml` (`:1426`) follows redirects but returns only `{ html }`; it must return the final URL too (the headless path already has `rendered.finalUrl`, `headlessFetch.ts:63`). Without it a requested `ctshirts.com` address would give a different store from the page it lands on. |
| `server.ts` local SQLite | `commercial_skus` (`:74`), `sku_size_metrics` (`:99`), `sku_reviews` (`:116`, `review_uid` is built from the SKU at `:309`), `size_chart` (`:145`), `ingestion_log` (`:133`) all key on `sku`. SQLite cannot change a primary key in place: use the table-copy pattern already at `:166`-`:210`. `upsertReportTransaction` (`:234`, `INSERT OR REPLACE` `:239`), `hasStoredReviews` (`:216`), `loadStoredReport` (`:224`), `loadSizeChart` (`:333`), `saveSizeChart` (`:361`), `chartsBySku` (`:355`) and the reads in `getDatabaseSummary` (`:1493`) look rows up by SKU. |
| `server.ts` endpoints | `POST /api/db/commit` (`:1605`, `charts[item.sku]`), `deleteSkuTransaction` and `DELETE /api/db/sku/:sku` (`:1642`, `:1653`: take a `product_key`), the scrape handler's chart-only branch (`:1871`-`:1874`) and commit (`:1907`). |
| `webscraper/fitPayload.ts` | `FitPayload` (`:5`) and `fitPayloadFromReport` (`:60`, `sku: report.sku` `:66`): add `store`. `ProductFitReport` (`fitAnalyzer.ts`) gains `store` and `productKey`. |
| `webscraper/supabaseFit.ts` | `pushFitReports` (`:54`) keys the chart map by `report.sku`; `RemoteFitSku` (`:73`) and `remoteSkusFromCatalog` (`:95`) gain `productKey` and `store`; `deleteRemoteFitSku` (`:133`) sends a `product_key`. |
| `webscraper/App.tsx` | The delete call (`:134`), the list replace by `item.sku` (`:114`), the remote list comparisons and `key={row.sku}` (`:363`-`:392`). |
| `engine/cli/candidate-source.ts` | Reads ordered by `sku` (`:101`-`:102`) and groups charts by `sku` (`:134`-`:148`): a SKU at two stores would merge their charts. Group by `product_key`. Candidate id `slug(p.sku)` (`:162`) must become `slug(product_key)`, or stay `slug(sku)` for a SKU that is at one store only. |
| `engine/cli/export-candidates.ts`, `db-types.ts` | `readFromSqlite` (`:27`-`:37`) and the row types (`:3`, `:13`) select and carry `sku` only. |
| `engine/api/handlers.ts` | `POST /recommend` finds the candidate by `slug(request.candidateId)` (`:51`-`:52`). Keep accepting a bare SKU slug when it matches one candidate, so existing callers work. |
| `website/api/recommend.js`, `candidates.js` | Generated: `npm run build:api` after the engine change (CI checks the bundles are current). |
| Tests | `server.test.ts`, `fitPayload.test.ts`, `supabaseFit.test.ts`, the engine's candidate-source tests. |

## Rollout order for B

1. Engine and API first, reading `product_key` when the rows have it and `sku` when they do not. Rebuild the bundles.
2. Scraper changes (`store` in the payload, final URL, local table rebuild). Old scraper copies keep working, as the SQL derives the store.
3. Run the migration in the Supabase SQL editor. After it, delete by `product_key`; the three leftover SKUs in `delete-skus.md`
   become `nike.com:url-15i8x08`, `vineyardvines.com:url-8obn02` and `alexmill.com:url-s82zsj` if they are still there.
4. Only then commit a second store's row for a SKU another store already has.

## Decisions for the team

- Whether `reitmans.com` and `reitmans.ca` are one store (an alias list in the scraper, sent as `payload.store`) or two.
- Whether `us.puma.com` and `www.puma.com` are one store. The proposal says two: the host is the store.
- Whether to do A first and wait for a real clash before doing B.
- Pasted HTML has the source address `batch://direct-review-payload`, so its store would be `direct-review-payload`. Such rows
  need a SKU or an address from the person pasting them.
