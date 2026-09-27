-- CD price-data quality hardening
-- v15 dropped source extra_difference (e.g. 未開封 / ファーストデザインキラ),
-- causing variant prices to be attached to NORMAL products.
-- The corrupted v15 observations were quarantined in price_observation_anomalies.
-- Ranking cache also requires a second observation within 24h for >300% jumps.

create table if not exists public.price_observation_anomalies (
  id bigserial primary key,
  price_observation_id uuid,
  market_source_id uuid,
  product_id uuid,
  price_jpy integer,
  previous_price_jpy integer,
  observed_at timestamptz,
  reason text not null,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.price_observation_anomalies enable row level security;
revoke all on public.price_observation_anomalies from public,anon,authenticated;

-- Production functions:
-- refresh_price_change_ranking_cache()
-- sanitize_price_change_ranking_cache()
-- price-change-ranking-cache-refresh (*/5 * * * *)
-- are installed in the production database.