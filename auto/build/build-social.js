#!/usr/bin/env node
/*
 * build-social.js  —  compute 専任（既存 parse-feedback.js と同じ「集計→JSON出力」方式）
 * ソーシャル分析（YouTube）の履歴を更新し、ダッシュボード描画用データと Slack通知用データを出力する。
 * HTMLは作らない（描画は render-social.js、暗号化は encrypt-wrap.js）。
 *
 * 【日次の伸び】YouTube API は「現時点の累計値」しか返さないため、日々のスナップショットを
 *   履歴(history.json)に蓄積（同一dateは置換＝冪等）して前日差分から日次増分を出す。
 *   history.json は auto/cache/ 配下（gitignore）。social-publish.sh が auto/cache-social.enc
 *   （CACHE_KEY）として永続化・コミットする。
 *
 * 入力 : <history.json>   … 過去の日次スナップショット配列（無ければ空配列で開始。実行後に当日分を追記して書き戻す）
 *        <snapshot.json>  … social-fetch.js が出力した当日スナップショット
 * 出力 : <out_data.json>  … 描画用データ D（render-social.js が焼き込む）
 *        <out_notify.json>… Slack通知用の要約
 *        <history.json>   … 当日分を追記して上書き
 *
 * 使い方: node auto/build/build-social.js <history.json> <snapshot.json> <out_data.json> <out_notify.json> [updated]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [, , HIST, SNAP, OUT_DATA, OUT_NOTIFY, updatedArg] = process.argv;
if (!HIST || !SNAP || !OUT_DATA || !OUT_NOTIFY) {
  console.error("usage: node build-social.js <history.json> <snapshot.json> <out_data.json> <out_notify.json> [updated]");
  process.exit(1);
}

const md = (d) => { const a = String(d).split("-"); return a.length === 3 ? `${+a[1]}/${+a[2]}` : d; };
const round1 = (x) => Math.round(x * 10) / 10;
const engRate = (likes, comments, views) => (views ? round1(((likes + comments) / views) * 100) : 0);

// ---------- 履歴から集計してダッシュボードデータ(D)を作る ----------
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

  const viewsAt = (snapIndex, id) => {
    const s = yt[snapIndex];
    if (!s || !s.videos) return null;
    const f = s.videos.find((v) => v.id === id);
    return f ? f.views : null;
  };

  // 動画別の横断行（最新スナップショット）
  const rows = latestVids.map((v) => {
    const prev = viewsAt(ref7, v.id);
    const d7 = prev == null ? null : v.views - prev;
    return {
      title: v.title, views: v.views, likes: v.likes, comments: v.comments,
      d7, eng: engRate(v.likes, v.comments, v.views), publishedAt: v.publishedAt,
    };
  }).sort((a, b) => b.views - a.views);

  // 集計KPI
  const totalLikes = rows.reduce((a, r) => a + (r.likes || 0), 0);
  const totalComments = rows.reduce((a, r) => a + (r.comments || 0), 0);
  const totalViews = views[L] || rows.reduce((a, r) => a + (r.views || 0), 0);
  const videoCount = vcount[L] || rows.length;
  const avgViews = videoCount ? Math.round(totalViews / videoCount) : 0;
  const avgEng = totalViews ? round1(((totalLikes + totalComments) / totalViews) * 100) : 0;

  // 動画別 総再生トップ10
  const topViews = rows.slice(0, 10).map((r) => ({ title: r.title, views: r.views }));

  // エンゲージ率トップ10（極端な少数サンプルを除く: 全体平均再生の20%以上 or 最低100再生）
  const engThreshold = Math.max(100, Math.round(avgViews * 0.2));
  let engPool = rows.filter((r) => r.views >= engThreshold);
  if (engPool.length < 5) engPool = rows.slice(); // 母数が少なければ全件
  const topEng = engPool.slice().sort((a, b) => b.eng - a.eng).slice(0, 10)
    .map((r) => ({ title: r.title, eng: r.eng, views: r.views }));

  // 公開時期 × 再生数（bubble: x=公開epoch ms, y=再生数, r=エンゲージに応じたサイズ）
  const scatter = rows.filter((r) => r.publishedAt).map((r) => {
    const t = Date.parse(r.publishedAt);
    return { x: isNaN(t) ? null : t, y: r.views, r: Math.max(3, Math.min(16, 3 + r.eng * 2)), title: r.title };
  }).filter((p) => p.x != null);

  // 再生の集中度（トップ5 vs その他）
  const top5Sum = rows.slice(0, 5).reduce((a, r) => a + r.views, 0);
  const restSum = Math.max(0, (rows.reduce((a, r) => a + r.views, 0)) - top5Sum);
  const top5Titles = rows.slice(0, 5).map((r) => r.title);

  // 直近で伸びている動画（7日再生増分トップ。履歴2日目以降のみ）
  const growing = rows.filter((r) => r.d7 != null && r.d7 > 0)
    .sort((a, b) => b.d7 - a.d7).slice(0, 10)
    .map((r) => ({ title: r.title, d7: r.d7, views: r.views }));

  return {
    generated_at: updated,
    last_date: dates[L] || "-",
    has_history: history.length >= 2,
    days: history.length,
    kpi: {
      subscribers: subs[L] || 0,
      subs_delta: subsDelta[L],
      subs_7d: L > 0 ? subs[L] - subs[ref7] : null,
      total_views: totalViews,
      views_delta: viewsDelta[L],
      views_7d: L > 0 ? views[L] - views[ref7] : null,
      video_count: videoCount,
      avg_views: avgViews,
      total_likes: totalLikes,
      total_comments: totalComments,
      avg_engagement: avgEng,
    },
    // トレンド（render側で期間タブにより窓を絞る。dates=YYYY-MM-DD, labels=M/D）
    trend: { dates, labels: dates.map(md), subs, subsDelta, views, viewsDelta },
    topViews,
    topEng,
    scatter,
    concentration: {
      top5: top5Sum, rest: restSum,
      top5_share: (top5Sum + restSum) ? round1((top5Sum / (top5Sum + restSum)) * 100) : 0,
      top5_titles: top5Titles,
    },
    growing,
    table: rows,
  };
}

function main() {
  // 1) 履歴ロード（無ければ空）
  let history = [];
  if (fs.existsSync(HIST)) {
    try {
      const decoded = JSON.parse(fs.readFileSync(HIST, "utf8"));
      if (Array.isArray(decoded)) history = decoded;
    } catch (e) { console.error("[ERROR] history.json の JSON 解析に失敗: " + e.message); process.exit(1); }
  }

  // 2) 当日スナップショットを追記（同一dateは置換＝冪等）
  let snap;
  try { snap = JSON.parse(fs.readFileSync(SNAP, "utf8")); }
  catch (e) { console.error("[ERROR] snapshot の JSON 解析に失敗: " + e.message); process.exit(1); }
  if (!snap || !snap.date) { console.error("[ERROR] snapshot に date がありません。"); process.exit(1); }
  const idx = history.findIndex((h) => h.date === snap.date);
  if (idx >= 0) history[idx] = snap; else history.push(snap);
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 3) 履歴を書き戻す（social-publish.sh が cache-social.enc として封緘）
  fs.mkdirSync(path.dirname(HIST), { recursive: true });
  fs.writeFileSync(HIST, JSON.stringify(history), "utf8");

  // 4) 集計データを出力
  const updated = updatedArg || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const data = buildData(history, updated);
  fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
  fs.writeFileSync(OUT_DATA, JSON.stringify(data), "utf8");

  // 5) Slack通知用の要約
  const k = data.kpi;
  const topVideo = data.topViews[0] || null;
  const topGrowing = data.growing[0] || null;
  const notify = {
    date: data.last_date,
    has_history: data.has_history,
    days: data.days,
    kpi: {
      subscribers: k.subscribers, subs_delta: k.subs_delta, subs_7d: k.subs_7d,
      total_views: k.total_views, views_delta: k.views_delta, views_7d: k.views_7d,
      video_count: k.video_count, avg_views: k.avg_views,
      total_likes: k.total_likes, total_comments: k.total_comments, avg_engagement: k.avg_engagement,
    },
    top_video: topVideo ? { title: topVideo.title, views: topVideo.views } : null,
    top_growing: topGrowing ? { title: topGrowing.title, d7: topGrowing.d7 } : null,
  };
  fs.mkdirSync(path.dirname(OUT_NOTIFY), { recursive: true });
  fs.writeFileSync(OUT_NOTIFY, JSON.stringify(notify), "utf8");

  const fd = (v) => (v == null ? "—" : (v >= 0 ? "+" + v.toLocaleString("ja-JP") : v.toLocaleString("ja-JP")));
  console.log(`[OK] data=${OUT_DATA} notify=${OUT_NOTIFY} ｜ 履歴 ${history.length}日分`);
  console.log(`SUMMARY: YouTube分析 ｜ 最終データ日 ${data.last_date} ｜ 登録者 ${k.subscribers.toLocaleString("ja-JP")}（7日 ${fd(k.subs_7d)}）｜ 総再生 ${k.total_views.toLocaleString("ja-JP")}（前日比 ${fd(k.views_delta)}）｜ 動画 ${k.video_count}本 ｜ 平均再生 ${k.avg_views.toLocaleString("ja-JP")}／本 ｜ 平均エンゲージ ${k.avg_engagement}%`);
}

main();
