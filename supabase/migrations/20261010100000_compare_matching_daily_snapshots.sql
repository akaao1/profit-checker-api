CREATE OR REPLACE FUNCTION public.refresh_price_change_ranking_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE tokyo_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('price_change_ranking_cache'));
 CREATE TEMP TABLE _daily_snapshot_deltas ON COMMIT DROP AS
 WITH cd_current AS (
  SELECT cur.product_id,cur.price_jpy,cur.source_observed_at observed_at
  FROM public.daily_price_snapshots cur JOIN public.market_products mp ON mp.id=cur.product_id AND mp.game='pokemon'
  WHERE cur.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AND cur.snapshot_date=tokyo_today
   AND cur.price_jpy>0 AND cur.source_age_minutes BETWEEN 0 AND 1440
 ), cd_previous AS (
  SELECT prev.product_id,prev.price_jpy,prev.source_observed_at observed_at
  FROM public.daily_price_snapshots prev JOIN public.market_products mp ON mp.id=prev.product_id AND mp.game='pokemon'
  WHERE prev.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AND prev.snapshot_date=tokyo_today-1
   AND prev.price_jpy>0 AND prev.source_age_minutes BETWEEN 0 AND 1440
 ), cd_daily AS (
  SELECT 'CD'::text channel,cur.product_id,cur.price_jpy current_price_jpy,prev.price_jpy previous_price_jpy,
   cur.observed_at current_observed_at,prev.observed_at previous_observed_at
  FROM cd_current cur JOIN cd_previous prev USING(product_id)
 ), ha_current AS (
  SELECT cur.product_id,cur.price_jpy,cur.source_observed_at observed_at
  FROM public.daily_sale_price_snapshots cur JOIN public.market_products mp ON mp.id=cur.product_id AND mp.game='pokemon'
  WHERE cur.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND cur.snapshot_date=tokyo_today
   AND cur.price_jpy>0 AND cur.source_age_minutes BETWEEN 0 AND 1440 AND cur.in_stock=true
 ), ha_previous AS (
  SELECT prev.product_id,prev.price_jpy,prev.source_observed_at observed_at
  FROM public.daily_sale_price_snapshots prev JOIN public.market_products mp ON mp.id=prev.product_id AND mp.game='pokemon'
  WHERE prev.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND prev.snapshot_date=tokyo_today-1
   AND prev.price_jpy>0 AND prev.source_age_minutes BETWEEN 0 AND 1440 AND prev.in_stock=true
 ), ha_daily AS (
  SELECT 'HA'::text channel,cur.product_id,cur.price_jpy current_price_jpy,prev.price_jpy previous_price_jpy,
   cur.observed_at current_observed_at,prev.observed_at previous_observed_at
  FROM ha_current cur JOIN ha_previous prev USING(product_id)
 ), deltas AS (
  SELECT * FROM cd_daily UNION ALL SELECT * FROM ha_daily
 ), enriched AS (
  SELECT d.channel,d.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,
   d.current_price_jpy,d.previous_price_jpy,d.current_price_jpy-d.previous_price_jpy change_jpy,
   round(((d.current_price_jpy-d.previous_price_jpy)::numeric/nullif(d.previous_price_jpy,0))*100,2) change_percent,
   d.current_observed_at,d.previous_observed_at
  FROM deltas d JOIN public.market_products mp ON mp.id=d.product_id AND mp.game='pokemon'
  WHERE d.current_price_jpy<>d.previous_price_jpy
 ), numbered AS (
  SELECT *,row_number() OVER(PARTITION BY channel ORDER BY abs(change_percent) DESC,abs(change_jpy) DESC,current_observed_at DESC,product_id)::integer rank
  FROM enriched
 )
 SELECT * FROM numbered WHERE rank<=10000;
 TRUNCATE public.price_change_ranking_cache;
 INSERT INTO public.price_change_ranking_cache(channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,generated_at)
 SELECT channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,now()
 FROM _daily_snapshot_deltas;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sanitize_price_change_ranking_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE tokyo_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
 CREATE TEMP TABLE _keep_daily_rankings ON COMMIT DROP AS
 SELECT c.* FROM public.price_change_ranking_cache c
 WHERE c.current_price_jpy>0 AND c.previous_price_jpy>0 AND (
  (c.channel='CD'
   AND EXISTS(SELECT 1 FROM public.daily_price_snapshots cur WHERE cur.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AND cur.product_id=c.product_id AND cur.snapshot_date=tokyo_today AND cur.price_jpy=c.current_price_jpy AND cur.source_observed_at=c.current_observed_at AND cur.source_age_minutes BETWEEN 0 AND 1440)
   AND EXISTS(SELECT 1 FROM public.daily_price_snapshots prev WHERE prev.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AND prev.product_id=c.product_id AND prev.snapshot_date=tokyo_today-1 AND prev.price_jpy=c.previous_price_jpy AND prev.source_observed_at=c.previous_observed_at AND prev.source_age_minutes BETWEEN 0 AND 1440))
  OR
  (c.channel='HA'
   AND EXISTS(SELECT 1 FROM public.daily_sale_price_snapshots cur WHERE cur.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND cur.product_id=c.product_id AND cur.snapshot_date=tokyo_today AND cur.price_jpy=c.current_price_jpy AND cur.source_observed_at=c.current_observed_at AND cur.source_age_minutes BETWEEN 0 AND 1440 AND cur.in_stock=true)
   AND EXISTS(SELECT 1 FROM public.daily_sale_price_snapshots prev WHERE prev.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND prev.product_id=c.product_id AND prev.snapshot_date=tokyo_today-1 AND prev.price_jpy=c.previous_price_jpy AND prev.source_observed_at=c.previous_observed_at AND prev.source_age_minutes BETWEEN 0 AND 1440 AND prev.in_stock=true))
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