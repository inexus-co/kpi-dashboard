#!/usr/bin/env node
/*
 * render-puzzle.js
 * まなんでパズル フィードバックのレコード＋AIサマリーをテンプレートに焼き込み inner HTML を出力。
 * 使い方: node render-puzzle.js <template.html> <records.json> <ai_puzzle.json> <out_inner.html> [updated]
 */
const fs=require('fs');
const [,,tplPath,recPath,aiPath,outPath,updatedArg]=process.argv;
if(!tplPath||!recPath||!outPath){ console.error('args: <template> <records> <ai> <out> [updated]'); process.exit(1); }
const records=JSON.parse(fs.readFileSync(recPath,'utf8'));
const ai = aiPath && fs.existsSync(aiPath) ? JSON.parse(fs.readFileSync(aiPath,'utf8')) : {};
const updated=updatedArg||new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
let tpl=fs.readFileSync(tplPath,'utf8');
const json=JSON.stringify({records, ai, updated}).replace(/</g,'\\u003c');
if(tpl.indexOf('/*__BAKED__*/')===-1){ console.error('placeholder not found'); process.exit(2); }
tpl=tpl.replace('/*__BAKED__*/', json);
fs.writeFileSync(outPath, tpl);
console.log(JSON.stringify({ out:outPath, bytes:tpl.length, records:records.length, aiKeys:Object.keys(ai) }));
