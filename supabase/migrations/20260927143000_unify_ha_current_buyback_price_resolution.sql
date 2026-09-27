-- Unify HA buyback price resolution.
-- HA buyback prices are stored in price_observations under the HA BUY_PRICE source.
-- sale_observations/sale_current_listings are selling inventory and must not be used
-- for HA buyback-price displays or buyback spread rankings.
-- Current HA buyback is the newest positive observation within a 60-minute freshness window.

create or replace view public.ha_current_stable_buy_prices as
select distinct on (po.product_id)
  po.product_id,
  po.price_jpy,
  po.observed_at,
  po.source_product_key,
  po.source_url
from public.price_observations po
where po.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
  and po.price_jpy>0
  and po.observed_at >= now()-interval '60 minutes'
order by po.product_id,po.observed_at desc,po.created_at desc,po.id desc;

alter view public.ha_current_stable_buy_prices set (security_invoker=true);

create or replace view public.latest_market_prices as
select '6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid as market_source_id,
       product_id,price_jpy,observed_at,source_url,qualifies_min_price
from public.cd_current_stable_prices
union all
select '7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,
       product_id,price_jpy,observed_at,source_url,true
from public.ha_current_stable_buy_prices;

alter view public.latest_market_prices set (security_invoker=true);

create or replace function public.get_current_buy_prices(p_product_ids uuid[])
returns table(product_id uuid,market_source_id uuid,price_jpy integer,observed_at timestamptz)
language sql stable security definer set search_path='public'
as $$
with ids as (
  select unnest(coalesce(p_product_ids,'{}'::uuid[])) as product_id
)
select c.product_id,
       '6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid,
       c.price_jpy,
       c.observed_at
from public.cd_current_stable_prices c
join ids i using(product_id)
union all
select h.product_id,
       '7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,
       h.price_jpy,
       h.observed_at
from public.ha_current_stable_buy_prices h
join ids i using(product_id);
$$;

create or replace function public.get_price_spread_rankings(p_limit integer default 50)
returns jsonb
language sql stable security definer set search_path='public'
as $$
with paired as (
  select c.product_id,
         mp.canonical_name,
         mp.set_name,
         mp.card_number,
         mp.rarity,
         c.price_jpy as cd_price_jpy,
         h.price_jpy as ha_price_jpy,
         c.observed_at as cd_observed_at,
         h.observed_at as ha_observed_at,
         h.price_jpy-c.price_jpy as difference_jpy,
         round(
           abs(h.price_jpy-c.price_jpy)::numeric /
           nullif(least(h.price_jpy,c.price_jpy),0)*100,2
         ) as difference_percent
  from public.cd_current_stable_prices c
  join public.ha_current_stable_buy_prices h using(product_id)
  join public.market_products mp on mp.id=c.product_id
  where h.price_jpy<>c.price_jpy
),
ranked as (
  select *,
         case when difference_jpy>0 then 'HA' else 'CD' end as channel,
         row_number() over(
           partition by case when difference_jpy>0 then 'HA' else 'CD' end
           order by abs(difference_jpy) desc,
                    difference_percent desc,
                    greatest(cd_observed_at,ha_observed_at) desc,
                    product_id
         ) as rank
  from paired
),
payload as (
  select channel,
         jsonb_agg(
           jsonb_build_object(
             'rank',rank,
             'product_id',product_id,
             'canonical_name',canonical_name,
             'set_name',set_name,
             'card_number',card_number,
             'rarity',rarity,
             'cd_price_jpy',cd_price_jpy,
             'ha_price_jpy',ha_price_jpy,
             'difference_jpy',difference_jpy,
             'difference_percent',difference_percent,
             'cd_observed_at',cd_observed_at,
             'ha_observed_at',ha_observed_at
           ) order by rank
         ) filter(
           where rank<=greatest(1,least(coalesce(p_limit,50),10000))
         ) as items
  from ranked
  group by channel
)
select jsonb_build_object(
  'HA',coalesce((select items from payload where channel='HA'),'[]'::jsonb),
  'CD',coalesce((select items from payload where channel='CD'),'[]'::jsonb)
);
$$;
