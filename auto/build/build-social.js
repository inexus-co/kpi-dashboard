#!/usr/bin/env node
/*
 * build-social.js
 * ソーシャル分析（YouTube）ダッシュボードの「内側HTML(平文)」を生成する。
 * データは生成時に焼き込み、描画は Chart.js。暗号化は別途 encrypt-wrap.js が担当する
 * （既存の build-kids.js / build-saiten.js と同じ「inner生成 → encrypt-wrap」方式）。
 *
 * 【日次の伸びの出し方】YouTube API は「現時点の累計値」しか返さないため、日々の
 *   スナップショットを履歴(history.json)に蓄積し、前日との差分から日次の増分を算出する。
 *   このスクリプトが当日スナップショットを history.json に追記（同一dateは置換＝冪等）して書き戻す。
 *   history.json は auto/cache/ 配下（gitignore）に置き、social-publish.sh が
 *   auto/cache-social.enc（CACHE_KEY で暗号化）として永続化・コミットする。
 *
 * 入力 : <history.json>   … 過去の日次スナップショット配列（無ければ空配列で開始。実行後に当日分を追記して書き戻す）
 *        <snapshot.json>  … social-fetch.js が出力した当日スナップショット
 * 出力 : <out_inner.html> … 平文の自己完結ダッシュボードHTML（encrypt-wrap.js の入力）
 *        <history.json>   … 当日分を追記して上書き
 *
 * 使い方: node auto/build/build-social.js <history.json> <snapshot.json> <out_inner.html> [updated]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [, , HIST, SNAP, OUT, updatedArg] = process.argv;
if (!HIST || !SNAP || !OUT) {
  console.error("usage: node build-social.js <history.json> <snapshot.json> <out_inner.html> [updated]");
  process.exit(1);
}

const md = (d) => { const a = String(d).split("-"); return a.length === 3 ? `${+a[1]}/${+a[2]}` : d; };

// ---------- 履歴から集計してダッシュボードデータを作る ----------
function buildData(history, updated) {
  const dates = history.map((h) => h.date);
  const yt = history.map((h) => (h.youtube || {}));
  const subs = yt.map((y) => (y.channel ? y.channel.subscribers || 0 : 0));
  const views = yt.map((y) => (y.channel ? y.channel.views || 0 : 0));
  const vcount = yt.map((y) => (y.channel ? y.channel.videos || 0 : 0));
  const delta = (arr) => arr.map((v, i) => (i === 0 ? null : v - arr[i - 1]));
  const subsDelta = delta(subs);
  const viewsDelta = delta(views);

  const L = history.length - 1;
  const ref7 = Math.max(0, L - 7); // 約7日前のスナップショット（日次運用前提・index基準）
  const latestVids = (yt[L] && yt[L].videos ? yt[L].videos : []).slice();

  function viewsAt(snapIndex, id) {
    const s = yt[snapIndex];
    if (!s || !s.videos) return null;
    const f = s.videos.find((v) => v.id === id);
    return f ? f.views : null;
  }

  const rows = latestVids.map((v) => {
    const prev = viewsAt(ref7, v.id);
    const d7 = prev == null ? null : v.views - prev;
    const eng = v.views ? Math.round(((v.likes + v.comments) / v.views) * 1000) / 10 : 0;
    return { title: v.title, views: v.views, likes: v.likes, comments: v.comments, d7, eng, publishedAt: v.publishedAt };
  }).sort((a, b) => b.views - a.views);

  const top = rows.slice(0, 10);

  return {
    generated_at: updated,
    last_date: dates[L] || "-",
    has_history: history.length >= 2,
    days: history.length,
    kpi: {
      subscribers: subs[L] || 0,
      subs_delta: subsDelta[L],
      subs_7d: L > 0 ? subs[L] - subs[ref7] : null,
      total_views: views[L] || 0,
      views_delta: viewsDelta[L],
      views_7d: L > 0 ? views[L] - views[ref7] : null,
      video_count: vcount[L] || 0,
    },
    trend: { labels: dates.map(md), subs, subsDelta, views, viewsDelta },
    top: { labels: top.map((r) => r.title), views: top.map((r) => r.views) },
    table: rows,
  };
}

// ---------- 内側HTML（平文・パスワードゲートなし。encrypt-wrap.js が暗号化ゲートを付与） ----------
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
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif; background:#f7f8fa; color:#1a1d23; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1180px; margin:0 auto; padding:24px 20px 64px; }
  header h1 { font-size:20px; margin:0 0 4px; font-weight:700; }
  header .sub { color:#6b7280; font-size:13px; }
  .asof { color:#6b7280; font-size:12px; margin-top:6px; }
  .notice { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; border-radius:10px; padding:10px 14px; font-size:12.5px; margin:16px 0 0; }
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
  .chartbox.sm { height:300px; }
  table.vids { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.vids th, table.vids td { padding:8px 10px; border-bottom:1px solid #eef0f3; text-align:right; white-space:nowrap; }
  table.vids th { color:#6b7280; font-weight:600; font-size:11px; }
  table.vids th.l, table.vids td.l { text-align:left; white-space:normal; }
  table.vids td.l { max-width:380px; }
  table.vids tbody tr:hover { background:#fafbfc; }
  .pos { color:#16a34a; } .zero { color:#9097a1; }
  footer { color:#9097a1; font-size:11px; margin-top:28px; text-align:center; }
  @media (max-width:760px){ .charts { grid-template-columns:1fr; } }
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
  <div class="grid kpis" id="kpis"></div>
  <div class="grid charts">
    <div class="card"><h3>総再生数の日次増分</h3><p class="hint">棒：1日に増えた再生数（チャンネル全体）</p><div class="chartbox"><canvas id="viewsDeltaChart"></canvas></div></div>
    <div class="card"><h3>チャンネル登録者数の推移</h3><p class="hint">線：累計登録者数</p><div class="chartbox"><canvas id="subsChart"></canvas></div></div>
    <div class="card"><h3>新規登録者数（日次）</h3><p class="hint">棒：1日に増えた登録者数</p><div class="chartbox"><canvas id="subsDeltaChart"></canvas></div></div>
    <div class="card"><h3>動画別 総再生数 トップ10</h3><p class="hint">現時点の累計再生数が多い動画</p><div class="chartbox"><canvas id="topChart"></canvas></div></div>
    <div class="card full">
      <h3>動画別 実績一覧</h3><p class="hint">累計の再生数・いいね・コメントと、直近7日の再生増分／エンゲージメント率（(いいね+コメント)÷再生数）</p>
      <div style="overflow-x:auto">
        <table class="vids">
          <thead><tr><th class="l">動画</th><th>総再生数</th><th>いいね</th><th>コメント</th><th>7日の再生増分</th><th>エンゲージ率</th></tr></thead>
          <tbody id="vidRows"></tbody>
        </table>
      </div>
    </div>
  </div>
  <footer>generated by cloud routine — データソース: YouTube Data API</footer>
</div>
<script>
const D = /*__DATA__*/;
const fmt = x => Number(x).toLocaleString("ja-JP");
const C = { red:"#dc2626", blue:"#2563eb", green:"#16a34a", amber:"#d97706", purple:"#7c3aed" };
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = v => v == null ? '<span class="zero">—</span>' : (v > 0 ? '<span class="pos">+'+fmt(v)+'</span>' : (v === 0 ? '<span class="zero">0</span>' : fmt(v)));
const d = (v) => v == null ? "—" : (v >= 0 ? "+"+fmt(v) : fmt(v));

