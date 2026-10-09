-- Bind HA data to the actual current sale source and reject stale snapshots.
CREATE OR REPLACE VIEW public.ha_current_stable_buy_prices AS
SELECT DISTINCT ON (so.product_id)
  so.product_id,so.sale_price_jpy AS price_jpy,so.observed_at,
  so.external_product_key AS source_product_key,so.source_url
FROM public.sale_observations so
JOIN public.sale_current_listings scl
  ON scl.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
 AND scl.external_product_key=so.external_product_key
 AND scl.cycle_id=(SELECT last_completed_cycle_id FROM public.sale_collection_state WHERE id=true)
JOIN public.market_products mp ON mp.id=so.product_id
WHERE so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
  AND mp.game='pokemon' AND scl.checked_at>=now()-interval '24 hours'
  AND so.observed_at>=now()-interval '24 hours' AND so.sale_price_jpy>0 AND so.in_stock=true
ORDER BY so.product_id,so.sale_price_jpy ASC,so.observed_at DESC,so.id DESC;
ALTER VIEW public.ha_current_stable_buy_prices SET (security_invoker=true);

CREATE OR REPLACE FUNCTION public.get_current_buy_prices(p_product_ids uuid[])
RETURNS TABLE(product_id uuid,market_source_id uuid,price_jpy integer,observed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
WITH ids AS (SELECT unnest(coalesce(p_product_ids,'{}'::uuid[])) product_id),
cd AS (SELECT c.product_id,c.price_jpy,c.observed_at FROM public.cd_current_stable_prices c JOIN ids i USING(product_id)
 WHERE c.price_jpy>0 AND c.observed_at>=now()-interval '24 hours'),
ha AS (SELECT h.product_id,h.price_jpy,h.observed_at FROM public.ha_current_stable_buy_prices h JOIN ids i USING(product_id)
 WHERE h.price_jpy>0 AND h.observed_at>=now()-interval '24 hours')
SELECT cd.product_id,'6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid,cd.price_jpy,cd.observed_at FROM cd
UNION ALL SELECT ha.product_id,'7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,ha.price_jpy,ha.observed_at FROM ha;
$$;

CREATE OR REPLACE FUNCTION public.get_price_spread_rankings(p_limit integer DEFAULT 50,p_game text DEFAULT 'pokemon')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
WITH paired AS (
 SELECT c.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,c.price_jpy cd_price_jpy,
   h.price_jpy ha_price_jpy,c.observed_at cd_observed_at,h.observed_at ha_observed_at,
   h.price_jpy-c.price_jpy difference_jpy,
   round(abs(h.price_jpy-c.price_jpy)::numeric/nullif(least(h.price_jpy,c.price_jpy),0)*100,2) difference_percent
 FROM public.cd_current_stable_prices c JOIN public.ha_current_stable_buy_prices h USING(product_id)
 JOIN public.market_products mp ON mp.id=c.product_id
 WHERE p_game='pokemon' AND mp.game='pokemon' AND c.price_jpy>0 AND h.price_jpy>0
   AND c.observed_at>=now()-interval '24 hours' AND h.observed_at>=now()-interval '24 hours'
   AND h.price_jpy<>c.price_jpy
), ranked AS (
 SELECT *,CASE WHEN difference_jpy>0 THEN 'HA' ELSE 'CD' END channel,
 row_number() OVER(PARTITION BY CASE WHEN difference_jpy>0 THEN 'HA' ELSE 'CD' END
 ORDER BY abs(difference_jpy) DESC,difference_percent DESC,greatest(cd_observed_at,ha_observed_at) DESC,product_id) rank
 FROM paired
)
SELECT jsonb_build_object(
 'HA',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,'card_number',card_number,'rarity',rarity,'cd_price_jpy',cd_price_jpy,'ha_price_jpy',ha_price_jpy,'difference_jpy',difference_jpy,'difference_percent',difference_percent,'cd_observed_at',cd_observed_at,'ha_observed_at',ha_observed_at) ORDER BY rank) FROM ranked WHERE channel='HA' AND rank<=greatest(1,least(coalesce(p_limit,50),10000))),'[]'::jsonb),
 'CD',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,'card_number',card_number,'rarity',rarity,'cd_price_jpy',cd_price_jpy,'ha_price_jpy',ha_price_jpy,'difference_jpy',difference_jpy,'difference_percent',difference_percent,'cd_observed_at',cd_observed_at,'ha_observed_at',ha_observed_at) ORDER BY rank) FROM ranked WHERE channel='CD' AND rank<=greatest(1,least(coalesce(p_limit,50),10000))),'[]'::jsonb)
);
$$;

