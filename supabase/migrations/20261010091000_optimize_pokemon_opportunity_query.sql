-- Use the fresh normalized HA view instead of an OR join over all products.
CREATE OR REPLACE FUNCTION public.get_ha_to_cd_opportunities(p_limit integer DEFAULT 50,p_game text DEFAULT 'pokemon')
RETURNS TABLE(rank integer,game text,product_id uuid,canonical_name text,set_name text,card_number text,rarity text,variant_key text,condition_label text,stock_qty integer,ha_price_jpy integer,cd_price_jpy integer,gross_profit_jpy integer,gross_margin_pct numeric,ha_observed_at timestamptz,cd_observed_at timestamptz,ha_source_url text,ha_external_product_key text)
LANGUAGE sql STABLE SET search_path=public AS $function$
WITH matched AS (
 SELECT mp.id product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,mp.variant_key,so.condition_label,so.stock_qty,
  h.price_jpy ha_price_jpy,cp.price_jpy cd_price_jpy,h.observed_at ha_observed_at,cp.observed_at cd_observed_at,
  so.source_url ha_source_url,h.source_product_key ha_external_product_key,cp.price_jpy-h.price_jpy gross_profit_jpy,
  round(((cp.price_jpy-h.price_jpy)::numeric/nullif(h.price_jpy,0))*100,2) gross_margin_pct
 FROM public.ha_current_stable_buy_prices h
 JOIN public.sale_observations so ON so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
  AND so.external_product_key=h.source_product_key AND so.product_id=h.product_id AND so.observed_at=h.observed_at
  AND so.sale_price_jpy=h.price_jpy AND so.in_stock=true
 JOIN public.market_products mp ON mp.id=h.product_id AND mp.game='pokemon'
 JOIN public.cd_current_stable_prices cp ON cp.product_id=h.product_id
 WHERE p_game='pokemon' AND h.price_jpy>0 AND cp.price_jpy>h.price_jpy
  AND h.observed_at>=now()-interval '24 hours' AND cp.observed_at>=now()-interval '24 hours'
  AND abs(extract(epoch FROM(h.observed_at-cp.observed_at)))<=86400
)
SELECT row_number() OVER(ORDER BY gross_profit_jpy DESC,gross_margin_pct DESC NULLS LAST,product_id)::integer,'pokemon'::text,
 product_id,canonical_name,set_name,card_number,rarity,variant_key,condition_label,stock_qty,ha_price_jpy,cd_price_jpy,
 gross_profit_jpy,gross_margin_pct,ha_observed_at,cd_observed_at,ha_source_url,ha_external_product_key
FROM matched ORDER BY gross_profit_jpy DESC,gross_margin_pct DESC NULLS LAST,product_id LIMIT greatest(1,least(coalesce(p_limit,50),200));
$function$;

CREATE OR REPLACE VIEW public.sale_current_opportunities_cd_ha AS
SELECT so.id sale_observation_id,h.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,so.product_name,so.condition_label,
 CASE WHEN so.condition_label LIKE 'A%' THEN 'A' ELSE left(so.condition_label,1) END condition_group,
 so.condition_label LIKE 'A%' is_primary_condition,h.price_jpy sale_price_jpy,so.stock_qty,so.source_url sale_source_url,
 h.observed_at sale_observed_at,cp.price_jpy cd_buy_price_jpy,cp.observed_at cd_buy_observed_at,cp.price_jpy-h.price_jpy gross_spread_jpy,
 round((cp.price_jpy-h.price_jpy)::numeric/nullif(h.price_jpy,0)*100,2) gross_margin_pct,mp.variant_key,mp.variant_base_name,
 so.stock_qty_source,so.stock_qty_observed_at,scl.checked_at current_snapshot_checked_at
FROM public.ha_current_stable_buy_prices h
JOIN public.sale_observations so ON so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
 AND so.external_product_key=h.source_product_key AND so.product_id=h.product_id AND so.observed_at=h.observed_at
 AND so.sale_price_jpy=h.price_jpy AND so.in_stock=true
JOIN public.sale_current_listings scl ON scl.sale_source_id=so.sale_source_id AND scl.external_product_key=so.external_product_key
 AND scl.cycle_id=(SELECT last_completed_cycle_id FROM public.sale_collection_state WHERE id=true)
JOIN public.market_products mp ON mp.id=h.product_id AND mp.game='pokemon'
JOIN public.cd_current_stable_prices cp ON cp.product_id=h.product_id
WHERE h.price_jpy>0 AND cp.price_jpy>h.price_jpy AND h.observed_at>=now()-interval '24 hours'
 AND cp.observed_at>=now()-interval '24 hours' AND scl.checked_at>=now()-interval '24 hours'
 AND abs(extract(epoch FROM(h.observed_at-cp.observed_at)))<=86400;
ALTER VIEW public.sale_current_opportunities_cd_ha SET(security_invoker=true);
SELECT public.refresh_price_change_ranking_cache();
SELECT public.sanitize_price_change_ranking_cache();