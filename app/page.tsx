"use client";
import {useEffect,useState} from "react";
export default function Home(){
 const[data,setData]=useState<any>(null),[q,setQ]=useState("");
 async function load(s=""){const r=await fetch("/api/radar"+(s?"?q="+encodeURIComponent(s):""),{cache:"no-store"});setData(await r.json())}
 useEffect(()=>{load()},[]);
 const prices=data?.prices??[],sources=data?.sources??[];
 return <main>
 <header><b>⚡ Cross-Border Seller Radar</b><span>● LIVE</span></header>
 <section className="hero"><div><small>RAW CARD → BEST EXIT</small><h1>店頭で見つけた瞬間に、<br/><em>売り先まで判断する。</em></h1><p>買取価格を横断して、現在の出口価格を確認します。</p></div><aside><small>LIVE SOURCES</small><strong>{sources.filter((s:any)=>s.enabled&&s.latest_product_count>0).length}</strong></aside></section>
 <section className="search"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="カード名を検索"/><button onClick={()=>load(q)}>検索</button></section>
 <section className="head"><small>MARKET EXIT</small><h2>現在の買取レーダー</h2></section>
 <section className="grid">{prices.map((p:any,i:number)=><article key={p.product_id}><small>#{i+1}</small><h3>{p.canonical_name}</h3><label>{p.set_name??"その他"} · {p.card_number??"—"} · {p.rarity??"—"}</label><strong>¥{Number(p.best_exit_price_jpy??p.cardrush_buy_price_jpy??0).toLocaleString("ja-JP")}</strong><p>{p.best_exit_source_name??"—"}</p></article>)}</section>
 <section className="sources"><small>DATA SOURCE STATUS</small><h2>データソース</h2>{sources.map((s:any)=><div className="src" key={s.id}><i className={s.health_status==="LIVE"?"on":""}/>{s.name}<small>{s.health_status} · {s.latest_product_count}件</small></div>)}</section>
 </main>
}