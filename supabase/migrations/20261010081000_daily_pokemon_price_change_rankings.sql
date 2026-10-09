-- Initial daily change policy: use only fresh current observations and a prior-day sample.
-- The later daily-snapshot migration replaces the observation-window baseline with fixed daily snapshots.
CREATE OR REPLACE FUNCTION public.refresh_price_change_ranking_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('price_change_ranking_cache'));
  CREATE TEMP TABLE _pcr ON COMMIT DROP AS
  WITH cd_current AS (
    SELECT c.product_id,c.price_jpy,c.observed_at
    FROM public.cd_current_stable_prices c
    JOIN public.market_products mp ON mp.id=c.product_id
    WHERE mp.game='pokemon' AND c.price_jpy>0 AND c.observed_at>=now()-interval '24 hours'
  ),
  cd_daily AS (
    SELECT 'CD'::text channel,cur.product_id,cur.price_jpy current_price_jpy,
      prev.price_jpy previous_price_jpy,cur.observed_at current_observed_at,prev.observed_at previous_observed_at
    FROM cd_current cur
    JOIN LATERAL (
      SELECT po.price_jpy,po.observed_at FROM public.price_observations po
      WHERE po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
        AND po.product_id=cur.product_id AND po.price_jpy>0
        AND po.observed_at<=cur.observed_at-interval '20 hours'
        AND po.observed_at>=cur.observed_at-interval '28 hours'
      ORDER BY abs(extract(epoch FROM (po.observed_at-(cur.observed_at-interval '24 hours')))),po.observed_at DESC,po.id DESC
      LIMIT 1
    ) prev ON true
  ),
  ha_current AS (
    SELECT h.product_id,h.price_jpy,h.observed_at FROM public.ha_current_stable_buy_prices h
    JOIN public.market_products mp ON mp.id=h.product_id
    WHERE mp.game='pokemon' AND h.price_jpy>0 AND h.observed_at>=now()-interval '24 hours'
  ),
  ha_daily AS (
    SELECT 'HA'::text channel,cur.product_id,cur.price_jpy current_price_jpy,
      prev.sale_price_jpy previous_price_jpy,cur.observed_at current_observed_at,prev.observed_at previous_observed_at
    FROM ha_current cur
    JOIN LATERAL (
      SELECT so.sale_price_jpy,so.observed_at FROM public.sale_observations so
      WHERE so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
        AND so.product_id=cur.product_id AND so.in_stock=true AND so.sale_price_jpy>0
        AND so.observed_at<=cur.observed_at-interval '20 hours'
        AND so.observed_at>=cur.observed_at-interval '28 hours'
      ORDER BY so.sale_price_jpy ASC,abs(extract(epoch FROM (so.observed_at-(cur.observed_at-interval '24 hours')))),so.observed_at DESC,so.id DESC
      LIMIT 1
    ) prev ON true
  ),
  deltas AS (SELECT * FROM cd_daily UNION ALL SELECT * FROM ha_daily),
  enriched AS (
    SELECT d.channel,d.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,
      d.current_price_jpy,d.previous_price_jpy,d.current_price_jpy-d.previous_price_jpy change_jpy,
      round(((d.current_price_jpy-d.previous_price_jpy)::numeric/nullif(d.previous_price_jpy,0))*100,2) change_percent,
      d.current_observed_at,d.previous_observed_at
    FROM deltas d JOIN public.market_products mp ON mp.id=d.product_id
    WHERE d.current_price_jpy<>d.previous_price_jpy
  ),
  numbered AS (
    SELECT *,row_number() OVER(PARTITION BY channel ORDER BY abs(change_percent) DESC,abs(change_jpy) DESC,current_observed_at DESC,product_id)::integer rank
    FROM enriched
  )
  SELECT * FROM numbered WHERE rank<=10000;
  TRUNCATE public.price_change_ranking_cache;
  INSERT INTO public.price_change_ranking_cache
    (channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,generated_at)
  SELECT channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,now() FROM _pcr;
END;
$function$;
-- Filter daily CD snapshots so stale source prices cannot be stamped as current.
CREATE OR REPLACE FUNCTION public.create_daily_cardrush_snapshot()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE inserted_count integer; tokyo_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  DELETE FROM public.daily_price_snapshots
  WHERE market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
    AND snapshot_date=tokyo_today AND source_observed_at<now()-interval '24 hours';
  INSERT INTO public.daily_price_snapshots
    (market_source_id,product_id,snapshot_date,snapshot_at,price_jpy,source_observed_at,source_age_minutes)
  SELECT lmp.market_source_id,lmp.product_id,tokyo_today,now(),lmp.price_jpy,lmp.observed_at,
    greatest(0,floor(extract(epoch FROM (now()-lmp.observed_at))/60))::integer
  FROM public.latest_market_prices lmp
  WHERE lmp.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
    AND lmp.price_jpy>0 AND lmp.observed_at>=now()-interval '24 hours'
  ON CONFLICT(market_source_id,product_id,snapshot_date) DO UPDATE SET
    snapshot_at=excluded.snapshot_at,price_jpy=excluded.price_jpy,
    source_observed_at=excluded.source_observed_at,source_age_minutes=excluded.source_age_minutes;
  GET DIAGNOSTICS inserted_count=ROW_COUNT; RETURN inserted_count;
END;
$function$;
-- Recover a collection cycle abandoned for more than one day without publishing partial rows.
UPDATE public.sale_collection_state SET next_page=1,current_cycle_id=gen_random_uuid(),cycle_started_at=now(),next_due_at=now(),damaged_next_due_at=now()
WHERE id=true AND (last_success_at IS NULL OR last_success_at<now()-interval '24 hours');
UPDATE public.sale_fetch_runs SET status='FAILED',finished_at=now(),error_count=1,
  error_message='stale RUNNING run recovered during Pokemon-only freshness repair'
WHERE status='RUNNING' AND started_at<now()-interval '10 minutes';
SELECT public.refresh_price_change_ranking_cache();
SELECT public.sanitize_price_change_ranking_cache();