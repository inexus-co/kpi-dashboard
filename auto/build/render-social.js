#!/usr/bin/env node
/*
 * render-social.js  —  描画専任（既存 render-feedback.js と同じ「baked-JSON 焼き込み」方式）
 * build-social.js が出力した social_data.json と、AI寸評 social_ai.json を、
 * リッチな内側HTML(平文)に焼き込む。暗号化は別途 encrypt-wrap.js が担当。
 *
 * 入力 : <data.json>      … build-social.js の出力（D オブジェクト）
 *        <ai.json>        … {pros:[],cons:[]}（無ければ空＝数値由来の自動ハイライトをフォールバック表示）
 * 出力 : <out_inner.html> … 平文の自己完結ダッシュボードHTML（encrypt-wrap.js の入力）
 *
 * 使い方: node auto/build/render-social.js <data.json> <ai.json> <out_inner.html>
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [, , DATA, AI, OUT] = process.argv;
if (!DATA || !OUT) {
  console.error("usage: node render-social.js <data.json> <ai.json> <out_inner.html>");
  process.exit(1);
}

const D = JSON.parse(fs.readFileSync(DATA, "utf8"));
let ai = { pros: [], cons: [] };
if (AI && fs.existsSync(AI)) {
  try {
    const o = JSON.parse(fs.readFileSync(AI, "utf8"));
    ai = { pros: Array.isArray(o.pros) ? o.pros : [], cons: Array.isArray(o.cons) ? o.cons : [] };
  } catch (_) { /* 壊れていても空でフォールバック */ }
}
const aiProvided = (ai.pros.length + ai.cons.length) > 0;

const TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ソーシャル分析ダッシュボード（YouTube）</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js"></script>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif; background:#f5f6f8; color:#1a1d23; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1180px; margin:0 auto; padding:24px 20px 64px; }
  header h1 { font-size:21px; margin:0 0 4px; font-weight:700; }
  header .sub { color:#6b7280; font-size:13px; }
  .asof { color:#9097a1; font-size:12px; margin-top:6px; }
  .notice { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; border-radius:10px; padding:9px 14px; font-size:12.5px; margin:14px 0 0; }
  /* AIサマリー */
  .aicard { margin-top:18px; background:linear-gradient(135deg,#fff1f1,#fff6ee); border:1px solid #f3d3cf; border-radius:14px; padding:15px 18px; }
  .aihead { font-size:12.5px; font-weight:700; color:#c0362b; display:flex; align-items:center; gap:8px; }
  .aibadge { font-size:10.5px; font-weight:600; color:#6b6f86; background:#fff; border:1px solid #ead7d4; border-radius:999px; padding:1px 8px; }
  .aicols { margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .aicol { background:#fff; border:1px solid #efe3e1; border-radius:10px; padding:11px 14px; }
  .aicol.pro { border-left:4px solid #1f9d6b; } .aicol.con { border-left:4px solid #e0533d; }
  .aicoltitle { font-size:12px; font-weight:700; margin-bottom:6px; }
  .aicol.pro .aicoltitle { color:#1f9d6b; } .aicol.con .aicoltitle { color:#e0533d; }
  .aicol ul { margin:0; padding-left:18px; } .aicol li { font-size:13px; line-height:1.6; color:#2a2f45; margin-bottom:4px; }
  /* KPI帯 */
  .section-label { font-size:13px; font-weight:700; color:#374151; margin:26px 0 10px; }
  .section-label .hint { font-weight:400; color:#9097a1; margin-left:8px; font-size:11.5px; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .card { background:#fff; border:1px solid #e7e9ee; border-radius:12px; padding:14px 16px; box-shadow:0 1px 2px rgba(16,24,40,.04); }
  .kpi .label { color:#6b7280; font-size:11.5px; font-weight:600; }
  .kpi .value { font-size:25px; font-weight:700; margin-top:5px; line-height:1.1; }
  .kpi .meta { font-size:11.5px; color:#6b7280; margin-top:5px; }
  .kpi .meta strong { color:#1a1d23; }
  .kpi .spark { height:30px; margin-top:8px; position:relative; }
  /* チャートグリッド */
  .tabs { display:inline-flex; background:#eceef2; border-radius:10px; padding:3px; margin:0 0 12px; }
  .tab { border:0; background:transparent; padding:6px 16px; border-radius:8px; font-size:12.5px; font-weight:600; color:#5b6473; cursor:pointer; }
  .tab.active { background:#fff; color:#1f2430; box-shadow:0 1px 2px rgba(0,0,0,.08); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .card h3 { margin:0 0 2px; font-size:13.5px; font-weight:700; }
  .card .hint { color:#9097a1; font-size:11px; margin:0 0 10px; }
  .cbox { position:relative; height:240px; } .cbox.tall { height:300px; }
  .full { grid-column:1 / -1; }
  /* テーブル */
  table.vids { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.vids th, table.vids td { padding:8px 10px; border-bottom:1px solid #eef0f3; text-align:right; white-space:nowrap; }
  table.vids th { color:#6b7280; font-weight:600; font-size:11px; }
  table.vids th.l, table.vids td.l { text-align:left; white-space:normal; }
  table.vids td.l { max-width:360px; }
  table.vids th.sortable { cursor:pointer; user-select:none; }
  table.vids th.sortable:hover { color:#2563eb; }
  table.vids th.sortable.act { color:#1a1d23; }
  table.vids th .ar { font-size:9px; color:#9097a1; margin-left:3px; }
  .bar { display:inline-block; height:8px; border-radius:4px; background:#dbe4ff; vertical-align:middle; margin-right:6px; }
  .pos { color:#16a34a; font-weight:600; } .zero { color:#9097a1; }
  .badge { display:inline-block; font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:999px; }
  .badge.hi { background:#dcfce7; color:#15803d; } .badge.mid { background:#fef9c3; color:#a16207; } .badge.lo { background:#f1f5f9; color:#64748b; }
  details { margin-top:10px; } summary { cursor:pointer; color:#2563eb; font-size:12.5px; font-weight:600; }
  footer { color:#9097a1; font-size:11px; margin-top:30px; text-align:center; }
  @media (max-width:860px){ .aicols { grid-template-columns:1fr; } }
  @media (max-width:760px){ .kpis { grid-template-columns:repeat(2,1fr); } .grid2 { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>ソーシャル分析ダッシュボード（YouTube）</h1>
    <div class="sub">YouTube Data API の公開統計を日次スナップショットで蓄積（毎日自動更新）</div>
    <div class="asof" id="asof"></div>
    <div class="notice" id="notice" style="display:none"></div>
  </header>

  <!-- A. AIサマリー -->
  <div class="aicard">
    <div class="aihead">🤖 AIサマリー <span class="aibadge" id="aibadge">分析</span></div>
    <div class="aicols">
      <div class="aicol pro"><div class="aicoltitle">👍 良い点</div><ul id="aiPros"></ul></div>
      <div class="aicol con"><div class="aicoltitle">⚠️ 注意点</div><ul id="aiCons"></ul></div>
    </div>
  </div>

  <!-- B. KPI帯 -->
  <div class="section-label">主要指標 <span class="hint">チャンネルの現在地</span></div>
  <div class="kpis" id="kpis"></div>

  <!-- C. トレンド -->
  <div class="section-label">トレンド <span class="hint">日々の伸び（履歴が貯まるほど厚くなる）</span></div>
  <div class="tabs" id="tabs">
    <button class="tab active" data-days="7">直近7日</button>
    <button class="tab" data-days="30">直近30日</button>
    <button class="tab" data-days="0">全期間</button>
  </div>
  <div class="grid2">
    <div class="card"><h3>総再生数</h3><p class="hint">線：累計／棒：1日に増えた再生数</p><div class="cbox"><canvas id="cViews"></canvas></div></div>
    <div class="card"><h3>チャンネル登録者数</h3><p class="hint">線：累計／棒：1日に増えた登録者数</p><div class="cbox"><canvas id="cSubs"></canvas></div></div>
  </div>

  <!-- D. 動画パフォーマンス（横断） -->
  <div class="section-label">動画パフォーマンス <span class="hint">最新時点の横断分析（初日から見られる）</span></div>
  <div class="grid2">
    <div class="card"><h3>総再生数トップ10</h3><p class="hint">累計再生数が多い動画</p><div class="cbox tall"><canvas id="cTopViews"></canvas></div></div>
    <div class="card"><h3>エンゲージ率トップ10</h3><p class="hint">(いいね＋コメント)÷再生数。一定再生数以上の動画から</p><div class="cbox tall"><canvas id="cTopEng"></canvas></div></div>
    <div class="card"><h3>公開時期 × 再生数</h3><p class="hint">点＝動画（横:公開日／縦:累計再生／大きさ:エンゲージ率）</p><div class="cbox"><canvas id="cScatter"></canvas></div></div>
    <div class="card"><h3>再生の集中度</h3><p class="hint">トップ5本が総再生に占める割合</p><div class="cbox"><canvas id="cConc"></canvas></div></div>
  </div>

  <!-- E. 伸びている動画 -->
  <div id="growSec" style="display:none">
    <div class="section-label">直近で伸びている動画 <span class="hint">7日間の再生増分トップ</span></div>
    <div class="grid2"><div class="card full"><div class="cbox"><canvas id="cGrow"></canvas></div></div></div>
  </div>

  <!-- F. 動画一覧 -->
  <div class="section-label">動画別 実績一覧 <span class="hint">累計の再生数・いいね・コメント／7日の再生増分／エンゲージ率（列見出しクリックで並び替え）</span></div>
  <div class="card full">
    <div style="overflow-x:auto">
      <table class="vids">
        <thead><tr><th class="l">動画</th><th class="sortable" data-key="views">総再生数<span class="ar"></span></th><th class="sortable" data-key="likes">いいね<span class="ar"></span></th><th class="sortable" data-key="comments">コメント<span class="ar"></span></th><th class="sortable" data-key="d7">7日の再生増分<span class="ar"></span></th><th class="sortable" data-key="eng">エンゲージ率<span class="ar"></span></th></tr></thead>
        <tbody id="vidRows"></tbody>
      </table>
    </div>
    <details id="moreWrap" style="display:none"><summary id="moreSummary"></summary>
      <div style="overflow-x:auto;margin-top:8px"><table class="vids"><tbody id="vidRowsMore"></tbody></table></div>
    </details>
  </div>

  <footer>generated by cloud routine — データソース: YouTube Data API（数値は暗号化して埋め込み）</footer>
</div>

<script>
const D = /*__DATA__*/;
const AI = /*__AI__*/;
const fmt = x => Number(x).toLocaleString("ja-JP");
const C = { red:"#dc2626", blue:"#2563eb", green:"#16a34a", amber:"#d97706", purple:"#7c3aed", teal:"#0d9488", gray:"#cbd5e1" };
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sd = v => v == null ? "—" : (v >= 0 ? "+"+fmt(v) : fmt(v));
const signed = v => v == null ? '<span class="zero">—</span>' : (v > 0 ? '<span class="pos">+'+fmt(v)+'</span>' : (v === 0 ? '<span class="zero">0</span>' : fmt(v)));

document.getElementById("asof").textContent = "最終データ日: " + D.last_date + " ／ 生成: " + D.generated_at + " ／ 蓄積 " + D.days + "日分";
if (!D.has_history) {
  const nt = document.getElementById("notice"); nt.style.display = "block";
  nt.textContent = "データ蓄積中です。日次の伸び（増分）とトレンドは2日目以降から表示されます。現在は累計値と横断分析を表示しています。";
}

/* ---- A. AIサマリー（baked AI、無ければ数値由来フォールバック） ---- */
(function(){
  let pros = AI.pros || [], cons = AI.cons || [], badge = "Claude";
  if (pros.length + cons.length === 0) {
    badge = "自動ハイライト";
    const k = D.kpi;
    pros = []; cons = [];
    if (D.topViews[0]) pros.push("最も見られている「"+D.topViews[0].title+"」が "+fmt(D.topViews[0].views)+" 回再生");
    if (k.views_7d != null && k.views_7d > 0) pros.push("直近7日で総再生が +"+fmt(k.views_7d)+" 伸びています");
    if (k.avg_engagement) pros.push("平均エンゲージ率は "+k.avg_engagement+"%（いいね＋コメント÷再生）");
    if (D.growing && D.growing[0]) pros.push("「"+D.growing[0].title+"」が直近7日で +"+fmt(D.growing[0].d7)+" 再生と好調");
    if (!D.has_history) cons.push("履歴が1日分のみ。日次の伸びは明日以降から見えます");
    if (k.subs_7d === 0) cons.push("登録者数の伸びがこの期間ほぼ横ばい");
    if (D.concentration && D.concentration.top5_share >= 60) cons.push("再生がトップ5本に集中（"+D.concentration.top5_share+"%）。新しいヒットの裾野づくりが課題");
    if (k.avg_views && k.video_count) cons.push("動画あたり平均再生は "+fmt(k.avg_views)+" 回。底上げ余地あり");
    pros = pros.slice(0,4); cons = cons.slice(0,4);
  }
  document.getElementById("aibadge").textContent = badge;
  const fill = (id, arr, empty) => { document.getElementById(id).innerHTML = (arr&&arr.length)? arr.map(x=>"<li>"+esc(x)+"</li>").join("") : '<li style="color:#9aa1ad">'+empty+"</li>"; };
  fill("aiPros", pros, "目立った良い点はまだありません");
  fill("aiCons", cons, "目立った注意点はありません 🎉");
})();

/* ---- B. KPIカード ---- */
(function(){
  const k = D.kpi;
  const card = (l,v,m,spark)=> '<div class="card kpi"><div class="label">'+l+'</div><div class="value">'+v+'</div><div class="meta">'+m+'</div>'+(spark?'<div class="spark"><canvas id="'+spark+'"></canvas></div>':'')+'</div>';
  document.getElementById("kpis").innerHTML =
    card("チャンネル登録者", fmt(k.subscribers), "直近7日 <strong>"+sd(k.subs_7d)+"</strong>", "spkSubs") +
    card("総再生数（累計）", fmt(k.total_views), "前日比 <strong>"+sd(k.views_delta)+"</strong>／7日 <strong>"+sd(k.views_7d)+"</strong>", "spkViews") +
    card("公開動画数", fmt(k.video_count), "平均 <strong>"+fmt(k.avg_views)+"</strong> 回／本") +
    card("平均エンゲージ率", k.avg_engagement+"%", "(いいね＋コメント)÷再生") +
    card("総いいね", fmt(k.total_likes), "全動画の累計") +
    card("総コメント", fmt(k.total_comments), "全動画の累計") +
    card("今日増えた再生", sd(k.views_delta), "前日からの増分") +
    card("今日増えた登録者", sd(k.subs_delta), "前日からの増分");
  // スパークライン（履歴があれば）
  const spark = (id, arr, color) => {
    const el = document.getElementById(id); if (!el || !arr || arr.length < 2) return;
    new Chart(el, { type:"line", data:{ labels:arr.map(()=> ""), datasets:[{ data:arr, borderColor:color, borderWidth:1.5, pointRadius:0, tension:.3, fill:false }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{enabled:false}}, scales:{x:{display:false},y:{display:false}} } });
  };
  spark("spkSubs", D.trend.subs, C.blue);
  spark("spkViews", D.trend.views, C.red);
})();

/* ---- 共通オプション ---- */
const base = (extra={}) => Object.assign({ responsive:true, maintainAspectRatio:false,
  plugins:{ legend:{ display:false } },
  scales:{ x:{ grid:{display:false}, ticks:{font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:10} }, y:{ beginAtZero:true, grid:{color:"#eef0f3"}, ticks:{font:{size:10}} } } }, extra);
const hbar = (extra={}) => base(Object.assign({ indexAxis:"y",
  scales:{ x:{beginAtZero:true,grid:{color:"#eef0f3"},ticks:{font:{size:10}}}, y:{grid:{display:false},ticks:{font:{size:10},autoSkip:false,callback:function(v){const t=this.getLabelForValue(v);return t.length>20?t.slice(0,20)+"…":t;}}} } }, extra));

/* ---- C. トレンド（期間タブ） ---- */
let viewsChart=null, subsChart=null;
function windowSlice(days){
  const n = D.trend.dates.length;
  if (!days || days >= n) return { from:0, n };
  return { from: Math.max(0, n-days), n };
}
function drawTrend(days){
  const w = windowSlice(days);
  const labels = D.trend.labels.slice(w.from);
  const views = D.trend.views.slice(w.from), viewsDelta = D.trend.viewsDelta.slice(w.from);
  const subs = D.trend.subs.slice(w.from), subsDelta = D.trend.subsDelta.slice(w.from);
  if (viewsChart) viewsChart.destroy();
  if (subsChart) subsChart.destroy();
  const dualOpts = (extra={}) => base(Object.assign({ scales:{
    x:{grid:{display:false},ticks:{font:{size:10},autoSkip:true,maxTicksLimit:9}},
    y:{position:"left",beginAtZero:false,grid:{color:"#eef0f3"},ticks:{font:{size:10}}},
    y1:{position:"right",beginAtZero:true,grid:{display:false},ticks:{font:{size:10}}} } }, extra));
  viewsChart = new Chart(cViews, { data:{ labels, datasets:[
    { type:"bar", label:"日次増分", data:viewsDelta, yAxisID:"y1", backgroundColor:"rgba(220,38,38,.45)", borderRadius:3, order:2 },
    { type:"line", label:"累計", data:views, yAxisID:"y", borderColor:C.red, backgroundColor:"rgba(220,38,38,.06)", fill:true, tension:.25, pointRadius:0, borderWidth:2, order:1 } ] },
    options: dualOpts({ plugins:{ legend:{ display:true, labels:{boxWidth:12,font:{size:10}} } } }) });
  subsChart = new Chart(cSubs, { data:{ labels, datasets:[
    { type:"bar", label:"日次増分", data:subsDelta, yAxisID:"y1", backgroundColor:"rgba(37,99,235,.4)", borderRadius:3, order:2 },
    { type:"line", label:"累計", data:subs, yAxisID:"y", borderColor:C.blue, backgroundColor:"rgba(37,99,235,.06)", fill:true, tension:.25, pointRadius:0, borderWidth:2, order:1 } ] },
    options: dualOpts({ plugins:{ legend:{ display:true, labels:{boxWidth:12,font:{size:10}} } } }) });
}
document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab"); if (!btn || btn.classList.contains("active")) return;
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  btn.classList.add("active");
  drawTrend(parseInt(btn.dataset.days,10));
});
drawTrend(7);

/* ---- D. 動画パフォーマンス ---- */
new Chart(cTopViews, { type:"bar", data:{ labels:D.topViews.map(r=>r.title), datasets:[
  { data:D.topViews.map(r=>r.views), backgroundColor:"rgba(124,58,237,.65)", borderRadius:3 } ] }, options: hbar() });

new Chart(cTopEng, { type:"bar", data:{ labels:D.topEng.map(r=>r.title), datasets:[
  { data:D.topEng.map(r=>r.eng), backgroundColor:"rgba(13,148,136,.65)", borderRadius:3 } ] },
  options: hbar({ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=>" "+c.parsed.x+"%（"+fmt(D.topEng[c.dataIndex].views)+"回）" } } } }) });

new Chart(cScatter, { type:"bubble", data:{ datasets:[
  { data:D.scatter, backgroundColor:"rgba(217,119,6,.45)", borderColor:"rgba(217,119,6,.8)" } ] },
  options: base({ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=>{const p=D.scatter[c.dataIndex];return " "+p.title+"："+fmt(p.y)+"回";} } } },
    scales:{ x:{ type:"linear", grid:{color:"#eef0f3"}, ticks:{font:{size:10},maxTicksLimit:6,callback:(v)=>{const d=new Date(v);return (d.getMonth()+1)+"/"+(""+d.getFullYear()).slice(2);}} },
             y:{ beginAtZero:true, grid:{color:"#eef0f3"}, ticks:{font:{size:10}} } } }) });

new Chart(cConc, { type:"doughnut", data:{ labels:["トップ5本","その他の動画"], datasets:[
  { data:[D.concentration.top5, D.concentration.rest], backgroundColor:["#7c3aed","#e5e7eb"], borderWidth:0 } ] },
  options:{ responsive:true, maintainAspectRatio:false, cutout:"62%",
    plugins:{ legend:{ position:"bottom", labels:{boxWidth:12,font:{size:11}} },
      tooltip:{ callbacks:{ label:(c)=>{const tot=D.concentration.top5+D.concentration.rest; return " "+fmt(c.parsed)+"回（"+(tot?((c.parsed/tot)*100).toFixed(1):0)+"%）";} } } } } });

/* ---- E. 伸びている動画 ---- */
if (D.growing && D.growing.length) {
  document.getElementById("growSec").style.display = "block";
  new Chart(cGrow, { type:"bar", data:{ labels:D.growing.map(r=>r.title), datasets:[
    { data:D.growing.map(r=>r.d7), backgroundColor:"rgba(22,163,74,.6)", borderRadius:3 } ] },
    options: hbar({ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=>" +"+fmt(c.parsed.x)+" 回（7日）" } } } }) });
}

/* ---- F. テーブル（上位15＋折りたたみ・列見出しで並び替え） ---- */
(function(){
  const maxV = Math.max(1, ...D.table.map(r=>r.views));
  const engBadge = (e)=> e>=3 ? '<span class="badge hi">'+e+'%</span>' : (e>=1 ? '<span class="badge mid">'+e+'%</span>' : '<span class="badge lo">'+e+'%</span>');
  const row = (r)=> '<tr><td class="l"><span class="bar" style="width:'+Math.round((r.views/maxV)*60)+'px"></span>'+esc(r.title)+'</td><td>'+fmt(r.views)+'</td><td>'+fmt(r.likes)+'</td><td>'+fmt(r.comments)+'</td><td>'+signed(r.d7)+'</td><td>'+engBadge(r.eng)+'</td></tr>';
  const num = (v)=> (v == null ? -Infinity : v); // null（7日増分の初日など）は降順で末尾へ
  const ths = [].slice.call(document.querySelectorAll('th.sortable'));
  let curKey = "views", curDir = -1; // -1=降順, 1=昇順
  function render(){
    const sorted = D.table.slice().sort(function(a,b){
      const av = num(a[curKey]), bv = num(b[curKey]);
      const c = av < bv ? -1 : av > bv ? 1 : 0; // 昇順
      return curDir === 1 ? c : -c;
    });
    document.getElementById("vidRows").innerHTML = sorted.slice(0,15).map(row).join("");
    const rest = sorted.slice(15);
    const mw = document.getElementById("moreWrap");
    if (rest.length) {
      mw.style.display = "block";
      document.getElementById("moreSummary").textContent = "残り "+rest.length+" 本を表示";
      document.getElementById("vidRowsMore").innerHTML = rest.map(row).join("");
    } else { mw.style.display = "none"; }
    ths.forEach(function(th){
      const ar = th.querySelector('.ar');
      if (th.dataset.key === curKey) { th.classList.add('act'); ar.textContent = curDir === -1 ? '▼' : '▲'; }
      else { th.classList.remove('act'); ar.textContent = ''; }
    });
  }
  ths.forEach(function(th){
    th.addEventListener('click', function(){
      const k = th.dataset.key;
      if (k === curKey) curDir = -curDir; else { curKey = k; curDir = -1; }
      render();
    });
  });
  render();
})();
</script>
</body>
</html>
`;

function main() {
  const dataJson = JSON.stringify(D).replace(/</g, "\\u003c");
  const aiJson = JSON.stringify(ai).replace(/</g, "\\u003c");
  const html = TEMPLATE.replace("/*__DATA__*/", dataJson).replace("/*__AI__*/", aiJson);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");
  console.log("[OK] inner written: " + OUT + " (" + html.length + " bytes) ｜ AI=" + (aiProvided ? "あり(Claude)" : "なし(自動ハイライト)") + " ｜ 動画 " + (D.table ? D.table.length : 0) + "本");
}

main();
