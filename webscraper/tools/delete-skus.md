# Deleting three leftover rows from the shared fit store

Status: written down, not run. Nobody has deleted these rows yet. It takes someone with the Supabase secret key
(`SUPABASE_SECRET_KEY`, the `service_role` key) or with the project's SQL editor. The publishable key cannot delete:
`delete_fit_sku` is granted to `service_role` only (end of `webscraper/fit_store.sql`).

## What the rows are

Read from the shared store on 2026-11-10 through the local scraper's `GET /api/db/remote` (catalog of 440 SKUs).
All three are older saves of products that were saved again later under their real SKU, with more reviews. The later
rows stay.

| SKU to delete | Brand / product | Reviews | Saved | Same product, kept under |
|---|---|---|---|---|
| `URL-15I8X08` | Nike.com / "Reviews: Nike Sportswear Club Men's T-Shirt. Nike.com" | 8 | 2026-11-09 15:47 | `ShrJfX` (Nike / "Nike Sportswear Club Men's T-Shirt", 311 reviews) |
| `URL-8OBN02` | Unknown brand / "Edgartown Short-Sleeve Pocket Tee" | 10 | 2026-11-09 15:50 | `1V011322` (same name, 16 reviews) |
| `URL-S82ZSJ` | Alex Mill / "Mill Shirt in Oxford" | 13 | 2026-11-09 15:57 | `7293397631035` (same name, 13 reviews) |

Their SKUs are `URL-` plus a hash of the page address, the scraper's last fallback when it has found no SKU
(`server.ts`, `` `URL-${stableHash(sourceUrl)}` `` at the end of the `sku` chain in `scrapeHtmlWithCheerio`). Later scrapes of the same
pages found a real id, so each product is in the store twice. The duplicates show up as extra candidates in the export
and in `GET /candidates`. Deleting a row also deletes its `sku_size_metrics` and `sku_size_chart` rows (`on delete cascade`).

Do not delete the other `URL-` rows. Honeylove (`URL-HOB9N2`) and Summersalt (`URL-DFEPJB`) state no SKU
(`SUPPORTED_STORES.md`), so a hash is their only key; Finisterre (`URL-E988A4`), Cottonon (`URL-KC8MX8`) and Lödyn
(`URL-Z9FRHR`) are round 7 rows that were not checked for this.

## Way 1: through the local scraper's delete endpoint

`DELETE /api/db/sku/:sku` (`webscraper/server.ts`, `app.delete('/api/db/sku/:sku', ...)`) deletes the SKU from the local SQLite
copy, writes a `DELETE_SKU` row to `ingestion_log`, then calls `deleteRemoteFitSku(sku)` (`supabaseFit.ts`), which calls
the `delete_fit_sku` function with the secret key.

1. Put the key in `webscraper/.env.local`. The file is gitignored; never commit it and never paste the key in chat or a PR.

   ```
   SUPABASE_SECRET_KEY=<the service_role key>
   ```

   `SUPABASE_URL` is already in `.env.example`.
2. Start the scraper from `webscraper/`: `npm run dev`. The log says "Supabase fit store is ready."
3. Look first. This prints the three rows (and fails loudly if the shape changed):

   ```
   curl -s http://127.0.0.1:3000/api/db/remote | node -e '
     const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
     const want = new Set(["URL-15I8X08", "URL-8OBN02", "URL-S82ZSJ"]);
     console.log("catalog", j.skus.length);
     for (const s of j.skus) if (want.has(s.sku)) console.log(s.sku, "|", s.brand, "|", s.name, "|", s.totalReviews);'
   ```

   Expect three lines. The catalog count was 440 on 2026-11-10 and should be 437 afterwards.
4. Delete, one SKU at a time:

   ```
   curl -s -X DELETE http://127.0.0.1:3000/api/db/sku/URL-15I8X08
   curl -s -X DELETE http://127.0.0.1:3000/api/db/sku/URL-8OBN02
   curl -s -X DELETE http://127.0.0.1:3000/api/db/sku/URL-S82ZSJ
   ```

   Each answer must contain `"supabase":{"ok":true}`. If it says `"skipped":true` with "needs SUPABASE_SECRET_KEY", the key
   was not loaded and only the local copy was deleted; fix the key and run it again (deleting twice is harmless).
5. Check: repeat step 3. It prints no rows, and the catalog count is 3 lower.
6. Stop the scraper and take the key out of `.env.local` if you do not need it.

Warning: the endpoint has no login, and the server listens on all interfaces (`app.listen(PORT, '0.0.0.0')`). While it runs
with the secret key, anyone who can reach the port can delete any SKU from the shared store. Run it on a trusted network
only, for as short a time as the steps take.

A teammate who still has these SKUs in a local `commercial_fit.db` could commit them again from the workbench's commit
button. Tell the team after the delete.

## Way 2: SQL in the Supabase SQL editor

No key is needed, only access to the project's SQL editor. Run each block on its own with nothing selected otherwise
(see the note at the top of `fit_store.sql`).

```sql
-- 1. Look first: expect exactly these three rows.
select sku, brand, product_name, total_reviews, committed_at
from public.commercial_skus
where sku in ('URL-15I8X08', 'URL-8OBN02', 'URL-S82ZSJ')
order by sku;
```

```sql
-- 2. Delete. sku_size_metrics and sku_size_chart rows go with them (on delete cascade).
-- The delete must report 3 rows. If it does not, run "rollback;" instead of "commit;".
begin;
delete from public.commercial_skus
where sku in ('URL-15I8X08', 'URL-8OBN02', 'URL-S82ZSJ')
returning sku;
commit;
```

```sql
-- 3. Check: 0, 0, 0 and the kept rows still there.
select
  (select count(*) from public.commercial_skus where sku in ('URL-15I8X08', 'URL-8OBN02', 'URL-S82ZSJ')) as skus_left,
  (select count(*) from public.sku_size_metrics where sku in ('URL-15I8X08', 'URL-8OBN02', 'URL-S82ZSJ')) as metrics_left,
  (select count(*) from public.sku_size_chart where sku in ('URL-15I8X08', 'URL-8OBN02', 'URL-S82ZSJ')) as charts_left,
  (select count(*) from public.commercial_skus where sku in ('ShrJfX', '1V011322', '7293397631035')) as kept;
```

`kept` must be 3. The same delete through the function the scraper uses is
`select public.delete_fit_sku('URL-15I8X08');` (one SKU per call; the SQL editor runs it as the owner).

SQL does not touch any machine's local SQLite copy.
