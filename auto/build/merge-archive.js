#!/usr/bin/env node
/*
 * merge-archive.js
 * Slackチャンネルの取得テキストをローカルアーカイブへ差分マージする。
 * - レコード境界は末尾の [YYYY-MM-DD HH:MM:SS JST] スタンプ
 * - 重複（再取得のオーバーラップ）はスタンプ＋内容ハッシュで排除
 * - pruneDays より古いレコードは削除（アーカイブ肥大防止）
 * - meta.json に最新スタンプ・Unix秒（次回の oldest 用）を記録
 *
 * 使い方: node merge-archive.js <archive.txt> <new.txt> <meta.json> [pruneDays=200]
 */
const fs=require('fs');
const crypto=require('crypto');
const [,,archPath,newPath,metaPath,pruneArg]=process.argv;
if(!archPath||!newPath||!metaPath){ console.error('args: <archive.txt> <new.txt> <meta.json> [pruneDays]'); process.exit(1); }
const pruneDays=parseInt(pruneArg||'200',10);

// 形式1: ブロック末尾に [YYYY-MM-DD HH:MM:SS JST]（concise）
// 形式2: ブロック先頭に === Message from ... at YYYY-MM-DD HH:MM:SS JST ===（detailed）
const tailRe=/\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) JST\]/g;
const headRe=/=== Message from [^\n]* at (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) JST ===/g;
function blocksTail(text){
  const out=[]; let last=0,m; tailRe.lastIndex=0;
  while((m=tailRe.exec(text))!==null){
    const block=text.slice(last,m.index+m[0].length); last=m.index+m[0].length;
    out.push({ date:m[1], stamp:m[1]+' '+m[2], block });
  }
  return out;
}
function blocksHead(text){
  const hits=[]; let m; headRe.lastIndex=0;
  while((m=headRe.exec(text))!==null) hits.push({ idx:m.index, date:m[1], stamp:m[1]+' '+m[2] });
  return hits.map((h,i)=>({ date:h.date, stamp:h.stamp,
    block: text.slice(h.idx, i+1<hits.length?hits[i+1].idx:text.length).replace(/\s+$/,'') }));
}
function blocks(text){
  const head=blocksHead(text), tail=blocksTail(text);
  return head.length>=tail.length?head:tail;
}
const hash=s=>crypto.createHash('sha1').update(s.trim()).digest('hex').slice(0,12);
const key=b=>b.stamp+'|'+hash(b.block);

const archText=fs.existsSync(archPath)?fs.readFileSync(archPath,'utf8'):'';
const newText=fs.existsSync(newPath)?fs.readFileSync(newPath,'utf8'):'';
const arch=blocks(archText), nu=blocks(newText);
const seen=new Set(arch.map(key));
let added=0;
for(const b of nu){ if(!seen.has(key(b))){ arch.push(b); seen.add(key(b)); added++; } }

// prune
const cut=new Date(); cut.setDate(cut.getDate()-pruneDays);
const p=x=>String(x).padStart(2,'0');
const cutStr=cut.getFullYear()+'-'+p(cut.getMonth()+1)+'-'+p(cut.getDate());
const before=arch.length;
const kept=arch.filter(b=>b.date>=cutStr).sort((a,b)=>a.stamp<b.stamp?-1:1);
const pruned=before-kept.length;

fs.writeFileSync(archPath, kept.map(b=>b.block).join('\n')+'\n');
const newest=kept.length?kept[kept.length-1].stamp:null;
const newestUnix=newest?Math.floor(Date.parse(newest.replace(' ','T')+'+09:00')/1000):null;
const meta={ newestStamp:newest, newestUnix, records:kept.length,
  oldestStamp:kept.length?kept[0].stamp:null, pruneDays,
  updated:new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) };
fs.writeFileSync(metaPath, JSON.stringify(meta,null,1));
console.log(JSON.stringify({added, pruned, total:kept.length, newest, newestUnix}));
