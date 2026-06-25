#!/usr/bin/env node
/*
 * render-ga4.js  —  描画専任（render-social.js と同じ「baked-JSON 焼き込み」方式）
 * build-ga4.js が出力した ga4_data.json と、AI寸評 ga4_ai.json を、
 * リッチな内側HTML(平文)に焼き込む。暗号化は別途 encrypt-wrap.js が担当。
 *
 * 入力 : <data.json>      … build-ga4.js の出力（D オブジェクト）
 *        <ai.json>        … {pros:[],cons:[]}（無ければ空＝数値由来の自動ハイライトをフォールバック）
 * 出力 : <out_inner.html> … 平文の自己完結ダッシュボードHTML（encrypt-wrap.js の入力）
 *
 * 使い方: node auto/build/render-ga4.js <data.json> <ai.json> <out_inner.html>
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [, , DATA, AI, OUT] = process.argv;
if (!DATA || !OUT) {
  console.error("usage: node render-ga4.js <data.json> <ai.json> <out_inner.html>");
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
<title>Web分析（GA4）ダッシュボード</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js"></script>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif; background:#f7f8fa; color:#1a1d23; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1180px; margin:0 auto; padding:24px 20px 64px; }
  header h1 { font-size:21px; margin:0 0 4px; font-weight:700; }
  header .sub { color:#6b7280; font-size:13px; }
  header .sub code { background:#eef0f3; padding:1px 6px; border-radius:5px; font-size:12px; }
  .asof { color:#9097a1; font-size:12px; margin-top:6px; }
  .notice { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; border-radius:10px; padding:9px 14px; font-size:12.5px; margin:14px 0 0; }
  /* AIサマリー */
  .aicard { margin-top:18px; background:linear-gradient(135deg,#eef4ff,#f3f0ff); border:1px solid #d7defb; border-radius:14px; padding:15px 18px; }
  .aihead { font-size:12.5px; font-weight:700; color:#3257c5; display:flex; align-items:center; gap:8px; }
  .aibadge { font-size:10.5px; font-weight:600; color:#6b6f86; background:#fff; border:1px solid #d8def0; border-radius:999px; padding:1px 8px; }
  .aicols { margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .aicol { background:#fff; border:1px solid #e6ebf6; border-radius:10px; padding:11px 14px; }
  .aicol.pro { border-left:4px solid #1f9d6b; } .aicol.con { border-left:4px solid #e0a23d; }
  .aicoltitle { font-size:12px; font-weight:700; margin-bottom:6px; }
  .aicol.pro .aicoltitle { color:#1f9d6b; } .aicol.con .aicoltitle { color:#b4791e; }
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
  /* チャートグリッド */
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .card h3 { margin:0 0 2px; font-size:13.5px; font-weight:700; }
  .card .hint { color:#9097a1; font-size:11px; margin:0 0 10px; }
  .cbox { position:relative; height:240px; } .cbox.tall { height:290px; }
  .full { grid-column:1 / -1; }
  /* テーブル */
  table.evt { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.evt th, table.evt td { padding:8px 10px; border-bottom:1px solid #eef0f3; text-align:right; white-space:nowrap; }
  table.evt th { color:#6b7280; font-weight:600; font-size:11px; }
  table.evt th.l, table.evt td.l { text-align:left; white-space:normal; }
  table.evt td.l { max-width:420px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  table.evt th.sortable { cursor:pointer; user-select:none; }
  table.evt th.sortable:hover { color:#2563eb; }
  table.evt th.sortable.act { color:#1a1d23; }
  table.evt th .ar { font-size:9px; color:#9097a1; margin-left:3px; }
  .bar { display:inline-block; height:8px; border-radius:4px; background:#dbe4ff; vertical-align:middle; margin-right:6px; }
  .badge { display:inline-block; font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:999px; }
  .badge.key { background:#dcfce7; color:#15803d; } .badge.no { background:#f1f5f9; color:#94a3b8; }
  details { margin-top:10px; } summary { cursor:pointer; color:#2563eb; font-size:12.5px; font-weight:600; }
  footer { color:#9097a1; font-size:11px; margin-top:30px; text-align:center; }
  @media (max-width:860px){ .aicols { grid-template-columns:1fr; } }
  @media (max-width:760px){ .kpis { grid-template-columns:repeat(2,1fr); } .grid2 { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Web分析（GA4）ダッシュボード</h1>
    <div class="sub">GA4 <code>kids.inexus-co.com</code>（まなんでパズル Web版・property 289134520）の集計値を直接取得（毎日自動更新）</div>
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
  <div class="section-label">主要指標 <span class="hint">アクティブユーザー（昨日基準のローリング）</span></div>
  <div class="kpis" id="kpis"></div>

  <!-- C. トレンド -->
  <div class="section-label">トレンド <span class="hint">日次はGA4が直接返す直近7日／ローリングは履歴が貯まるほど厚くなる</span></div>
  <div class="grid2">
    <div class="card"><h3>日次アクティブユーザー</h3><p class="hint">線：日次アクティブ／破線：7日移動平均（直近7日）</p><div class="cbox"><canvas id="cActive"></canvas></div></div>
    <div class="card"><h3>新規ユーザー（日次）</h3><p class="hint">棒：日次の新規ユーザー（直近7日）</p><div class="cbox"><canvas id="cNew"></canvas></div></div>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="card"><h3>セッション・ページビュー（日次）</h3><p class="hint">棒：セッション（左軸）／線：ページビュー（右軸）</p><div class="cbox"><canvas id="cSess"></canvas></div></div>
    <div class="card"><h3>エンゲージメント率（日次）</h3><p class="hint">エンゲージしたセッションの割合（%）</p><div class="cbox"><canvas id="cEng"></canvas></div></div>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="card full"><h3>アクティブユーザー推移（DAU / WAU / MAU）</h3><p class="hint">毎日のスナップショットを蓄積して時系列化（履歴2日目以降から線になります）</p><div class="cbox"><canvas id="cRolling"></canvas></div></div>
  </div>

  <!-- D. 流入元 -->
  <div class="section-label">流入元 <span class="hint">直近28日・チャネル別</span></div>
  <div class="grid2">
    <div class="card"><h3>チャネル別セッション</h3><p class="hint">どこから来たか（セッション数の構成）</p><div class="cbox tall"><canvas id="cChDoughnut"></canvas></div></div>
    <div class="card"><h3>チャネル別 新規ユーザー</h3><p class="hint">チャネルごとの新規ユーザー獲得</p><div class="cbox tall"><canvas id="cChBar"></canvas></div></div>
  </div>

  <!-- E. 主要イベント -->
  <div class="section-label">主要イベント <span class="hint">直近28日・発生回数／キーイベント（コンバージョン）指定の有無（列見出しで並び替え）</span></div>
  <div class="card full">
    <div style="overflow-x:auto">
      <table class="evt">
        <thead><tr><th class="l">イベント名</th><th class="sortable" data-key="count">発生回数<span class="ar"></span></th><th class="sortable" data-key="key">キーイベント<span class="ar"></span></th><th>種別</th></tr></thead>
        <tbody id="evtRows"></tbody>
      </table>
    </div>
    <details id="moreWrap" style="display:none"><summary id="moreSummary"></summary>
      <div style="overflow-x:auto;margin-top:8px"><table class="evt"><tbody id="evtRowsMore"></tbody></table></div>
    </details>
  </div>

  <footer>generated by cloud routine — データソース: Google Analytics Data API v1（BigQuery非経由・数値は暗号化して埋め込み）</footer>
</div>

<script>
const D = /*__DATA__*/;
const AI = /*__AI__*/;
const fmt = x => Number(x).toLocaleString("ja-JP");
const C = { blue:"#2563eb", green:"#16a34a", amber:"#d97706", purple:"#7c3aed", pink:"#db2777", teal:"#0d9488", gray:"#94a3b8" };
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sd = v => v == null ? "—" : (v >= 0 ? "+"+fmt(v) : fmt(v));
// GA4 既定チャネルグループの配色
const CH_COLORS = { "Direct":"#2563eb","Organic Search":"#16a34a","Organic Social":"#db2777","Referral":"#d97706","Paid Search":"#7c3aed","Paid Social":"#9333ea","Paid Other":"#a855f7","Email":"#0d9488","Display":"#f59e0b","Organic Video":"#dc2626","Paid Video":"#b91c1c","AI Assistant":"#0891b2","Cross-network":"#64748b","Unassigned":"#cbd5e1" };
const chColor = (name) => CH_COLORS[name] || "#94a3b8";

document.getElementById("asof").textContent = "最終データ日: " + D.last_date + " ／ 取得日: " + D.fetch_date + " ／ 生成: " + D.generated_at + " ／ 蓄積 " + D.days + "日分";
if (!D.has_history) {
  const nt = document.getElementById("notice"); nt.style.display = "block";
  nt.textContent = "データ蓄積中です。DAU/WAU/MAUの「推移」と前週比は2日目以降から表示されます。現在は直近7日の日次トレンドと28日の流入元・イベントを表示しています。";
}

/* ---- A. AIサマリー（baked AI、無ければ数値由来フォールバック） ---- */
(function(){
  let pros = AI.pros || [], cons = AI.cons || [], badge = "Claude";
  if (pros.length + cons.length === 0) {
    badge = "自動ハイライト";
    const k = D.kpi; pros = []; cons = [];
    pros.push("DAU "+fmt(k.dau)+"／WAU "+fmt(k.wau)+"／MAU "+fmt(k.mau)+"（昨日基準のローリング）");
    if (k.dau_7d != null && k.dau_7d > 0) pros.push("DAUは約7日前比で +"+fmt(k.dau_7d));
    if (D.acquisition[0]) pros.push("主要流入は「"+D.acquisition[0].channel+"」で "+fmt(D.acquisition[0].sessions)+" セッション");
    const ar = D.daily.engRate || []; if (ar.length) { const avg=Math.round(ar.reduce((a,b)=>a+b,0)/ar.length*10)/10; pros.push("直近7日の平均エンゲージメント率は "+avg+"%"); }
    if (!D.has_history) cons.push("履歴が1日分のみ。DAU/WAU/MAUの推移は明日以降から見えます");
    if (k.stickiness && k.stickiness < 20) cons.push("粘着度(DAU/MAU) は "+k.stickiness+"%。再訪の習慣化に伸びしろ");
    const dir = (D.acquisition.find(a=>a.channel==="Direct")||{}).sessions||0;
    const tot = D.acquisition.reduce((a,b)=>a+b.sessions,0);
    if (tot && dir/tot >= 0.8) cons.push("流入が Direct に集中（"+Math.round(dir/tot*100)+"%）。検索/ソーシャル流入の開拓余地");
    const keyed = D.events.filter(e=>e.key>0).map(e=>e.name);
    if (keyed.length && keyed.length <= 2) cons.push("キーイベント指定は "+keyed.join("・")+" のみ。重要行動のコンバージョン設定を見直す余地");
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
  const card = (l,v,m)=> '<div class="card kpi"><div class="label">'+l+'</div><div class="value">'+v+'</div><div class="meta">'+m+'</div></div>';
  document.getElementById("kpis").innerHTML =
    card("DAU（日次アクティブ）", fmt(k.dau), "約7日前比 <strong>"+sd(k.dau_7d)+"</strong>") +
    card("WAU（7日アクティブ）", fmt(k.wau), "約7日前比 <strong>"+sd(k.wau_7d)+"</strong>") +
    card("MAU（28日アクティブ）", fmt(k.mau), "約7日前比 <strong>"+sd(k.mau_7d)+"</strong>") +
    card("粘着度（DAU/MAU）", k.stickiness+"%", "高いほど毎日使われている");
})();

/* ---- 共通チャートオプション ---- */
const base = (extra={}) => Object.assign({ responsive:true, maintainAspectRatio:false,
  plugins:{ legend:{ display:false } },
  scales:{ x:{ grid:{display:false}, ticks:{font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:10} }, y:{ beginAtZero:true, grid:{color:"#eef0f3"}, ticks:{font:{size:10}} } } }, extra);
const hbar = (extra={}) => base(Object.assign({ indexAxis:"y",
  scales:{ x:{beginAtZero:true,grid:{color:"#eef0f3"},ticks:{font:{size:10}}}, y:{grid:{display:false},ticks:{font:{size:10},autoSkip:false,callback:function(v){const t=this.getLabelForValue(v);return t.length>20?t.slice(0,20)+"…":t;}}} } }, extra));

/* ---- C. トレンド ---- */
new Chart(cActive, { type:"line", data:{ labels:D.daily.labels, datasets:[
    { label:"日次アクティブ", data:D.daily.activeUsers, borderColor:C.purple, backgroundColor:"rgba(124,58,237,.08)", fill:true, tension:.3, pointRadius:0, borderWidth:2 },
    { label:"7日移動平均", data:D.daily.activeMa, borderColor:C.amber, borderDash:[5,4], borderWidth:2, pointRadius:0, tension:.3 } ] },
  options: base({ plugins:{ legend:{ display:true, labels:{boxWidth:12,font:{size:10}} } } }) });

new Chart(cNew, { type:"bar", data:{ labels:D.daily.labels, datasets:[
    { label:"新規ユーザー", data:D.daily.newUsers, backgroundColor:"rgba(22,163,74,.55)", borderRadius:3 } ] }, options: base() });

new Chart(cSess, { data:{ labels:D.daily.labels, datasets:[
    { type:"bar", label:"セッション", data:D.daily.sessions, yAxisID:"y", backgroundColor:"rgba(37,99,235,.45)", borderRadius:3, order:2 },
    { type:"line", label:"ページビュー", data:D.daily.pv, yAxisID:"y1", borderColor:"#dc2626", backgroundColor:"rgba(220,38,38,.06)", fill:false, tension:.25, pointRadius:0, borderWidth:2, order:1 } ] },
  options: base({ plugins:{ legend:{ display:true, labels:{boxWidth:12,font:{size:10}} } },
    scales:{ x:{grid:{display:false},ticks:{font:{size:10}}}, y:{position:"left",beginAtZero:true,grid:{color:"#eef0f3"},ticks:{font:{size:10}}}, y1:{position:"right",beginAtZero:true,grid:{display:false},ticks:{font:{size:10}}} } }) });

new Chart(cEng, { type:"line", data:{ labels:D.daily.labels, datasets:[
    { label:"エンゲージメント率", data:D.daily.engRate, borderColor:C.teal, backgroundColor:"rgba(13,148,136,.08)", fill:true, tension:.3, pointRadius:2, borderWidth:2 } ] },
  options: base({ scales:{ x:{grid:{display:false},ticks:{font:{size:10}}}, y:{beginAtZero:false,grid:{color:"#eef0f3"},ticks:{font:{size:10},callback:(v)=>v+"%"}} } }) });

new Chart(cRolling, { type:"line", data:{ labels:D.rollingTrend.labels, datasets:[
    { label:"DAU", data:D.rollingTrend.dau, borderColor:C.purple, borderWidth:2, pointRadius:2, tension:.3 },
    { label:"WAU", data:D.rollingTrend.wau, borderColor:C.blue, borderWidth:2, pointRadius:2, tension:.3 },
    { label:"MAU", data:D.rollingTrend.mau, borderColor:C.green, borderWidth:2, pointRadius:2, tension:.3 } ] },
  options: base({ plugins:{ legend:{ display:true, labels:{boxWidth:12,font:{size:10}} } }, scales:{ x:{grid:{display:false},ticks:{font:{size:10}}}, y:{beginAtZero:true,grid:{color:"#eef0f3"},ticks:{font:{size:10}}} } }) });

/* ---- D. 流入元 ---- */
new Chart(cChDoughnut, { type:"doughnut", data:{ labels:D.acquisition.map(a=>a.channel), datasets:[
    { data:D.acquisition.map(a=>a.sessions), backgroundColor:D.acquisition.map(a=>chColor(a.channel)), borderWidth:0 } ] },
  options:{ responsive:true, maintainAspectRatio:false, cutout:"58%",
    plugins:{ legend:{ position:"right", labels:{boxWidth:12,font:{size:11}} },
      tooltip:{ callbacks:{ label:(c)=>{const tot=D.acquisition.reduce((a,b)=>a+b.sessions,0); return " "+c.label+": "+fmt(c.parsed)+"（"+(tot?((c.parsed/tot)*100).toFixed(1):0)+"%）";} } } } } });

new Chart(cChBar, { type:"bar", data:{ labels:D.acquisition.map(a=>a.channel), datasets:[
    { data:D.acquisition.map(a=>a.newUsers), backgroundColor:D.acquisition.map(a=>chColor(a.channel)), borderRadius:3 } ] },
  options: hbar({ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=>" 新規 "+fmt(c.parsed.x)+"／セッション "+fmt(D.acquisition[c.dataIndex].sessions) } } } }) });

/* ---- E. 主要イベント（上位15＋折りたたみ・列見出しで並び替え） ---- */
(function(){
  const maxC = Math.max(1, ...D.events.map(r=>r.count));
  const kbadge = (key)=> key>0 ? '<span class="badge key">キー</span>' : '<span class="badge no">—</span>';
  const row = (r)=> '<tr><td class="l"><span class="bar" style="width:'+Math.round((r.count/maxC)*60)+'px"></span>'+esc(r.name)+'</td><td>'+fmt(r.count)+'</td><td>'+(r.key>0?fmt(r.key):'<span style="color:#9097a1">0</span>')+'</td><td>'+kbadge(r.key)+'</td></tr>';
  const num = (v)=> (v == null ? -Infinity : v);
  const ths = [].slice.call(document.querySelectorAll('th.sortable'));
  let curKey = "count", curDir = -1;
  function render(){
    const sorted = D.events.slice().sort(function(a,b){
      const av = num(a[curKey]), bv = num(b[curKey]);
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return curDir === 1 ? c : -c;
    });
    document.getElementById("evtRows").innerHTML = sorted.slice(0,15).map(row).join("");
    const rest = sorted.slice(15);
    const mw = document.getElementById("moreWrap");
    if (rest.length) {
      mw.style.display = "block";
      document.getElementById("moreSummary").textContent = "残り "+rest.length+" 件を表示";
      document.getElementById("evtRowsMore").innerHTML = rest.map(row).join("");
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
  const html = TEMPLATE.replace("/*__DATA__*/", () => dataJson).replace("/*__AI__*/", () => aiJson);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");
  console.log("[OK] inner written: " + OUT + " (" + html.length + " bytes) ｜ AI=" + (aiProvided ? "あり(Claude)" : "なし(自動ハイライト)") + " ｜ イベント " + (D.events ? D.events.length : 0) + "件");
}

main();
