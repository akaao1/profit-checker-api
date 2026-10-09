export const dynamic="force-dynamic";
export const revalidate=0;

type Row={rank:number;product_id:string;canonical_name:string;set_name:string|null;card_number:string|null;rarity:string|null;current_price_jpy:number;previous_price_jpy:number;change_jpy:number;change_percent:number;current_observed_at:string;previous_observed_at:string};
const yen=(n:number)=>"¥"+Math.round(n).toLocaleString("ja-JP");
const pct=(n:number)=>(n>=0?"+":"")+n.toFixed(1)+"%";
const dt=(s:string)=>new Date(s).toLocaleString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});

async function getChanges():Promise<{CD:Row[];HA:Row[]}>{
  try{
    const r=await fetch("https://profit-checker-api.vercel.app/api/radar?all_changes=1&only=changes",{cache:"no-store"});
    if(!r.ok)return {CD:[],HA:[]};
    const x=await r.json();
    return {CD:Array.isArray(x.change_rankings?.CD)?x.change_rankings.CD:[],HA:Array.isArray(x.change_rankings?.HA)?x.change_rankings.HA:[]};
  }catch{return {CD:[],HA:[]}}
}

export default async function Changes(){
 const data=await getChanges();
 return <main><header><div className="brand"><span>⚡</span><div><b>Cross-Border Seller Radar</b><small>PRICE CHANGE HISTORY</small></div></div><a className="back" href="/">← 価格レーダーへ戻る</a></header>
 <section className="change-page-head"><small>ALL PRICE CHANGES</small><h1>前日比 変動ランキング・全件</h1><p>前日スナップショットと最新の新鮮な価格を比較します。24時間以内のデータが揃わないカードは表示しません。</p></section>
 {(["CD","HA"] as const).map(ch=><section className="all-ranking" key={ch}><div className="all-ranking-head"><h2>{ch}</h2><span>{data[ch].length.toLocaleString()}件</span></div><div className="all-table"><div className="all-row all-head"><span>順位</span><span>カード</span><span>前日価格</span><span>現在価格</span><span>増減額・率</span><span>前日時点</span><span>現在時点</span></div>{data[ch].length===0?<div className="empty">該当する前日比データがありません。</div>:data[ch].map((r,i)=><a className="all-row" key={r.product_id} href={"/search?product_id="+encodeURIComponent(r.product_id)}><b>{i+1}</b><span><strong>{r.canonical_name}</strong><small>{r.set_name??"—"} · <b className="rank-card-number">{r.card_number??"—"}</b> · {r.rarity??"—"}</small></span><span>{yen(r.previous_price_jpy)}</span><span>{yen(r.current_price_jpy)}</span><span className="all-change"><strong className={r.change_jpy>=0?"profit":"loss"}>{r.change_jpy>=0?"+":""}{yen(Math.abs(r.change_jpy))}</strong><small className={r.change_percent>=0?"profit":"loss"}>{pct(r.change_percent)}</small></span><span>{dt(r.previous_observed_at)}</span><span>{dt(r.current_observed_at)}</span></a>)}</div></section>)}
 <footer>Cross-Border Seller Radar · CD / HA separated comparison</footer></main>;
}