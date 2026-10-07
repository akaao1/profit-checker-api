create table if not exists public.game_registry (
  code text primary key,
  display_name text not null,
  adapter_key text not null,
  enabled boolean not null default false,
  collection_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.game_registry(code,display_name,adapter_key,enabled,collection_enabled)
values ('pokemon','Pokemon','pokemon',true,true),('one_piece','ONE PIECE','one_piece',false,false),('yugioh','Yu-Gi-Oh!','yugioh',false,false),('mtg','Magic: The Gathering','mtg',false,false)
on conflict (code) do update set display_name=excluded.display_name,adapter_key=excluded.adapter_key;

create table if not exists public.market_source_games (
  market_source_id uuid not null references public.market_sources(id) on delete cascade,
  game_code text not null references public.game_registry(code),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (market_source_id,game_code)
);

create table if not exists public.sale_source_games (
  sale_source_id uuid not null references public.sale_sources(id) on delete cascade,
  game_code text not null references public.game_registry(code),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (sale_source_id,game_code)
);

insert into public.market_source_games(market_source_id,game_code)
select id,'pokemon' from public.market_sources where id='6147f366-d44f-40ce-a364-fdcdcb9dbf29'::uuid on conflict do nothing;

insert into public.sale_source_games(sale_source_id,game_code)
select id,'pokemon' from public.sale_sources where id in ('7d8d8aaf-a197-4615-bf43-ecae1f62e0c2'::uuid,'75d222f1-4e7c-48b2-95ff-8de0f885ebd7'::uuid) on conflict do nothing;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.market_products'::regclass and conname='market_products_game_fkey') then
    alter table public.market_products add constraint market_products_game_fkey foreign key (game) references public.game_registry(code);
  end if;
end $$;

create index if not exists idx_market_products_game_id on public.market_products(game,id);
create index if not exists idx_market_source_games_game on public.market_source_games(game_code,market_source_id);
create index if not exists idx_sale_source_games_game on public.sale_source_games(game_code,sale_source_id);

alter table public.game_registry enable row level security;
alter table public.market_source_games enable row level security;
alter table public.sale_source_games enable row level security;
revoke all on public.game_registry from anon,authenticated;
revoke all on public.market_source_games from anon,authenticated;
revoke all on public.sale_source_games from anon,authenticated;

comment on table public.game_registry is 'Supported card-game registry. Core data remains product/history/current-state driven.';
comment on table public.market_source_games is 'Explicit market-source to game boundary for CD collection.';
comment on table public.sale_source_games is 'Explicit sale-source to game boundary for HA collection.';
