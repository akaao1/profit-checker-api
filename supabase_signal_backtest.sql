-- Historical validation layer for CD × HA action signals.
-- Measures whether a sale-side event coincided with a positive CD-minus-HA spread.

create or replace view public.signal_backtest_cd_ha
with (security_invoker=true) as
with events as (
  select * from public.sale_inventory_change_signals_cd_ha
  where observed_at >= now()-interval '7 days'
    and event_type in ('RESTOCK','PRICE_DROP','STOCK_INCREASE','STOCK_DECREASE')
),
sale_at_event as (
  select distinct on (e.product_id,e.condition_label,e.variant_key,e.observed_at)
    e.*,s.sale_price_jpy event_sale_price_jpy,s.stock_qty event_stock_qty,s.in_stock event_in_stock
  from events e
  left join public.sale_observations s
    on s.product_id=e.product_id and s.condition_label=e.condition_label and s.variant_key=e.variant_key
   and s.observed_at between e.observed_at-interval '2 minutes' and e.observed_at+interval '2 minutes'
  order by e.product_id,e.condition_label,e.variant_key,e.observed_at,abs(extract(epoch from(s.observed_at-e.observed_at)))
),
cd_at_event as (
  select distinct on(e.product_id,e.observed_at)
    e.product_id,e.observed_at,p.price_jpy cd_price_at_event,p.observed_at cd_price_observed_at
  from events e
  left join public.price_observations p on p.product_id=e.product_id
   and p.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'
   and p.observed_at<=e.observed_at and p.observed_at>=e.observed_at-interval '6 hours'
  order by e.product_id,e.observed_at,p.observed_at desc
),
forward_sale as (
  select distinct on(e.product_id,e.condition_label,e.variant_key,e.observed_at)
    e.product_id,e.condition_label,e.variant_key,e.observed_at event_at,
    s.observed_at future_observed_at,s.sale_price_jpy future_sale_price_jpy,s.stock_qty future_stock_qty,s.in_stock future_in_stock
  from events e join public.sale_observations s on s.product_id=e.product_id
   and s.condition_label=e.condition_label and s.variant_key=e.variant_key
   and s.observed_at>e.observed_at and s.observed_at<=e.observed_at+interval '6 hours'
  order by e.product_id,e.condition_label,e.variant_key,e.observed_at,s.observed_at
)
select e.product_id,e.condition_label,e.variant_key,e.event_type,e.observed_at event_at,
 e.price_change_jpy,e.price_change_percent,e.stock_change_qty,
 se.event_sale_price_jpy,se.event_stock_qty,se.event_in_stock,
 ce.cd_price_at_event,ce.cd_price_observed_at,
 case when ce.cd_price_at_event is not null and se.event_sale_price_jpy is not null then ce.cd_price_at_event-se.event_sale_price_jpy end gross_spread_at_event,
 fs.future_observed_at,fs.future_sale_price_jpy,fs.future_stock_qty,fs.future_in_stock,
 case when ce.cd_price_at_event is not null and fs.future_sale_price_jpy is not null then ce.cd_price_at_event-fs.future_sale_price_jpy end forward_spread_jpy,
 extract(epoch from(fs.future_observed_at-e.observed_at))/60.0 forward_minutes
from events e
left join sale_at_event se on se.product_id=e.product_id and se.condition_label=e.condition_label and se.variant_key=e.variant_key and se.observed_at=e.observed_at
left join cd_at_event ce on ce.product_id=e.product_id and ce.observed_at=e.observed_at
left join forward_sale fs on fs.product_id=e.product_id and fs.condition_label=e.condition_label and fs.variant_key=e.variant_key and fs.event_at=e.observed_at;

create or replace view public.signal_backtest_summary_cd_ha
with (security_invoker=true) as
select event_type,
 count(*) events,
 count(*) filter(where cd_price_at_event is not null and event_sale_price_jpy is not null) covered_events,
 count(*) filter(where gross_spread_at_event>0) positive_spread_events,
 round(avg(gross_spread_at_event)) avg_spread_jpy,
 round(avg(gross_spread_at_event) filter(where gross_spread_at_event is not null)) avg_covered_spread_jpy,
 count(*) filter(where forward_spread_jpy>0) positive_forward_events,
 round(avg(forward_spread_jpy) filter(where forward_spread_jpy is not null)) avg_forward_spread_jpy
from public.signal_backtest_cd_ha
group by event_type;
