-- Repair cross-source identity for 067/SV-P and make current CD price lookup alias-aware.
insert into public.cd_ha_set_name_alias_map
(canonical_product_id,alias_product_id,canonical_set_code,ha_set_name,canonical_name,card_number,rarity,mapping_confidence,mapping_basis)
values
('706ffc84-e1aa-403d-a42b-43776f2e8f41','5dba2d79-a761-4c62-be1e-71f6f06c3c62','SV-P','プロモーションカード「SV-P」','ブラッキー','067/SV-P','PROMO','HIGH','same card number + cross-source promo identity; CD name carries YU NAGABA label')
on conflict do nothing;

create or replace function public.get_current_buy_prices(p_product_ids uuid[])
returns table(product_id uuid,market_source_id uuid,price_jpy integer,observed_at timestamptz)
language sql stable security definer set search_path='public'
as $function$
with ids as (select unnest(coalesce(p_product_ids,'{}'::uuid[])) product_id),
resolved as (
  select i.product_id as requested_product_id,i.product_id as price_product_id from ids i
  union all
  select i.product_id,a.alias_product_id
  from ids i join public.cd_ha_set_name_alias_map a on a.canonical_product_id=i.product_id
),
dedup as (
  select distinct on (requested_product_id,price_product_id) requested_product_id,price_product_id
  from resolved order by requested_product_id,price_product_id
)
select d.requested_product_id,'6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid,c.price_jpy,c.observed_at
from dedup d join public.cd_current_stable_prices c on c.product_id=d.price_product_id
union all
select i.product_id,'7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,h.price_jpy,h.observed_at
from ids i join public.ha_current_stable_buy_prices h on h.product_id=i.product_id;
$function$;

-- CD current-listing snapshots can legitimately shrink below 100 items.
-- Keep the safety guard at 50% of the previous snapshot, with an absolute floor of 50.
create or replace function public.sync_source_current_listings(p_market_source_id uuid,p_source_product_ids text[])
returns void language plpgsql set search_path='public' as $function$
declare v_previous_count integer; v_new_count integer; v_min_safe_count integer;
begin
 select count(*) into v_previous_count from public.source_current_listings where market_source_id=p_market_source_id;
 select count(distinct x) into v_new_count from unnest(coalesce(p_source_product_ids,array[]::text[])) x where nullif(trim(x),'') is not null;
 if v_new_count=0 then raise exception 'current listing snapshot rejected: empty source_product_ids for source %',p_market_source_id; end if;
 if v_previous_count>=100 then
   v_min_safe_count:=greatest(50,floor(v_previous_count*0.50)::integer);
   if v_new_count<v_min_safe_count then
     raise exception 'current listing snapshot rejected: suspicious drop from % to % (minimum safe %)',v_previous_count,v_new_count,v_min_safe_count;
   end if;
 end if;
 delete from public.source_current_listings where market_source_id=p_market_source_id;
 insert into public.source_current_listings(market_source_id,source_product_id,checked_at)
 select p_market_source_id,x,now()
 from (select distinct x from unnest(p_source_product_ids) x where nullif(trim(x),'') is not null)d
 on conflict (market_source_id,source_product_id) do update set checked_at=excluded.checked_at;
end;$function$;
