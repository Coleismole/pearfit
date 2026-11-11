-- PROPOSED, NOT APPLIED. Not part of fit_store.sql. See sku-keys.md for why and for the order to roll it out.
--
-- Store-scoped product key for the shared fit store: product_key = lower(store || ':' || sku), where store is
-- the host of the product page without "www." (reitmans.ca, charlestyrwhitt.com). The same SKU at two stores
-- becomes two rows; the same product reached through two addresses that end on one host stays one row.
--
-- Run the whole file in the Supabase SQL editor with nothing selected. It is one transaction: either all of
-- it applies or none of it does. Existing rows keep their sku, and get store and product_key filled in.

begin;

-- A. The store of an address: its host without "www.", lower case. A bare host is accepted too.
--    The scraper computes the same value (new URL(address).hostname without "www."), see sku-keys.md.
create or replace function public.fit_store_of(address text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    lower(regexp_replace(substring(address from '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)'), '^www\.', '')),
    nullif(lower(regexp_replace(btrim(address), '^www\.', '')), ''),
    'unknown'
  );
$$;

-- B. Parent table.
alter table public.commercial_skus add column if not exists store text;
alter table public.commercial_skus add column if not exists product_key text;
update public.commercial_skus set store = public.fit_store_of(source_url) where store is null;
update public.commercial_skus set product_key = lower(store || ':' || sku) where product_key is null;
alter table public.commercial_skus alter column store set not null;
alter table public.commercial_skus alter column product_key set not null;

-- C. Child tables get the key. Until the key swap below, sku is still unique, so the join is exact.
alter table public.sku_size_metrics add column if not exists product_key text;
alter table public.sku_size_chart add column if not exists product_key text;
update public.sku_size_metrics m set product_key = s.product_key from public.commercial_skus s where s.sku = m.sku and m.product_key is null;
update public.sku_size_chart c set product_key = s.product_key from public.commercial_skus s where s.sku = c.sku and c.product_key is null;
alter table public.sku_size_metrics alter column product_key set not null;
alter table public.sku_size_chart alter column product_key set not null;

-- D. Swap the keys. Constraint names are looked up, not assumed.
do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'f' and confrelid = 'public.commercial_skus'::regclass
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'p'
      and conrelid in ('public.commercial_skus'::regclass, 'public.sku_size_metrics'::regclass, 'public.sku_size_chart'::regclass)
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.commercial_skus add primary key (product_key);
create index if not exists commercial_skus_sku_idx on public.commercial_skus (sku);

alter table public.sku_size_metrics add primary key (product_key, size_code);
alter table public.sku_size_metrics
  add constraint sku_size_metrics_product_key_fkey foreign key (product_key) references public.commercial_skus (product_key) on delete cascade;

alter table public.sku_size_chart add primary key (product_key, size_code);
alter table public.sku_size_chart
  add constraint sku_size_chart_product_key_fkey foreign key (product_key) references public.commercial_skus (product_key) on delete cascade;

-- E. Functions. Same names and grants as fit_store.sql. Old scraper copies keep working: a payload with
--    no "store" gets its store from "sourceUrl", which every payload already carries.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('commit_fit_report', 'delete_fit_sku', 'list_fit_catalog')
  loop
    execute format('drop function %s', fn);
  end loop;
end $$;

