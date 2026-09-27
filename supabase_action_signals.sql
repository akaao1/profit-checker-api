-- Cross-market action signals for CD × HA.
-- Applied to Supabase on 2026-09-27.
-- These are read-only views derived from existing observation history.

create or replace view public.sale_inventory_change_signals_cd_ha
with (security_invoker=true) as
with keyed as (
  select
    so.sale_source_id, so.external_product_key, so.product_id,
    so.condition_label, so.variant_key, so.sale_price_jpy, so.stock_qty,
    so.in_stock, so.observed_at,
    lag(so.sale_price_jpy) over (partition by so.sale_source_id, so.external_product_key, so.condition_label, so.variant_key order by so.observed_at, so.id) previous_price_jpy,
    lag(so.stock_qty) over (partition by so.sale_source_id, so.external_product_key, so.condition_label, so.variant_key order by so.observed_at, so.id) previous_stock_qty,
    lag(so.in_stock) over (partition by so.sale_source_id, so.external_product_key, so.condition_label, so.variant_key order by so.observed_at, so.id) previous_in_stock,
    lag(so.observed_at) over (partition by so.sale_source_id, so.external_product_key, so.condition_label, so.variant_key order by so.observed_at, so.id) previous_observed_at
  from public.sale_observations so
)
select sale_source_id,external_product_key,product_id,condition_label,variant_key,
  sale_price_jpy,previous_price_jpy,sale_price_jpy-previous_price_jpy price_change_jpy,
  case when previous_price_jpy is null or previous_price_jpy=0 then null else round((sale_price_jpy-previous_price_jpy)::numeric*100/previous_price_jpy,2) end price_change_percent,
  stock_qty,previous_stock_qty,
  case when stock_qty is not null and previous_stock_qty is not null then stock_qty-previous_stock_qty end stock_change_qty,
  in_stock,previous_in_stock,
  case when previous_in_stock is true and in_stock is false then 'OUT_OF_STOCK'
       when previous_in_stock is false and in_stock is true then 'RESTOCK'
       when stock_qty is not null and previous_stock_qty is not null and stock_qty<previous_stock_qty then 'STOCK_DECREASE'
       when stock_qty is not null and previous_stock_qty is not null and stock_qty>previous_stock_qty then 'STOCK_INCREASE'
       when previous_price_jpy is not null and sale_price_jpy<previous_price_jpy then 'PRICE_DROP'
       when previous_price_jpy is not null and sale_price_jpy>previous_price_jpy then 'PRICE_RISE'
       else 'UNCHANGED' end event_type,
  observed_at,previous_observed_at,extract(epoch from (observed_at-previous_observed_at))/60.0 interval_minutes
from keyed
where previous_observed_at is not null
and (sale_price_jpy is distinct from previous_price_jpy or stock_qty is distinct from previous_stock_qty or in_stock is distinct from previous_in_stock);

create or replace view public.cross_market_action_radar_cd_ha
with (security_invoker=true) as
with events as (
  select distinct on (product_id,condition_label,variant_key)
    product_id,condition_label,variant_key,event_type,observed_at,price_change_jpy,stock_change_qty,stock_qty
  from public.sale_inventory_change_signals_cd_ha
  where observed_at >= now()-interval '24 hours'
  order by product_id,condition_label,variant_key,observed_at desc
)
select o.*,e.event_type latest_sale_event_type,e.observed_at latest_sale_event_at,
  e.price_change_jpy latest_sale_price_change_jpy,e.stock_change_qty latest_sale_stock_change_qty,
  e.stock_qty latest_event_stock_qty,
  case when e.event_type='RESTOCK' then 'RESTOCK'
       when e.event_type='PRICE_DROP' then 'SALE_PRICE_DROP'
       when e.event_type='STOCK_DECREASE' then 'STOCK_DECREASE'
       when e.event_type='OUT_OF_STOCK' then 'OUT_OF_STOCK'
       else 'CURRENT_OPPORTUNITY' end radar_signal
from public.sale_current_opportunities_cd_ha o
left join events e on e.product_id=o.product_id and e.condition_label=o.condition_label and e.variant_key=o.variant_key;
