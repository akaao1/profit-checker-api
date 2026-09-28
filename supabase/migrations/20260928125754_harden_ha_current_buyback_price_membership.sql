-- HA現在買取価格は「現在のHA買取リスト掲載」を必須条件にする。
-- price_observations は履歴なので、履歴に価格が残っていても
-- source_current_listings に存在しない商品は現在価格として返さない。
create or replace view public.ha_current_stable_buy_prices as
select distinct on (po.product_id)
  po.product_id,
  po.price_jpy,
  po.observed_at,
  po.source_product_key,
  po.source_url
from public.price_observations po
join public.source_current_listings scl
  on scl.market_source_id = '7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
 and scl.source_product_id = po.raw_payload->>'source_product_id'
where po.market_source_id = '7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
  and po.price_jpy > 0
  and po.observed_at >= now() - interval '1 hour'
order by po.product_id, po.observed_at desc, po.created_at desc, po.id desc;
