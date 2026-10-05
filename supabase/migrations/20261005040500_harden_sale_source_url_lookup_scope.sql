-- Restrict the server-side source URL lookup to the current HA snapshot.
-- The RPC remains intentionally callable by the public source-product route, but it must not
-- expose historical/non-current observation URLs.

CREATE OR REPLACE FUNCTION public.get_sale_source_url_by_id(p_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path=public
STABLE
AS $$
  SELECT so.source_url
  FROM public.sale_observations so
  JOIN public.sale_current_listings scl
    ON scl.sale_source_id=so.sale_source_id
   AND scl.external_product_key=so.external_product_key
   AND scl.cycle_id=(SELECT last_completed_cycle_id FROM public.sale_collection_state WHERE id=true)
  WHERE so.id=p_id
    AND so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
    AND so.source_url IS NOT NULL
    AND so.source_url ~ '^https?://'
  LIMIT 1
$$;
