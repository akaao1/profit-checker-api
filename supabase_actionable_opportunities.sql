-- Actionable Opportunity layer derived from current CD × HA opportunities.
-- Score is an explainable freshness/stock/condition/opportunity signal, not a purchase recommendation.

create or replace view public.actionable_opportunities_cd_ha
with (security_invoker=true) as
with latest_event as (
  select distinct on (product_id, condition_label, variant_key)
    product_id, condition_label, variant_key, event_type, observed_at,
    price_change_jpy, price_change_percent, stock_change_qty, stock_qty
  from public.sale_inventory_change_signals_cd_ha
  where observed_at >= now()-interval '24 hours'
  order by product_id, condition_label, variant_key, observed_at desc
)
select o.*, e.event_type latest_event_type, e.observed_at latest_event_at,
  e.price_change_jpy latest_event_price_change_jpy,
  e.price_change_percent latest_event_price_change_percent,
  e.stock_change_qty latest_event_stock_change_qty,
  e.stock_qty latest_event_stock_qty,
  extract(epoch from (now()-o.sale_observed_at))/60.0 sale_age_minutes,
  extract(epoch from (now()-o.cd_buy_observed_at))/60.0 cd_age_minutes,
  case when e.event_type='RESTOCK' then 'RESTOCK_OPPORTUNITY'
       when e.event_type='PRICE_DROP' then 'PRICE_DROP_OPPORTUNITY'
       when e.event_type='STOCK_DECREASE' then 'STOCK_TIGHTENING'
       when e.event_type='OUT_OF_STOCK' then 'NO_LONGER_AVAILABLE'
       else 'STABLE_OPPORTUNITY' end action_type,
  (case when o.gross_spread_jpy>0 then 40 else 0 end
   + case when o.is_primary_condition then 15 else 5 end
   + case when o.stock_qty is not null and o.stock_qty>0 then 15 else 5 end
   + case when extract(epoch from (now()-o.sale_observed_at))/60.0<=30 then 15
          when extract(epoch from (now()-o.sale_observed_at))/60.0<=120 then 8 else 0 end
   + case when extract(epoch from (now()-o.cd_buy_observed_at))/60.0<=30 then 15
          when extract(epoch from (now()-o.cd_buy_observed_at))/60.0<=120 then 8 else 0 end
   + case when e.event_type='RESTOCK' then 10 when e.event_type='PRICE_DROP' then 8
          when e.event_type='STOCK_DECREASE' then 3 else 0 end) action_signal_score
from public.sale_current_opportunities_cd_ha o
left join latest_event e on e.product_id=o.product_id
 and e.condition_label=o.condition_label and e.variant_key=o.variant_key;
