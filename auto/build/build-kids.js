#!/usr/bin/env node
/*
 * build-kids.js
 * まなんでパズル 利用実績ダッシュボードの「内側HTML(平文)」を生成する。
 * データは生成時に焼き込み、描画は Chart.js。暗号化は別途 encrypt-wrap.js が担当。
 * （既存の build-saiten.js / render-feedback.js と同じ「inner生成 → encrypt-wrap」方式）
 *
 * 入力 : <raw_dir>/<name>.json  … BigQuery execute_sql_readonly の返却JSONそのまま
 *        cumulative / platform / new_users / dau / creators / engagement
 * 出力 : <out_inner.html>        … 平文の自己完結ダッシュボードHTML
 *
 * 使い方: node auto/build/build-kids.js <raw_dir> <out_inner.html> [updated]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [, , RAW_DIR, OUT, updatedArg] = process.argv;
if (!RAW_DIR || !OUT) {
  console.error("usage: node build-kids.js <raw_dir> <out_inner.html> [updated]");
  process.exit(1);
}

// ---------- BigQuery結果のパース ----------
function unwrap(obj) {
  if (typeof obj === "string") obj = JSON.parse(obj);
  if (obj && typeof obj === "object") {
    if ("schema" in obj && "rows" in obj) return obj;
    if (obj.structuredContent) return unwrap(obj.structuredContent);
    if (Array.isArray(obj.content) && obj.content[0] && "text" in obj.content[0]) {
      return unwrap(obj.content[0].text);
    }
  }
  throw new Error("BigQuery結果の形式を認識できません");
}
function loadRows(name) {
  const obj = unwrap(JSON.parse(fs.readFileSync(path.join(RAW_DIR, name + ".json"), "utf8")));
  const fields = (obj.schema && obj.schema.fields ? obj.schema.fields : []).map((f) => f.name);
  return (obj.rows || []).map((row) => {
    const rec = {};
    (row.f || []).forEach((cell, i) => { rec[fields[i]] = cell.v; });
    return rec;
  });
}
const n = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v)));
const md = (d) => { const [, m, day] = d.split("-"); return `${+m}/${+day}`; };
function movAvg(arr, w = 7) {
  return arr.map((_, i) => {
    const s = Math.max(0, i - w + 1);
    const chunk = arr.slice(s, i + 1);
    return Math.round((chunk.reduce((a, b) => a + b, 0) / chunk.length) * 10) / 10;
  });
}

const PLAT_LABELS = { ios: "iOS", android: "Android", web: "Web", amazon: "Amazon", pwa: "PWA", webview: "WebView", unknown: "不明" };
const PLAT_COLORS = { ios: "#2563eb", android: "#16a34a", web: "#7c3aed", amazon: "#d97706", pwa: "#0d9488", webview: "#db2777", unknown: "#94a3b8" };
const ORDER = ["ios", "android", "web", "amazon", "pwa", "webview", "unknown"];

function buildData(updated) {
  const cum = loadRows("cumulative");
  const plat = loadRows("platform");
  const nu = loadRows("new_users");
  const dau = loadRows("dau");
  const creators = loadRows("creators");
  const eng = loadRows("engagement");

  const cumVals = cum.map((r) => n(r.count));
  const lastDate = cum.length ? cum[cum.length - 1].date : "-";
  const totalUsers = cumVals.length ? cumVals[cumVals.length - 1] : 0;
  const prev30 = cumVals.length > 30 ? cumVals[cumVals.length - 31] : (cumVals[0] || 0);
  const growth30 = totalUsers - prev30;

  const nuVals = nu.map((r) => n(r.count));
  const nuLatest = nuVals.length ? nuVals[nuVals.length - 1] : 0;
  const nuAvg7 = nuVals.length ? Math.round(nuVals.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, nuVals.length)) : 0;

  const dauVals = dau.map((r) => n(r.dau));
  const dauLatest = dauVals.length ? dauVals[dauVals.length - 1] : 0;
  const dauAvg7 = dauVals.length ? Math.round(dauVals.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, dauVals.length)) : 0;

  let creatorBase = 0;
  if (creators.length) creatorBase = n(creators.reduce((a, b) => (b.date > a.date ? b : a)).c);
  const creatorRate = totalUsers ? Math.round((creatorBase / totalUsers) * 1000) / 10 : 0;

  const platLatestDate = plat.reduce((m, r) => (r.date > m ? r.date : m), plat.length ? plat[0].date : "");
  const platLatest = plat.filter((r) => r.date === platLatestDate)
    .sort((a, b) => (ORDER.indexOf(a.env) + 1 || 99) - (ORDER.indexOf(b.env) + 1 || 99));

  return {
    generated_at: updated,
    last_date: lastDate,
    kpi: { total_users: totalUsers, growth30, new_latest: nuLatest, new_avg7: nuAvg7, dau_latest: dauLatest, dau_avg7: dauAvg7, creator_base: creatorBase, creator_rate: creatorRate },
    cumulative: { labels: cum.map((r) => md(r.date)), values: cumVals },
    platform: { labels: platLatest.map((r) => PLAT_LABELS[r.env] || r.env), values: platLatest.map((r) => n(r.count)), colors: platLatest.map((r) => PLAT_COLORS[r.env] || "#94a3b8") },
    new_users: { labels: nu.map((r) => md(r.date)), values: nuVals, ma: movAvg(nuVals) },
    dau: { labels: dau.map((r) => md(r.date)), values: dauVals, ma: movAvg(dauVals) },
    engagement: {
      labels: eng.map((r) => md(r.date)),
      created: eng.map((r) => n(r.created)), published: eng.map((r) => n(r.published)),
      favorited: eng.map((r) => n(r.favorited)), copied: eng.map((r) => n(r.copied)),
      prog: eng.map((r) => n(r.prog_cleared)), algo: eng.map((r) => n(r.algo_cleared)),
    },
  };
}

const TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>まなんでパズル 利用実績ダッシュボード</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js"></script>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif; background:#f7f8fa; color:#1a1d23; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1180px; margin:0 auto; padding:24px 20px 64px; }
  header h1 { font-size:20px; margin:0 0 4px; font-weight:700; }
  header .sub { color:#6b7280; font-size:13px; }
  .asof { color:#6b7280; font-size:12px; margin-top:6px; }
  .grid { display:grid; gap:16px; }
  .kpis { grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); margin:22px 0; }
  .card { background:#fff; border:1px solid #e7e9ee; border-radius:12px; padding:16px 18px; box-shadow:0 1px 2px rgba(16,24,40,.04); }
  .kpi .label { color:#6b7280; font-size:12px; font-weight:600; letter-spacing:.02em; }
  .kpi .value { font-size:28px; font-weight:700; margin-top:6px; line-height:1.1; }
  .kpi .meta { font-size:12px; color:#6b7280; margin-top:6px; }
  .kpi .meta strong { color:#1a1d23; }
  .charts { grid-template-columns:1fr 1fr; margin-bottom:16px; }
  .charts .full { grid-column:1 / -1; }
  .card h3 { margin:0 0 2px; font-size:14px; font-weight:700; }
  .card .hint { color:#9097a1; font-size:11px; margin:0 0 12px; }
  .chartbox { position:relative; height:240px; }
  .chartbox.sm { height:220px; }
  footer { color:#9097a1; font-size:11px; margin-top:28px; text-align:center; }
  @media (max-width:760px){ .charts { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>まなんでパズル 利用実績ダッシュボード</h1>
    <div class="sub">BigQuery <code>inexus-prod.kids_jp</code> の日次集計（毎日自動更新）</div>
    <div class="asof" id="asof"></div>
  </header>
  <div class="grid kpis" id="kpis"></div>
  <div class="grid charts">
    <div class="card"><h3>累計ユーザー数の推移</h3><p class="hint">登録ユーザーの累計（全プラットフォーム）・直近90日</p><div class="chartbox"><canvas id="cumChart"></canvas></div></div>
    <div class="card"><h3>プラットフォーム別ユーザー構成</h3><p class="hint">最新時点の累計ユーザーの内訳</p><div class="chartbox"><canvas id="platChart"></canvas></div></div>
    <div class="card"><h3>新規ユーザー数（日次）</h3><p class="hint">棒：日次新規登録／線：7日移動平均・直近30日</p><div class="chartbox"><canvas id="newChart"></canvas></div></div>
    <div class="card"><h3>DAU（日次アクティブユーザー）</h3><p class="hint">線：DAU／点線：7日移動平均・直近30日</p><div class="chartbox"><canvas id="dauChart"></canvas></div></div>
    <div class="card full"><h3>学習エンゲージメント（日次）</h3><p class="hint">コースのクリア数とアウトプット量・直近30日</p><div class="chartbox sm"><canvas id="engChart"></canvas></div></div>
    <div class="card full"><h3>作品アクション（日次）</h3><p class="hint">新規作品作成／公開／お気に入り／コピー・直近30日</p><div class="chartbox sm"><canvas id="projChart"></canvas></div></div>
  </div>
  <footer>generated by cloud routine — データソース: BigQuery inexus-prod.kids_jp</footer>
</div>
<script>
const D = /*__DATA__*/;
const fmt = x => Number(x).toLocaleString("ja-JP");
const C = { blue:"#2563eb", green:"#16a34a", amber:"#d97706", purple:"#7c3aed", pink:"#db2777", teal:"#0d9488" };
document.getElementById("asof").textContent = "最終データ日: " + D.last_date + " ／ 生成: " + D.generated_at;
const k = D.kpi;
const card = (l,v,m)=> '<div class="card kpi"><div class="label">'+l+'</div><div class="value">'+v+'</div><div class="meta">'+m+'</div></div>';
document.getElementById("kpis").innerHTML =
  card("累計ユーザー数", fmt(k.total_users), "直近30日で <strong>+"+fmt(k.growth30)+"</strong>") +
  card("新規ユーザー / 日", fmt(k.new_latest), "7日平均 <strong>"+fmt(k.new_avg7)+"</strong>") +
  card("DAU（直近）", fmt(k.dau_latest), "7日平均 <strong>"+fmt(k.dau_avg7)+"</strong>") +
  card("作品クリエイター累計", fmt(k.creator_base), "全ユーザーの <strong>"+k.creator_rate+"%</strong>");
