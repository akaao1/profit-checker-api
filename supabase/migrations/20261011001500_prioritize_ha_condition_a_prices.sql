-- Keep HA current prices anchored to the latest completed current listing cycle.
-- Among in-stock listings for the same product, prefer condition A first.
-- Conditions B/C/D remain supplemental and are used only when no in-stock A listing exists.
create or replace view public.ha_current_stable_buy_prices as
with latest_per_listing as (
  select distinct on (so.external_product_key)
    so.product_id,
    so.sale_price_jpy as price_jpy,
    so.observed_at,
    so.external_product_key as source_product_key,
    so.source_url,
    so.in_stock,
    so.condition_label
  from public.sale_current_listings scl
  join public.sale_observations so
    on so.sale_source_id = scl.sale_source_id
   and so.external_product_key = scl.external_product_key
  join public.market_products mp
    on mp.id = so.product_id
   and mp.game = 'pokemon'
  where scl.sale_source_id = '75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
    and scl.cycle_id = (
      select last_completed_cycle_id
      from public.sale_collection_state
      where id = true
    )
    and scl.checked_at >= now() - interval '24 hours'
    and so.sale_source_id = '75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
    and so.observed_at >= now() - interval '24 hours'
    and so.sale_price_jpy > 0
  order by so.external_product_key, so.observed_at desc, so.id desc
),
preferred_in_stock as (
  select distinct on (l.product_id)
    l.product_id,
    l.price_jpy,
    l.observed_at,
    l.source_product_key,
    l.source_url
  from latest_per_listing l
  where l.in_stock = true
  order by
    l.product_id,
    case when l.condition_label like 'A%' then 0 else 1 end,
    l.price_jpy,
    l.observed_at desc,
    l.source_product_key
)
select product_id, price_jpy, observed_at, source_product_key, source_url
from preferred_in_stock;
