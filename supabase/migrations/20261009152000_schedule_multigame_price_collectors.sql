-- Keep multi-game CD buyback-price observations fresh.
-- The collector has a per-source lock, so overlapping scheduler ticks are safe.
create or replace function public.invoke_multigame_price_collector(p_source_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, net
as $function$
begin
  if p_source_id not in (
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid
  ) then
    raise exception 'unsupported multigame collector source';
  end if;

  return net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/multigame-price-collector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cardrush_cron_token')
    ),
    body := jsonb_build_object('source_id', p_source_id::text),
    timeout_milliseconds := 120000
  );
end;
$function$;

revoke all on function public.invoke_multigame_price_collector(uuid) from public, anon, authenticated;

do $block$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'multigame-cd-one-piece-every-5-min',
      'multigame-cd-yugioh-every-5-min',
      'multigame-cd-mtg-every-5-min'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$block$;

select cron.schedule(
  'multigame-cd-one-piece-every-5-min',
  '*/5 * * * *',
  $$select public.invoke_multigame_price_collector('11111111-1111-4111-8111-111111111111'::uuid);$$
);

select cron.schedule(
  'multigame-cd-yugioh-every-5-min',
  '*/5 * * * *',
  $$select public.invoke_multigame_price_collector('22222222-2222-4222-8222-222222222222'::uuid);$$
);

select cron.schedule(
  'multigame-cd-mtg-every-5-min',
  '*/5 * * * *',
  $$select public.invoke_multigame_price_collector('33333333-3333-4333-8333-333333333333'::uuid);$$
);
