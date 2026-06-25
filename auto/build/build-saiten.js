#!/usr/bin/env node
/*
 * build-saiten.js
 * 採点くん/まなんでパズル KPI アーティファクトを「静的版（集計データ焼き込み）」に変換する。
 * ビルド時に Slackテキストをパースして DATA を作り、それだけを焼き込む（生テキストは焼き込まない＝軽量）。
 * 描画ロジック（buildLayout/drawCharts）はアーティファクトのまま使う。
 *
 * 使い方: node build-saiten.js <artifact.html> <slack_text.txt> <out_inner.html> [updatedStr] [ai_saiten.json]
 */
const fs = require('fs');
const [,, tplPath, textPath, outPath, updatedArg, aiArg] = process.argv;
if (!tplPath || !textPath || !outPath) { console.error('args: <artifact.html> <slack_text.txt> <out.html> [updated] [ai.json]'); process.exit(1); }

const rawText = fs.readFileSync(textPath, 'utf8');
const updated = updatedArg || new Date().toLocaleString('ja-JP', { timeZone:'Asia/Tokyo' });
// AIサマリー（良い点 / 課題）を期間別(7 / 30 / 180日)に焼き込む。存在しなければ空（ダッシュボード側でカード非表示）。
// 受け付ける形式:
//   新: { "7": {pros,cons}, "30": {pros,cons}, "180": {pros,cons} }
//   旧: { pros, cons }（互換のため全期間に同内容を適用）
const AI_PERIODS = ['7', '30', '180'];
function normalizeAI(rawAi) {
  if (!rawAi || typeof rawAi !== 'object') return {};
  const hasPeriod = AI_PERIODS.some(k => rawAi[k] && (Array.isArray(rawAi[k].pros) || Array.isArray(rawAi[k].cons)));
  if (hasPeriod) {
    const out = {};
    for (const k of AI_PERIODS) {
      const v = rawAi[k];
      if (v && (Array.isArray(v.pros) || Array.isArray(v.cons))) out[k] = { pros: v.pros || [], cons: v.cons || [] };
    }
    return out;
  }
  if (Array.isArray(rawAi.pros) || Array.isArray(rawAi.cons)) {
    const flat = { pros: rawAi.pros || [], cons: rawAi.cons || [] };
    return { '7': flat, '30': flat, '180': flat };
  }
  return {};
}
const ai = normalizeAI((aiArg && fs.existsSync(aiArg)) ? JSON.parse(fs.readFileSync(aiArg, 'utf8')) : null);

// ===== アーティファクトと同一のパースロジック（Nodeで実行）=====
const num = s => (s != null && s !== "") ? parseFloat(String(s).replace(/,/g, "")) : null;
function pad(n){ return String(n).padStart(2,"0"); }
function normalize(text) {
  let t = text;
  if (t.indexOf("\\n") !== -1 && t.indexOf("\n") === -1) {
    t = t.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\\t/g, " ").replace(/\\"/g, '"');
  }
  t = t.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  return t;
}
function parseReports(rawText) {
  const text = normalize(rawText);
  const titleRe = /(採点くん|まなんでパズル)\s*統計レポート\s*[（(](\d{4})\/(\d{1,2})\/(\d{1,2})[)）]/g;
  const hits = [];
  let m;
  while ((m = titleRe.exec(text)) !== null) hits.push({ app: m[1], y: m[2], mo: m[3], d: m[4], idx: m.index });
  const saiten = {}, puzzle = {};
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const body = text.slice(h.idx, i + 1 < hits.length ? hits[i + 1].idx : text.length);
    const date = `${h.y}-${pad(h.mo)}-${pad(h.d)}`;
    const get = re => { const x = body.match(re); return x ? num(x[1]) : null; };
    if (h.app === "採点くん") {
      saiten[date] = {
        date,
        registered: get(/登録ユーザー数[:：]\s*\*?\s*([\d,]+)\s*人/),
        totalScore: get(/総採点数[:：]\s*\*?\s*([\d,]+)\s*回/),
        free: get(/Free[:：]\s*([\d,]+)\s*人/),
        pro: get(/Pro[:：]\s*([\d,]+)\s*人/),
        premium: get(/Premium[:：]\s*([\d,]+)\s*人/),
        dayScore: get(/当日の統計[\s\S]*?採点数[:：]\s*([\d,]+)\s*回/),
        active: get(/アクティブユーザー数[:：]\s*([\d,]+)\s*人/),
        newUsers: get(/新規登録ユーザー数[:：]\s*([\d,]+)\s*人/),
        like: get(/いいね[:：]\s*([\d,]+)\s*件/),
        dislike: get(/よくないね[:：]\s*([\d,]+)\s*件/),
      };
    } else {
      puzzle[date] = {
        date,
        totalUsers: get(/トータルユーザー数[:：]\*?\s*([\d,]+)/),
        totalAccounts: get(/トータルアカウント数[:：]\*?\s*([\d,]+)/),
        newUsers: get(/今日の新規ユーザー[:：]\*?\s*([\d,]+)/),
      };
    }
  }
  const sortVals = o => Object.values(o).sort((a,b) => a.date < b.date ? -1 : 1);
  return { saiten: sortVals(saiten), puzzle: sortVals(puzzle) };
}

