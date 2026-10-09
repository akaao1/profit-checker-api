-- Pause the legacy HA buy-price scraper. The active SELL_PRICE collector is sale-radar;
-- running both scrapers against the same upstream can cause HTTP 429 and stale ranking inputs.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname='hareruya2-price-collector-every-30-min';