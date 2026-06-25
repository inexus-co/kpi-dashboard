#!/usr/bin/env node
/*
 * build-ga4.js  —  compute 専任（build-social.js と同じ「集計→JSON出力」方式）
 * GA4(Web分析: kids.inexus-co.com) の日次スナップショット履歴を更新し、
 * ダッシュボード描画用データ(D)と Slack通知用データを出力する。
 * HTMLは作らない（描画は render-ga4.js、暗号化は encrypt-wrap.js）。
 *
 * 【履歴の意味】GA4 Data API はレポート集合を返す。dailyTrend は直近7日を毎回返すが、
 *   ローリング活性(WAU/MAU)は「昨日基準の単日値」しか返らないため、日々のスナップショットを
 *   history.json に蓄積（同一dateは置換＝冪等）して WAU/MAU の推移を時系列化する。
 *   history.json は auto/cache/ga4/ 配下（gitignore）。ga4-publish.sh が auto/cache-ga4.enc
 *   （CACHE_KEY）として永続化・コミットする。
 *
 * 入力 : <history.json>   … 過去の日次スナップショット配列（無ければ空で開始。実行後に当日分を追記して書き戻す）
 *        <snapshot.json>  … ga4-fetch.js が出力した当日スナップショット（GA4_OUT）
 * 出力 : <out_data.json>  … 描画用データ D（render-ga4.js が焼き込む）
 *        <out_notify.json>… Slack通知用の要約
 *        <history.json>   … 当日分を追記して上書き
 *
 * 使い方: node auto/build/build-ga4.js <history.json> <snapshot.json> <out_data.json> <out_notify.json> [updated]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [, , HIST, SNAP, OUT_DATA, OUT_NOTIFY, updatedArg] = process.argv;
if (!HIST || !SNAP || !OUT_DATA || !OUT_NOTIFY) {
  console.error("usage: node build-ga4.js <history.json> <snapshot.json> <out_data.json> <out_notify.json> [updated]");
  process.exit(1);
}

// GA4 metricValues は文字列で返る
const N = (v) => (v === null || v === undefined || v === "" ? 0 : Math.round(Number(v)));
const F = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const round1 = (x) => Math.round(x * 10) / 10;
const mdGa4 = (s) => { const t = String(s); return t.length === 8 ? `${+t.slice(4, 6)}/${+t.slice(6, 8)}` : t; }; // 'YYYYMMDD' -> M/D
const mdHist = (d) => { const a = String(d).split("-"); return a.length === 3 ? `${+a[1]}/${+a[2]}` : d; };           // 'YYYY-MM-DD' -> M/D
// fetchedAt(ISO/UTC) -> JST の YYYY-MM-DD（冪等キー）。en-CA は YYYY-MM-DD 形式
const jstDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
function movAvg(arr, w = 7) {
  return arr.map((_, i) => {
    const s = Math.max(0, i - w + 1);
    const chunk = arr.slice(s, i + 1);
    return Math.round((chunk.reduce((a, b) => a + b, 0) / chunk.length) * 10) / 10;
  });
}

// ---------- 履歴から集計してダッシュボードデータ(D)を作る ----------
function buildData(history, updated) {
  const L = history.length - 1;
  const latest = history[L] || {};
  const ref7 = Math.max(0, L - 7); // 約7日前のスナップショット（日次運用前提・index基準）

  // ローリング活性の時系列（history を貯めるほど厚くなる）
  const rollDau = history.map((h) => N(h.rolling && h.rolling.dau));
  const rollWau = history.map((h) => N(h.rolling && h.rolling.wau));
  const rollMau = history.map((h) => N(h.rolling && h.rolling.mau));

  // 日次トレンド（GA4が直接 date別に返す＝初日から7日分見える）
  const dt = Array.isArray(latest.dailyTrend) ? latest.dailyTrend : [];
  const daily = {
    labels: dt.map((r) => mdGa4(r.date)),
    activeUsers: dt.map((r) => N(r.activeUsers)),
    newUsers: dt.map((r) => N(r.newUsers)),
    sessions: dt.map((r) => N(r.sessions)),
    pv: dt.map((r) => N(r.screenPageViews)),
    engRate: dt.map((r) => round1(F(r.engagementRate) * 100)), // 0.54 -> 54.0(%)
    avgEngSec: dt.map((r) => (N(r.activeUsers) ? Math.round(N(r.userEngagementDuration) / N(r.activeUsers)) : 0)),
  };
  daily.activeMa = movAvg(daily.activeUsers);

  // 流入元（fetch側で sessions 降順済み）
  const acquisition = (Array.isArray(latest.acquisition) ? latest.acquisition : []).map((r) => ({
    channel: r.sessionDefaultChannelGroup || "(other)",
    sessions: N(r.sessions), newUsers: N(r.newUsers), activeUsers: N(r.activeUsers),
  }));

  // 主要イベント（fetch側で eventCount 降順済み）
  const events = (Array.isArray(latest.events) ? latest.events : []).map((r) => ({
    name: r.eventName || "(unknown)", count: N(r.eventCount), key: N(r.keyEvents),
  }));

  const dau = N(latest.rolling && latest.rolling.dau);
  const wau = N(latest.rolling && latest.rolling.wau);
  const mau = N(latest.rolling && latest.rolling.mau);
  const hasHistory = history.length >= 2;
  const lastDate = dt.length ? mdGa4(dt[dt.length - 1].date) : (latest.date || "-");

  return {
    generated_at: updated,
    last_date: lastDate,          // 最新「データ日」（dailyTrendの末日 = 通常は前日）
    fetch_date: latest.date || "-", // 取得日(JST)
    has_history: hasHistory,
    days: history.length,
    kpi: {
      dau, wau, mau,
      stickiness: mau ? round1((dau / mau) * 100) : 0,
      dau_7d: hasHistory ? rollDau[L] - rollDau[ref7] : null,
      wau_7d: hasHistory ? rollWau[L] - rollWau[ref7] : null,
      mau_7d: hasHistory ? rollMau[L] - rollMau[ref7] : null,
    },
    daily,
    rollingTrend: { labels: history.map((h) => mdHist(h.date)), dau: rollDau, wau: rollWau, mau: rollMau },
    acquisition,
    events,
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

  // 2) 当日スナップショットを追記（冪等キー date=取得日(JST)。同一dateは置換）
  let snap;
  try { snap = JSON.parse(fs.readFileSync(SNAP, "utf8")); }
  catch (e) { console.error("[ERROR] snapshot の JSON 解析に失敗: " + e.message); process.exit(1); }
  if (!snap || !snap.fetchedAt) { console.error("[ERROR] snapshot に fetchedAt がありません。"); process.exit(1); }
  snap.date = jstDate(snap.fetchedAt); // 冪等キーを付与（ga4-fetch.js は date を持たない）
  const idx = history.findIndex((h) => h.date === snap.date);
  if (idx >= 0) history[idx] = snap; else history.push(snap);
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 3) 履歴を書き戻す（ga4-publish.sh が cache-ga4.enc として封緘）
  fs.mkdirSync(path.dirname(HIST), { recursive: true });
  fs.writeFileSync(HIST, JSON.stringify(history), "utf8");

  // 4) 集計データを出力
  const updated = updatedArg || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const data = buildData(history, updated);
  fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
  fs.writeFileSync(OUT_DATA, JSON.stringify(data), "utf8");

  // 5) Slack通知用の要約
  const k = data.kpi;
  const topCh = data.acquisition[0] || null;
  const topEv = data.events[0] || null;
  const notify = {
    date: data.last_date,
    fetch_date: data.fetch_date,
    has_history: data.has_history,
    days: data.days,
    kpi: { dau: k.dau, wau: k.wau, mau: k.mau, stickiness: k.stickiness, dau_7d: k.dau_7d, wau_7d: k.wau_7d, mau_7d: k.mau_7d },
    top_channel: topCh ? { channel: topCh.channel, sessions: topCh.sessions } : null,
    top_event: topEv ? { name: topEv.name, count: topEv.count } : null,
  };
  fs.mkdirSync(path.dirname(OUT_NOTIFY), { recursive: true });
  fs.writeFileSync(OUT_NOTIFY, JSON.stringify(notify), "utf8");

  const fd = (v) => (v == null ? "—" : (v >= 0 ? "+" + v.toLocaleString("ja-JP") : v.toLocaleString("ja-JP")));
  console.log(`[OK] data=${OUT_DATA} notify=${OUT_NOTIFY} ｜ 履歴 ${history.length}日分`);
  console.log(`SUMMARY: Web分析(GA4) ｜ 最終データ日 ${data.last_date} ｜ DAU ${k.dau.toLocaleString("ja-JP")}（7日 ${fd(k.dau_7d)}）｜ WAU ${k.wau.toLocaleString("ja-JP")} ｜ MAU ${k.mau.toLocaleString("ja-JP")} ｜ 粘着度 ${k.stickiness}% ｜ 主要流入 ${topCh ? topCh.channel : "—"} ｜ 主要イベント ${topEv ? topEv.name : "—"}`);
}

main();
