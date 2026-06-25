'use strict';

/**
 * ga4-fetch.js — GA4 Data API v1 直結フェッチ（ゼロ依存・Node標準ライブラリのみ）
 *
 * 既存 kpi-dashboard パイプライン（ステートレス・クリーンチェックアウト・npm依存ゼロ）に
 * 合わせ、サービスアカウントのJWTを crypto で自前署名 → oauth2 でトークン取得 →
 * analyticsdata.googleapis.com を https で叩く。npmレジストリ到達に依存しない。
 *
 * 認証情報（どちらか）:
 *   - GA4_SA_KEY_B64               : サービスアカウントJSONをbase64化した文字列（クラウドRoutine向け）
 *   - GOOGLE_APPLICATION_CREDENTIALS: サービスアカウントJSONのファイルパス（ローカル向け）
 *
 * その他:
 *   - GA4_PROPERTY_ID : 既定 289134520（kids.inexus-co.com）
 *   - GA4_OUT         : 指定すればスナップショットJSONをそのパスに書き出す（未指定なら stdout）
 *
 * 出力: 4種レポートを束ねたスナップショットJSON（dailyTrend / rolling / acquisition / events）。
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '289134520';
const TOKEN_HOST = 'oauth2.googleapis.com';
const DATA_HOST = 'analyticsdata.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

// ---- サービスアカウント鍵の読み込み（base64 env もしくは ファイルパス） ----
function loadServiceAccount() {
  if (process.env.GA4_SA_KEY_B64) {
    const raw = Buffer.from(process.env.GA4_SA_KEY_B64.replace(/\s/g, ''), 'base64').toString('utf8');
    return JSON.parse(raw);
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path && fs.existsSync(path)) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  }
  throw new Error('認証情報がありません。GA4_SA_KEY_B64 か GOOGLE_APPLICATION_CREDENTIALS を設定してください。');
}

// ---- base64url ----
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---- 汎用 HTTPS POST（JSON / form どちらも） ----
function httpsPost(host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path, method: 'POST', headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---- サービスアカウントJWT → アクセストークン ----
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: `https://${TOKEN_HOST}/token`, iat: now, exp: now + 3600 })
  );
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const form = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;
  const res = await httpsPost(TOKEN_HOST, '/token', { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }, form);
  if (res.status !== 200) {
    throw new Error(`token取得失敗 (HTTP ${res.status}): ${res.body}`);
  }
  return JSON.parse(res.body).access_token;
}

// ---- runReport ----
async function runReport(token, request) {
  const body = JSON.stringify(request);
  const res = await httpsPost(
    DATA_HOST,
    `/v1beta/properties/${PROPERTY_ID}:runReport`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body
  );
  if (res.status !== 200) {
    throw new Error(`runReport失敗 (HTTP ${res.status}): ${res.body}`);
  }
  return JSON.parse(res.body);
}

// レスポンスを {dimName/metName: value} の配列に整形
function toRows(report) {
  const dims = (report.dimensionHeaders || []).map((h) => h.name);
  const mets = (report.metricHeaders || []).map((h) => h.name);
  return (report.rows || []).map((row) => {
    const o = {};
    (row.dimensionValues || []).forEach((v, i) => (o[dims[i]] = v.value));
    (row.metricValues || []).forEach((v, i) => (o[mets[i]] = v.value));
    return o;
  });
}

async function main() {
  const sa = loadServiceAccount();
  const token = await getAccessToken(sa);

  // 1) 日次トレンド（直近7日）
  const daily = await runReport(token, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' },
      { name: 'screenPageViews' }, { name: 'engagementRate' }, { name: 'userEngagementDuration' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  // 2) ローリング DAU/WAU/MAU（単日レンジ=昨日基準で正しいスナップショット）
  const rollingRep = await runReport(token, {
    dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
    metrics: [{ name: 'active1DayUsers' }, { name: 'active7DayUsers' }, { name: 'active28DayUsers' }],
  });
  const rr = toRows(rollingRep)[0] || {};

  // 3) 獲得・流入元（直近28日）
  const acq = await runReport(token, {
    dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 15,
  });

  // 4) 主要イベント（直近28日）
  const events = await runReport(token, {
    dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'keyEvents' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 25,
  });

  const snapshot = {
    propertyId: PROPERTY_ID,
    fetchedAt: new Date().toISOString(),
    dailyTrend: toRows(daily),
    rolling: { dau: rr.active1DayUsers, wau: rr.active7DayUsers, mau: rr.active28DayUsers },
    acquisition: toRows(acq),
    events: toRows(events),
  };

  const json = JSON.stringify(snapshot, null, 2);
  if (process.env.GA4_OUT) {
    fs.writeFileSync(process.env.GA4_OUT, json);
    console.error(`✅ snapshot written → ${process.env.GA4_OUT}`);
  } else {
    process.stdout.write(json + '\n');
  }
  // 人が読む確認用サマリは stderr へ
  console.error(`✅ GA4 fetch OK (property ${PROPERTY_ID}) — DAU ${snapshot.rolling.dau} / WAU ${snapshot.rolling.wau} / MAU ${snapshot.rolling.mau}, dailyTrend ${snapshot.dailyTrend.length}日分, channels ${snapshot.acquisition.length}, events ${snapshot.events.length}`);
}

main().catch((err) => {
  const msg = (err && err.message) || String(err);
  console.error(`❌ ga4-fetch 失敗: ${msg}`);
  if (/HTTP 40[13]|PERMISSION_DENIED/.test(msg)) {
    console.error('ヒント: GA4管理画面「プロパティのアクセス管理」でサービスアカウントを「閲覧者」追加済みか確認。');
  } else if (/ENOTFOUND|ETIMEDOUT|getaddrinfo|EAI_AGAIN/.test(msg)) {
    console.error('ヒント: ネットワーク到達性の問題（クラウドsandboxのallowlist等）。analyticsdata/oauth2.googleapis.com への到達を確認。');
  }
  process.exitCode = 1;
});
