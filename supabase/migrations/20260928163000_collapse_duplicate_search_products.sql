-- Collapse duplicate product identities for 067/SV-P into the established HA canonical product.
insert into public.cd_ha_set_name_alias_map
(canonical_product_id,alias_product_id,canonical_set_code,ha_set_name,canonical_name,card_number,rarity,mapping_confidence,mapping_basis)
select '706ffc84-e1aa-403d-a42b-43776f2e8f41'::uuid,v.alias_id,'SV-P','プロモーションカード「SV-P」','ブラッキー','067/SV-P','PROMO','HIGH',
       'exact card number + SV-P promo identity; duplicate product normalization'
from (values
('3041b801-f64b-45b0-a2d7-ebc9af254e41'::uuid),
('3fb93687-b798-44eb-8e52-87fde5656904'::uuid),
('a34fa801-5398-4696-9995-707ec0df642b'::uuid),
('6bf62160-5c67-4290-ae3f-167d898d5978'::uuid)
) v(alias_id)
where not exists (
 select 1 from public.cd_ha_set_name_alias_map a
 where a.canonical_product_id='706ffc84-e1aa-403d-a42b-43776f2e8f41'::uuid and a.alias_product_id=v.alias_id
);

-- Return one canonical search candidate while retaining history from every mapped product.
create or replace function public.search_price_history(p_query text,p_days integer default 90,p_limit integer default 12)
returns table(product_id uuid,canonical_name text,set_name text,card_number text,rarity text,source_id uuid,source_name text,observed_day date,price_jpy integer,observed_at timestamptz)
language sql stable set search_path='public'
as $function$
with matched as (
 select mp.id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,
        coalesce(a.canonical_product_id,mp.id) resolved_product_id
 from public.market_products mp
 left join public.cd_ha_set_name_alias_map a on a.alias_product_id=mp.id
 where lower(coalesce(mp.canonical_name,'')) like '%'||lower(trim(p_query))||'%'
    or lower(coalesce(mp.card_number,'')) like '%'||lower(trim(p_query))||'%'
    or lower(coalesce(mp.set_name,'')) like '%'||lower(trim(p_query))||'%'
),
products as (
 select distinct on (m.resolved_product_id)
   m.resolved_product_id id,
   coalesce(c.canonical_name,m.canonical_name) canonical_name,
   coalesce(c.set_name,m.set_name) set_name,
   coalesce(c.card_number,m.card_number) card_number,
   coalesce(c.rarity,m.rarity) rarity
 from matched m
 left join public.market_products c on c.id=m.resolved_product_id
 order by m.resolved_product_id,case when m.resolved_product_id=m.id then 0 else 1 end,m.id
),
ranked as (
 select p.id resolved_product_id,po.market_source_id,po.observed_at::date observed_day,
        po.price_jpy,po.observed_at,
        row_number() over(partition by p.id,po.market_source_id,po.observed_at::date
                          order by po.observed_at desc,po.id desc) rn
 from matched m
 join products p on p.id=m.resolved_product_id
 join public.price_observations po on po.product_id=m.id
 join public.market_sources ms on ms.id=po.market_source_id
 where ms.enabled=true
   and po.observed_at>=now()-make_interval(days=>greatest(1,least(p_days,730)))
)
select p.id,p.canonical_name,p.set_name,p.card_number,p.rarity,
       r.market_source_id,ms.name,r.observed_day,r.price_jpy,r.observed_at
from ranked r
join products p on p.id=r.resolved_product_id
join public.market_sources ms on ms.id=r.market_source_id
where r.rn=1
order by p.canonical_name,r.observed_day desc,ms.name
$function$;

-- Never return multiple current CD prices when several aliases are current.
create or replace function public.get_current_buy_prices(p_product_ids uuid[])
returns table(product_id uuid,market_source_id uuid,price_jpy integer,observed_at timestamptz)
language sql stable security definer set search_path='public'
as $function$
with ids as (select unnest(coalesce(p_product_ids,'{}'::uuid[])) product_id),
resolved as (
 select i.product_id requested_product_id,i.product_id price_product_id from ids i
 union all
 select i.product_id,a.alias_product_id
 from ids i join public.cd_ha_set_name_alias_map a on a.canonical_product_id=i.product_id
),
cd_ranked as (
 select d.requested_product_id,c.price_jpy,c.observed_at,
        row_number() over(partition by d.requested_product_id order by c.observed_at desc) rn
 from (select distinct requested_product_id,price_product_id from resolved)d
 join public.cd_current_stable_prices c on c.product_id=d.price_product_id
)
select requested_product_id,'6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid,price_jpy,observed_at
from cd_ranked where rn=1
union all
select i.product_id,'7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,h.price_jpy,h.observed_at
from ids i join public.ha_current_stable_buy_prices h on h.product_id=i.product_id;
$function$;
