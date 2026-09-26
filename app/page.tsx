"use client";
import {useEffect,useMemo,useState} from "react";
type Price={product_id:string;canonical_name:string;set_name:string|null;card_number:string|null;rarity:string|null;cardrush_buy_price_jpy:number|null;best_exit_price_jpy:number|null;best_exit_source_name:string|null;cross_source_spread_jpy:number|null;cross_source_spread_percent:string|null};
const yen=(n:number|null|undefined)=>n==null?"—":"¥"+Math.round(n).toLocaleString("ja-JP");
export default function Home(){
 const[data,setData]=useState<any>(null),[q,setQ]=useState(""),[busy,setBusy]=useState(true),[cost,setCost]=useState(0),[tab,setTab]=useState<"radar"|"calc">("radar");
 async function load(s=""){setBusy(true);try{const r=await fetch("/api/radar"+(s?"?q="+encodeURIComponent(s):""),{cache:"no-store"});setData(await r.json())}catch{}finally{setBusy(false)}}
 useEffect(()=>{load()},[]);
 const prices:Price[]=data?.prices??[],sources=data?.sources??[];
 const live=sources.filter((s:any)=>s.enabled&&s.latest_product_count>0);
 const positive=prices.filter(p=>(p.cross_source_spread_jpy??0)>0).length;
 const searchCount=(data?.search??[]).length;
 const summary=useMemo(()=>{const exits=prices.map(p=>p.best_exit_price_jpy??p.cardrush_buy_price_jpy).filter(Boolean) as number[];return exits.length?Math.round(exits.reduce((a,b)=>a+b,0)/exits.length):0},[prices]);
 return <main>
 <header><div className="brand"><span>⚡</span><div><b>Cross-Border Seller Radar</b><small>AKIHABARA · LIVE BUYBACK INTELLIGENCE</small></div></div><span className="live">● LIVE</span></header>
 <section className="hero"><div><small>RAW CARD → BEST EXIT</small><h1>店頭で見つけた瞬間に、<br/><em>売り先まで判断する。</em></h1><p>複数の買取データを横断し、カードを見つけたその場で出口価格と仕入れ採算を確認するためのレーダーです。</p><div className="hero-stats"><span><b>{live.length}</b> LIVE SOURCES</span><span><b>{prices.length.toLocaleString()}</b> COMPARISONS</span><span><b>{positive}</b> POSITIVE SPREADS</span></div></div><aside><small>平均 BEST EXIT</small><strong>{yen(summary)}</strong><label>現在表示中の価格</label></aside></section>
 <nav className="tabs"><button className={tab==="radar"?"active":""} onClick={()=>setTab("radar")}>価格レーダー</button><button className={tab==="calc"?"active":""} onClick={()=>setTab("calc")}>仕入れ判定</button></nav>
 {tab==="radar"?<>
 <section className="search"><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(q)} placeholder="カード名を検索（例：ピカチュウ）"/><button onClick={()=>load(q)}>検索</button></section>
 {q&&<div className="hint">{searchCount}件のカード候補 · Enterまたは検索でレーダーを絞り込み</div>}
 <section className="head"><div><small>MARKET EXIT</small><h2>現在の買取レーダー</h2></div><button className="ghost" onClick={()=>load()}>↻ 更新</button></section>
 <section className="grid">{busy?<div className="empty">価格データを読み込んでいます…</div>:prices.length?prices.map((p,i)=>{const exit=p.best_exit_price_jpy??p.cardrush_buy_price_jpy;const profit=cost>0&&exit!=null?exit-cost:null;const roi=profit!=null?profit/cost*100:null;return <article key={p.product_id}><small>#{String(i+1).padStart(2,"0")}</small><h3>{p.canonical_name}</h3><label>{p.set_name??"その他"} · {p.card_number??"—"} · {p.rarity??"—"}</label><div className="price"><span>BEST EXIT</span><b>{yen(exit)}</b></div><p className="source">{p.best_exit_source_name??"—"} · {p.cross_source_spread_jpy!=null?("Spread "+yen(p.cross_source_spread_jpy)):"比較待ち"}</p><input className="buy" inputMode="numeric" placeholder="店頭仕入れ価格 ¥" value={cost||""} onChange={e=>setCost(Number(e.target.value.replace(/\\D/g,""))||0)}/>{roi!=null&&<div className={roi>0?"profit":"loss"}>{profit!>=0?"+":""}{yen(profit)} <span>ROI {roi.toFixed(1)}%</span></div>}</article>}) : <div className="empty">一致する価格データがありません。</div>}</section>
 </>:<section className="calculator"><small>FAST DECISION</small><h2>仕入れ判定</h2><p>店頭価格と出口価格を入力して、交通費などを含めた簡易ROIを計算できます。</p><label>仕入れ価格<input id="buy" inputMode="numeric" placeholder="12000"/></label><label>出口価格<input id="exit" inputMode="numeric" placeholder="18000"/></label><label>その他コスト<input id="other" inputMode="numeric" placeholder="500"/></label><button onClick={()=>{const b=Number((document.getElementById("buy") as HTMLInputElement).value||0),e=Number((document.getElementById("exit") as HTMLInputElement).value||0),o=Number((document.getElementById("other") as HTMLInputElement).value||0),p=e-b-o,r=b?p/b*100:0;const el=document.getElementById("result");if(el)el.textContent=b?((p>=0?"+":"")+yen(p)+" · ROI "+r.toFixed(1)+"%"):"仕入れ価格を入力してください"}}>計算する</button><div id="result" className="result">仕入れ価格を入力してください</div><small className="notice">※ 実際の買取額はカード状態、在庫、買取制限、店舗条件、交通費等で変動します。画面のROIは入力値による試算です。</small></section>}
 <section className="sources"><small>DATA SOURCE STATUS</small><h2>データソース</h2>{sources.map((s:any)=><div className="src" key={s.id}><i className={s.health_status==="LIVE"?"on":""}/><span>{s.name}<small>{s.health_status} · {Number(s.latest_product_count||0).toLocaleString()}件</small></span></div>)}</section>
 <footer>Cross-Border Seller Radar · Supabase × Vercel</footer>
 </main>
}