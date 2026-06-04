#!/usr/bin/env node
/*
 * merge-current.js
 * 確定済みキャッシュ（freee_closed_cache.json）と当期取得データ（current_fetch.json）を統合し
 * freee_raw.json を生成する。確定年度が増えていれば（会計期ロールオーバー）キャッシュも更新する。
 *
 * current_fetch.json 形式:
 * { fiscalYear, monthsElapsed, annualCurrent:[balances], monthly:[{fy,cm,sales,op}...],
 *   walletables:[...], updated,
 *   extraAnnual:{"2025":[balances],...}?, extraMonthly:[{fy,cm,sales,op}]? }   ← ロールオーバー時のバックフィル用(任意)
 *
 * 使い方: node merge-current.js <current_fetch.json> <freee_closed_cache.json> <out_freee_raw.json>
 */
const fs=require('fs');
const [,,curPath,cachePath,outPath]=process.argv;
if(!curPath||!cachePath||!outPath){ console.error('args: <current_fetch.json> <closed_cache.json> <out.json>'); process.exit(1); }
const cur=JSON.parse(fs.readFileSync(curPath,'utf8'));
let cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath,'utf8')) : { closedThrough:0, annual:{}, monthly:[] };
const FY=cur.fiscalYear;

// annual 統合
const annual = Object.assign({}, cache.annual||{}, cur.extraAnnual||{});
annual[String(FY)] = cur.annualCurrent;

// monthly 統合（fy-cm で重複排除、当期/extra を優先）
const mm = new Map();
(cache.monthly||[]).forEach(m=>mm.set(m.fy+'-'+m.cm, m));
(cur.extraMonthly||[]).forEach(m=>mm.set(m.fy+'-'+m.cm, m));
(cur.monthly||[]).forEach(m=>mm.set(m.fy+'-'+m.cm, m));
const monthly = [...mm.values()];

// 完全性チェック：2021..FY-1 の全年次が揃っているか
const missing=[];
for(let y=2021;y<FY;y++) if(!annual[String(y)]) missing.push(y);
if(missing.length){
  console.error('ERROR: 確定年度の年次データが不足: FY'+missing.join(',FY')+
    ' — 会計期ロールオーバーの可能性。current_fetch.json の extraAnnual / extraMonthly に当該年度（年次balances＋12ヶ月）を含めて再実行してください。');
  process.exit(2);
}

const raw={ fiscalYear:FY, monthsElapsed:cur.monthsElapsed, annual, monthly,
  walletables:cur.walletables||[], updated:cur.updated || new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) };
fs.writeFileSync(outPath, JSON.stringify(raw));

// キャッシュ更新（< FY を確定として保存）→ ロールオーバー自己修復
const newCacheAnnual={}; Object.keys(annual).forEach(k=>{ if(+k<FY) newCacheAnnual[k]=annual[k]; });
const newCacheMonthly=monthly.filter(m=>m.fy<FY);
fs.writeFileSync(cachePath, JSON.stringify({ closedThrough:FY-1, annual:newCacheAnnual, monthly:newCacheMonthly }));

console.log(JSON.stringify({ fiscalYear:FY, monthsElapsed:cur.monthsElapsed,
  annualYears:Object.keys(annual), monthly:monthly.length, walletables:(cur.walletables||[]).length,
  cacheClosedThrough:FY-1, cacheMonthly:newCacheMonthly.length }));
