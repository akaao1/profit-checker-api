create or replace function public.get_ha_to_cd_opportunities(p_limit integer default 50, p_game text default 'pokemon')
returns table (rank integer, game text, product_id uuid, canonical_name text, set_name text, card_number text, rarity text, variant_key text, condition_label text, stock_qty integer, ha_price_jpy integer, cd_price_jpy integer, gross_profit_jpy integer, gross_margin_pct numeric, ha_observed_at timestamptz, cd_observed_at timestamptz, ha_source_url text, ha_external_product_key text)
language sql stable set search_path=public as $$
with source as (
 select s.id from public.sale_sources s join public.sale_source_games sg on sg.sale_source_id=s.id
 where sg.game_code=p_game and s.enabled=true and s.source_type='SELL_PRICE'
 order by case when s.code='ha_current' then 0 else 1 end,s.code limit 1
), ha_latest as (
 select distinct on (so.external_product_key) so.id,so.external_product_key,so.product_id,so.product_name,so.card_number,so.rarity,so.condition_label,so.sale_price_jpy,so.stock_qty,so.in_stock,so.source_url,so.observed_at,so.variant_key,trim(split_part(so.product_name,'(',1)) canonical_guess
 from public.sale_observations so join public.sale_current_listings scl on scl.sale_source_id=so.sale_source_id and scl.external_product_key=so.external_product_key
 where so.sale_source_id=(select id from source)
 order by so.external_product_key,so.observed_at desc,so.id desc
), matched as (
 select distinct on (coalesce(ha.product_id,mp.id),ha.external_product_key)
 mp.id product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,mp.variant_key,ha.condition_label,ha.stock_qty,
 ha.sale_price_jpy ha_price_jpy,cp.price_jpy cd_price_jpy,ha.observed_at ha_observed_at,cp.observed_at cd_observed_at,
 ha.source_url ha_source_url,ha.external_product_key,cp.price_jpy-ha.sale_price_jpy gross_profit_jpy,
 round(((cp.price_jpy-ha.sale_price_jpy)::numeric/ha.sale_price_jpy::numeric)*100,2) gross_margin_pct
 from ha_latest ha join public.market_products mp on mp.game=p_game and (
  (ha.product_id is not null and mp.id=ha.product_id) or
  (ha.product_id is null and mp.card_number=ha.card_number and mp.canonical_name=ha.canonical_guess and mp.rarity=ha.rarity and mp.variant_key=coalesce(ha.variant_key,'NORMAL'))
 )
 join public.cd_current_stable_prices cp on cp.product_id=mp.id
 where ha.in_stock=true and ha.sale_price_jpy>0 and cp.price_jpy>ha.sale_price_jpy
   and ha.observed_at >= now()-interval '1 day'
   and cp.observed_at >= now()-interval '1 day'
   and abs(extract(epoch from (ha.observed_at-cp.observed_at))) <= 86400
 order by coalesce(ha.product_id,mp.id),ha.external_product_key,ha.observed_at desc
)
select row_number() over(order by gross_profit_jpy desc,gross_margin_pct desc nulls last,product_id)::integer,
 p_game,product_id,canonical_name,set_name,card_number,rarity,variant_key,condition_label,stock_qty,ha_price_jpy,cd_price_jpy,gross_profit_jpy,gross_margin_pct,ha_observed_at,cd_observed_at,ha_source_url,external_product_key
from matched order by gross_profit_jpy desc,gross_margin_pct desc nulls last,product_id
limit greatest(1,least(p_limit,200)); $$;