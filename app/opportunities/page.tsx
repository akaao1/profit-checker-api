"use client";

import { useEffect, useState } from "react";

const API = "https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/sale-radar?action=opportunities&limit=100";
const HEALTH_API = "https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/sale-radar?action=health";
const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const dt = (s: string) => new Date(s).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const variantLabel = (k: string | undefined) => {
  if (!k || k === "NORMAL") return "通常仕様";
  return k.split("+").map((x) => x === "MASTERBALL_MIRROR" ? "マスターボールミラー" : x === "MONSTERBALL_MIRROR" ? "モンスターボールミラー" : x === "MIRROR" ? "ミラー" : x === "UNOPENED" ? "未開封" : x).join(" + ");
};

type O = {
  sale_observation_id: string; canonical_name: string; set_name: string | null; card_number: string | null; rarity: string | null;
  condition_label: string; condition_group: string; is_primary_condition: boolean; sale_price_jpy: number; stock_qty: number | null;
  stock_qty_source?: string | null; stock_qty_observed_at?: string | null; sale_observed_at: string; cd_buy_price_jpy: number;
  cd_buy_observed_at: string; gross_spread_jpy: number; gross_margin_pct: number; variant_key?: string; variant_base_name?: string;
};
type Health = {
  current_listing_count: number; current_cycle_staging_count: number; next_page: number; max_page: number; pages_per_run: number;
  last_completed_cycle_at: string | null; last_success_at: string | null; next_due_at: string | null;
  current_snapshot_checked_at: string | null; current_snapshot_age_minutes: number | string | null;
};

export default function Opportunities() {
  const [d, setD] = useState<O[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(API, { cache: "no-store" }).then((r) => r.json()),
      fetch(HEALTH_API, { cache: "no-store" }).then((r) => r.json()),
    ]).then(([op, h]) => {
      if (!op.ok) throw new Error(op.error || "取得失敗");
      setD((op.opportunities ?? []).sort((a: O, b: O) =>
        Number(b.is_primary_condition) - Number(a.is_primary_condition) || b.gross_spread_jpy - a.gross_spread_jpy
      ));
      if (h.ok) setHealth(h.health ?? null);
    }).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  const building = !!health && !health.last_completed_cycle_at;
  const age = health?.current_snapshot_age_minutes;
  const ageText = age == null ? "—" : Math.round(Number(age)) + "分前";

  return <main style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 20px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <div>
        <a href="/">← Radar</a>
        <h1 style={{ margin: "12px 0 6px" }}>💰 Buyback Arbitrage Radar</h1>
        <p style={{ color: "#8994a3", margin: 0 }}>HAの販売価格 <strong>&lt;</strong> CDの買取価格。現在在庫があるものだけ。</p>
      </div>
      <div style={{ padding: "10px 14px", border: "1px solid #29313c", borderRadius: 10 }}>LIVE / CD買取 × HA販売</div>
    </div>

    {health && <section style={{ marginTop: 20, padding: 16, border: "1px solid #29313c", borderRadius: 12 }}>
      <div style={{ fontWeight: 800 }}>{building ? "🔄 現在スナップショットを更新中" : "🟢 現在スナップショット"}</div>
      <div style={{ color: "#8994a3", marginTop: 7 }}>
        {building
          ? "新しい一巡分を構築中：" + health.current_cycle_staging_count.toLocaleString() + "件収集済み / page " + health.next_page + " / " + health.max_page + "。構築完了までは直前の確定スナップショットを使用します。"
          : "確定スナップショット：" + health.current_listing_count.toLocaleString() + "件。最終確認 " + ageText + "。"}
      </div>
      {health.last_completed_cycle_at && <div style={{ color: "#8994a3", marginTop: 4 }}>前回一巡完了：{dt(health.last_completed_cycle_at)}</div>}
    </section>}

    <div style={{ marginTop: 20, padding: 16, border: "1px solid #29313c", borderRadius: 12, color: "#a9b4c1" }}>
      判定は<strong>同一カード番号＋カード名</strong>で既存商品DBへ紐付けし、HAの在庫あり販売価格とCD最新買取価格を比較します。状態なしはAとして扱い、A/A+/A-を<strong>A（主指標）</strong>、B/B+/B-・C・Dを<strong>補助比較</strong>として表示します。
    </div>

    {loading && <p style={{ marginTop: 30 }}>読み込み中…</p>}
    {err && <p style={{ marginTop: 30, color: "#ff8a8a" }}>{err}</p>}
    {!loading && !err && !d.length && <section style={{ marginTop: 30, padding: 40, border: "1px solid #29313c", borderRadius: 14, textAlign: "center" }}>
      <h2>現在、条件成立の商品はありません</h2>
      <p style={{ color: "#8994a3" }}>監視は分散スケジュールで継続します。販売価格がCD買取価格を下回った商品がここへ現れます。</p>
    </section>}

    <section style={{ marginTop: 24, display: "grid", gap: 12 }}>
      {d.map((x, i) => <article key={x.sale_observation_id} style={{ padding: 18, border: "1px solid #29313c", borderRadius: 14, background: "#10151c" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <span style={{ color: "#73e8a2", fontWeight: 800 }}>#{i + 1}</span>
            <strong style={{ fontSize: 18, marginLeft: 8 }}>{x.canonical_name}</strong>
            <div style={{ color: "#8994a3", marginTop: 5 }}>{variantLabel(x.variant_key)} · {x.set_name ?? "—"} · {x.card_number ?? "—"} · {x.rarity ?? "—"} · 状態{x.condition_label} · {x.is_primary_condition ? "主指標" : "補助"}</div>
          </div>
          <a href={"/api/source-product?id=" + encodeURIComponent(x.sale_observation_id)} target="_blank" rel="noreferrer">HAの商品ページ ↗</a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(130px,1fr))", gap: 10, marginTop: 18 }}>
          <div><small>販売価格</small><div style={{ fontSize: 22, fontWeight: 800 }}>{yen(x.sale_price_jpy)}</div><small>{x.stock_qty == null ? "在庫数量：取得待ち" : x.stock_qty === 0 ? "在庫数量：0枚（在庫なし）" : "在庫数量：" + x.stock_qty + "枚"}</small></div>
          <div><small>CD買取</small><div style={{ fontSize: 22, fontWeight: 800 }}>{yen(x.cd_buy_price_jpy)}</div><small>{dt(x.cd_buy_observed_at)}</small></div>
          <div><small>粗利差</small><div style={{ fontSize: 22, fontWeight: 800, color: "#73e8a2" }}>+{yen(x.gross_spread_jpy)}</div><small>販売価格比 {x.gross_margin_pct.toFixed(1)}%</small></div>
          <div><small>在庫数量の観測</small><div style={{ fontWeight: 700, marginTop: 6 }}>{x.stock_qty_observed_at ? dt(x.stock_qty_observed_at) : "—"}</div><small>{x.stock_qty_source === "product_html" ? "商品ページ確認" : x.stock_qty_source === "source_json" ? "商品データ確認" : x.stock_qty_source === "availability" ? "在庫有無から確定" : "数量未確定"}</small></div>
        </div>
      </article>)}
    </section>
  </main>;
}
