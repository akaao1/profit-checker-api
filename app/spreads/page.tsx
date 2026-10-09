export const dynamic="force-dynamic";
export const revalidate=0;

type Row={rank:number;game:string;product_id:string;canonical_name:string;set_name:string|null;card_number:string|null;rarity:string|null;variant_key:string|null;condition_label:string|null;stock_qty:number|null;ha_price_jpy:number;cd_price_jpy:number;gross_profit_jpy:number;gross_margin_pct:number|null;ha_observed_at:string;cd_observed_at:string;ha_source_url:string|null;ha_external_product_key:string};
type Api={ok:boolean;game:string;opportunities?:Row[];error?:string};

const API="https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/radar-api";
const yen=(n:number)=>"¥"+Math.round(n).toLocaleString("ja-JP");
const dt=(s:string)=>new Date(s).toLocaleString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
const GAMES=["pokemon","one_piece","yugioh","mtg"] as const;
type Game=typeof GAMES[number];
const gameName:Record<Game,string>={pokemon:"ポケモン",one_piece:"ONE PIECE",yugioh:"Yu-Gi-Oh!",mtg:"MTG"};
const validGame=(v:string|undefined):Game=>GAMES.includes(v as Game)?v as Game:"pokemon";

async function load(game:Game):Promise<Api>{
 const r=await fetch(API+"?opportunities=1&game="+encodeURIComponent(game)+"&limit=100",{cache:"no-store"});
 const x=await r.json().catch(()=>({ok:false,error:"API応答を解析できませんでした。"}));
 if(!r.ok||x.ok===false)throw new Error(x.error||"価格差データの取得に失敗しました。");
 return x;
}

export default async function Arbitrage({searchParams}:{searchParams:Promise<{game?:string}>}){
 const params=await searchParams,game=validGame(params.game);
 let rows:Row[]=[];let error="";
 try{const x=await load(game);rows=x.opportunities??[]}catch(e){error=e instanceof Error?e.message:"価格差データの取得に失敗しました。";}
 return <main>
  <header><div className="brand"><span>⚡</span><div><b>Cross-Border Seller Radar</b><small>HA BUY → CD SELL</small></div></div><nav style={{display:"flex",gap:12,flexWrap:"wrap"}}><a className="back" href="/">← 価格レーダー</a><a className="back" href="/search?game={game}">🔎 カード検索</a></nav></header>
  <section className="change-page-head">
   <small>ARBITRAGE OPPORTUNITIES</small>
   <h1>{gameName[game]}：HAで買って、CDで売る</h1>
   <p><b>HAの販売価格で仕入れ → CDの買取価格で売却</b>した場合に、CD買取価格 − HA販売価格 がプラスで、かつ両方の価格取得時刻が24時間以内かつ相互に24時間以内のカードだけを表示します。古い価格は利益候補として表示しません。</p>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:16}}>{GAMES.map(g=><a key={g} className="primary-link" href={"/arbitrage?game="+g} style={{opacity:g===game?1:.6}}>{gameName[g]}</a>)}</div>
  </section>
  {error&&<div role="alert" style={{margin:"12px 0 20px",padding:"12px 16px",border:"1px solid #b91c1c",borderRadius:10}}>⚠️ {error}</div>}
  {!error&&<section className="all-ranking">
   <div className="all-ranking-head"><div><h2>利益額の大きい順</h2><small>HA仕入れ価格 → CD買取価格</small></div><span>{rows.length.toLocaleString()}件</span></div>
   <div className="all-table">
    <div className="spread-all-row spread-all-head"><span>順位</span><span>カード</span><span>HAで買う</span><span>CDで売る</span><span>粗利益</span><span>利益率</span><span>状態</span><span>在庫</span></div>
    {rows.length===0?<div className="empty">{game==="pokemon"?"現在、条件を満たす利益候補はありません。CD価格の更新待ち、価格差なし、または取得時刻が24時間条件外の可能性があります。":"現在、このゲームのHA販売価格データが未接続です。HAの買取価格データは販売価格の代用にせず、実際のHA販売価格を収集できるまで利益候補を表示しません。"}</div>:rows.map(r=><a className="spread-all-row" key={r.product_id+"-"+r.ha_external_product_key} href={"/search?game="+game+"&product_id="+encodeURIComponent(r.product_id)}>
      <b>{r.rank}</b>
      <span><strong>{r.canonical_name}</strong><small>{r.set_name??"—"} · <b className="rank-card-number">{r.card_number??"—"}</b> · {r.rarity??"—"}</small></span>
      <span><b>{yen(r.ha_price_jpy)}</b><small>{dt(r.ha_observed_at)}</small></span>
      <span><b>{yen(r.cd_price_jpy)}</b><small>{dt(r.cd_observed_at)}</small></span>
      <span className="spread-diff profit"><b>+{yen(r.gross_profit_jpy)}</b></span>
      <span className="profit"><b>{r.gross_margin_pct==null?"—":r.gross_margin_pct.toFixed(1)+"%"}</b></span>
      <span>{r.condition_label??"—"}</span>
      <span>{r.stock_qty==null?"在庫確認済":r.stock_qty+"枚"}</span>
    </a>)}
   </div>
  </section>}
  <section className="ranking-section" style={{marginTop:24}}><div className="head"><div><small>MEANING</small><h2>このページの見方</h2></div></div><div className="ranking-card" style={{padding:20}}><p style={{lineHeight:1.8,margin:0}}>例：HAが¥100,000、CDが¥190,000なら、単純差額は <b>¥90,000</b> です。このページではこの方向だけを対象にし、逆方向の「CDで買ってHAで売る」は別の価格差ランキングとして扱います。送料・手数料・税金などは含まない粗利益です。</p></div></section>
  <footer>Cross-Border Seller Radar · HA BUY → CD SELL</footer>
 </main>;
}