CREATE OR REPLACE VIEW public.sale_current_opportunities_cd_ha AS
WITH latest_sale AS (
 SELECT DISTINCT ON (so.external_product_key) so.id,so.sale_fetch_run_id,so.sale_source_id,so.product_id,so.external_product_key,
  so.product_name,so.card_number,so.set_code,so.rarity,so.condition_label,so.sale_price_jpy,so.stock_qty,so.in_stock,
  so.source_url,so.observed_at,so.raw_payload,so.variant_key,so.variant_base_name,so.stock_qty_source,so.stock_qty_observed_at,
  scl.checked_at current_snapshot_checked_at
 FROM public.sale_observations so JOIN public.sale_current_listings scl
  ON scl.sale_source_id=so.sale_source_id AND scl.external_product_key=so.external_product_key
  AND scl.cycle_id=(SELECT last_completed_cycle_id FROM public.sale_collection_state WHERE id=true)
 WHERE so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
  AND scl.checked_at>=now()-interval '24 hours' AND so.observed_at>=now()-interval '24 hours'
 ORDER BY so.external_product_key,so.observed_at DESC,so.id DESC
)
SELECT ls.id sale_observation_id,ls.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,ls.product_name,ls.condition_label,
 CASE WHEN ls.condition_label LIKE 'A%' THEN 'A' ELSE left(ls.condition_label,1) END condition_group,
 ls.condition_label LIKE 'A%' is_primary_condition,ls.sale_price_jpy,ls.stock_qty,ls.source_url sale_source_url,
 ls.observed_at sale_observed_at,cp.price_jpy cd_buy_price_jpy,cp.observed_at cd_buy_observed_at,
 cp.price_jpy-ls.sale_price_jpy gross_spread_jpy,
 CASE WHEN ls.sale_price_jpy>0 THEN round((cp.price_jpy-ls.sale_price_jpy)::numeric/ls.sale_price_jpy::numeric*100,2) ELSE NULL END gross_margin_pct,
 mp.variant_key,mp.variant_base_name,ls.stock_qty_source,ls.stock_qty_observed_at,ls.current_snapshot_checked_at
FROM latest_sale ls JOIN public.market_products mp ON mp.id=ls.product_id AND mp.game='pokemon'
JOIN public.cd_current_stable_prices cp ON cp.product_id=ls.product_id AND cp.observed_at>=now()-interval '24 hours'
WHERE ls.in_stock=true AND ls.sale_price_jpy>0 AND cp.price_jpy>ls.sale_price_jpy;
ALTER VIEW public.sale_current_opportunities_cd_ha SET (security_invoker=true);

CREATE OR REPLACE VIEW public.source_current_listing_health_cd_ha AS
SELECT 'CD'::text channel,'6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid market_source_id,
 (SELECT count(*) FROM public.cd_current_stable_prices) current_count,
 (SELECT count(DISTINCT source_product_key) FROM public.cd_current_stable_prices) observed_source_ids,
 (SELECT count(*) FROM public.price_observations po WHERE po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid) observation_count,
 (SELECT min(observed_at) FROM public.cd_current_stable_prices) min_checked_at,
 (SELECT max(observed_at) FROM public.cd_current_stable_prices) max_checked_at
UNION ALL
SELECT 'HA'::text,'7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,
 (SELECT count(*) FROM public.sale_current_listings WHERE sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND checked_at>=now()-interval '24 hours'),
 (SELECT count(DISTINCT so.external_product_key) FROM public.sale_observations so JOIN public.sale_current_listings scl ON scl.sale_source_id=so.sale_source_id AND scl.external_product_key=so.external_product_key WHERE so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND scl.checked_at>=now()-interval '24 hours'),
 (SELECT count(*) FROM public.sale_observations WHERE sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND observed_at>=now()-interval '24 hours'),
 (SELECT min(checked_at) FROM public.sale_current_listings WHERE sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid),
 (SELECT max(checked_at) FROM public.sale_current_listings WHERE sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid);
ALTER VIEW public.source_current_listing_health_cd_ha SET (security_invoker=true);