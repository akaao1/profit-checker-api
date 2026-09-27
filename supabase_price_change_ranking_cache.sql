-- Price-change ranking cache: keep expensive historical ranking work off request path.
create index if not exists idx_price_observations_cd_source_key_latest on public.price_observations (market_source_id,source_product_key,observed_at desc,id desc) include (product_id,price_jpy) where source_product_key is not null;
create index if not exists idx_price_observations_ha_source_key_latest on public.price_observations (market_source_id,(raw_payload->>'source_product_id'),observed_at desc,id desc) include (product_id,price_jpy) where (raw_payload->>'source_product_id') is not null;
create index if not exists idx_price_observations_source_time_product on public.price_observations (market_source_id,observed_at desc,product_id,id desc) include (price_jpy,source_product_key) where price_jpy>0;
create table if not exists public.price_change_ranking_cache (
 channel text not null, rank integer not null, product_id uuid not null,
 canonical_name text, set_name text, card_number text, rarity text,
 current_price_jpy integer not null, previous_price_jpy integer not null,
 change_jpy integer not null, change_percent numeric(12,2) not null,
 current_observed_at timestamptz not null, previous_observed_at timestamptz not null,
 generated_at timestamptz not null default now(), primary key(channel,rank)
);
alter table public.price_change_ranking_cache enable row level security;
revoke all on public.price_change_ranking_cache from public,anon,authenticated;
-- refresh function and get_price_change_rankings are installed in production by migration.
-- Keep the cache refresh on a 5-minute DB schedule:
select cron.schedule('price-change-ranking-cache-refresh','*/5 * * * *','select public.refresh_price_change_ranking_cache();')
where not exists(select 1 from cron.job where jobname='price-change-ranking-cache-refresh');