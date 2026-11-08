-- Fit values only. Review text has no column.
-- The scraper calls these functions with the publishable key, which is the anon role.
-- The functions run as the database owner, so anon cannot write the tables directly.

create table if not exists public.commercial_skus (
  sku text primary key,
  product_id text not null,
  brand text not null,
  product_name text not null,
  category text not null,
  retail_price text,
  fabric_composition text,
  total_reviews integer not null,
  overall_fit_index double precision not null,
  overall_verdict text not null,
  grading_delta double precision not null,
  runs_small_pct integer not null,
  true_to_size_pct integer not null,
  runs_large_pct integer not null,
  shrinkage_mention_pct integer not null,
  fabric_opacity_pct integer,
  sentiment_score integer not null,
  avg_rating double precision not null,
  source_url text,
  scraped_at timestamptz not null,
  committed_at timestamptz not null default now()
);

create table if not exists public.sku_size_metrics (
  sku text not null references public.commercial_skus (sku) on delete cascade,
  size_code text not null,
  review_count integer not null,
  fit_skew double precision not null,
  fit_verdict text not null,
  runs_small_pct integer not null,
  true_to_size_pct integer not null,
  runs_large_pct integer not null,
  shrinkage_pct integer not null,
  sentiment_score integer not null,
  avg_rating double precision not null,
  return_risk text not null,
  primary_fit_note text,
  primary key (sku, size_code)
);

-- Brand size chart. chest_cm is pit-to-pit, flat, in centimeters.
-- length_cm and sleeve_cm are whatever the chart stated, converted to cm.
-- A measurement the chart did not state is NULL. Do not store 0 for unknown.
create table if not exists public.sku_size_chart (
  sku text not null references public.commercial_skus (sku) on delete cascade,
  size_code text not null,
  sort_order integer not null,
  chest_cm double precision,
  length_cm double precision,
  sleeve_cm double precision,
  primary key (sku, size_code)
);

-- Existing projects created this column as NOT NULL. Re-run this script so an unknown opacity can be null.
alter table public.commercial_skus alter column fabric_opacity_pct drop not null;

alter table public.commercial_skus enable row level security;
alter table public.sku_size_metrics enable row level security;
alter table public.sku_size_chart enable row level security;
revoke all on table public.commercial_skus from anon, authenticated;
revoke all on table public.sku_size_metrics from anon, authenticated;
revoke all on table public.sku_size_chart from anon, authenticated;

-- Drop first so the recreated functions are owned by the role running this script.
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
begin
  if coalesce(payload->>'sku', '') = '' then
    raise exception 'sku is required';
  end if;

  insert into public.commercial_skus (
    sku, product_id, brand, product_name, category, retail_price, fabric_composition,
    total_reviews, overall_fit_index, overall_verdict, grading_delta,
    runs_small_pct, true_to_size_pct, runs_large_pct,
    shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating,
    source_url, scraped_at, committed_at
  ) values (
    payload->>'sku',
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
  on conflict (sku) do update set
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

  delete from public.sku_size_metrics where sku = payload->>'sku';

  insert into public.sku_size_metrics (
    sku, size_code, review_count, fit_skew, fit_verdict,
    runs_small_pct, true_to_size_pct, runs_large_pct,
    shrinkage_pct, sentiment_score, avg_rating, return_risk, primary_fit_note
  )
  select
    payload->>'sku',
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
  from jsonb_array_elements(coalesce(payload->'sizes', '[]'::jsonb)) as s;

  -- Replace this SKU's chart only when the scrape actually found one.
  -- A missing or empty chart leaves the previous rows in place.
  if jsonb_typeof(payload->'chart') = 'array' and jsonb_array_length(payload->'chart') > 0 then
    delete from public.sku_size_chart where sku = payload->>'sku';

    insert into public.sku_size_chart (
      sku, size_code, sort_order, chest_cm, length_cm, sleeve_cm
    )
    select
      payload->>'sku',
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

create function public.delete_fit_sku(target_sku text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
              order by case m.size_code
                when 'XS' then 1
                when 'S' then 2
                when 'M' then 3
                when 'L' then 4
                when 'XL' then 5
                when 'XXL' then 6
                else 100
              end,
              m.size_code
            ),
            '[]'::jsonb
          )
          from public.sku_size_metrics m
          where m.sku = s.sku
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
          where c.sku = s.sku
        )
      )
      order by s.committed_at desc
    ),
    '[]'::jsonb
  )
  from public.commercial_skus s;
$$;

-- Grant every overload. A signature mismatch leaves the API calling a function anon still cannot execute.
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
    execute format('revoke all on function %s from public', fn);
    execute format(
      'grant execute on function %s to anon, authenticated, service_role',
      fn
    );
  end loop;
end $$;
