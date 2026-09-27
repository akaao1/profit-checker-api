-- CD price-data quality hardening v2
-- v15 dropped source extra_difference (e.g. 未開封 / ファーストデザインキラ),
-- causing variant prices to be attached to NORMAL products.
-- v16 restores extra_difference into product identity and uses a composite source key.
-- Historical corrupted v15 observations were quarantined in price_observation_anomalies.
-- Ranking cache requires a second observation within 24h for >300% jumps.
-- Bare numeric CD source_product_key values are rejected for all future inserts.

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

-- Production functions/triggers:
-- refresh_price_change_ranking_cache()
-- sanitize_price_change_ranking_cache()
-- enforce_cd_variant_source_key_format()
-- price-change-ranking-cache-refresh (*/5 * * * *)
-- are installed in the production database.