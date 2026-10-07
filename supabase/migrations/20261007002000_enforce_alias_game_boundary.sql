create or replace function public.enforce_alias_game_boundary()
returns trigger language plpgsql security invoker as $$
declare canonical_game text; alias_game text;
begin
  select game into canonical_game from public.market_products where id=new.canonical_product_id;
  select game into alias_game from public.market_products where id=new.alias_product_id;
  if canonical_game is null or alias_game is null then raise exception 'alias product must reference existing products'; end if;
  if canonical_game <> alias_game then raise exception 'alias products must belong to the same game'; end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_alias_game_boundary on public.cd_ha_set_name_alias_map;
create trigger trg_enforce_alias_game_boundary before insert or update on public.cd_ha_set_name_alias_map for each row execute function public.enforce_alias_game_boundary();
