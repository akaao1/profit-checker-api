-- Restore CD current-price baseline and add multi-game completed-cycle rows.
-- Pokemon baseline: latest observations before the active incomplete cycle + 60-minute overlay.
-- Multi-game: only rows from the last completed per-source cycle are eligible.
create or replace view public.cd_current_stable_prices
with (security_invoker=true) as
with state as (
 select cycle_started_at from public.price_collection_state where market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid
), base as (
 select distinct on(po.product_id) po.product_id,po.price_jpy,po.observed_at,po.source_product_key,po.source_url,po.qualifies_min_price
 from public.price_observations po,state s
 where po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid and po.price_jpy>0 and po.observed_at < s.cycle_started_at
 order by po.product_id,po.observed_at desc,po.id desc
), overlay as (
 select distinct on(po.product_id) po.product_id,po.price_jpy,po.observed_at,po.source_product_key,po.source_url,po.qualifies_min_price
 from public.price_observations po
 where po.market_source_id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid and po.price_jpy>0 and po.observed_at>=now()-interval '1 hour'
 order by po.product_id,po.observed_at desc,po.id desc
), mg as (
 select distinct on(po.product_id) po.product_id,po.price_jpy,po.observed_at,po.source_product_key,po.source_url,po.price_jpy>=ms.min_price_jpy qualifies_min_price
 from public.price_observations po join public.multigame_price_collection_state s on s.source_id=po.market_source_id join public.market_sources ms on ms.id=po.market_source_id
 where s.last_completed_cycle_id is not null and po.price_jpy>0 and po.raw_payload->>'cycle_id'=s.last_completed_cycle_id::text
 order by po.product_id,po.observed_at desc,po.id desc
), rows as (select * from base union all select * from overlay union all select * from mg)
select distinct on(product_id) product_id,price_jpy,observed_at,source_product_key,source_url,qualifies_min_price from rows order by product_id,observed_at desc,source_product_key;

create table if not exists public.multigame_price_collection_state(
 source_id uuid primary key references public.market_sources(id) on delete cascade,
 game_code text not null references public.game_registry(code),
 next_page integer not null default 1,
 max_pages integer not null default 50,
 pages_per_run integer not null default 5,
 current_cycle_id uuid,
 last_completed_cycle_id uuid,
 last_success_at timestamptz,
 updated_at timestamptz not null default now(),
 locked_at timestamptz
);
alter table public.multigame_price_collection_state enable row level security;
revoke all on public.multigame_price_collection_state from anon,authenticated;