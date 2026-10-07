create or replace function public.refresh_price_change_ranking_cache()
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtext('price_change_ranking_cache'));
 create temp table _pcr on commit drop as
 with cd_base as (
  select po.product_id,po.price_jpy,po.observed_at,po.id
  from public.price_observations po
  join public.market_sources ms on ms.id=po.market_source_id and ms.enabled and ms.source_type='BUY_PRICE'
  join public.market_source_games msg on msg.market_source_id=ms.id and msg.enabled
  join public.game_registry gr on gr.code=msg.game_code and gr.enabled
  where po.price_jpy>0 and po.observed_at>=now()-interval '30 days'
 ), cd_seq as (
  select 'CD' channel,product_id,price_jpy,observed_at,id,lag(price_jpy) over(partition by product_id order by observed_at,id) previous_price_jpy,lag(observed_at) over(partition by product_id order by observed_at,id) previous_observed_at,row_number() over(partition by product_id order by observed_at desc,id desc) rn from cd_base
 ), ha_base as (
  select so.product_id,so.sale_price_jpy price_jpy,so.observed_at,so.id
  from public.sale_observations so join public.sale_sources ss on ss.id=so.sale_source_id and ss.enabled join public.sale_source_games ssg on ssg.sale_source_id=ss.id and ssg.enabled join public.game_registry gr on gr.code=ssg.game_code and gr.enabled
  where so.sale_price_jpy>0 and so.observed_at>=now()-interval '30 days' and exists(select 1 from public.ha_current_stable_buy_prices h where h.product_id=so.product_id)
 ), ha_seq as (
  select 'HA' channel,product_id,price_jpy,observed_at,id,lag(price_jpy) over(partition by product_id order by observed_at,id) previous_price_jpy,lag(observed_at) over(partition by product_id order by observed_at,id) previous_observed_at,row_number() over(partition by product_id order by observed_at desc,id desc) rn from ha_base
 ), ranked as (
  select channel,product_id,price_jpy current_price_jpy,observed_at current_observed_at,previous_price_jpy,previous_observed_at,price_jpy-previous_price_jpy change_jpy,round(((price_jpy-previous_price_jpy)::numeric/nullif(previous_price_jpy,0))*100,2) change_percent from (select * from cd_seq union all select * from ha_seq) x where rn=1 and previous_price_jpy is not null and price_jpy<>previous_price_jpy
 ), enriched as (
  select r.channel,r.product_id,mp.canonical_name,mp.set_name,mp.card_number,mp.rarity,r.current_price_jpy,r.previous_price_jpy,r.change_jpy,r.change_percent,r.current_observed_at,r.previous_observed_at from ranked r join public.market_products mp on mp.id=r.product_id
 ), numbered as (
  select *,row_number() over(partition by channel order by abs(change_percent) desc,current_observed_at desc,product_id) rank from enriched
 )
 select * from numbered where rank<=10000;
 truncate public.price_change_ranking_cache;
 insert into public.price_change_ranking_cache(channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,generated_at)
 select channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,now() from _pcr;
end; $$;