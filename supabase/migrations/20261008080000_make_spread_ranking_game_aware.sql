create or replace function public.get_price_spread_rankings(p_limit integer default 50,p_game text default 'pokemon')
returns jsonb language sql stable security definer set search_path=public as $function$
with cd as (
 select c.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,mp.variant_key,c.price_jpy cd_price_jpy,c.observed_at cd_observed_at
 from public.cd_current_stable_prices c join public.market_products mp on mp.id=c.product_id where mp.game=p_game
),
ha as (
 select distinct on (hm.card_number,coalesce(hm.rarity,''),coalesce(hm.variant_key,'NORMAL'))
  hm.card_number,hm.rarity,hm.variant_key,h.price_jpy,h.observed_at,h.product_id
 from public.ha_current_stable_buy_prices h join public.market_products hm on hm.id=h.product_id
 where hm.game=p_game
 order by hm.card_number,coalesce(hm.rarity,''),coalesce(hm.variant_key,'NORMAL'),h.observed_at desc,h.product_id
),
paired as (
 select c.product_id,c.canonical_name,c.set_name,c.card_number,c.rarity,c.cd_price_jpy,h.price_jpy ha_price_jpy,c.cd_observed_at,h.observed_at ha_observed_at,
 h.price_jpy-c.cd_price_jpy difference_jpy,round(abs(h.price_jpy-c.cd_price_jpy)::numeric/nullif(least(h.price_jpy,c.cd_price_jpy),0)*100,2) difference_percent
 from cd c join ha h on c.card_number=h.card_number and coalesce(c.rarity,'')=coalesce(h.rarity,'') and coalesce(c.variant_key,'NORMAL')=coalesce(h.variant_key,'NORMAL')
 where h.price_jpy<>c.cd_price_jpy
),
ranked as (
 select *,case when difference_jpy>0 then 'HA' else 'CD' end channel,row_number() over(partition by case when difference_jpy>0 then 'HA' else 'CD' end order by abs(difference_jpy) desc,difference_percent desc,greatest(cd_observed_at,ha_observed_at) desc,product_id) rank from paired
)
select jsonb_build_object(
 'HA',coalesce((select jsonb_agg(jsonb_build_object('rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,'card_number',card_number,'rarity',rarity,'cd_price_jpy',cd_price_jpy,'ha_price_jpy',ha_price_jpy,'difference_jpy',difference_jpy,'difference_percent',difference_percent,'cd_observed_at',cd_observed_at,'ha_observed_at',ha_observed_at) order by rank) from ranked where channel='HA' and rank<=greatest(1,least(coalesce(p_limit,50),10000))),'[]'::jsonb),
 'CD',coalesce((select jsonb_agg(jsonb_build_object('rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,'card_number',card_number,'rarity',rarity,'cd_price_jpy',cd_price_jpy,'ha_price_jpy',ha_price_jpy,'difference_jpy',difference_jpy,'difference_percent',difference_percent,'cd_observed_at',cd_observed_at,'ha_observed_at',ha_observed_at) order by rank) from ranked where channel='CD' and rank<=greatest(1,least(coalesce(p_limit,50),10000))),'[]'::jsonb)
);
$function$;
