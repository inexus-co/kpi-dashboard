#!/usr/bin/env node
/**
 * ISEちゃん 利用レポート：新しい質問を OpenAI の Moderation（無料）にもかけ、結果を BigQuery の表に「記録だけ」する。
 *
 * 使い方: node auto/build/ise-moderate.js [--max 600] [--days 30]
 *   - 毎朝、ise-classify.js のあとに走らせる（ise-daily.sh）。失敗しても毎朝の処理は止めない（試しのため）。
 *   - まだ Moderation にかけていない質問のうち、直近 --days 日（既定 30）の分を、古い順に --max 件（既定 600）まで。
 *   - 画面に出すのは件数だけ（質問の文は出さない・ファイルにも書かない）。
 *
 * なぜ（2026-11-04・総務の申し送り・渡邉さんの OK「おすすめで進めて」）：
 *   見守りは Claude（ise-classify.js の danger）が全件を読んでいる。Moderation を「2枚目の網」として並べ、
 *   2週間ほど記録だけして、Claude が拾わず Moderation だけが拾ったものに本物の心配が含まれるかを確かめる。
 *   含まれていれば「どちらかが拾えば知らせる」にする。いまは知らせには使わない。
 *   Moderation は日本語の精度が公式に示されていないので、まず試す。
 *
 * 残す表（質問の文は置かない）:
 *   inexus-prod.ise_report.moderation_labels : rid・ts・flagged・categories（当たった分類をカンマ区切り）・top_category・top_score・model・labeled_at
 *   表が無ければ自分で作る（ise-report-reader はデータセット ise_report の dataEditor）。
 *
 * 鍵: OpenAI の鍵は Secret Manager（inexus-prod の ise-openai-moderation-key）から ise-report-reader で読む。
 *     手元で試すときだけ ISE_OPENAI_API_KEY で上書きできる。鍵が無いときは SKIP と出して 0 で終わる。
 */
'use strict';
const { getToken, query, request, why, retry } = require('./ise-bq-lib');

const MODEL = 'omni-moderation-latest';
const BATCH = 32;
const STD = '`inexus-prod.ise_analytics.run_googleapis_com_stdout`';
const ML = '`inexus-prod.ise_report.moderation_labels`';
const SECRET = 'ise-openai-moderation-key';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : def;
}

async function loadKey(token) {
  if (process.env.ISE_OPENAI_API_KEY) return process.env.ISE_OPENAI_API_KEY;
  const r = await request('GET', 'secretmanager.googleapis.com',
    `/v1/projects/inexus-prod/secrets/${SECRET}/versions/latest:access`, { Authorization: `Bearer ${token}` });
  if (r.status !== 200) return null;
  return Buffer.from(JSON.parse(r.body).payload.data, 'base64').toString('utf8').trim();
}

async function moderate(key, inputs) {
  const body = JSON.stringify({ model: MODEL, input: inputs });
  const r = await request('POST', 'api.openai.com', '/v1/moderations',
    { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body);
  if (r.status !== 200) throw new Error(`Moderation が HTTP ${r.status}`);
  const res = JSON.parse(r.body).results;
  if (!Array.isArray(res) || res.length !== inputs.length) throw new Error('Moderation の結果の数が合いません');
  return res;
}

async function main() {
  const max = arg('--max', 600), days = arg('--days', 30);
  const token = await getToken();
  const key = await loadKey(token);
  if (!key) { console.log(`SKIP Moderation（鍵 ${SECRET} がまだ無い）`); return; }

  await query(token, `CREATE TABLE IF NOT EXISTS ${ML} (
    rid STRING, ts TIMESTAMP, flagged BOOL, categories STRING, top_category STRING, top_score FLOAT64,
    model STRING, labeled_at TIMESTAMP)`, { name: 'create' });

  const { rows } = await query(token, `SELECT rid, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E6SZ', ts) ts, q FROM (
      SELECT jsonPayload.response_id rid, MIN(timestamp) ts, ANY_VALUE(SUBSTR(jsonPayload.question, 1, 2000)) q
      FROM ${STD} WHERE jsonPayload.event='ise_chat' AND jsonPayload.response_id IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${Number(days)} DAY) GROUP BY rid)
    WHERE rid NOT IN (SELECT rid FROM ${ML}) AND q IS NOT NULL AND q != '' ORDER BY ts LIMIT ${Number(max)}`, { name: 'todo' });

  const out = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const part = rows.slice(i, i + BATCH);
    const res = await retry('moderation', () => moderate(key, part.map(x => x.q)));
    part.forEach((x, k) => {
      const r = res[k];
      const scores = Object.entries(r.category_scores || {}).sort((a, b) => b[1] - a[1]);
      out.push({
        rid: x.rid, ts: x.ts, flagged: !!r.flagged,
        categories: Object.entries(r.categories || {}).filter(([, v]) => v).map(([c]) => c).join(','),
        top_category: scores[0] ? scores[0][0] : null, top_score: scores[0] ? scores[0][1] : null, model: MODEL,
      });
    });
  }

  if (out.length) {
    await query(token, `INSERT INTO ${ML} (rid, ts, flagged, categories, top_category, top_score, model, labeled_at)
      SELECT JSON_VALUE(x,'$.rid'), TIMESTAMP(JSON_VALUE(x,'$.ts')), BOOL(JSON_QUERY(x,'$.flagged')), JSON_VALUE(x,'$.categories'),
        JSON_VALUE(x,'$.top_category'), FLOAT64(JSON_QUERY(x,'$.top_score')), JSON_VALUE(x,'$.model'), CURRENT_TIMESTAMP()
      FROM UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(@j))) x
      WHERE JSON_VALUE(x,'$.rid') NOT IN (SELECT rid FROM ${ML})`, { params: { j: JSON.stringify(out) }, name: 'insert' });
  }
  console.log(`OK Moderation ${out.length} 件（当たり ${out.filter(x => x.flagged).length} 件）${rows.length >= max ? '・上限に達した＝残りは次回' : ''}`);
}

main().catch(e => { console.error('FAILED Moderation', why(e)); process.exit(1); });
