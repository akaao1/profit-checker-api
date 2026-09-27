-- Harden cross-market current-price resolution for opportunity/spread discovery.
-- The CD collector is paginated and can be mid-cycle; source_current_listings is therefore
-- not treated as the authoritative live snapshot while a cycle is in progress.
-- We use the latest completed full CD cycle plus a short fresh-observation overlay.
-- HA uses the atomic sale_current_listings snapshot directly.

CREATE OR REPLACE VIEW public.cd_current_stable_prices AS
WITH latest_full_run AS (
  SELECT pfr.id,pfr.finished_at
  FROM public.price_fetch_runs pfr
  JOIN public.price_collection_state pcs ON pcs.market_source_id=pfr.market_source_id
  WHERE pfr.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
    AND pfr.status='SUCCESS' AND pfr.pages_fetched >= pcs.max_pages
  ORDER BY pfr.finished_at DESC NULLS LAST,pfr.started_at DESC
  LIMIT 1
),
candidate AS (
  SELECT po.product_id,po.price_jpy,po.observed_at,po.source_product_key,po.source_url,po.qualifies_min_price
  FROM public.price_observations po
  JOIN latest_full_run r ON r.id=po.fetch_run_id
  WHERE po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
    AND po.price_jpy>0
  UNION ALL
  SELECT po.product_id,po.price_jpy,po.observed_at,po.source_product_key,po.source_url,po.qualifies_min_price
  FROM public.price_observations po
  WHERE po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
    AND po.price_jpy>0
    AND po.observed_at>=now()-interval '60 minutes'
),
ranked AS (
  SELECT DISTINCT ON (product_id) *
  FROM candidate
  ORDER BY product_id,observed_at DESC
)
SELECT * FROM ranked;

ALTER VIEW public.cd_current_stable_prices SET (security_invoker=true);