const base = (extra={}) => Object.assign({ responsive:true, maintainAspectRatio:false,
  plugins:{ legend:{ labels:{ boxWidth:12, font:{size:11} } } },
  scales:{ x:{ grid:{display:false}, ticks:{font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:10} }, y:{ beginAtZero:true, grid:{color:"#eef0f3"}, ticks:{font:{size:10}} } } }, extra);
new Chart(cumChart, { type:"line", data:{ labels:D.cumulative.labels, datasets:[{ label:"累計ユーザー", data:D.cumulative.values, borderColor:C.blue, backgroundColor:"rgba(37,99,235,.08)", fill:true, tension:.25, pointRadius:0, borderWidth:2 }] },
  options: base({ plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false},ticks:{font:{size:10},autoSkip:true,maxTicksLimit:9}}, y:{beginAtZero:false,grid:{color:"#eef0f3"},ticks:{font:{size:10}}} } }) });
new Chart(platChart, { type:"doughnut", data:{ labels:D.platform.labels, datasets:[{ data:D.platform.values, backgroundColor:D.platform.colors, borderWidth:0 }] },
  options:{ responsive:true, maintainAspectRatio:false, cutout:"58%", plugins:{ legend:{ position:"right", labels:{ boxWidth:12, font:{size:11} } }, tooltip:{ callbacks:{ label:(c)=> c.label+": "+fmt(c.parsed)+" ("+((c.parsed/D.platform.values.reduce((a,b)=>a+b,0))*100).toFixed(1)+"%)" } } } } });
