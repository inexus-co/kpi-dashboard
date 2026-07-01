#!/usr/bin/env node
/*
 * build-consolidated.js
 * 既に公開済みの暗号化ダッシュボードHTML（リポジトリ直下）を DASHBOARD_PASSWORD で復号し、
 * タブ切替シェル(templates/consolidated-template.html)に iframe(srcdoc) として丸ごと埋め込んだ
 * 統合内側HTML（平文）を生成する。出力は encrypt-wrap.js で再暗号化して all.html にする。
 *
 * 新しいデータ源は持たない: 各ダッシュボードの「最新公開版」をそのまま再利用するため
 * データAPI・キャッシュ鍵・他ジョブの中間生成物に依存しない（自己完結）。
 *
 * 復号は encrypt-wrap.js の逆操作:
 *   PBKDF2(SHA-256, 250000) で鍵導出 → AES-256-GCM、payload = ciphertext || authTag(16byte)
 *
 * 使い方:
 *   node build-consolidated.js <password> <out-inner.html>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [,, password, outPath] = process.argv;
if (!password || !outPath) {
  console.error('usage: node build-consolidated.js <password> <out-inner.html>');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..', '..');           // repo root (auto/build -> ..)
const TPL  = path.join(__dirname, 'templates', 'consolidated-template.html');

// タブの順序とラベル（#op-insights の投稿名に準拠）
const DASHBOARDS = [
  { id: 'kpi',        file: 'index.html',                 label: '採点くん/まなんでパズル KPI' },
  { id: 'saiten-fb',  file: 'saiten-feedback.html',       label: '採点くん フィードバック' },
  { id: 'puzzle-fb',  file: 'puzzle-feedback.html',       label: 'まなんでパズル フィードバック' },
  { id: 'kids',       file: 'kids-usage.html',            label: 'まなんでパズル 利用実績' },
  { id: 'web',        file: 'web-analytics.html',         label: 'Web分析(GA4)' },
  { id: 'social',     file: 'social-analytics.html',      label: 'ソーシャル分析(YouTube)' },
  { id: 'competitor', file: 'competitor-monitoring.html', label: '競合アプリ定点観測' },
  { id: 'freee',      file: 'freee.html',                 label: '経営(freee)' },
  { id: 'ise',        file: 'ise-chat-usage.html',         label: 'いせちゃん対話ログ' },
];

// encrypt-wrap.js が出力する鍵情報を抽出する。2形式に対応:
//   新（2026-07-01〜・複数パスワード対応）: const ITERS=NNN; const SLOTS=[{salt,iv,payload}, ...];
//   旧（単一パスワード）                 : const SALT="..", IV="..", ITERS=NNN; const PAYLOAD="..";
// Routineの再生成タイミング次第で新旧どちらの公開HTMLも来うるため両対応する。
function extractSlots(html) {
  const mNew = html.match(/const\s+ITERS=(\d+);\s*const\s+SLOTS=(\[.*?\]);/s);
  if (mNew) {
    const iters = parseInt(mNew[1], 10);
    return JSON.parse(mNew[2]).map(s => ({ ...s, iters }));
  }
  const m1 = html.match(/const\s+SALT="([^"]+)",\s*IV="([^"]+)",\s*ITERS=(\d+);/);
  const m2 = html.match(/const\s+PAYLOAD="([^"]+)";/);
  if (m1 && m2) {
    return [{ salt: m1[1], iv: m1[2], iters: parseInt(m1[3], 10), payload: m2[1] }];
  }
  return null;
}

function decryptSlot({ salt, iv, iters, payload }, pw) {
  const saltB = Buffer.from(salt, 'base64');
  const ivB   = Buffer.from(iv, 'base64');
  const payB  = Buffer.from(payload, 'base64');
  const tag   = payB.subarray(payB.length - 16);            // 末尾16byte = GCM authTag
  const ct    = payB.subarray(0, payB.length - 16);
  const key   = crypto.pbkdf2Sync(Buffer.from(pw, 'utf8'), saltB, iters, 32, 'sha256');
  const dec   = crypto.createDecipheriv('aes-256-gcm', key, ivB);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

// 渡されたパスワードで、いずれかの枠が復号できればその平文を返す（複数パスワード対応ページ用）。
function decrypt(slots, pw) {
  for (const slot of slots) {
    try { return decryptSlot(slot, pw); } catch (e) { /* このパスワードでは開かない枠。次を試す */ }
  }
  throw new Error('no matching password slot');
}

// JSONをインライン<script>内のJS値リテラルとして安全に埋め込む。
// '<' をエスケープして </script> や <!-- がHTMLパーサに拾われるのを防ぎ、
// U+2028/U+2029（JSでは行終端子）も JS文字列リテラルを壊さないようエスケープする。
function safeForScript(jsonStr) {
  // U+2028/U+2029 はソースに直書きするとパーサを壊すため実行時に構築する。
  const re = new RegExp('[<' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']', 'g');
  return jsonStr.replace(re, ch =>
    ch === '<' ? '\\u003c' : '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

const out = [];
for (const d of DASHBOARDS) {
  const p = path.join(ROOT, d.file);
  if (!fs.existsSync(p)) { console.warn('[skip] not found:', d.file); continue; }
  const html = fs.readFileSync(p, 'utf8');
  const slots = extractSlots(html);
  if (!slots) { console.warn('[skip] no encrypted payload found:', d.file); continue; }
  let inner;
  try {
    inner = decrypt(slots, password);
  } catch (e) {
    console.warn('[skip] decrypt failed (wrong password?):', d.file, '-', e.message);
    continue;
  }
  if (!/<html|<!doctype/i.test(inner)) {
    console.warn('[warn] decrypted content does not look like HTML:', d.file);
  }
  out.push({ id: d.id, label: d.label, html: inner });
  console.log('[ok]', d.file, '->', d.id, `(${inner.length} bytes)`);
}

if (!out.length) {
  console.error('[ERROR] 復号できたダッシュボードがありません。DASHBOARD_PASSWORD を確認してください。');
  process.exit(1);
}

const updated = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
}).format(new Date()) + ' JST';

const cfg = safeForScript(JSON.stringify({ updated, dashboards: out }));

const tpl = fs.readFileSync(TPL, 'utf8');
if (!tpl.includes('/*__CFG__*/')) {
  console.error('[ERROR] テンプレートに /*__CFG__*/ プレースホルダがありません:', TPL);
  process.exit(1);
}
const result = tpl.replace('/*__CFG__*/', () => cfg); // 関数置換: cfg中の $ を特殊扱いしない

fs.writeFileSync(outPath, result);
console.log('wrote', outPath, `(${result.length} bytes, ${out.length} dashboards)`);
