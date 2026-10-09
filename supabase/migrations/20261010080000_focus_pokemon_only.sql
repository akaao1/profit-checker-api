-- Pause non-Pokemon collection and exposure without deleting historical data.
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN (
    'multigame-cd-one-piece-every-5-min',
    'multigame-cd-yugioh-every-5-min',
    'multigame-cd-mtg-every-5-min'
  ) LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;
UPDATE public.game_registry SET enabled=false, collection_enabled=false WHERE code IN ('one_piece','yugioh','mtg');
UPDATE public.market_sources SET enabled=false, updated_at=now() WHERE id IN (
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333'
);
UPDATE public.market_source_games SET enabled=false WHERE market_source_id IN (
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333'
);
UPDATE public.sale_sources SET enabled=false, updated_at=now()
WHERE code IN ('ha_toretoku_one_piece','ha_toretoku_yugioh','ha_toretoku_mtg');
UPDATE public.sale_source_games SET enabled=false WHERE sale_source_id IN (
 SELECT id FROM public.sale_sources WHERE code IN ('ha_toretoku_one_piece','ha_toretoku_yugioh','ha_toretoku_mtg')
);