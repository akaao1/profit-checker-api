CREATE OR REPLACE FUNCTION public.get_price_change_rankings(p_limit integer DEFAULT 10000)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
select jsonb_build_object(
 'CD',coalesce((
   select jsonb_agg(jsonb_build_object(
     'rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,
     'card_number',card_number,'rarity',rarity,'current_price_jpy',current_price_jpy,
     'previous_price_jpy',previous_price_jpy,'change_jpy',change_jpy,'change_percent',change_percent,
     'current_observed_at',current_observed_at,'previous_observed_at',previous_observed_at
   ) order by rank)
   from public.price_change_ranking_cache
   where channel='CD'
     and rank<=greatest(1,least(coalesce(p_limit,10000),10000))
 ),'[]'::jsonb),
 'HA',coalesce((
   select jsonb_agg(jsonb_build_object(
     'rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,
     'card_number',card_number,'rarity',rarity,'current_price_jpy',current_price_jpy,
     'previous_price_jpy',previous_price_jpy,'change_jpy',change_jpy,'change_percent',change_percent,
     'current_observed_at',current_observed_at,'previous_observed_at',previous_observed_at
   ) order by rank)
   from public.price_change_ranking_cache c
   where channel='HA'
     and rank<=greatest(1,least(coalesce(p_limit,10000),10000))
     and exists (
       select 1 from public.ha_current_stable_buy_prices h
       where h.product_id=c.product_id
     )
 ),'[]'::jsonb)
);
$function$;