-- Use one consistent daily snapshot time for both CD and HA.
DO $$ DECLARE j record; BEGIN
 FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('cardrush-daily-8am-snapshot','cardrush-daily-20-jst-snapshot')
 LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;
SELECT cron.schedule('cardrush-daily-20-jst-snapshot','0 11 * * *','SELECT public.create_daily_cardrush_snapshot();');