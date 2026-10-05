-- Keep HA current price aligned with the HA sale-side current completed cycle.
-- The HA current price used by radar is the current HA sale-side price,
-- not the historical price_observations buyback source.
-- Only listings in the latest completed HA cycle participate.
CREATE OR REPLACE VIEW public.ha_current_stable_buy_prices
WITH (security_invoker=true) AS
WITH latest_per_listing AS (
  SELECT DISTINCT ON (so.external_product_key)
    so.id,
    so.product_id,
    so.sale_price_jpy AS price_jpy,
    so.observed_at,
    so.external_product_key AS source_product_key,
    so.source_url,
    so.condition_label,
    so.in_stock
  FROM public.sale_observations so
  JOIN public.sale_current_listings scl
    ON scl.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
   AND scl.external_product_key=so.external_product_key
   AND scl.cycle_id=(SELECT sale_collection_state.last_completed_cycle_id FROM public.sale_collection_state WHERE sale_collection_state.id=true)
  WHERE so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
    AND so.sale_price_jpy>0
  ORDER BY so.external_product_key,so.observed_at DESC,so.id DESC
),
current_rows AS (
  SELECT latest_per_listing.product_id,
    latest_per_listing.price_jpy,
    latest_per_listing.observed_at,
    latest_per_listing.source_product_key,
    latest_per_listing.source_url,
    latest_per_listing.condition_label,
    latest_per_listing.in_stock,
    row_number() OVER (
      PARTITION BY latest_per_listing.product_id
      ORDER BY
        CASE WHEN latest_per_listing.in_stock THEN 0 ELSE 1 END,
        CASE upper(coalesce(latest_per_listing.condition_label,''::text))
          WHEN 'A+' THEN 0 WHEN 'A' THEN 1 WHEN 'A-' THEN 2
          WHEN 'B+' THEN 3 WHEN 'B' THEN 4 WHEN 'B-' THEN 5
          WHEN 'C+' THEN 6 WHEN 'C' THEN 7 WHEN 'C-' THEN 8
          WHEN 'D+' THEN 9 WHEN 'D' THEN 10 WHEN 'D-' THEN 11
          ELSE 12 END,
        latest_per_listing.observed_at DESC,
        latest_per_listing.id DESC
    ) AS rn
  FROM latest_per_listing
)
SELECT product_id,price_jpy,observed_at,source_product_key,source_url
FROM current_rows
WHERE rn=1;
