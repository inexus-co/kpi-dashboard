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
 * 認証と BigQuery の呼び出しは ise-bq-lib.js（2026-11-03 に ise-classify.js と共通にした）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { query, why, retry, getToken } = require('./ise-bq-lib');

const NAMES = ['daily', 'hour', 'dow', 'purpose', 'unit', 'materials', 'recent', 'watch', 'watchconv'];
const SQL_PATH = path.join(__dirname, 'ise-analysis.sql');
const OUT = process.argv[2] || 'auto/cache/ise-q';

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

const runOne = (token, name, sql) => query(token, sql, { name });

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