document.getElementById("asof").textContent = "最終データ日: " + D.last_date + " ／ 生成: " + D.generated_at + " ／ 蓄積 " + D.days + "日分";
if (!D.has_history) {
  const nt = document.getElementById("notice");
  nt.style.display = "block";
  nt.textContent = "データ蓄積中です。日次の伸び（増分）は2日目以降から表示されます。現在は累計値のみ表示しています。";
}
const k = D.kpi;
const card = (l,v,m)=> '<div class="card kpi"><div class="label">'+l+'</div><div class="value">'+v+'</div><div class="meta">'+m+'</div></div>';
document.getElementById("kpis").innerHTML =
  card("チャンネル登録者数", fmt(k.subscribers), "直近7日 <strong>"+d(k.subs_7d)+"</strong>") +
  card("総再生数（累計）", fmt(k.total_views), "直近7日 <strong>"+d(k.views_7d)+"</strong>") +
  card("総再生数（前日比）", d(k.views_delta), "1日に増えた再生数") +
  card("公開動画数", fmt(k.video_count), "新規登録者(前日比) <strong>"+d(k.subs_delta)+"</strong>");

const base = (extra={}) => Object.assign({ responsive:true, maintainAspectRatio:false,
  plugins:{ legend:{ display:false } },
  scales:{ x:{ grid:{display:false}, ticks:{font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:10} }, y:{ beginAtZero:true, grid:{color:"#eef0f3"}, ticks:{font:{size:10}} } } }, extra);

