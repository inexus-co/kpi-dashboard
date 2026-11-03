#!/usr/bin/env node
/**
 * ISEちゃん 利用レポート：ise-analysis.sql の9つのクエリを BigQuery で実行し、結果をそのままファイルに保存する。
 *
 * 使い方: node auto/build/ise-bq-fetch.js [auto/cache/ise-q]
 *   - 出力: <出力先>/<名前>.json（名前＝daily・hour・dow・purpose・unit・materials・recent・watch・watchconv）
 *     列名をキーにした行の配列。値は BigQuery が返した文字列のまま（書き写さない）。0件は []。
 *   - 画面に出すのは、クエリの名前と行数だけ（会話の本文は出さない）。
 *
 * なぜ（2026-11-03）：それまでは BigQuery のコネクタの結果を、毎朝 Claude がその場で決めたやり方で
 *   ファイルに写していた。手順に保存のしかたが無かったので、日によって「本文を書き写すのは危ない」と止まった
 *   （10/23・11/03）。コネクタは60秒で待つのをやめるので、時間のかかるクエリ（unit・watchconv）の扱いも揺れた。
 *   ⇒ スクリプトが直接ファイルに書く1本の道にした。
 *
 * 認証（上から順に使う）:
 *   - ISE_BQ_SA_KEY_B64              : BigQuery を読むだけのサービスアカウントの JSON を base64 にしたもの（クラウドのルーティン向け）
 *   - GOOGLE_APPLICATION_CREDENTIALS : サービスアカウントの JSON のファイル（手元向け）
 *   - どちらも無ければ gcloud のログイン（gcloud auth print-access-token・手元向け）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PROJECT = 'inexus-prod';
const LOCATION = 'asia-northeast1';
const NAMES = ['daily', 'hour', 'dow', 'purpose', 'unit', 'materials', 'recent', 'watch', 'watchconv'];
const SQL_PATH = path.join(__dirname, 'ise-analysis.sql');
const OUT = process.argv[2] || 'auto/cache/ise-q';
const LIMIT_MS = 15 * 60 * 1000; // 1つのクエリを待つ上限

function b64url(x) {
  return Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function request(method, host, p, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path: p, method, headers }, res => {
      // 文字の途中で区切られても化けないよう、バイトのまま集めてから文字にする（11/03 試しで「発表」が化けた）
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function loadServiceAccount() {
  if (process.env.ISE_BQ_SA_KEY_B64) {
    return JSON.parse(Buffer.from(process.env.ISE_BQ_SA_KEY_B64.replace(/\s/g, ''), 'base64').toString('utf8'));
  }
  const f = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (f && fs.existsSync(f)) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (j.type === 'service_account') return j;
  }
  return null;
}

async function getToken() {
  const sa = loadServiceAccount();
  if (!sa) {
    try {
      return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
      throw new Error('BigQuery の認証情報がありません（ISE_BQ_SA_KEY_B64・GOOGLE_APPLICATION_CREDENTIALS・gcloud のどれも使えない）');
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const form = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;
  const r = await request('POST', 'oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }, form);
  if (r.status !== 200) throw new Error(`トークンが取れません（HTTP ${r.status}）`);
  return JSON.parse(r.body).access_token;
}

// ise-analysis.sql を「-- [名前]」の行で9つに分ける（次の「-- [」の行まで）
function splitSql() {
  const s = fs.readFileSync(SQL_PATH, 'utf8');
  const out = {};
  for (const name of NAMES) {
    const i = s.indexOf(`-- [${name}]`);
    if (i < 0) throw new Error(`ise-analysis.sql に -- [${name}] がありません`);
    const j = s.indexOf('\n-- [', i + 4);
    out[name] = s.slice(i, j < 0 ? s.length : j);
  }
  return out;
}

async function bq(token, method, p, body) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { Authorization: `Bearer ${token}` };
  if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  const r = await request(method, 'bigquery.googleapis.com', `/bigquery/v2/projects/${PROJECT}${p}`, headers, data);
  const j = JSON.parse(r.body || '{}');
  if (r.status !== 200) throw new Error(`BigQuery HTTP ${r.status}: ${(j.error && j.error.message) || ''}`.slice(0, 300));
  return j;
}

async function runOne(token, name, sql) {
  const t0 = Date.now();
  let res = await bq(token, 'POST', '/queries', { query: sql, useLegacySql: false, location: LOCATION, timeoutMs: 20000, maxResults: 10000 });
  const jobId = res.jobReference.jobId;
  while (!res.jobComplete) {
    if (Date.now() - t0 > LIMIT_MS) throw new Error(`${name}: ${LIMIT_MS / 60000} 分待っても終わらない`);
    res = await bq(token, 'GET', `/queries/${jobId}?location=${LOCATION}&timeoutMs=20000&maxResults=10000`);
  }
  const fields = res.schema.fields.map(f => f.name);
  const rows = [];
  const push = rs => (rs || []).forEach(r => {
    const o = {};
    r.f.forEach((c, k) => (o[fields[k]] = c.v));
    rows.push(o);
  });
  push(res.rows);
  let token2 = res.pageToken;
  while (token2) {
    const pg = await bq(token, 'GET', `/queries/${jobId}?location=${LOCATION}&maxResults=10000&pageToken=${encodeURIComponent(token2)}`);
    push(pg.rows);
    token2 = pg.pageToken;
  }
  const total = Number(res.totalRows || rows.length);
  if (rows.length !== total) throw new Error(`${name}: 行数が合わない（${rows.length} / ${total}）`);
  return { rows, sec: Math.round((Date.now() - t0) / 1000) };
}

const why = e => String((e && (e.message || e.code || (e.errors && e.errors.map(x => x.code || x.message).join(',')))) || e);

// 通信の失敗は1回だけやり直す（一度きりの朝の実行で、たまたまの失敗で止めないため）
async function retry(label, fn) {
  try { return await fn(); } catch (e) {
    console.log(`RETRY ${label}: ${why(e).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 5000));
    return fn();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const token = await retry('token', getToken);
  const sqls = splitSql();
  // 9つを同時に走らせる（AI.CLASSIFY のものは数分かかる）
  const results = await Promise.allSettled(NAMES.map(n => retry(n, () => runOne(token, n, sqls[n]))));
  let failed = 0;
  results.forEach((r, k) => {
    const n = NAMES[k];
    if (r.status === 'fulfilled') {
      fs.writeFileSync(path.join(OUT, `${n}.json`), JSON.stringify(r.value.rows));
      console.log(`OK ${n} ${r.value.rows.length} 行（${r.value.sec} 秒）`);
    } else {
      failed++;
      console.log(`FAILED ${n}: ${why(r.reason).slice(0, 300)}`);
    }
  });
  if (failed) { console.log(`FAILED ${failed} 本`); process.exit(1); }
  console.log('DONE');
})().catch(e => { console.log(`FAILED ${why(e)}`); process.exit(1); });
