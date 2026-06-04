#!/usr/bin/env node
/*
 * parse-feedback.js
 * フィードバックSlackテキストをパースし、直近180日のレコード＋範囲別集計＋通知用サマリを書き出す。
 * 集計ロジックはアーティファクト(grade-feedback-dashboard)と同一。
 *
 * 使い方: node parse-feedback.js <feedback_text.txt> <out_records.json> <out_stats.json> <out_notify.json>
 */
const fs=require('fs');
const [,,textPath,recPath,statsPath,notifyPath]=process.argv;
if(!textPath||!recPath||!statsPath||!notifyPath){ console.error('args: <text> <records.json> <stats.json> <notify.json>'); process.exit(1); }
const text=fs.readFileSync(textPath,'utf8');

function field(block,label){ const re=new RegExp("\\*"+label+":\\*\\s*([^\\n*]+)"); const m=block.match(re); return m?m[1].trim():null; }
function parseRecords(text){
  const tsRe=/\[(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) JST\]/g;
  const recs=[]; let last=0,m;
  while((m=tsRe.exec(text))!==null){
    const block=text.slice(last,m.index+m[0].length); last=m.index+m[0].length;
    const dateStr=m[1]+"-"+m[2]+"-"+m[3];
    let rating="other";
    if(block.includes(":+1:")) rating="pos"; else if(block.includes(":-1:")) rating="neg";
    const imgM=block.match(/(https?:\/\/[^\s\]]+\.(?:jpg|jpeg|png))/i);
    recs.push({ dateStr, time:m[4], rating,
      os:(field(block,"OS")||"").toLowerCase()||"不明",
      plan:field(block,"課金プラン")||"不明",
      subject:field(block,"教科")||"不明",
      reason:field(block,"理由")||"",
      img:imgM?imgM[1]:null });
  }
  return recs;
}
function daysAgoStr(n){ const d=new Date(); d.setDate(d.getDate()-n);
  const p=x=>String(x).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
function countBy(recs,keyFn){ const map={};
  recs.forEach(r=>{ const k=keyFn(r)||"不明"; map[k]=map[k]||{pos:0,neg:0,other:0,total:0}; map[k][r.rating]++; map[k].total++; }); return map; }

const all=parseRecords(text);
// 直近180日に限定
const cutoff180=daysAgoStr(179);
const records=all.filter(r=>r.dateStr>=cutoff180);

function statsFor(days){
  const cutoff=daysAgoStr(days-1);
  const recs=records.filter(r=>r.dateStr>=cutoff);
  const total=recs.length, pos=recs.filter(r=>r.rating==="pos").length, neg=recs.filter(r=>r.rating==="neg").length;
  const other=total-pos-neg, rated=pos+neg, posRate=rated?Math.round(pos/rated*100):0;
  const bySub=countBy(recs,r=>r.subject), byOS=countBy(recs,r=>r.os), byPlan=countBy(recs,r=>r.plan);
  const reasonMap={}; recs.filter(r=>r.rating==="neg").forEach(r=>{const k=r.reason||"理由なし";reasonMap[k]=(reasonMap[k]||0)+1;});
  const label=days===180?"直近6ヶ月":("直近"+days+"日");
  const sortK=o=>Object.keys(o).sort((a,b)=>o[b].total-o[a].total);
  return { 期間:label, 総数:total, いいね:pos, よくない:neg, コメントのみ:other, 満足率パーセント:posRate,
    教科別:sortK(bySub).map(k=>({教科:k,件数:bySub[k].total,いいね:bySub[k].pos,よくない:bySub[k].neg})),
    OS別:sortK(byOS).map(k=>({os:k,いいね:byOS[k].pos,よくない:byOS[k].neg})),
    プラン別:sortK(byPlan).map(k=>({プラン:k,いいね:byPlan[k].pos,よくない:byPlan[k].neg})),
    否定理由:Object.keys(reasonMap).sort((a,b)=>reasonMap[b]-reasonMap[a]).map(k=>({理由:k,件数:reasonMap[k]})) };
}
const stats={ "直近7日":statsFor(7), "直近30日":statsFor(30), "直近6ヶ月":statsFor(180) };
fs.writeFileSync(recPath, JSON.stringify(records));
fs.writeFileSync(statsPath, JSON.stringify(stats));

const mk=s=>({total:s.総数,pos:s.いいね,neg:s.よくない,satisfaction:s.満足率パーセント});
const notify={ date: records.length?records[0].dateStr:null, latest: records.length?records[0].dateStr:null,
  d7:mk(stats["直近7日"]), d30:mk(stats["直近30日"]) };
// 最新日付は records 内の最大
if(records.length){ notify.latest=records.reduce((a,r)=>r.dateStr>a?r.dateStr:a, records[0].dateStr); }
fs.writeFileSync(notifyPath, JSON.stringify(notify));

console.log(JSON.stringify({ totalParsed:all.length, within180:records.length,
  d7:notify.d7, d30:notify.d30, d180:mk(stats["直近6ヶ月"]),
  topNegReasons:stats["直近30日"].否定理由.slice(0,5) }, null, 0));
