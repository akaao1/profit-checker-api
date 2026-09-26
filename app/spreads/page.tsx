"use client";
import {useEffect,useState} from "react";

type Row={rank:number;product_id:string;canonical_name:string;set_name:string|null;card_number:string|null;rarity:string|null;cd_price_jpy:number;ha_price_jpy:number;difference_jpy:number;difference_percent:number;cd_observed_at:string;ha_observed_at:string};
const yen=(n:number)=>"¥"+Math.round(n).toLocaleString("ja-JP");
const dt=(s:string)=>new Date(s).toLocaleString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});

export default function Spreads(){
 const[data,setData]=useState<{CD:Row[];HA:Row[]}>({CD:[],HA:[]});
 const[busy,setBusy]=useState(true);
 useEffect(()=>{fetch("/api/radar?all_spreads=1",{cache:"no-store"}).then(r=>r.json()).then(x=>setData(x.spread_rankings??{CD:[],HA:[]})).catch(()=>{}).finally(()=>setBusy(false))},[]);
 return <main><header><div className="brand"><span>⚡</span><div><b>Cross-Border Seller Radar</b><small>BUYBACK SPREAD INTELLIGENCE</small></div></div><a className="back" href="/">← 価格レーダーへ戻る</a></header>
 <section className="change-page-head"><small>CD / HA SPREAD</small><h1>買取価格差ランキング</h1><p>同一SKUについてCDとHAを比較。差額の大きい順に、HAが高いケースとCDが高いケースを分離しています。同額は除外。</p></section>
 {busy?<div className="empty">価格差データを読み込んでいます…</div>:(["HA","CD"] as const).map(ch=><section className="all-ranking" key={ch}><div className="all-ranking-head"><h2>{ch} のほうが高い</h2><span>{data[ch].length.toLocaleString()}件</span></div><div className="all-table"><div className="spread-all-row spread-all-head"><span>順位</span><span>カード</span><span>CD買取</span><span>HA買取</span><span>差額</span><span>差率</span><span>CD時点</span><span>HA時点</span></div>{data[ch].map(r=><a className="spread-all-row" key={r.product_id} href={"/?product_id="+encodeURIComponent(r.product_id)}><b>{r.rank}</b><span><strong>{r.canonical_name}</strong><small>{r.set_name??"—"} · {r.card_number??"—"} · {r.rarity??"—"}</small></span><span>{yen(r.cd_price_jpy)}</span><span>{yen(r.ha_price_jpy)}</span><span className="spread-diff">+{yen(Math.abs(r.difference_jpy))}</span><span>{r.difference_percent.toFixed(1)}%</span><span>{dt(r.cd_observed_at)}</span><span>{dt(r.ha_observed_at)}</span></a>)}</div></section>)}
 <footer>Cross-Border Seller Radar · CD / HA separated comparison</footer></main>;
}