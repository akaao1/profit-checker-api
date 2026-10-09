CREATE INDEX IF NOT EXISTS idx_sale_current_listings_active_cycle
ON public.sale_current_listings (sale_source_id, cycle_id, checked_at, external_product_key);

CREATE OR REPLACE VIEW public.ha_current_stable_buy_prices AS
WITH latest_per_listing AS (
  SELECT DISTINCT ON (so.external_product_key)
    so.product_id,
    so.sale_price_jpy AS price_jpy,
    so.observed_at,
    so.external_product_key AS source_product_key,
    so.source_url,
    so.in_stock
  FROM public.sale_current_listings scl
  JOIN public.sale_observations so
    ON so.sale_source_id = scl.sale_source_id
   AND so.external_product_key = scl.external_product_key
  JOIN public.market_products mp
    ON mp.id = so.product_id
   AND mp.game = 'pokemon'
  WHERE scl.sale_source_id = '75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
    AND scl.cycle_id = (
      SELECT sale_collection_state.last_completed_cycle_id
      FROM public.sale_collection_state
      WHERE sale_collection_state.id = true
    )
    AND scl.checked_at >= now() - interval '24 hours'
    AND so.sale_source_id = '75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
    AND so.observed_at >= now() - interval '24 hours'
    AND so.sale_price_jpy > 0
  ORDER BY so.external_product_key, so.observed_at DESC, so.id DESC
),
cheapest_in_stock AS (
  SELECT DISTINCT ON (l.product_id)
    l.product_id, l.price_jpy, l.observed_at,
    l.source_product_key, l.source_url
  FROM latest_per_listing l
  WHERE l.in_stock = true
  ORDER BY l.product_id, l.price_jpy ASC, l.observed_at DESC, l.source_product_key
)
SELECT product_id, price_jpy, observed_at, source_product_key, source_url
FROM cheapest_in_stock;

ALTER VIEW public.ha_current_stable_buy_prices SET (security_invoker = true);