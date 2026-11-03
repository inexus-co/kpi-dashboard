'use strict';
/**
 * ISEちゃん 利用レポート：BigQuery の REST を使うための共通の部品（ise-bq-fetch.js・ise-classify.js が使う）。
 * 認証（上から順に使う）:
 *   - ISE_BQ_SA_KEY_B64              : サービスアカウント ise-report-reader の JSON を base64 にしたもの（クラウドのルーティン向け）
 *   - GOOGLE_APPLICATION_CREDENTIALS : サービスアカウントの JSON のファイル（手元向け）
 *   - GCP の中（Cloud Run のジョブ）で動いているときは、そのサービスアカウントのトークンをメタデータサーバーから取る（鍵のファイルが要らない）
 *   - どれも無ければ gcloud のログイン（gcloud auth print-access-token・手元向け）
 */
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PROJECT = 'inexus-prod';
const LOCATION = 'asia-northeast1';

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
    req.setTimeout(10 * 60 * 1000, () => req.destroy(new Error('通信が10分返ってこない')));
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
  if (!sa && process.env.CLOUD_RUN_JOB) {
    const r = await new Promise((resolve, reject) => {
      const http = require('http');
      http.get({ host: 'metadata.google.internal', path: '/computeMetadata/v1/instance/service-account/default/token',
        headers: { 'Metadata-Flavor': 'Google' } }, res => {
        const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
      }).on('error', reject);
    });
    if (r.status !== 200) throw new Error(`メタデータサーバーからトークンが取れません（HTTP ${r.status}）`);
    return JSON.parse(r.body).access_token;
  }
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

async function bq(token, method, p, body) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { Authorization: `Bearer ${token}` };
  if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  const r = await request(method, 'bigquery.googleapis.com', `/bigquery/v2/projects/${PROJECT}${p}`, headers, data);
  const j = JSON.parse(r.body || '{}');
  if (r.status !== 200) throw new Error(`BigQuery HTTP ${r.status}: ${(j.error && j.error.message) || ''}`.slice(0, 300));
  if (j.status && j.status.errorResult) throw new Error(`BigQuery: ${j.status.errorResult.message}`.slice(0, 300));
  return j;
}

/**
 * クエリを1本実行し、終わるまで待って全部の行を返す（列名をキーにした行の配列・値は文字列のまま）。
 * params: { 名前: 文字列 } を渡すと @名前 の STRING の引数になる。
 */
async function query(token, sql, { params, limitMs = 15 * 60 * 1000, name = 'query' } = {}) {
  const t0 = Date.now();
  const body = { query: sql, useLegacySql: false, location: LOCATION, timeoutMs: 20000, maxResults: 10000 };
  if (params) {
    body.parameterMode = 'NAMED';
    body.queryParameters = Object.entries(params).map(([k, v]) => ({
      name: k, parameterType: { type: 'STRING' }, parameterValue: { value: String(v) },
    }));
  }
  let res = await bq(token, 'POST', '/queries', body);
  const jobId = res.jobReference.jobId;
  while (!res.jobComplete) {
    if (Date.now() - t0 > limitMs) throw new Error(`${name}: ${limitMs / 60000} 分待っても終わらない`);
    res = await bq(token, 'GET', `/queries/${jobId}?location=${LOCATION}&timeoutMs=20000&maxResults=10000`);
  }
  if (!res.schema) return { rows: [], sec: Math.round((Date.now() - t0) / 1000), affected: Number(res.numDmlAffectedRows || 0) };
  const fields = res.schema.fields.map(f => f.name);
  const rows = [];
  const push = rs => (rs || []).forEach(r => {
    const o = {};
    r.f.forEach((c, k) => (o[fields[k]] = c.v));
    rows.push(o);
  });
  push(res.rows);
  let next = res.pageToken;
  while (next) {
    const pg = await bq(token, 'GET', `/queries/${jobId}?location=${LOCATION}&maxResults=10000&pageToken=${encodeURIComponent(next)}`);
    push(pg.rows);
    next = pg.pageToken;
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

module.exports = { PROJECT, LOCATION, request, getToken, query, why, retry };
