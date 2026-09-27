-- Restore fast current-listing-backed CD/HA spread ranking.
-- The previous implementation joined the entire HA observation history to the
-- current listing snapshot, which could exceed the API statement timeout.

create index if not exists idx_source_current_listings_source_product
on public.source_current_listings (market_source_id, source_product_id);

create index if not exists idx_price_observations_ha_product_time
on public.price_observations (market_source_id, product_id, observed_at desc, created_at desc, id desc)
where market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid and price_jpy>0;

create or replace function public.get_price_spread_rankings(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path='public'
as $function$
with cd_current as (
  select distinct on (x.product_id) x.product_id,x.price_jpy,x.observed_at
  from (
    select scl.source_product_id,po.product_id,po.price_jpy,po.observed_at
    from public.source_current_listings scl
    cross join lateral (
      select po.product_id,po.price_jpy,po.observed_at
      from public.price_observations po
      where po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
        and po.source_product_key=scl.source_product_id and po.price_jpy>0
      order by po.observed_at desc,po.created_at desc,po.id desc limit 1
    ) po
    where scl.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
  ) x
  order by x.product_id,x.observed_at desc
),
ha_current as (
  select distinct on (x.product_id) x.product_id,x.price_jpy,x.observed_at
  from (
    select scl.source_product_id,po.product_id,po.price_jpy,po.observed_at
    from public.source_current_listings scl
    cross join lateral (
      select po.product_id,po.price_jpy,po.observed_at
      from public.price_observations po
      where po.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
        and (po.raw_payload->>'source_product_id')=scl.source_product_id and po.price_jpy>0
      order by po.observed_at desc,po.created_at desc,po.id desc limit 1
    ) po
    where scl.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
  ) x
  order by x.product_id,x.observed_at desc
),
paired as (
  select c.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,
    c.price_jpy cd_price_jpy,h.price_jpy ha_price_jpy,c.observed_at cd_observed_at,h.observed_at ha_observed_at,
    h.price_jpy-c.price_jpy difference_jpy,
    round(abs(h.price_jpy-c.price_jpy)::numeric/nullif(least(h.price_jpy,c.price_jpy),0)*100,2) difference_percent
  from cd_current c join ha_current h on h.product_id=c.product_id join public.market_products mp on mp.id=c.product_id
  where h.price_jpy<>c.price_jpy
),
ranked as (
  select *,case when difference_jpy>0 then 'HA' else 'CD' end channel,
    row_number() over(partition by case when difference_jpy>0 then 'HA' else 'CD' end
      order by abs(difference_jpy) desc,difference_percent desc,greatest(cd_observed_at,ha_observed_at) desc,product_id) rank
  from paired
),
payload as (
  select channel,jsonb_agg(jsonb_build_object(
    'rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,'card_number',card_number,'rarity',rarity,
    'cd_price_jpy',cd_price_jpy,'ha_price_jpy',ha_price_jpy,'difference_jpy',difference_jpy,'difference_percent',difference_percent,
    'cd_observed_at',cd_observed_at,'ha_observed_at',ha_observed_at) order by rank)
    filter(where rank<=greatest(1,least(coalesce(p_limit,50),10000))) items
  from ranked group by channel
)
select jsonb_build_object('HA',coalesce((select items from payload where channel='HA'),'[]'::jsonb),'CD',coalesce((select items from payload where channel='CD'),'[]'::jsonb));
$function$;