CREATE INDEX IF NOT EXISTS idx_price_observations_fetch_run_product_time
ON public.price_observations(fetch_run_id,product_id,observed_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_price_observations_source_product_time
ON public.price_observations(market_source_id,product_id,observed_at DESC,id DESC);

CREATE OR REPLACE VIEW public.sale_current_opportunities_cd_ha AS
WITH latest_sale AS (
  SELECT DISTINCT ON (so.external_product_key)
    so.id,so.sale_fetch_run_id,so.sale_source_id,so.product_id,so.external_product_key,
    so.product_name,so.card_number,so.set_code,so.rarity,so.condition_label,
    so.sale_price_jpy,so.stock_qty,so.in_stock,so.source_url,so.observed_at,
    so.raw_payload,so.variant_key,so.variant_base_name,so.stock_qty_source,
    so.stock_qty_observed_at,scl.checked_at AS current_snapshot_checked_at
  FROM public.sale_observations so
  JOIN public.sale_current_listings scl
    ON scl.sale_source_id=so.sale_source_id
   AND scl.external_product_key=so.external_product_key
  WHERE so.sale_source_id=(SELECT ss.id FROM public.sale_sources ss WHERE ss.code='HA_SELL' LIMIT 1)
    AND so.observed_at >= now()-interval '6 hours'
  ORDER BY so.external_product_key,so.observed_at DESC,so.id DESC
)
SELECT
  ls.id AS sale_observation_id,ls.product_id,mp.canonical_name,mp.set_name,mp.card_number,
  mp.rarity,ls.product_name,ls.condition_label,
  CASE WHEN ls.condition_label LIKE 'A%' THEN 'A' ELSE left(ls.condition_label,1) END AS condition_group,
  ls.condition_label LIKE 'A%' AS is_primary_condition,
  ls.sale_price_jpy,ls.stock_qty,ls.source_url AS sale_source_url,
  ls.observed_at AS sale_observed_at,cp.price_jpy AS cd_buy_price_jpy,
  cp.observed_at AS cd_buy_observed_at,
  cp.price_jpy-ls.sale_price_jpy AS gross_spread_jpy,
  CASE WHEN ls.sale_price_jpy>0
    THEN round((cp.price_jpy-ls.sale_price_jpy)::numeric/ls.sale_price_jpy::numeric*100,2)
    ELSE NULL END AS gross_margin_pct,
  mp.variant_key,mp.variant_base_name,ls.stock_qty_source,ls.stock_qty_observed_at,
  ls.current_snapshot_checked_at
FROM latest_sale ls
JOIN public.market_products mp ON mp.id=ls.product_id
JOIN public.cd_current_stable_prices cp ON cp.product_id=ls.product_id
WHERE ls.in_stock=true AND ls.sale_price_jpy>0 AND cp.price_jpy>ls.sale_price_jpy;

ALTER VIEW public.sale_current_opportunities_cd_ha SET (security_invoker=true);

CREATE OR REPLACE VIEW public.sale_condition_comparison_cd_ha AS
WITH latest_sale AS (
  SELECT DISTINCT ON (so.external_product_key)
    so.id,so.sale_fetch_run_id,so.sale_source_id,so.product_id,so.external_product_key,
    so.product_name,so.card_number,so.set_code,so.rarity,so.condition_label,
    so.sale_price_jpy,so.stock_qty,so.in_stock,so.source_url,so.observed_at,
    so.raw_payload,so.variant_key,so.variant_base_name,so.stock_qty_source,so.stock_qty_observed_at
  FROM public.sale_observations so
  JOIN public.sale_current_listings scl
    ON scl.sale_source_id=so.sale_source_id
   AND scl.external_product_key=so.external_product_key
  WHERE so.sale_source_id=(SELECT ss.id FROM public.sale_sources ss WHERE ss.code='HA_SELL' LIMIT 1)
  ORDER BY so.external_product_key,so.observed_at DESC,so.id DESC
),
base AS (
  SELECT ls.id,ls.sale_fetch_run_id,ls.sale_source_id,ls.product_id,ls.external_product_key,
    ls.product_name,ls.card_number,ls.set_code,ls.rarity,ls.condition_label,ls.sale_price_jpy,
    ls.stock_qty,ls.in_stock,ls.source_url,ls.observed_at,ls.raw_payload,ls.variant_key,
    ls.variant_base_name,ls.stock_qty_source,ls.stock_qty_observed_at,
    mp.canonical_name,mp.set_name,mp.card_number AS mp_card_number,mp.rarity AS mp_rarity,
    mp.variant_key AS mp_variant_key,mp.variant_base_name AS mp_variant_base_name,
    cp.price_jpy AS cd_buy_price_jpy,cp.observed_at AS cd_buy_observed_at
  FROM latest_sale ls
  JOIN public.market_products mp ON mp.id=ls.product_id
  JOIN public.cd_current_stable_prices cp ON cp.product_id=ls.product_id
)
SELECT product_id,canonical_name,set_name,mp_card_number AS card_number,mp_rarity AS rarity,
  cd_buy_price_jpy,cd_buy_observed_at,
  (array_agg(id ORDER BY observed_at DESC) FILTER (WHERE condition_label LIKE 'A%'))[1] AS a_sale_observation_id,
  (array_agg(id ORDER BY observed_at DESC) FILTER (WHERE condition_label LIKE 'B%'))[1] AS b_sale_observation_id,
  (array_agg(id ORDER BY observed_at DESC) FILTER (WHERE condition_label LIKE 'C%'))[1] AS c_sale_observation_id,
  (array_agg(id ORDER BY observed_at DESC) FILTER (WHERE condition_label LIKE 'D%'))[1] AS d_sale_observation_id,
  max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'A%') AS a_sale_price_jpy,
  max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'B%') AS b_sale_price_jpy,
  max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'C%') AS c_sale_price_jpy,
  max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'D%') AS d_sale_price_jpy,
  max(condition_label) FILTER (WHERE condition_label LIKE 'A%') AS a_condition_label,
  max(condition_label) FILTER (WHERE condition_label LIKE 'B%') AS b_condition_label,
  max(condition_label) FILTER (WHERE condition_label LIKE 'C%') AS c_condition_label,
  max(condition_label) FILTER (WHERE condition_label LIKE 'D%') AS d_condition_label,
  cd_buy_price_jpy-max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'A%') AS a_spread_jpy,
  cd_buy_price_jpy-max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'B%') AS b_spread_jpy,
  cd_buy_price_jpy-max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'C%') AS c_spread_jpy,
  cd_buy_price_jpy-max(sale_price_jpy) FILTER (WHERE condition_label LIKE 'D%') AS d_spread_jpy,
  mp_variant_key AS variant_key,mp_variant_base_name AS variant_base_name
