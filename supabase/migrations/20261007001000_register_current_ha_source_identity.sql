insert into public.sale_sources(
  id,code,name,base_url,source_type,enabled,retrieval_method,permission_status,timezone,notes
) values (
  '75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid,
  'ha_current',
  'HA current sale source',
  'https://www.hareruya2.com',
  'SELL_PRICE',
  true,
  'HTTP',
  'VERBAL_OK',
  'Asia/Tokyo',
  'Current HA sale listing source identity used by the completed-cycle current-state model.'
) on conflict (id) do update set
  code=excluded.code,name=excluded.name,base_url=excluded.base_url,source_type=excluded.source_type,
  enabled=excluded.enabled,retrieval_method=excluded.retrieval_method,permission_status=excluded.permission_status,
  timezone=excluded.timezone,notes=excluded.notes;

insert into public.sale_source_games(sale_source_id,game_code)
values ('75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid,'pokemon')
on conflict do nothing;
