insert into public.market_sources(id,name,source_type,url,permission_status,retrieval_method,enabled,min_price_jpy,timezone,notes)
values
('11111111-1111-4111-8111-111111111111','CardRush ONE PIECE 買取価格','BUY_PRICE','https://cardrush.media/onepiece/buying_prices','VERBAL_OK','WEB',true,1000,'Asia/Tokyo','Multi-game CD adapter source.'),
('22222222-2222-4222-8222-222222222222','CardRush Yu-Gi-Oh! 買取価格','BUY_PRICE','https://cardrush.media/yugioh/buying_prices','VERBAL_OK','WEB',true,1000,'Asia/Tokyo','Multi-game CD adapter source.'),
('33333333-3333-4333-8333-333333333333','CardRush MTG 買取価格','BUY_PRICE','https://cardrush.media/mtg/buying_prices','VERBAL_OK','WEB',true,1000,'Asia/Tokyo','Multi-game CD adapter source.')
on conflict(id) do update set name=excluded.name,url=excluded.url,enabled=excluded.enabled;

insert into public.market_source_games(market_source_id,game_code) values
('11111111-1111-4111-8111-111111111111','one_piece'),
('22222222-2222-4222-8222-222222222222','yugioh'),
('33333333-3333-4333-8333-333333333333','mtg')
on conflict do nothing;

insert into public.sale_sources(id,code,name,base_url,source_type,enabled,retrieval_method,permission_status,timezone,notes)
values
('41111111-1111-4111-8111-111111111111','ha_toretoku_one_piece','HA ONE PIECE buyback source','https://kaitori-toretoku.jp/buypricelist/onepiece','BUY_PRICE',true,'WEB','PUBLIC','Asia/Tokyo','Multi-game HA adapter source.'),
('42222222-2222-4222-8222-222222222222','ha_toretoku_yugioh','HA Yu-Gi-Oh! buyback source','https://kaitori-toretoku.jp/buypricelist/yugioh','BUY_PRICE',true,'WEB','PUBLIC','Asia/Tokyo','Multi-game HA adapter source.'),
('43333333-3333-4333-8333-333333333333','ha_toretoku_mtg','HA MTG buyback source','https://kaitori-toretoku.jp/buypricelist/mtg','BUY_PRICE',true,'WEB','PUBLIC','Asia/Tokyo','Multi-game HA adapter source.')
on conflict(id) do update set name=excluded.name,base_url=excluded.base_url,enabled=excluded.enabled;

insert into public.sale_source_games(sale_source_id,game_code) values
('41111111-1111-4111-8111-111111111111','one_piece'),
('42222222-2222-4222-8222-222222222222','yugioh'),
('43333333-3333-4333-8333-333333333333','mtg')
on conflict do nothing;

insert into public.price_collection_state(market_source_id,next_page,max_pages)
values
('11111111-1111-4111-8111-111111111111',1,50),
('22222222-2222-4222-8222-222222222222',1,100),
('33333333-3333-4333-8333-333333333333',1,50)
on conflict(market_source_id) do nothing;
