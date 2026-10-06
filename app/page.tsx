type C={rank:number;product_id:string;canonical_name:string;set_name:string|null;card_number:string|null;current_price_jpy:number;previous_price_jpy:number;change_jpy:number;change_percent:number;current_observed_at:string;previous_observed_at:string};
type S={rank:number;product_id:string;canonical_name:string;set_name:string|null;card_number:string|null;cd_price_jpy:number;ha_price_jpy:number;difference_jpy:number;difference_percent:number;cd_observed_at:string;ha_observed_at:string};
type Radar={ok:boolean;change_rankings:{CD:C[];HA:C[]};spread_rankings:{CD:S[];HA:S[]};warnings?:{feature?:string;message:string}[]};

const RADAR_API_URL="https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/radar-api";
const yen=(n:number)=>"¥"+Math.round(n).toLocaleString("ja-JP");
const pct=(n:number)=>(n>=0?"+":"")+n.toFixed(1)+"%";
const dt=(s:string)=>new Date(s).toLocaleString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});

async function getRadar():Promise<Radar|null>{
  try{
    const r=await fetch(RADAR_API_URL+"?limit=50",{cache:"no-store"});
    if(!r.ok)return null;
    const x=await r.json() as Partial<Radar>;
    if(x.ok===false)return null;
    return {ok:true,change_rankings:{CD:Array.isArray(x.change_rankings?.CD)?x.change_rankings.CD:[],HA:Array.isArray(x.change_rankings?.HA)?x.change_rankings.HA:[]},spread_rankings:{CD:Array.isArray(x.spread_rankings?.CD)?x.spread_rankings.CD:[],HA:Array.isArray(x.spread_rankings?.HA)?x.spread_rankings.HA:[]},warnings:Array.isArray(x.warnings)?x.warnings:[]};
  }catch{return null}
}

function ChangeCard({channel,rows}:{channel:"CD"|"HA";rows:C[]}){
  return <div className="ranking-card"><div className="ranking-card-head"><b>{channel}</b><span>変動率の大きい順</span></div>
    {rows.length===0?<div className="ranking-empty">該当する前回比データがありません。</div>:rows.slice(0,50).map((r,i)=>
      <a className="ranking-row" key={r.product_id} href={"/search?product_id="+encodeURIComponent(r.product_id)}>
        <span className="rank-no">{i+1}</span><span className="rank-name"><strong>{r.canonical_name}</strong><small>{r.set_name??"—"} · <b className="rank-card-number">{r.card_number??"—"}</b></small></span>
        <span className="rank-prices"><span className="rank-price-line"><b>{yen(r.previous_price_jpy)}</b><span>→</span><b>{yen(r.current_price_jpy)}</b></span><span className="rank-change"><b className={r.change_jpy>=0?"profit":"loss"}>{r.change_jpy>=0?"+":""}{yen(Math.abs(r.change_jpy))}</b><b className={r.change_percent>=0?"profit":"loss"}>{pct(r.change_percent)}</b></span><em>{dt(r.previous_observed_at)} → {dt(r.current_observed_at)}</em></span>
      </a>)}
  </div>
}

function SpreadCard({channel,rows}:{channel:"HA"|"CD";rows:S[]}){
  return <div className="ranking-card"><div className="ranking-card-head"><b>{channel} が高い</b><span>価格差の大きい順</span></div>
    {rows.length===0?<div className="ranking-empty">該当する価格差データがありません。</div>:rows.slice(0,50).map(r=>
      <a className="spread-row" key={r.product_id} href={"/search?product_id="+encodeURIComponent(r.product_id)}>
        <span className="rank-no">{r.rank}</span><span className="rank-name"><strong>{r.canonical_name}</strong><small>{r.set_name??"—"} · <b className="rank-card-number">{r.card_number??"—"}</b></small></span>
        <span className="spread-prices"><span><i>CD</i> {yen(r.cd_price_jpy)}</span><span><i>HA</i> {yen(r.ha_price_jpy)}</span><b className="profit">{r.difference_jpy>=0?"+":"−"}{yen(Math.abs(r.difference_jpy))}</b><em>{r.difference_percent.toFixed(1)}%</em></span>
      </a>)}
  </div>
}

export default async function Home(){
  const d=await getRadar();
  const changes=d?.change_rankings??{CD:[],HA:[]};
  const spreads=d?.spread_rankings??{CD:[],HA:[]};
  return <main><header><div className="brand"><span>⚡</span><div><b>Cross-Border Seller Radar</b><small>AKIHABARA · BUYBACK INTELLIGENCE</small></div></div><span className="live">● LIVE</span></header>
    <section className="ranking-hero"><small>MARKET RADAR</small><h1>買取価格の変動と、<br/><em>CD / HA の価格差。</em></h1><p>ランキング専用ページです。カードを探すときは検索ページから、カード名・型番で直接検索できます。</p><a className="primary-link" href="/search">🔎 カードを検索する →</a><a className="primary-link" href="/opportunities" style={{marginLeft:10}}>💰 買取差益を探す →</a></section>
    <section className="ranking-section"><div className="head"><div><small>PRICE CHANGE</small><h2>前回比 変動ランキング</h2></div><a className="all-changes-link" href="/changes">全件を見る →</a></div><div className="ranking-grid"><ChangeCard channel="CD" rows={changes.CD}/><ChangeCard channel="HA" rows={changes.HA}/></div></section>
    <section className="ranking-section"><div className="head"><div><small>BUYBACK SPREAD</small><h2>CD / HA 買取価格差ランキング</h2></div><a className="all-changes-link" href="/spreads">全件を見る →</a></div><div className="ranking-grid"><SpreadCard channel="HA" rows={spreads.HA}/><SpreadCard channel="CD" rows={spreads.CD}/></div></section>
    <footer>Cross-Border Seller Radar · CD / HA separated comparison</footer></main>
}