new Chart(newChart, { data:{ labels:D.new_users.labels, datasets:[
    { type:"bar", label:"新規ユーザー", data:D.new_users.values, backgroundColor:"rgba(22,163,74,.55)", borderRadius:3, order:2 },
    { type:"line", label:"7日移動平均", data:D.new_users.ma, borderColor:C.green, borderWidth:2, pointRadius:0, tension:.3, order:1 } ] }, options: base() });
new Chart(dauChart, { type:"line", data:{ labels:D.dau.labels, datasets:[
    { label:"DAU", data:D.dau.values, borderColor:C.purple, backgroundColor:"rgba(124,58,237,.08)", fill:true, tension:.3, pointRadius:0, borderWidth:2 },
    { label:"7日移動平均", data:D.dau.ma, borderColor:C.amber, borderDash:[5,4], borderWidth:2, pointRadius:0, tension:.3 } ] }, options: base() });
new Chart(engChart, { data:{ labels:D.engagement.labels, datasets:[
    { type:"bar", label:"プログラム講座クリア", data:D.engagement.prog, backgroundColor:"rgba(37,99,235,.7)", stack:"s", borderRadius:2 },
    { type:"bar", label:"アルゴリズム講座クリア", data:D.engagement.algo, backgroundColor:"rgba(13,148,136,.7)", stack:"s", borderRadius:2 },
    { type:"line", label:"新規作品作成（純増）", data:D.engagement.created, borderColor:C.amber, borderWidth:2, pointRadius:0, tension:.3 } ] },
  options: base({ scales:{ x:{stacked:true,grid:{display:false},ticks:{font:{size:10},autoSkip:true,maxTicksLimit:12}}, y:{stacked:true,beginAtZero:true,grid:{color:"#eef0f3"},ticks:{font:{size:10}}} } }) });
new Chart(projChart, { type:"line", data:{ labels:D.engagement.labels, datasets:[
    { label:"公開", data:D.engagement.published, borderColor:C.blue, borderWidth:2, pointRadius:0, tension:.3 },
    { label:"お気に入り", data:D.engagement.favorited, borderColor:C.pink, borderWidth:2, pointRadius:0, tension:.3 },
    { label:"コピー", data:D.engagement.copied, borderColor:C.teal, borderWidth:2, pointRadius:0, tension:.3 } ] }, options: base() });
</script>
</body>
</html>
`;

function main() {
  const updated = updatedArg || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const data = buildData(updated);
  const html = TEMPLATE.replace("/*__DATA__*/", JSON.stringify(data));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");
  const k = data.kpi;
  console.log(`[OK] inner written: ${OUT} (${html.length} bytes)`);
  console.log(`SUMMARY: 最終データ日 ${data.last_date} ｜ 累計 ${k.total_users.toLocaleString("ja-JP")} (+${k.growth30}/30d) ｜ DAU ${k.dau_latest} (7日平均 ${k.dau_avg7}) ｜ 新規 ${k.new_latest}/日`);
}
main();
