-- Fix HA buyback search resolution.
-- HA buyback data lives in price_observations under the HA BUY_PRICE source.
-- The previous implementation incorrectly read HA selling inventory from sale_observations.
CREATE OR REPLACE FUNCTION public.get_current_buy_prices(p_product_ids uuid[])
RETURNS TABLE(product_id uuid, market_source_id uuid, price_jpy integer, observed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='public'
AS $function$
WITH ids AS (
  SELECT unnest(coalesce(p_product_ids,'{}'::uuid[])) AS product_id
),
cd AS (
  SELECT c.product_id,c.price_jpy,c.observed_at
  FROM public.cd_current_stable_prices c
  JOIN ids i ON i.product_id=c.product_id
),
ha AS (
  SELECT DISTINCT ON (po.product_id)
    po.product_id,po.price_jpy,po.observed_at
  FROM public.price_observations po
  JOIN ids i ON i.product_id=po.product_id
  WHERE po.market_source_id='7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
    AND po.price_jpy>0
  ORDER BY po.product_id,po.observed_at DESC,po.created_at DESC,po.id DESC
)
SELECT cd.product_id,'6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid,cd.price_jpy,cd.observed_at FROM cd
UNION ALL
SELECT ha.product_id,'7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,ha.price_jpy,ha.observed_at FROM ha;
$function$;
