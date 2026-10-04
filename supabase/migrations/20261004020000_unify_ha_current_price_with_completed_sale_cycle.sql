-- Unify HA current price with the latest completed HA sale cycle.
-- Historical price_observations remain history; current HA price comes from
-- the completed sale_fetch_runs that constitute the latest full cycle.
create or replace view public.ha_current_stable_buy_prices
with (security_invoker=true) as
with current_runs as (
  select sfr.id
  from (
    select sfr.id,
           row_number() over(order by sfr.finished_at desc) as rn
    from public.sale_fetch_runs sfr
    where sfr.status='SUCCESS'
      and sfr.finished_at <= (
        select last_completed_cycle_at
        from public.sale_collection_state
        where id=true
      )
  ) sfr
  where sfr.rn <= ceil((
    select max_page::numeric / nullif(pages_per_run,0)
    from public.sale_collection_state
    where id=true
  ))
),
current_ha_observations as (
  select distinct on (so.product_id)
    so.product_id,
    so.sale_price_jpy as price_jpy,
    so.observed_at,
    so.external_product_key as source_product_key,
    so.source_url
  from public.sale_observations so
  join current_runs cr on cr.id=so.sale_fetch_run_id
  where so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
    and so.sale_price_jpy>0
  order by so.product_id,so.observed_at desc,so.id desc
)
select product_id,price_jpy,observed_at,source_product_key,source_url
from current_ha_observations;
