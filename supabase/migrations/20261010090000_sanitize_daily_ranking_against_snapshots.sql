-- Validate daily ranking rows against the exact prior-day snapshots and current fresh prices.
CREATE OR REPLACE FUNCTION public.sanitize_price_change_ranking_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE d date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
 CREATE TEMP TABLE _keep_daily_rankings ON COMMIT DROP AS
 SELECT c.* FROM public.price_change_ranking_cache c
 WHERE c.current_price_jpy>0 AND c.previous_price_jpy>0
  AND c.current_observed_at>=now()-interval '24 hours'
  AND c.previous_observed_at>=now()-interval '48 hours'
  AND (
   (c.channel='CD'
    AND EXISTS(SELECT 1 FROM public.daily_price_snapshots ds WHERE ds.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AND ds.product_id=c.product_id AND ds.snapshot_date=d-1 AND ds.price_jpy=c.previous_price_jpy AND ds.source_age_minutes<=1440)
    AND EXISTS(SELECT 1 FROM public.cd_current_stable_prices cur WHERE cur.product_id=c.product_id AND cur.price_jpy=c.current_price_jpy AND cur.observed_at=c.current_observed_at AND cur.observed_at>=now()-interval '24 hours'))
   OR
   (c.channel='HA'
    AND EXISTS(SELECT 1 FROM public.daily_sale_price_snapshots ds WHERE ds.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND ds.product_id=c.product_id AND ds.snapshot_date=d-1 AND ds.price_jpy=c.previous_price_jpy AND ds.source_age_minutes<=1440 AND ds.in_stock=true)
    AND EXISTS(SELECT 1 FROM public.ha_current_stable_buy_prices cur WHERE cur.product_id=c.product_id AND cur.price_jpy=c.current_price_jpy AND cur.observed_at=c.current_observed_at AND cur.observed_at>=now()-interval '24 hours'))
  );
 TRUNCATE public.price_change_ranking_cache;
 INSERT INTO public.price_change_ranking_cache(channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,generated_at)
 SELECT channel,row_number() OVER(PARTITION BY channel ORDER BY abs(change_percent) DESC,abs(change_jpy) DESC,current_observed_at DESC,product_id)::integer,
  product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,now()
 FROM _keep_daily_rankings;
END;
$function$;
SELECT public.refresh_price_change_ranking_cache();
SELECT public.sanitize_price_change_ranking_cache();