const DATA = parseReports(rawText);

// ===== テンプレート変換 =====
let html = fs.readFileSync(tplPath, 'utf8');

// 1) cowork-artifact-meta ブロック除去
html = html.replace(/<script type="application\/json" id="cowork-artifact-meta">[\s\S]*?<\/script>\s*/i, '');

// 2) 焼き込みデータを本体scriptの先頭に注入（</script>対策で < をエスケープ）
const dataJson = JSON.stringify(DATA).replace(/</g,'\\u003c');
const aiJson = JSON.stringify(ai).replace(/</g,'\\u003c');
const inject =
  'const BAKED_DATA = ' + dataJson + ';\n' +
  'const BAKED_UPDATED = ' + JSON.stringify(updated) + ';\n' +
  'const BAKED_AI = ' + aiJson + ';\n' +
  'window.cowork = { callMcpTool: async () => ({ messages:"", pagination_info:"" }),\n' +
  '  askClaude: async () => JSON.stringify((BAKED_AI && (BAKED_AI["30"]||BAKED_AI["7"]||BAKED_AI["180"])) || {pros:[],cons:[]}) };\n';
const anchor = 'const CHANNEL_ID = "C08R1MRSXDF";';
if (html.indexOf(anchor) === -1) { console.error('anchor not found (CHANNEL_ID)'); process.exit(2); }
html = html.replace(anchor, inject + anchor);

// 3) init() のデータ取得部分を焼き込みデータ使用に差し替え
const fetchBlock = /const text = await fetchAll\(8\);\s*\n\s*LAST_TEXT = text;\s*\n\s*DATA = parseReports\(text\);/;
if (!fetchBlock.test(html)) { console.error('init fetch block not found'); process.exit(3); }
html = html.replace(fetchBlock, 'DATA = BAKED_DATA;');

// 4) 更新時刻を「データ取得時刻」に固定
html = html.replace('"最終更新: " + new Date().toLocaleString("ja-JP")', '"データ更新: " + BAKED_UPDATED');

fs.writeFileSync(outPath, html);

// 通知用サマリ（前日比つき）を書き出し
const S=DATA.saiten, P=DATA.puzzle;
const sL=S[S.length-1]||{}, sP=S[S.length-2]||{};
const pL=P[P.length-1]||{}, pP=P[P.length-2]||{};
const d=(a,b)=> (a==null||b==null)?null:(a-b);
const paid=(sL.pro||0)+(sL.premium||0), paidPrev=(sP.pro||0)+(sP.premium||0);
const likeRate=(sL.like!=null&&sL.dislike!=null&&(sL.like+sL.dislike)>0)? +(sL.like/(sL.like+sL.dislike)*100).toFixed(1) : null;
const notify={
  date: sL.date||pL.date||null,
  saiten:{ registered:sL.registered, registeredDelta:d(sL.registered,sP.registered),
    dayScore:sL.dayScore, paid, paidDelta:d(paid,paidPrev), likeRate },
  puzzle:{ totalUsers:pL.totalUsers, totalUsersDelta:d(pL.totalUsers,pP.totalUsers),
    totalAccounts:pL.totalAccounts, totalAccountsDelta:d(pL.totalAccounts,pP.totalAccounts), newUsers:pL.newUsers }
};
fs.writeFileSync(require('path').join(require('path').dirname(outPath),'saiten_notify.json'), JSON.stringify(notify));

console.log(JSON.stringify({ out: outPath, bytes: html.length, saitenDays: DATA.saiten.length, puzzleDays: DATA.puzzle.length,
  ai: Object.fromEntries(Object.entries(ai).map(([k,v]) => [k, { pros: (v.pros||[]).length, cons: (v.cons||[]).length }])),
  latestSaiten: sL||null, latestPuzzle: pL||null, notify }, null, 0));
