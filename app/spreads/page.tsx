export const dynamic="force-dynamic";
export const revalidate=0;

type Row={rank:number;product_id:string;canonical_name:string;set_name:string|null;card_number:string|null;rarity:string|null;cd_price_jpy:number;ha_price_jpy:number;difference_jpy:number;difference_percent:number;cd_observed_at:string;ha_observed_at:string;cd_stale?:boolean;ha_stale?:boolean};
type Warning={feature?:string;message:string};
type RadarResponse={spread_rankings?:{CD:Row[];HA:Row[]};warnings?:Warning[];ok?:boolean;error?:string};

const yen=(n:number)=>"¥"+Math.round(n).toLocaleString("ja-JP");
const dt=(s:string)=>new Date(s).toLocaleString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});

const GAMES=["pokemon","one_piece","yugioh","mtg"] as const;
type Game=typeof GAMES[number];
const gameName:Record<Game,string>={pokemon:"ポケモン",one_piece:"ONE PIECE",yugioh:"Yu-Gi-Oh!",mtg:"MTG"};
const validGame=(v:string|undefined):Game=>GAMES.includes(v as Game)?v as Game:"pokemon";
const loadRadar=async(game:Game):Promise<RadarResponse>=>{
  const r=await fetch("https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/radar-api?game="+encodeURIComponent(game)+"&limit=30",{cache:"no-store"});
  const x=await r.json().catch(()=>({error:"ランキングAPIの応答を解析できませんでした。"}));
  if(!r.ok||x.ok===false)throw new Error(x.error||"ランキングAPIエラー ("+r.status+")");
  return x;
};

export default async function Spreads({searchParams}:{searchParams:Promise<{game?:string}>}){
  const params=await searchParams;
  const game=validGame(params.game);
  let data:{CD:Row[];HA:Row[]}={CD:[],HA:[]};
  let warnings:string[]=[];
  let loadError="";
  try{
    const x=await loadRadar(game);
    data=x.spread_rankings??{CD:[],HA:[]};
    warnings=(x.warnings??[]).filter(w=>w.feature?.startsWith("spread_rankings")&&w.message).map(w=>w.message);
    if(!x.spread_rankings)loadError="API応答に価格差ランキングが含まれていません。";
  }catch(e){loadError=e instanceof Error?e.message:"ランキングの読み込みに失敗しました。";}
  return <main><header><div className="brand"><span>⚡</span><div><b>Cross-Border Seller Radar</b><small>BUYBACK SPREAD INTELLIGENCE</small></div></div><a className="back" href="/">← 価格レーダーへ戻る</a></header>
  <section className="change-page-head"><small>CD / HA SPREAD</small><h1>{gameName[game]} 買取価格差ランキング</h1><p>同一SKUについてCDとHAを比較。差額の大きい順に、HAが高いケースとCDが高いケースを分離しています。同額は除外。</p></section>
  {warnings.map((message,i)=><div key={i} role="status" style={{margin:"12px 0 20px",padding:"12px 16px",border:"1px solid #b7791f",borderRadius:10,background:"rgba(183,121,31,.10)",fontSize:13,lineHeight:1.6}}>⚠️ {message}</div>)}
  {loadError?<div role="alert" style={{margin:"12px 0 20px",padding:"12px 16px",border:"1px solid #b91c1c",borderRadius:10,background:"rgba(185,28,28,.10)",fontSize:13,lineHeight:1.6}}>⚠️ ランキングを読み込めませんでした：{loadError}</div>:(["HA","CD"] as const).map(ch=><section className="all-ranking" key={ch}><div className="all-ranking-head"><h2>{ch} のほうが高い</h2><span>{data[ch].length.toLocaleString()}件</span></div><div className="all-table"><div className="spread-all-row spread-all-head"><span>順位</span><span>カード</span><span>CD買取</span><span>HA買取</span><span>差額</span><span>差率</span><span>CD時点</span><span>HA時点</span></div>{data[ch].length===0?<div className="empty">該当する価格差データがありません。</div>:data[ch].map(r=><a className="spread-all-row" key={r.product_id} href={"/search?product_id="+encodeURIComponent(r.product_id)}><b>{r.rank}</b><span><strong>{r.canonical_name}</strong><small>{r.set_name??"—"} · <b className="rank-card-number">{r.card_number??"—"}</b> · {r.rarity??"—"}</small></span><span>{yen(r.cd_price_jpy)}</span><span>{yen(r.ha_price_jpy)}</span><span className="spread-diff">{r.difference_jpy>0?"+":"−"}{yen(Math.abs(r.difference_jpy))}</span><span>{r.difference_percent.toFixed(1)}%</span><span>{dt(r.cd_observed_at)}{r.cd_stale&&<small style={{display:"block",color:"#d97706",fontWeight:700}}>更新遅延</small>}</span><span>{dt(r.ha_observed_at)}{r.ha_stale&&<small style={{display:"block",color:"#d97706",fontWeight:700}}>更新遅延</small>}</span></a>)}</div></section>)}
  <footer>Cross-Border Seller Radar · CD / HA separated comparison</footer></main>;
}