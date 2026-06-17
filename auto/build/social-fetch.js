#!/usr/bin/env node
/*
 * social-fetch.js
 * YouTube Data API v3 から「現時点の累計値」を1スナップショットとして取得し、出力JSONに書き出す。
 * 日次の「伸び」は build-social.js が日々のスナップショットを履歴に蓄積し、前日との差分から算出する。
 * （既存の parse-feedback.js / parse-puzzle.js と同じ「取得→ファイル出力」方式）
 *
 * 取得する公開統計（OAuth不要・APIキーのみ）:
 *   - チャンネル: subscriberCount / viewCount / videoCount
 *   - 動画ごと : title / publishedAt / viewCount / likeCount / commentCount
 *
 * 必須環境変数:
 *   YOUTUBE_API_KEY    … Google Cloud で発行した YouTube Data API v3 のAPIキー
 *   YOUTUBE_CHANNEL_ID … 対象チャンネルID（UC... 形式）
 *
 * 使い方: node auto/build/social-fetch.js <out_snapshot.json>
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const [, , OUT] = process.argv;
if (!OUT) { console.error("usage: node social-fetch.js <out_snapshot.json>"); process.exit(1); }

const API = "https://www.googleapis.com/youtube/v3";

function todayJST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => {
        let j;
        try { j = JSON.parse(body); } catch (e) { return reject(new Error("JSON解析失敗: " + e.message)); }
        if (r.statusCode >= 400) {
          const msg = (j.error && j.error.message) || ("HTTP " + r.statusCode);
          return reject(new Error("YouTube API エラー: " + msg));
        }
        resolve(j);
      });
    }).on("error", reject);
  });
}

const num = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v)) || 0);

async function main() {
  const KEY = process.env.YOUTUBE_API_KEY;
  const CHANNEL = process.env.YOUTUBE_CHANNEL_ID;
  if (!KEY) { console.error("[ERROR] 環境変数 YOUTUBE_API_KEY が未設定です。"); process.exit(1); }
  if (!CHANNEL) { console.error("[ERROR] 環境変数 YOUTUBE_CHANNEL_ID が未設定です。"); process.exit(1); }

  // 1) チャンネル統計＋アップロード用プレイリストID
  const ch = await getJSON(`${API}/channels?part=statistics,contentDetails&id=${encodeURIComponent(CHANNEL)}&key=${KEY}`);
  const chItem = ch.items && ch.items[0];
  if (!chItem) { console.error("[ERROR] チャンネルが見つかりません: " + CHANNEL); process.exit(1); }
  const st = chItem.statistics || {};
  const uploads = chItem.contentDetails &&
    chItem.contentDetails.relatedPlaylists &&
    chItem.contentDetails.relatedPlaylists.uploads;
  if (!uploads) { console.error("[ERROR] アップロード用プレイリストが取得できませんでした。"); process.exit(1); }

  // 2) アップロード動画IDを全件（ページング）
  const ids = [];
  let pageToken = "";
  do {
    const pl = await getJSON(`${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}&key=${KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : ""));
    for (const it of pl.items || []) {
      const id = it.contentDetails && it.contentDetails.videoId;
      if (id) ids.push(id);
    }
    pageToken = pl.nextPageToken || "";
  } while (pageToken);

  // 3) 動画統計を50件ずつ取得
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(",");
    const v = await getJSON(`${API}/videos?part=statistics,snippet&id=${batch}&key=${KEY}`);
    for (const it of v.items || []) {
      const s = it.statistics || {};
      const sn = it.snippet || {};
      videos.push({
        id: it.id,
        title: sn.title || "",
        publishedAt: sn.publishedAt || "",
        views: num(s.viewCount),       // 非公開時は0
        likes: num(s.likeCount),       // 非公開時は0
        comments: num(s.commentCount), // 非公開時は0
      });
    }
  }

  const snapshot = {
    date: todayJST(),
    youtube: {
      channel: {
        subscribers: num(st.subscriberCount), // 非公開設定だと0
        views: num(st.viewCount),
        videos: num(st.videoCount),
      },
      videos,
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2), "utf8");

  const c = snapshot.youtube.channel;
  console.log(`[OK] snapshot: ${OUT}`);
  console.log(`     date=${snapshot.date} subscribers=${c.subscribers} views=${c.views} videos=${c.videos} fetched_videos=${videos.length}`);
}

main().catch((e) => { console.error("[ERROR] " + (e && e.message ? e.message : e)); process.exit(1); });
