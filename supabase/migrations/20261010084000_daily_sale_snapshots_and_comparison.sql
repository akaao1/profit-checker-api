CREATE TABLE IF NOT EXISTS public.daily_sale_price_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_source_id uuid NOT NULL REFERENCES public.sale_sources(id),
 product_id uuid NOT NULL REFERENCES public.market_products(id),
 snapshot_date date NOT NULL,
 snapshot_at timestamptz NOT NULL DEFAULT now(),
 external_product_key text NOT NULL,
 price_jpy integer NOT NULL CHECK(price_jpy>0),
 source_observed_at timestamptz NOT NULL,
 source_age_minutes integer NOT NULL CHECK(source_age_minutes>=0),
 in_stock boolean NOT NULL DEFAULT true,
 stock_qty integer,
 condition_label text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sale_source_id,product_id,snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_sale_snapshots_date_product ON public.daily_sale_price_snapshots(sale_source_id,snapshot_date DESC,product_id);

CREATE OR REPLACE FUNCTION public.create_daily_sale_price_snapshot()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE n integer; d date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
 INSERT INTO public.daily_sale_price_snapshots(sale_source_id,product_id,snapshot_date,snapshot_at,external_product_key,price_jpy,source_observed_at,source_age_minutes,in_stock,stock_qty,condition_label)
 SELECT '75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid,h.product_id,d,now(),h.source_product_key,h.price_jpy,h.observed_at,
  greatest(0,floor(extract(epoch FROM(now()-h.observed_at))/60))::integer,true,so.stock_qty,so.condition_label
 FROM public.ha_current_stable_buy_prices h
 JOIN public.sale_observations so ON so.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid
  AND so.external_product_key=h.source_product_key AND so.product_id=h.product_id AND so.observed_at=h.observed_at
 WHERE h.price_jpy>0 AND h.observed_at>=now()-interval '24 hours'
 ON CONFLICT(sale_source_id,product_id,snapshot_date) DO UPDATE SET
  snapshot_at=excluded.snapshot_at,external_product_key=excluded.external_product_key,price_jpy=excluded.price_jpy,
  source_observed_at=excluded.source_observed_at,source_age_minutes=excluded.source_age_minutes,
  in_stock=excluded.in_stock,stock_qty=excluded.stock_qty,condition_label=excluded.condition_label;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END;
$function$;

DO $$ DECLARE j record; BEGIN
 FOR j IN SELECT jobid FROM cron.job WHERE jobname='ha-daily-price-snapshot-20-jst'
 LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;
SELECT cron.schedule('ha-daily-price-snapshot-20-jst','0 11 * * *','SELECT public.create_daily_sale_price_snapshot();');

CREATE OR REPLACE FUNCTION public.refresh_price_change_ranking_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE d date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('price_change_ranking_cache'));
 CREATE TEMP TABLE _pcr ON COMMIT DROP AS
 WITH cur AS (
  SELECT 'CD'::text channel,c.product_id,c.price_jpy current_price_jpy,c.observed_at current_observed_at
  FROM public.cd_current_stable_prices c JOIN public.market_products mp ON mp.id=c.product_id
  WHERE mp.game='pokemon' AND c.price_jpy>0 AND c.observed_at>=now()-interval '24 hours'
  UNION ALL
  SELECT 'HA',h.product_id,h.price_jpy,h.observed_at
  FROM public.ha_current_stable_buy_prices h JOIN public.market_products mp ON mp.id=h.product_id
  WHERE mp.game='pokemon' AND h.price_jpy>0 AND h.observed_at>=now()-interval '24 hours'
 ), base AS (
  SELECT c.channel,c.product_id,c.current_price_jpy,
   CASE WHEN c.channel='CD' THEN ds.price_jpy ELSE hs.price_jpy END previous_price_jpy,
   c.current_observed_at,
   CASE WHEN c.channel='CD' THEN ds.snapshot_at ELSE hs.snapshot_at END previous_observed_at
  FROM cur c
  LEFT JOIN public.daily_price_snapshots ds ON c.channel='CD' AND ds.product_id=c.product_id
   AND ds.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid AND ds.snapshot_date=d-1 AND ds.source_age_minutes<=1440
  LEFT JOIN public.daily_sale_price_snapshots hs ON c.channel='HA' AND hs.product_id=c.product_id
   AND hs.sale_source_id='75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid AND hs.snapshot_date=d-1 AND hs.source_age_minutes<=1440 AND hs.in_stock
 ), enriched AS (
  SELECT b.channel,b.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,b.current_price_jpy,b.previous_price_jpy,
   b.current_price_jpy-b.previous_price_jpy change_jpy,
   round(((b.current_price_jpy-b.previous_price_jpy)::numeric/nullif(b.previous_price_jpy,0))*100,2) change_percent,
   b.current_observed_at,b.previous_observed_at
  FROM base b JOIN public.market_products mp ON mp.id=b.product_id
  WHERE b.previous_price_jpy IS NOT NULL AND b.current_price_jpy<>b.previous_price_jpy
 ), numbered AS (
  SELECT *,row_number() OVER(PARTITION BY channel ORDER BY abs(change_percent) DESC,abs(change_jpy) DESC,current_observed_at DESC,product_id)::integer rank FROM enriched
 )
 SELECT * FROM numbered WHERE rank<=10000;
 TRUNCATE public.price_change_ranking_cache;
 INSERT INTO public.price_change_ranking_cache(channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,generated_at)
 SELECT channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,now() FROM _pcr;
END;
$function$;

SELECT public.create_daily_cardrush_snapshot();
SELECT public.create_daily_sale_price_snapshot();
SELECT public.refresh_price_change_ranking_cache();
SELECT public.sanitize_price_change_ranking_cache();