create function public.commit_fit_report(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := payload->>'sku';
  v_store text;
  v_key text;
begin
  if coalesce(v_sku, '') = '' then
    raise exception 'sku is required';
  end if;
  v_store := public.fit_store_of(coalesce(nullif(payload->>'store', ''), payload->>'sourceUrl'));
  v_key := lower(v_store || ':' || v_sku);

  -- A chart-only payload means the scrape found no reviews. Create the row if it is new so the
  -- chart has a parent, but keep fit numbers and per-size rows from an earlier scrape.
  if coalesce((payload->>'chartOnly')::boolean, false) then
    insert into public.commercial_skus (
      product_key, store, sku, product_id, brand, product_name, category, retail_price, fabric_composition, total_reviews, overall_fit_index, overall_verdict, grading_delta, runs_small_pct, true_to_size_pct, runs_large_pct, shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating, source_url, scraped_at, committed_at
    ) values (
      v_key,
      v_store,
      v_sku,
      payload->>'productId',
      payload->>'brand',
      payload->>'name',
      payload->>'category',
      payload->>'price',
      payload->>'fabricComposition',
      (payload->>'totalReviews')::integer,
      (payload->>'overallFitIndex')::double precision,
      payload->>'overallVerdict',
      (payload->>'gradingDelta')::double precision,
      (payload->>'runsSmallPct')::integer,
      (payload->>'trueToSizePct')::integer,
      (payload->>'runsLargePct')::integer,
      (payload->>'shrinkageMentionPct')::integer,
      (payload->>'fabricOpacityPct')::integer,
      (payload->>'sentimentScore')::integer,
      (payload->>'avgRating')::double precision,
      payload->>'sourceUrl',
      (payload->>'scrapedAt')::timestamptz,
      now()
    )
    on conflict (product_key) do nothing;
  else
    insert into public.commercial_skus (
      product_key, store, sku, product_id, brand, product_name, category, retail_price, fabric_composition, total_reviews, overall_fit_index, overall_verdict, grading_delta, runs_small_pct, true_to_size_pct, runs_large_pct, shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating, source_url, scraped_at, committed_at
    ) values (
      v_key,
      v_store,
      v_sku,
      payload->>'productId',
      payload->>'brand',
      payload->>'name',
      payload->>'category',
      payload->>'price',
      payload->>'fabricComposition',
      (payload->>'totalReviews')::integer,
      (payload->>'overallFitIndex')::double precision,
      payload->>'overallVerdict',
      (payload->>'gradingDelta')::double precision,
      (payload->>'runsSmallPct')::integer,
      (payload->>'trueToSizePct')::integer,
      (payload->>'runsLargePct')::integer,
      (payload->>'shrinkageMentionPct')::integer,
      (payload->>'fabricOpacityPct')::integer,
      (payload->>'sentimentScore')::integer,
      (payload->>'avgRating')::double precision,
      payload->>'sourceUrl',
      (payload->>'scrapedAt')::timestamptz,
      now()
    )
    on conflict (product_key) do update set
      product_id = excluded.product_id,
      brand = excluded.brand,
      product_name = excluded.product_name,
      category = excluded.category,
      retail_price = excluded.retail_price,
      fabric_composition = excluded.fabric_composition,
      total_reviews = excluded.total_reviews,
      overall_fit_index = excluded.overall_fit_index,
      overall_verdict = excluded.overall_verdict,
      grading_delta = excluded.grading_delta,
      runs_small_pct = excluded.runs_small_pct,
      true_to_size_pct = excluded.true_to_size_pct,
      runs_large_pct = excluded.runs_large_pct,
      shrinkage_mention_pct = excluded.shrinkage_mention_pct,
      fabric_opacity_pct = excluded.fabric_opacity_pct,
      sentiment_score = excluded.sentiment_score,
      avg_rating = excluded.avg_rating,
      source_url = excluded.source_url,
      scraped_at = excluded.scraped_at,
      committed_at = now();

    delete from public.sku_size_metrics where product_key = v_key;

    insert into public.sku_size_metrics (
      product_key, sku, size_code, review_count, fit_skew, fit_verdict,
      runs_small_pct, true_to_size_pct, runs_large_pct,
      shrinkage_pct, sentiment_score, avg_rating, return_risk, primary_fit_note
    )
    select
      v_key,
      v_sku,
      s->>'size',
      (s->>'reviewCount')::integer,
      (s->>'fitSkew')::double precision,
      s->>'verdict',
      (s->>'runsSmallPct')::integer,
      (s->>'trueToSizePct')::integer,
      (s->>'runsLargePct')::integer,
      (s->>'shrinkagePct')::integer,
      (s->>'sentimentScore')::integer,
      (s->>'avgRating')::double precision,
      s->>'returnRisk',
      s->>'primaryFitNote'
    from jsonb_array_elements(coalesce(payload->'sizes', '[]'::jsonb)) as s
    -- A size with no reviews has no fit numbers. Older scraper copies still send one row per size.
    where coalesce((s->>'reviewCount')::integer, 0) > 0;
  end if;

  -- Replace this product's chart only when the scrape actually found one.
  -- A missing or empty chart leaves the previous rows in place.
  if jsonb_typeof(payload->'chart') = 'array' and jsonb_array_length(payload->'chart') > 0 then
    delete from public.sku_size_chart where product_key = v_key;

    insert into public.sku_size_chart (
      product_key, sku, size_code, sort_order, chest_cm, length_cm, sleeve_cm
    )
    select
      v_key,
      v_sku,
      s->>'size',
      coalesce((s->>'sortOrder')::integer, 0),
      case
        when jsonb_typeof(s->'chest_cm') = 'number' then (s->>'chest_cm')::double precision
        else null
      end,
      case
        when jsonb_typeof(s->'length_cm') = 'number' then (s->>'length_cm')::double precision
        else null
      end,
      case
        when jsonb_typeof(s->'sleeve_cm') = 'number' then (s->>'sleeve_cm')::double precision
        else null
      end
    from jsonb_array_elements(payload->'chart') as s
    where coalesce(s->>'size', '') <> '';
  end if;
end;
$$;

-- Takes a product_key ("reitmans.ca:497824"). A bare sku from an old scraper copy is accepted only when
-- exactly one row has it: deleting by sku alone must never remove another store's row.
create function public.delete_fit_sku(target_sku text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  matches integer;
begin
  if position(':' in target_sku) > 0 then
    delete from public.commercial_skus where product_key = lower(target_sku);
    return;
  end if;
  select count(*) into matches from public.commercial_skus where sku = target_sku;
  if matches > 1 then
    raise exception 'sku % is in % stores; give store:sku', target_sku, matches;
  end if;
  delete from public.commercial_skus where sku = target_sku;
end;
$$;

create function public.list_fit_catalog()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'productKey', s.product_key,
        'store', s.store,
        'sku', s.sku,
        'productId', s.product_id,
        'brand', s.brand,
        'name', s.product_name,
        'overallVerdict', s.overall_verdict,
        'totalReviews', s.total_reviews,
        'committedAt', s.committed_at,
        'sizes', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'size', m.size_code,
                'reviewCount', m.review_count,
                'fitSkew', m.fit_skew,
                'verdict', m.fit_verdict
              )
              order by array_position(array['XS','S','M','L','XL','XXL'], m.size_code), m.size_code
            ),
            '[]'::jsonb
          )
          from public.sku_size_metrics m
          where m.product_key = s.product_key
        ),
        'chart', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'size', c.size_code,
                'sortOrder', c.sort_order,
                'chest_cm', c.chest_cm,
                'length_cm', c.length_cm,
                'sleeve_cm', c.sleeve_cm
              )
              order by c.sort_order
            ),
            '[]'::jsonb
          )
          from public.sku_size_chart c
          where c.product_key = s.product_key
        )
      )
      order by s.committed_at desc
    ),
    '[]'::jsonb
  )
  from public.commercial_skus s;
$$;

-- F. The same grants as fit_store.sql: commit and list for the publishable key, delete for service_role only.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('commit_fit_report', 'delete_fit_sku', 'list_fit_catalog')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    if fn.name = 'delete_fit_sku' then
      execute format('grant execute on function %s to service_role', fn.signature);
    else
      execute format('grant execute on function %s to anon, authenticated, service_role', fn.signature);
    end if;
  end loop;
end $$;

commit;