new Chart(viewsDeltaChart, { data:{ labels:D.trend.labels, datasets:[
  { type:"bar", label:"日次再生増分", data:D.trend.viewsDelta, backgroundColor:"rgba(220,38,38,.6)", borderRadius:3 } ] }, options: base() });

new Chart(subsChart, { type:"line", data:{ labels:D.trend.labels, datasets:[
  { label:"登録者数", data:D.trend.subs, borderColor:C.blue, backgroundColor:"rgba(37,99,235,.08)", fill:true, tension:.25, pointRadius:0, borderWidth:2 } ] },
  options: base({ scales:{ x:{grid:{display:false},ticks:{font:{size:10},autoSkip:true,maxTicksLimit:9}}, y:{beginAtZero:false,grid:{color:"#eef0f3"},ticks:{font:{size:10}}} } }) });

new Chart(subsDeltaChart, { data:{ labels:D.trend.labels, datasets:[
  { type:"bar", label:"新規登録者", data:D.trend.subsDelta, backgroundColor:"rgba(22,163,74,.55)", borderRadius:3 } ] }, options: base() });

new Chart(topChart, { type:"bar", data:{ labels:D.top.labels, datasets:[
  { label:"総再生数", data:D.top.views, backgroundColor:"rgba(124,58,237,.65)", borderRadius:3 } ] },
  options: base({ indexAxis:"y",
    scales:{ x:{beginAtZero:true,grid:{color:"#eef0f3"},ticks:{font:{size:10}}}, y:{grid:{display:false},ticks:{font:{size:10},autoSkip:false,callback:function(v){ const t=this.getLabelForValue(v); return t.length>22?t.slice(0,22)+"…":t; }}} } }) });

document.getElementById("vidRows").innerHTML = D.table.map(r =>
  '<tr><td class="l">'+esc(r.title)+'</td><td>'+fmt(r.views)+'</td><td>'+fmt(r.likes)+'</td><td>'+fmt(r.comments)+'</td><td>'+signed(r.d7)+'</td><td>'+r.eng+'%</td></tr>'
).join("");
</script>
</body>
</html>
`;

function main() {
  // 1) 履歴ロード（無ければ空配列）
  let history = [];
  if (fs.existsSync(HIST)) {
    try {
      const decoded = JSON.parse(fs.readFileSync(HIST, "utf8"));
      if (Array.isArray(decoded)) history = decoded;
    } catch (e) {
      console.error("[ERROR] history.json の JSON 解析に失敗: " + e.message);
      process.exit(1);
    }
  }

  // 2) 当日スナップショットを追記（同一 date は置換＝冪等）
  let snap;
  try { snap = JSON.parse(fs.readFileSync(SNAP, "utf8")); }
  catch (e) { console.error("[ERROR] snapshot の JSON 解析に失敗: " + e.message); process.exit(1); }
  if (!snap || !snap.date) { console.error("[ERROR] snapshot に date がありません。"); process.exit(1); }

  const idx = history.findIndex((h) => h.date === snap.date);
  if (idx >= 0) history[idx] = snap; else history.push(snap);
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 3) 履歴を書き戻す（social-publish.sh が cache-social.enc として封緘・永続化）
  fs.mkdirSync(path.dirname(HIST), { recursive: true });
  fs.writeFileSync(HIST, JSON.stringify(history), "utf8");

  // 4) 内側HTML生成（データを焼き込み。'<' を < に退避して </script> 等での破断を防ぐ）
  const updated = updatedArg || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const data = buildData(history, updated);
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const html = TEMPLATE.replace("/*__DATA__*/", json);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");

  const kk = data.kpi;
  const fd = (v) => (v == null ? "—" : (v >= 0 ? "+" + v.toLocaleString("ja-JP") : v.toLocaleString("ja-JP")));
  console.log(`[OK] inner written: ${OUT} (${html.length} bytes) ｜ 履歴 ${history.length}日分`);
  console.log(`SUMMARY: YouTube分析 ｜ 最終データ日 ${data.last_date} ｜ 登録者 ${kk.subscribers.toLocaleString("ja-JP")}（7日 ${fd(kk.subs_7d)}）｜ 総再生 ${kk.total_views.toLocaleString("ja-JP")}（前日比 ${fd(kk.views_delta)}）｜ 動画 ${kk.video_count}本`);
}

main();