FROM base
GROUP BY product_id,canonical_name,set_name,mp_card_number,mp_rarity,mp_variant_key,mp_variant_base_name,
  cd_buy_price_jpy,cd_buy_observed_at;

ALTER VIEW public.sale_condition_comparison_cd_ha SET (security_invoker=true);

CREATE OR REPLACE VIEW public.latest_market_prices AS
SELECT '6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AS market_source_id,
       product_id,price_jpy,observed_at,source_url,qualifies_min_price
FROM public.cd_current_stable_prices
UNION ALL
SELECT po.market_source_id,po.product_id,po.price_jpy,po.observed_at,po.source_url,po.qualifies_min_price
FROM (
 SELECT DISTINCT ON ((po.raw_payload->>'source_product_id')) po.*
 FROM public.price_observations po
 JOIN public.source_current_listings scl
   ON scl.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
  AND scl.source_product_id=(po.raw_payload->>'source_product_id')
 WHERE po.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
 ORDER BY (po.raw_payload->>'source_product_id'),po.observed_at DESC,po.created_at DESC,po.id DESC
) po;

ALTER VIEW public.latest_market_prices SET (security_invoker=true);

CREATE OR REPLACE FUNCTION public.get_current_buy_prices(p_product_ids uuid[])
RETURNS TABLE(product_id uuid,market_source_id uuid,price_jpy integer,observed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public'
AS $$
WITH ids AS (SELECT unnest(coalesce(p_product_ids,'{}'::uuid[])) product_id),
cd AS (
 SELECT c.product_id,c.price_jpy,c.observed_at
 FROM public.cd_current_stable_prices c JOIN ids i ON i.product_id=c.product_id
),
ha AS (
 SELECT DISTINCT ON (so.product_id)
   so.product_id,so.sale_price_jpy AS price_jpy,so.observed_at
 FROM public.sale_current_listings scl
 JOIN public.sale_observations so
   ON so.sale_source_id=scl.sale_source_id AND so.external_product_key=scl.external_product_key
 JOIN ids i ON i.product_id=so.product_id
 WHERE scl.sale_source_id=(SELECT id FROM public.sale_sources WHERE code='HA_SELL' LIMIT 1)
   AND so.in_stock=true AND so.sale_price_jpy>0
 ORDER BY so.product_id,so.sale_price_jpy ASC,so.observed_at DESC,so.id DESC
)
SELECT cd.product_id,'6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid,cd.price_jpy,cd.observed_at FROM cd
UNION ALL
SELECT ha.product_id,'7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,ha.price_jpy,ha.observed_at FROM ha;
$$;

CREATE OR REPLACE FUNCTION public.get_price_spread_rankings(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public'
AS $$
WITH cd_current AS (
 SELECT product_id,price_jpy,observed_at FROM public.cd_current_stable_prices
),
ha_current AS (
 SELECT DISTINCT ON (so.product_id)
   so.product_id,so.sale_price_jpy AS price_jpy,so.observed_at,so.condition_label
 FROM public.sale_current_listings scl
 JOIN public.sale_observations so
   ON so.sale_source_id=scl.sale_source_id AND so.external_product_key=scl.external_product_key
 WHERE scl.sale_source_id=(SELECT id FROM public.sale_sources WHERE code='HA_SELL' LIMIT 1)
   AND so.in_stock=true AND so.sale_price_jpy>0
 ORDER BY so.product_id,so.sale_price_jpy ASC,so.observed_at DESC,so.id DESC
),
paired AS (
 SELECT c.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,
   c.price_jpy cd_price_jpy,h.price_jpy ha_price_jpy,c.observed_at cd_observed_at,h.observed_at ha_observed_at,
   h.price_jpy-c.price_jpy difference_jpy,
   round(abs(h.price_jpy-c.price_jpy)::numeric/nullif(least(h.price_jpy,c.price_jpy),0)*100,2) difference_percent
 FROM cd_current c JOIN ha_current h USING(product_id)
 JOIN public.market_products mp ON mp.id=c.product_id
 WHERE h.price_jpy<>c.price_jpy
),
ranked AS (
 SELECT *,case when difference_jpy>0 then 'HA' else 'CD' end channel,
 row_number() over(partition by case when difference_jpy>0 then 'HA' else 'CD' end
   order by abs(difference_jpy) desc,difference_percent desc,greatest(cd_observed_at,ha_observed_at) desc,product_id) rank
 FROM paired
),
payload AS (
 SELECT channel,jsonb_agg(jsonb_build_object(
   'rank',rank,'product_id',product_id,'canonical_name',canonical_name,'set_name',set_name,
   'card_number',card_number,'rarity',rarity,'cd_price_jpy',cd_price_jpy,'ha_price_jpy',ha_price_jpy,
   'difference_jpy',difference_jpy,'difference_percent',difference_percent,
   'cd_observed_at',cd_observed_at,'ha_observed_at',ha_observed_at
 ) ORDER BY rank) FILTER(WHERE rank<=greatest(1,least(coalesce(p_limit,50),10000))) items
 FROM ranked GROUP BY channel
)
SELECT jsonb_build_object(
 'HA',coalesce((SELECT items FROM payload WHERE channel='HA'),'[]'::jsonb),
 'CD',coalesce((SELECT items FROM payload WHERE channel='CD'),'[]'::jsonb)
);
$$;

CREATE OR REPLACE VIEW public.source_current_listing_health_cd_ha AS
SELECT 'CD'::text AS channel,'6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AS market_source_id,
       (SELECT count(*) FROM public.cd_current_stable_prices) AS current_count,
       (SELECT count(DISTINCT source_product_key) FROM public.cd_current_stable_prices) AS observed_source_ids,
       (SELECT count(*) FROM public.price_observations po WHERE po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid) AS observation_count,
       (SELECT min(observed_at) FROM public.cd_current_stable_prices) AS min_checked_at,
       (SELECT max(observed_at) FROM public.cd_current_stable_prices) AS max_checked_at
UNION ALL
SELECT 'HA'::text,'7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,
       (SELECT count(*) FROM public.sale_current_listings scl WHERE scl.sale_source_id=(SELECT id FROM public.sale_sources WHERE code='HA_SELL' LIMIT 1)),
       (SELECT count(DISTINCT so.external_product_key) FROM public.sale_observations so JOIN public.sale_current_listings scl ON scl.sale_source_id=so.sale_source_id AND scl.external_product_key=so.external_product_key WHERE so.sale_source_id=(SELECT id FROM public.sale_sources WHERE code='HA_SELL' LIMIT 1)),
       (SELECT count(*) FROM public.sale_observations so WHERE so.sale_source_id=(SELECT id FROM public.sale_sources WHERE code='HA_SELL' LIMIT 1)),
       (SELECT min(checked_at) FROM public.sale_current_listings WHERE sale_source_id=(SELECT id FROM public.sale_sources WHERE code='HA_SELL' LIMIT 1)),
       (SELECT max(checked_at) FROM public.sale_current_listings WHERE sale_source_id=(SELECT id FROM public.sale_sources WHERE code='HA_SELL' LIMIT 1));

ALTER VIEW public.source_current_listing_health_cd_ha SET (security_invoker=true);
