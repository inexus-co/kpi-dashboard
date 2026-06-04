#!/usr/bin/env node
/*
 * render-feedback.js
 * grade-feedback アーティファクトを「静的版（レコード＋AIサマリー焼き込み）」に変換。
 * window.cowork を shim し、ALL を焼き込みレコードに、askClaude を焼き込みpros/consに差し替える。
 * 集計・描画ロジックはアーティファクトのまま使う。
 *
 * 使い方: node render-feedback.js <artifact.html> <records.json> <ai_feedback.json> <out_inner.html> [updated]
 */
const fs=require('fs');
const [,,tplPath,recPath,aiPath,outPath,updatedArg]=process.argv;
if(!tplPath||!recPath||!outPath){ console.error('args: <artifact.html> <records.json> <ai.json> <out.html> [updated]'); process.exit(1); }
const records=JSON.parse(fs.readFileSync(recPath,'utf8'));
const ai = aiPath && fs.existsSync(aiPath) ? JSON.parse(fs.readFileSync(aiPath,'utf8')) : {};
const updated=updatedArg||new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});

let html=fs.readFileSync(tplPath,'utf8');

// 1) meta除去
html=html.replace(/<script type="application\/json" id="cowork-artifact-meta">[\s\S]*?<\/script>\s*/i,'');

// 2) 焼き込み＋shim を本体script先頭に注入
const esc=s=>JSON.stringify(s).replace(/</g,'\\u003c');
const inject =
  'const BAKED_RECORDS = '+esc(records)+';\n'+
  'const BAKED_AI = '+esc(ai)+';\n'+
  'const BAKED_UPDATED = '+JSON.stringify(updated)+';\n'+
  'window.cowork = { callMcpTool: async () => ({ messages:"", pagination_info:"" }),\n'+
  '  askClaude: async (p, arr) => { const s=(arr&&arr[0])||{}; return JSON.stringify(BAKED_AI[s.期間]||{pros:[],cons:[]}); } };\n';
const anchor='const CHANNEL = "C09L6KHTRJ7";';
if(html.indexOf(anchor)===-1){ console.error('anchor not found (CHANNEL)'); process.exit(2); }
html=html.replace(anchor, inject+anchor);

// 3) ALL を焼き込み、取得済み扱いに
html=html.replace('let ALL = [];', 'let ALL = BAKED_RECORDS.slice();');
html=html.replace('let exhausted = false;', 'let exhausted = true;');

// 4) 更新時刻を固定
html=html.replace('"最終更新: " + new Date().toLocaleString("ja-JP")', '"データ更新: " + BAKED_UPDATED');

fs.writeFileSync(outPath, html);
console.log(JSON.stringify({ out:outPath, bytes:html.length, records:records.length, aiKeys:Object.keys(ai) }));
