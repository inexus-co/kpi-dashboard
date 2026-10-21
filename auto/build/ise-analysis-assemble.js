#!/usr/bin/env node
/*
 * ise-analysis-assemble.js
 * ise-analysis.sql の各クエリの結果（BigQuery の行の配列を JSON で保存したもの）を集めて、
 * build-ise-analysis.js の入力 ise_analysis.json を作る。教材の題名は公開サイトから引く。
 *
 * 使い方:
 *   node ise-analysis-assemble.js <結果のフォルダ> <out ise_analysis.json>
 * フォルダに置くファイル（名前は ise-analysis.sql の [ ] と同じ）:
 *   daily.json  hour.json  dow.json  purpose.json  unit.json  materials.json
 *   各ファイルは [{"列名": 値, ...}, ...] の配列（数値は文字列でもよい）。
 */
const fs = require('fs');
const path = require('path');
const [, , dir, outPath] = process.argv;
if (dir === '--refresh-titles') {
  // 手元用：指定した番号の題名を公開サイトから引いて ise-material-titles.json に足す
  const p = path.join(__dirname, 'ise-material-titles.json');
  const known = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  (async () => {
    for (const id of (outPath || '').split(',').filter(Boolean)) {
      const res = await fetch(`https://ise-rika.cf.ocha.ac.jp/wp-json/wp/v2/posts/${id}?_fields=title`);
      if (res.ok) known[id] = (await res.json()).title.rendered.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, '&');
    }
    fs.writeFileSync(p, JSON.stringify(known, null, 1));
    console.log(`titles: ${Object.keys(known).length}`);
  })();
  return;
}
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

  // 題名は、まずリポジトリの一覧（ise-material-titles.json）から引く。ルーティンのクラウドからは
  // ise-rika.cf.ocha.ac.jp に通信できないことがある（2026-10-21 実測：全部「教材 No.」になった）。
  // 一覧に無い番号だけ公開サイトへ取りに行き、それも駄目なら番号で出す。一覧の作り直しは手元の Mac で
  // node auto/build/ise-analysis-assemble.js --refresh-titles <番号,番号,...>
  const titlesPath = path.join(__dirname, 'ise-material-titles.json');
  const known = fs.existsSync(titlesPath) ? JSON.parse(fs.readFileSync(titlesPath, 'utf8')) : {};
  const materials = [];
  for (const r of load('materials')) {
    const id = String(r.id);
    let title = known[id] || `教材 No.${id}`;
    if (!known[id]) try {
      const res = await fetch(`https://ise-rika.cf.ocha.ac.jp/wp-json/wp/v2/posts/${id}?_fields=title`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) title = (await res.json()).title.rendered.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, '&');
    } catch (e) { console.warn(`題名を引けなかった（番号で出す）: ${id}`); }
    materials.push({ id: num(id), title, n: num(r.n) });
  }

  const out = { since: daily[0].d, daily, hour, dow, purpose, unit, unitOther, materials };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`wrote ${outPath}: days=${daily.length} last=${daily[daily.length - 1].d} purpose=${Object.keys(purpose).length} unit=${Object.keys(unit).length} materials=${materials.length}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
