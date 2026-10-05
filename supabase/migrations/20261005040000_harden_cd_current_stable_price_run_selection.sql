-- Keep CD current prices valid when a completed collector run records no new observations.
-- Some full runs are orchestration-only/no-op runs; observations may remain attached to
-- the active page-processing run. Select the newest successful full run that actually
-- has observations, then apply the existing short fresh-observation overlay.

CREATE OR REPLACE VIEW public.cd_current_stable_prices
WITH (security_invoker=true) AS
WITH latest_full_run AS (
  SELECT pfr.id,pfr.finished_at
  FROM public.price_fetch_runs pfr
  JOIN public.price_collection_state pcs
    ON pcs.market_source_id=pfr.market_source_id
  WHERE pfr.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
    AND pfr.status='SUCCESS'
    AND pfr.pages_fetched>=pcs.max_pages
    AND EXISTS (
      SELECT 1
      FROM public.price_observations po
      WHERE po.fetch_run_id=pfr.id
        AND po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
    )
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
