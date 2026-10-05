-- Restore the HA buyback current-price boundary.
-- HA buyback prices come from price_observations under the HA BUY_PRICE source.
-- sale_observations/sale_current_listings are HA sale inventory and must not
-- become the source of HA buyback prices.
-- Historical buyback observations remain history; only currently listed,
-- positive, fresh HA buyback observations are eligible for current display.

CREATE OR REPLACE VIEW public.ha_current_stable_buy_prices
WITH (security_invoker=true) AS
SELECT DISTINCT ON (po.product_id)
  po.product_id,
  po.price_jpy,
  po.observed_at,
  po.source_product_key,
  po.source_url
FROM public.price_observations po
JOIN public.source_current_listings scl
  ON scl.market_source_id = '7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
 AND scl.source_product_id = po.raw_payload->>'source_product_id'
WHERE po.market_source_id = '7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid
  AND po.price_jpy > 0
  AND po.observed_at >= now() - interval '1 hour'
ORDER BY po.product_id, po.observed_at DESC, po.created_at DESC, po.id DESC;
