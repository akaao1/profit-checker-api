-- Keep HA price-change ranking aligned with the HA buyback current-listing source.
-- Historical observations remain eligible for calculating the change, but only products
-- currently present in source_current_listings for the HA buyback source can appear.

CREATE OR REPLACE FUNCTION public.get_price_change_rankings(p_limit integer DEFAULT 10000)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
with current_ha_products as (
  select distinct po.product_id
  from public.source_current_listings scl
  join lateral (
    select so.product_id
    from public.price_observations so
    where so.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
      and so.raw_payload->>'source_product_id'=scl.source_product_id
    order by so.observed_at desc, so.id desc
    limit 1
  ) po on true
  where scl.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
)
select jsonb_build_object(
  'CD',coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank',rank,'product_id',product_id,'canonical_name',canonical_name,
      'set_name',set_name,'card_number',card_number,'rarity',rarity,
      'current_price_jpy',current_price_jpy,'previous_price_jpy',previous_price_jpy,
      'change_jpy',change_jpy,'change_percent',change_percent,
      'current_observed_at',current_observed_at,'previous_observed_at',previous_observed_at
    ) order by rank)
    from public.price_change_ranking_cache
    where channel='CD'
      and rank<=greatest(1,least(coalesce(p_limit,10000),10000))
  ),'[]'::jsonb),
  'HA',coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank',rank,'product_id',product_id,'canonical_name',canonical_name,
      'set_name',set_name,'card_number',card_number,'rarity',rarity,
      'current_price_jpy',current_price_jpy,'previous_price_jpy',previous_price_jpy,
      'change_jpy',change_jpy,'change_percent',change_percent,
      'current_observed_at',current_observed_at,'previous_observed_at',previous_observed_at
    ) order by rank)
    from public.price_change_ranking_cache c
    where channel='HA'
      and rank<=greatest(1,least(coalesce(p_limit,10000),10000))
      and exists (
        select 1 from current_ha_products chp
        where chp.product_id=c.product_id
      )
  ),'[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION public.refresh_price_change_ranking_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtext('price_change_ranking_cache'));

  create temp table _current_ha_products on commit drop as
  select distinct po.product_id
  from public.source_current_listings scl
  join lateral (
    select so.product_id
    from public.price_observations so
    where so.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
      and so.raw_payload->>'source_product_id'=scl.source_product_id
    order by so.observed_at desc, so.id desc
    limit 1
  ) po on true
  where scl.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid;

  create unique index on _current_ha_products(product_id);

  create temp table _pcr on commit drop as
  with base as (
    select po.market_source_id,po.product_id,po.price_jpy,po.observed_at,po.id,
      case when po.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
        then coalesce(nullif(po.raw_payload->>'source_updated_at',''),po.observed_at::text)
        else po.observed_at::text end revision
    from public.price_observations po
    left join _current_ha_products chp
      on chp.product_id=po.product_id
     and po.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
    where po.price_jpy>0
      and po.observed_at >= now()-interval '14 days'
      and (
        po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
        or (po.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid and chp.product_id is not null)
      )
  ), revision_latest as (
    select distinct on(market_source_id,product_id,revision)
      market_source_id,product_id,price_jpy,observed_at,id,revision
    from base
    order by market_source_id,product_id,revision,observed_at desc,id desc
  ), sequenced as (
    select *,
      lag(price_jpy) over(partition by market_source_id,product_id order by observed_at,id) previous_price_jpy,
      lag(observed_at) over(partition by market_source_id,product_id order by observed_at,id) previous_observed_at,
      row_number() over(partition by market_source_id,product_id order by observed_at desc,id desc) current_row
    from revision_latest
  ), ranked as (
    select case when s.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid then 'CD' else 'HA' end channel,
      s.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,
      s.price_jpy current_price_jpy,s.observed_at current_observed_at,
      s.previous_price_jpy,s.previous_observed_at,s.price_jpy-s.previous_price_jpy change_jpy,
      round(((s.price_jpy-s.previous_price_jpy)::numeric/nullif(s.previous_price_jpy,0))*100,2) change_percent
    from sequenced s
    join public.market_products mp on mp.id=s.product_id
    where s.current_row=1 and s.previous_price_jpy is not null and s.price_jpy<>s.previous_price_jpy
  ), numbered as (
    select *,row_number() over(partition by channel order by abs(change_percent) desc,current_observed_at desc,product_id) rank
    from ranked
  )
  select * from numbered where rank<=10000;

  truncate public.price_change_ranking_cache;
  insert into public.price_change_ranking_cache(
    channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,
    previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,generated_at)
  select channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,
    previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,now()
  from _pcr;
end;
$function$;


ALTER VIEW public.ha_current_stable_buy_prices SET (security_invoker = true);
