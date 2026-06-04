#!/usr/bin/env node
/*
 * compute-model.js
 * freee_raw.json（年次balances＋月次{sales,op}＋walletables）から
 * 描画用の集計モデル BAKED を計算し、freee-template.html に焼き込んで inner HTML を出力。
 * AI分析文は ai.json (任意) の {cur, cum} から読み込む。
 *
 * 使い方: node compute-model.js <freee_raw.json> <template.html> <out_inner.html> [ai.json]
 */
const fs = require('fs');
const [,, rawPath, tplPath, outPath, aiPath] = process.argv;
if (!rawPath || !tplPath || !outPath) { console.error('args: <raw.json> <template.html> <out.html> [ai.json]'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const ai = aiPath && fs.existsSync(aiPath) ? JSON.parse(fs.readFileSync(aiPath, 'utf8')) : { cur:'', cum:'' };
const FORDER = [9,10,11,12,1,2,3,4,5,6,7,8];
const FY = raw.fiscalYear;
const monthsElapsed = raw.monthsElapsed;
const updated = raw.updated || new Date().toLocaleString('ja-JP', { timeZone:'Asia/Tokyo' });

const yen = n => '¥' + Math.round(n||0).toLocaleString('ja-JP');
const man = n => (Math.round((n||0)/1e4)).toLocaleString('ja-JP') + '万円';
const pct = (a,b) => b ? (a/b*100) : 0;
const mLabelCal = (fy,cm) => String(cm>=9?fy:fy+1).slice(2)+'/'+cm;

// --- balances helpers（アーティファクトと同一ロジック）---
function total(b, cat, field){ field=field||'closing_balance';
  const r=b.find(x=>x.account_category_name===cat && x.total_line===true && x.hierarchy_level===1); return r?(r[field]||0):0; }
function plTotal(b, field){ field=field||'closing_balance';
  const r=b.find(x=>x.account_category_name==='売上高' && x.total_line===true); return r?(r[field]||0):0; }
function revGroups(b){ return b.filter(x=>x.account_category_name==='売上高' && x.account_group_name && x.hierarchy_level===2 && !x.total_line); }
function expGroups(b){ return b.filter(x=>x.account_category_name==='販売管理費' && x.account_group_name && !x.total_line); }

const annual = {}; Object.keys(raw.annual).forEach(k=>annual[+k]=raw.annual[k]);

// ===== 当期 =====
const yb = annual[FY];
if(!yb) { console.error('current FY annual missing'); process.exit(2); }
const sales=plTotal(yb), gross=total(yb,'売上総損益金額'), op=total(yb,'営業損益金額'),
      ord=total(yb,'経常損益金額'), net=total(yb,'当期純損益金額');
const subsidy=(yb.find(b=>b.account_group_name==='補助金収入')||{}).closing_balance||0;

const rr=revGroups(yb).filter(r=>(r.closing_balance||0)!==0);
const er=expGroups(yb).filter(r=>(r.closing_balance||0)>0).sort((a,b)=>b.closing_balance-a.closing_balance).slice(0,12);

const cashAccts=(raw.walletables||[]).filter(w=>w.type==='bank_account'||w.type==='wallet');
const cashTotal=cashAccts.reduce((s,w)=>s+(w.walletable_balance||0),0);
const cashNonzero=cashAccts.filter(w=>w.walletable_balance!==0).sort((a,b)=>b.walletable_balance-a.walletable_balance);

// 月次（当期）
const mMap={}; raw.monthly.filter(m=>m.fy===FY).forEach(m=>{ mMap[m.cm]={sales:m.sales, op:m.op}; });
const completedIdx=Math.max(0, monthsElapsed-1);
const completedCms=FORDER.slice(0,completedIdx).filter(cm=>mMap[cm]);
const compVals=completedCms.map(cm=>mMap[cm]);
const recent=compVals.slice(-Math.min(3,compVals.length));
const avgSales=recent.length?recent.reduce((s,v)=>s+v.sales,0)/recent.length:0;
const avgOp=recent.length?recent.reduce((s,v)=>s+v.op,0)/recent.length:0;
const completed=compVals.length, remain=12-completed;
const compSales=compVals.reduce((s,v)=>s+v.sales,0), compOp=compVals.reduce((s,v)=>s+v.op,0);
const fcstSales=compSales+avgSales*remain, fcstOp=compOp+avgOp*remain;
const hasFcst=completed>0 && remain>0;
const fullLabels=FORDER.map(cm=>mLabelCal(FY,cm));
const salesAct=FORDER.map((cm,i)=> (i<completedIdx && mMap[cm]) ? mMap[cm].sales : null);
const salesFc =FORDER.map((cm,i)=> (i>=completedIdx) ? avgSales : null);
const opLine  =FORDER.map((cm,i)=> i<completedIdx ? (mMap[cm]?mMap[cm].op:null) : avgOp);

// YoY（前期＝確定年度の年次から）
const prevYb=annual[FY-1];
let yoy=null; const yl=['売上高','営業利益','経常利益','当期純利益'];
if(prevYb){
  const pick=b=>({'売上高':plTotal(b),'営業利益':total(b,'営業損益金額'),'経常利益':total(b,'経常損益金額'),'当期純利益':total(b,'当期純損益金額')});
  const yc=pick(yb), yp=pick(prevYb);
  yoy={ labels:yl, prev:yl.map(k=>yp[k]), cur:yl.map(k=>yc[k]) };
}

let note=`<b style="color:#1e46aa">読み解きメモ</b>　`;
note+=`当期は12ヶ月中 約${completed}ヶ月が完了した<b>期中</b>です。実績(YTD)は売上 ${yen(sales)}・営業利益 ${yen(op)}（利益率 ${pct(op,sales).toFixed(1)}%）。`;
if(hasFcst) note+=` 直近ペースでの<b>通期見込み</b>は売上 ${yen(fcstSales)}・営業利益 ${yen(fcstOp)}（あくまで試算）。`;
if(subsidy>0) note+=` 経常利益 ${yen(ord)} には一過性の<b>補助金収入 ${yen(subsidy)}</b>が含まれるため、本業の営業利益と切り分けて評価するのが安全です。`;
if(cashTotal>0) note+=` 現預金残高は ${yen(cashTotal)}。`;

const cur = {
  ai: ai.cur || '',
  salesTotal: sales,
  cards: [
    {label:'売上高（実績・期首〜現在）', value:yen(sales), sub:hasFcst?`通期見込 ${man(fcstSales)}`:man(sales)},
    {label:'営業利益（実績）', value:yen(op), neg:op<0, sub:hasFcst?`通期見込 ${man(fcstOp)}（利益率 ${pct(op,sales).toFixed(1)}%）`:`営業利益率 ${pct(op,sales).toFixed(1)}%`},
    {label:'経常利益（実績）', value:yen(ord), neg:ord<0, sub:`経常利益率 ${pct(ord,sales).toFixed(1)}%`},
    {label:'当期純利益（実績）', value:yen(net), neg:net<0, sub:man(net)},
    {label:'現預金残高', value:yen(cashTotal), sub:`口座 ${cashNonzero.length} 件`}
  ],
  waterfall: [sales,gross,op,ord,net],
  rev: { labels:rr.map(r=>r.account_group_name), data:rr.map(r=>r.closing_balance) },
  monthly: { labels:fullLabels, salesAct, salesFc, opLine, completedIdx },
  exp: { labels:er.map(r=>r.account_group_name), data:er.map(r=>r.closing_balance) },
  cash: { labels:cashNonzero.map(w=>w.name), data:cashNonzero.map(w=>w.walletable_balance) },
  yoy,
  note
};

// ===== 累積 =====
const fys=[]; for(let y=2021;y<=FY;y++) if(annual[y]) fys.push(y);
const sSales=fys.map(f=>plTotal(annual[f])), sOp=fys.map(f=>total(annual[f],'営業損益金額')),
      sOrd=fys.map(f=>total(annual[f],'経常損益金額')), sNet=fys.map(f=>total(annual[f],'当期純損益金額'));
const sum=a=>a.reduce((s,v)=>s+v,0);
const cumSales=sum(sSales), cumOp=sum(sOp), cumOrd=sum(sOrd), cumNet=sum(sNet);
let run=0; const cumNetLine=sNet.map(v=>run+=v);

// 月次（全期間）順序: FY昇順→会計月順(FORDER)
const monthsSorted=[...raw.monthly].sort((a,b)=> (a.fy-b.fy) || (FORDER.indexOf(a.cm)-FORDER.indexOf(b.cm)));
const cumMonthly={ labels:monthsSorted.map(m=>mLabelCal(m.fy,m.cm)), sales:monthsSorted.map(m=>m.sales), op:monthsSorted.map(m=>m.op) };

// 累積 売上構成 / 販管費（年次groupを合算）
const revMap={}, expMap={};
fys.forEach(f=>{ revGroups(annual[f]).forEach(g=>{ revMap[g.account_group_name]=(revMap[g.account_group_name]||0)+(g.closing_balance||0); }); });
fys.forEach(f=>{ expGroups(annual[f]).forEach(g=>{ expMap[g.account_group_name]=(expMap[g.account_group_name]||0)+(g.closing_balance||0); }); });
const revArr=Object.entries(revMap).filter(([k,v])=>v!==0).sort((a,b)=>b[1]-a[1]);
const expArr=Object.entries(expMap).filter(([k,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,12);

let noteCum=`<b style="color:#1e46aa">読み解きメモ</b>　起業から${fys.length}期累計で売上高 <b>${yen(cumSales)}</b>、累積当期純利益 <b>${yen(cumNet)}</b>（内部留保の目安）。`+
  `営業利益の累計は ${yen(cumOp)}（累積営業利益率 ${pct(cumOp,cumSales).toFixed(1)}%）。各年度のバラつきは上のグラフで確認できます。`;

const cum = {
  ai: ai.cum || '',
  salesTotal: cumSales,
  cards: [
    {label:'累積売上高', value:yen(cumSales), sub:`${fys.length}期分`},
    {label:'累積営業利益', value:yen(cumOp), neg:cumOp<0, sub:`営業利益率 ${pct(cumOp,cumSales).toFixed(1)}%`},
    {label:'累積経常利益', value:yen(cumOrd), neg:cumOrd<0, sub:man(cumOrd)},
    {label:'累積当期純利益', value:yen(cumNet), neg:cumNet<0, sub:'内部留保の目安'},
    {label:'現預金残高', value:yen(cashTotal), sub:'最新残高'}
  ],
  monthly: cumMonthly,
  fy: { labels:fys.map(f=>'FY'+f), sales:sSales, op:sOp, ord:sOrd, net:sNet },
  cumNet: cumNetLine,
  rev: { labels:revArr.map(x=>x[0]), data:revArr.map(x=>x[1]) },
  exp: { labels:expArr.map(x=>x[0]), data:expArr.map(x=>x[1]) },
  note: noteCum
};

const BAKED = {
  period: `会計期：FY${FY}（${FY}/9 〜 ${FY+1}/8）／ freee会計`,
  meta: `承認済み仕訳ベース（未承認除く）｜取得: ${updated}`,
  cur, cum
};

// 通知用サマリ
const notify = {
  fiscalYear: FY, monthsElapsed,
  sales, op, opMargin: +pct(op,sales).toFixed(1), ord, net, subsidy, cashTotal,
  fcstSales: hasFcst?Math.round(fcstSales):null, fcstOp: hasFcst?Math.round(fcstOp):null,
  cumSales, cumOp, cumNet, periods: fys.length
};
fs.writeFileSync(require('path').join(require('path').dirname(outPath),'freee_notify.json'), JSON.stringify(notify));

// テンプレートに焼き込み（</script>混入対策で < をエスケープ）
let tpl = fs.readFileSync(tplPath, 'utf8');
const json = JSON.stringify(BAKED).replace(/</g,'\\u003c');
tpl = tpl.replace('/*__BAKED__*/', json);
fs.writeFileSync(outPath, tpl);

// 検証用サマリ
console.log(JSON.stringify({
  FY, monthsElapsed, sales, op, ord, net, subsidy, cashTotal,
  revGroups: rr.length, expTop: er.length, cashAccts: cashNonzero.length,
  curMonths: Object.keys(mMap).length, completed, hasFcst,
  fys, cumSales, cumOp, cumOrd, cumNet, totalMonths: monthsSorted.length,
  bakedBytes: tpl.length
}, null, 0));
