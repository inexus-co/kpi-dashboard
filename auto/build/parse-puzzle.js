#!/usr/bin/env node
/*
 * parse-puzzle.js
 * まなんでパズル フィードバックチャンネル(#op-user-feedback-prod)のアーカイブをパース。
 * 3種: 評価受信(1〜5) / お問い合わせ受信(自由記述) / フィードバック受信(タグ＋自由記述)
 *
 * 使い方: node parse-puzzle.js <archive.txt> <out_records.json> <out_stats.json> <out_notify.json>
 */
const fs=require('fs');
const [,,textPath,recPath,statsPath,notifyPath]=process.argv;
if(!textPath||!recPath||!statsPath||!notifyPath){ console.error('args: <archive> <records> <stats> <notify>'); process.exit(1); }
const text=fs.readFileSync(textPath,'utf8');

function fieldLine(block,label){ const m=block.match(new RegExp("\\*"+label+":\\*\\s*([^\\n*]+)")); return m?m[1].trim():null; }
function fieldMulti(block,label){ const m=block.match(new RegExp("\\*"+label+":\\*\\s*([\\s\\S]*?)(?=\\n\\*|$)")); return m?m[1].trim():null; }
const cleanContent=s=>{ if(!s) return ""; s=s.replace(/\s*\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} JST\]\s*$/,'').trim();
  return (s==='なし'||s==='undefined')?'':s; };

const tsRe=/\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) JST\]/g;
const recs=[]; let last=0,m;
while((m=tsRe.exec(text))!==null){
  const block=text.slice(last,m.index+m[0].length); last=m.index+m[0].length;
  const dateStr=m[1], time=m[2];
  let kind=null;
  if(block.includes('評価受信')) kind='rating';
  else if(block.includes('お問い合わせ受信')) kind='inquiry';
  else if(block.includes('フィードバック受信')) kind='feedback';
  if(!kind) continue; // bot参加通知等はスキップ
  const env=(fieldLine(block,'最終ログイン環境')||fieldLine(block,'環境')||'不明').toLowerCase();
  const lang=fieldLine(block,'言語')||'不明';
  const name=fieldLine(block,'ユーザー名')||'';
  const adminM=block.match(/<(https:\/\/admin\.inexus-co\.com[^|>]+)\|/);
  const r={ dateStr, time, kind, env, lang, name, admin: adminM?adminM[1]:null };
  if(kind==='rating'){
    const s=block.match(/\*評価:\*\s*([1-5])/); if(!s) continue; r.score=+s[1];
  } else if(kind==='inquiry'){
    r.itype=fieldLine(block,'お問い合わせタイプ')||'';
    r.content=cleanContent(fieldMulti(block,'お問い合わせ内容')||fieldMulti(block,'メッセージ内容'));
  } else {
    r.types=(fieldLine(block,'フィードバックタイプ')||'').split(/[,、]\s*/).filter(Boolean);
    r.content=cleanContent(fieldMulti(block,'フィードバック内容'));
  }
  recs.push(r);
}
// 180日に限定
function daysAgoStr(n){ const d=new Date(); d.setDate(d.getDate()-n);
  const p=x=>String(x).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
const records=recs.filter(r=>r.dateStr>=daysAgoStr(179)).sort((a,b)=>(a.dateStr+a.time)<(b.dateStr+b.time)?-1:1);

function statsFor(days){
  const cutoff=daysAgoStr(days-1);
  const rs=records.filter(r=>r.dateStr>=cutoff);
  const rat=rs.filter(r=>r.kind==='rating'), inq=rs.filter(r=>r.kind==='inquiry'), fb=rs.filter(r=>r.kind==='feedback');
  const dist={1:0,2:0,3:0,4:0,5:0}; rat.forEach(r=>dist[r.score]++);
  const avg=rat.length? +(rat.reduce((s,r)=>s+r.score,0)/rat.length).toFixed(2) : null;
  const cnt=(arr,key)=>{ const o={}; arr.forEach(r=>{const k=r[key]||'不明';o[k]=(o[k]||0)+1;}); return o; };
  const envRat={}; rat.forEach(r=>{ const e=r.env; envRat[e]=envRat[e]||{n:0,sum:0,low:0,mid:0,high:0};
    envRat[e].n++; envRat[e].sum+=r.score; if(r.score<=2)envRat[e].low++; else if(r.score===3)envRat[e].mid++; else envRat[e].high++; });
  Object.values(envRat).forEach(v=>{v.avg=+(v.sum/v.n).toFixed(2); delete v.sum;});
  const typeCounts={}; fb.forEach(r=>(r.types||[]).forEach(t=>typeCounts[t]=(typeCounts[t]||0)+1));
  const voices=[...inq,...fb].filter(r=>r.content).sort((a,b)=>(b.dateStr+b.time).localeCompare(a.dateStr+a.time))
    .slice(0,40).map(r=>({d:r.dateStr,kind:r.kind,env:r.env,text:r.content.slice(0,100)}));
  const label=days===180?'直近6ヶ月':('直近'+days+'日');
  return { 期間:label, 評価:{件数:rat.length,平均:avg,分布:dist,高評価45:dist[4]+dist[5],低評価12:dist[1]+dist[2],環境別:envRat},
    問い合わせ:{件数:inq.length,環境別:cnt(inq,'env'),言語別:cnt(inq,'lang')},
    フィードバック:{件数:fb.length,タイプ別:typeCounts,環境別:cnt(fb,'env')},
    声サンプル:voices };
}
const stats={ '直近7日':statsFor(7), '直近30日':statsFor(30), '直近6ヶ月':statsFor(180) };
fs.writeFileSync(recPath, JSON.stringify(records));
fs.writeFileSync(statsPath, JSON.stringify(stats));

const mk=s=>({ratings:s.評価.件数, avg:s.評価.平均, high:s.評価.高評価45, low:s.評価.低評価12,
  inquiries:s.問い合わせ.件数, feedback:s.フィードバック.件数});
const latest=records.length?records[records.length-1].dateStr:null;
fs.writeFileSync(notifyPath, JSON.stringify({ latest, d7:mk(stats['直近7日']), d30:mk(stats['直近30日']) }));

console.log(JSON.stringify({ parsed:recs.length, within180:records.length,
  d7:mk(stats['直近7日']), d30:mk(stats['直近30日']), d180:mk(stats['直近6ヶ月']),
  topFbTypes:Object.entries(stats['直近30日'].フィードバック.タイプ別).sort((a,b)=>b[1]-a[1]).slice(0,5) }));
