#!/usr/bin/env node
/*
 * ise-analysis-assemble.js
 * ise-analysis.sql の各クエリの結果（BigQuery の行の配列を JSON で保存したもの）を集めて、
 * build-ise-analysis.js の入力 ise_analysis.json を作る。教材の題名は [materials] の結果に入っている。
 *
 * 使い方:
 *   node ise-analysis-assemble.js <結果のフォルダ> <out ise_analysis.json>
 * フォルダに置くファイル（名前は ise-analysis.sql の [ ] と同じ）:
 *   daily.json  hour.json  dow.json  purpose.json  unit.json  materials.json（必須）
 *   recent.json  watch.json  watchconv.json（無くてもよい）
 *   各ファイルは [{"列名": 値, ...}, ...] の配列（数値は文字列でもよい）。
 */
const fs = require('fs');
const path = require('path');
const [, , dir, outPath] = process.argv;
if (!dir || !outPath) {
  console.error('usage: node ise-analysis-assemble.js <dir> <out.json>');
  process.exit(1);
}
const load = n => {
  const p = path.join(dir, n + '.json');
  if (!fs.existsSync(p)) throw new Error(`結果のファイルが無い: ${p}`);
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`結果が空: ${p}`);
  return rows;
};
// 無くてもよい結果（recent・watch）。ファイルが無い・空なら [] を返す
const loadOpt = n => {
  const p = path.join(dir, n + '.json');
  if (!fs.existsSync(p)) return [];
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(rows) ? rows : [];
};
const num = v => Number(v);
const mm = v => String(v).padStart(2, '0');

// 分類の長い名前 → ページに出す名前
const PURPOSE = {
  '理科の質問・実験の相談': '理科の質問・実験の相談',
  '理科の教材や資料をさがす': '理科の教材や資料をさがす',
  '他の教科の勉強（算数・国語・社会・英語など）': '他の教科の勉強',
  '作文・レポート・発表の手伝い': '作文・レポート・発表の手伝い',
  'あいさつ・ためし打ち・短い一言': 'あいさつ・ためし打ち',
  'いせちゃん自身についての質問': 'いせちゃん自身への質問',
  '気持ち・悩み・生活の相談': '気持ち・悩み・生活の相談',
  '遊び・ふざけ・その他の雑談': '遊び・その他の雑談',
};
const UNIT = { '物理': '物理', '化学': '化学', '生物': '生物', '地学': '地学' };
const DOW = ['', '日', '月', '火', '水', '木', '金', '土']; // BigQuery の DAYOFWEEK は 1=日

async function main() {
  const daily = load('daily').map(r => ({ d: r.d, turns: num(r.turns), convs: num(r.convs), links: num(r.links) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  const hour = {};
  for (const r of load('hour')) hour[num(r.h)] = num(r.n);
  const dow = {};
  for (const r of load('dow')) dow[DOW[num(r.w)]] = num(r.n);

  const purpose = {};
  for (const r of load('purpose')) {
    const k = PURPOSE[r.cat];
    if (!k) { console.warn(`使い道の分類に無い名前（数えない）: ${r.cat}`); continue; }
    (purpose[k] = purpose[k] || {})[mm(r.m)] = num(r.n);
  }
  const unit = {}, unitOther = {};
  for (const r of load('unit')) {
    const k = UNIT[String(r.cat).slice(0, 2)];
    if (k) (unit[k] = unit[k] || {})[mm(r.m)] = num(r.n);
    else unitOther[mm(r.m)] = (unitOther[mm(r.m)] || 0) + num(r.n);
  }

  // 題名は [materials] のクエリが ISEちゃんの裏側のデータベース（ise_prod.ise_posts）から一緒に引いてくる。
  // 無いときだけ番号で出し、TITLE-MISSING と出す（ルーティンの最後の報告で拾う）。
  const materials = [];
  for (const r of load('materials')) {
    const id = String(r.id);
    let title = r.title ? String(r.title) : '';
    if (!title) { console.warn(`TITLE-MISSING ${id}（教材の写しに無い・番号で出した）`); title = `教材 No.${id}`; }
    materials.push({ id: num(id), title, n: num(r.n) });
  }

  // 実際のやり取り（直近14日・最大30件）。本文はページに載せるためだけに使う
  const recent = loadOpt('recent').map(r => ({
    jst: String(r.jst), question: String(r.question || ''), answer: String(r.answer || ''),
    cat: PURPOSE[r.cat] || '', turns: num(r.turns) || 1,
  }));
  // 見守り（直近24時間の、命や身の安全に差し迫った心配がある内容）。ページには載せない。
  // 見つかった日だけ、スキルの手順で #ptnr-お茶の水女子大学 へシンプルに知らせる（ise_watch.json を使う）
  const watch = loadOpt('watch').map(r => ({ jst: String(r.jst), question: String(r.question || '') }));
  fs.writeFileSync(path.join(path.dirname(outPath), 'ise_watch.json'), JSON.stringify(watch, null, 1));
  console.log(`WATCH ${watch.length} 件${watch.length ? '（' + watch.map(r => r.jst).join(', ') + '）' : ''}`);

  // 見守りの会話（直近14日）。心配な質問の前後をページの「見守り」の節（#watch）に載せる
  const wc = {};
  for (const r of loadOpt('watchconv')) {
    const key = String(r.conv_start);
    (wc[key] = wc[key] || { start: key, total: num(r.total), turns: [] }).turns.push({
      turn: num(r.turn), jst: String(r.jst), question: String(r.question || ''), answer: String(r.answer || ''),
      flag: r.flag === true || r.flag === 'true',
    });
  }
  const watchConv = Object.values(wc).sort((a, b) => (a.start < b.start ? 1 : -1));
  watchConv.forEach(c => c.turns.sort((a, b) => a.turn - b.turn));
  console.log(`WATCHCONV ${watchConv.length} 会話`);

  const out = { since: daily[0].d, daily, hour, dow, purpose, unit, unitOther, materials, recent, watchConv };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`wrote ${outPath}: days=${daily.length} last=${daily[daily.length - 1].d} purpose=${Object.keys(purpose).length} unit=${Object.keys(unit).length} materials=${materials.length}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
