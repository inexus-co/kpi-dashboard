#!/usr/bin/env node
/*
 * build-ise-analysis.js
 * ISEちゃん 利用レポート（ise-analysis.html の内側HTML）を作る。
 * 入力は BigQuery で集計した数字と、直近2週間の会話（最大30件・ページ下の「実際のやり取り」）。
 * 集計クエリ＝auto/build/ise-analysis.sql。旧ページ ise-chat-usage.html（全件の一覧）を統合した（2026-10-21）。
 *
 * 使い方:
 *   node build-ise-analysis.js <ise_analysis.json> <out-inner.html> "<更新日時の表示>"
 */
const fs = require('fs');
const [, , inPath, outPath, stamp] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node build-ise-analysis.js <ise_analysis.json> <out.html> "<stamp>"');
  process.exit(1);
}
const D = JSON.parse(fs.readFileSync(inPath, 'utf8'));

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Number(n).toLocaleString('ja-JP');
const sum = a => a.reduce((x, y) => x + y, 0);

// ---- 日別（記録の無い日は 0 で埋める） ----
const byDay = Object.fromEntries(D.daily.map(r => [r.d, r]));
const days = [];
for (let t = new Date(D.since + 'T00:00:00Z'); ; t.setUTCDate(t.getUTCDate() + 1)) {
  const d = t.toISOString().slice(0, 10);
  if (d > D.daily[D.daily.length - 1].d) break;
  const r = byDay[d] || { d, turns: 0, convs: 0, links: 0 };
  days.push(r);
}
const totalTurns = sum(days.map(r => r.turns));
const totalConvs = sum(days.map(r => r.convs));
const totalLinks = sum(days.map(r => r.links));
const activeDays = days.filter(r => r.turns > 0).length;
let cum = 0;
const cumulative = days.map(r => (cum += r.turns));

// ---- 月別 ----
const months = {};
for (const r of days) {
  const m = r.d.slice(0, 7);
  months[m] = months[m] || { turns: 0, convs: 0 };
  months[m].turns += r.turns;
  months[m].convs += r.convs;
}
const monthKeys = Object.keys(months).filter(m => months[m].turns >= 10); // 6/30 の1日だけの月は7月に寄せて見せない
if (months[D.since.slice(0, 7)] && !monthKeys.includes(D.since.slice(0, 7))) {
  const first = monthKeys[0];
  months[first].turns += months[D.since.slice(0, 7)].turns;
  months[first].convs += months[D.since.slice(0, 7)].convs;
}
const monthLabel = m => `${Number(m.slice(5))}月`;
const lastDay = days[days.length - 1].d;
const partialMonth = lastDay.slice(0, 7);
const partialNote = Number(lastDay.slice(8)) < 28 ? `（${Number(lastDay.slice(8))}日まで）` : '';

// ---- 共通の小さな部品 ----
const W = 720;
function axisY(max) {
  const step = niceStep(max / 4);
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return { ticks, top: ticks[ticks.length - 1] < max ? ticks[ticks.length - 1] + step : ticks[ticks.length - 1] };
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function frame(h, maxY, padL = 44) {
  const { ticks, top } = axisY(maxY);
  const plotH = h - 34;
  const y = v => 10 + plotH - (v / top) * plotH;
  const grid = ticks.map(v =>
    `<line x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/>` +
    `<text x="${padL - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmt(v)}</text>`).join('');
  return { y, grid, plotH, padL };
}

// 日別の棒
function dailyBars() {
  const h = 220;
  const max = Math.max(...days.map(r => r.turns));
  const f = frame(h, max);
  const bw = (W - 8 - f.padL) / days.length;
  const bars = days.map((r, i) => {
    const x = f.padL + i * bw;
    const top = f.y(r.turns), base = f.y(0);
    const hh = Math.max(0, base - top);
    return `<g class="hit"><rect x="${x}" y="10" width="${bw}" height="${f.plotH}" fill="transparent"/>` +
      (hh > 0 ? `<rect x="${x + 0.5}" y="${top}" width="${Math.max(1, bw - 1)}" height="${hh}" rx="${Math.min(2, bw / 3)}" class="bar"/>` : '') +
      `<title>${r.d}　質問 ${fmt(r.turns)} 件／会話 ${fmt(r.convs)} 件</title></g>`;
  }).join('');
  const labels = days.map((r, i) => r.d.endsWith('-01')
    ? `<text x="${f.padL + i * bw}" y="${h - 6}" class="tick">${Number(r.d.slice(5, 7))}月</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="日別の質問数">${f.grid}${bars}${labels}</svg>`;
}

// 累計の折れ線
function cumulativeLine() {
  const h = 220;
  const max = cumulative[cumulative.length - 1];
  const f = frame(h, max, 52);
  const x = i => f.padL + (i / (days.length - 1)) * (W - 8 - f.padL);
  const pts = cumulative.map((v, i) => `${x(i).toFixed(1)},${f.y(v).toFixed(1)}`).join(' ');
  const area = `${f.padL},${f.y(0)} ${pts} ${x(days.length - 1)},${f.y(0)}`;
  const labels = days.map((r, i) => r.d.endsWith('-01')
    ? `<text x="${x(i)}" y="${h - 6}" class="tick">${Number(r.d.slice(5, 7))}月</text>` : '').join('');
  const hits = days.map((r, i) => `<g class="hit"><rect x="${x(i) - 3}" y="10" width="6" height="${f.plotH}" fill="transparent"/><title>${r.d} までの累計　${fmt(cumulative[i])} 件</title></g>`).join('');
  const last = days.length - 1;
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="質問数の累計">${f.grid}` +
    `<polygon points="${area}" class="area"/><polyline points="${pts}" class="line"/>` +
    `<circle cx="${x(last)}" cy="${f.y(max)}" r="4" class="dot"/>` +
    `<text x="${x(last) - 8}" y="${f.y(max) - 10}" text-anchor="end" class="direct">${fmt(max)} 件</text>${labels}${hits}</svg>`;
}

// 縦棒（月別・時間帯・曜日）
function columns(items, { h = 200, unit = '件', valueLabels = true } = {}) {
  const max = Math.max(...items.map(i => i.v));
  const f = frame(h, max);
  const slot = (W - 8 - f.padL) / items.length;
  const bw = Math.min(56, slot * 0.62);
  return `<svg viewBox="0 0 ${W} ${h}" role="img">${f.grid}` + items.map((it, i) => {
    const cx = f.padL + slot * i + slot / 2;
    const top = f.y(it.v), hh = f.y(0) - top;
    return `<g class="hit"><rect x="${cx - slot / 2}" y="10" width="${slot}" height="${f.plotH}" fill="transparent"/>` +
      (hh > 0 ? `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${hh}" rx="4" class="bar${it.muted ? ' muted' : ''}"/>` : '') +
      (valueLabels && it.v > 0 ? `<text x="${cx}" y="${top - 6}" text-anchor="middle" class="direct">${fmt(it.v)}</text>` : '') +
      `<text x="${cx}" y="${h - 6}" text-anchor="middle" class="tick">${esc(it.label)}</text>` +
      `<title>${esc(it.tip || it.label)}　${fmt(it.v)} ${unit}</title></g>`;
  }).join('') + `</svg>`;
}

// 横棒（使い道・分野・教材）
function hbars(items, { color = null, max = null, unit = '件', wide = false } = {}) {
  const m = max || Math.max(...items.map(i => i.v));
  return `<div class="hbars${wide ? ' wide' : ''}">` + items.map(it => `
    <div class="hrow" title="${esc(it.label)}　${fmt(it.v)} ${unit}">
      <div class="hlabel">${it.href ? `<a href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.label)}</a>` : esc(it.label)}</div>
      <div class="htrack"><div class="hfill${it.muted ? ' muted' : ''}" style="width:${(it.v / m * 100).toFixed(1)}%;${it.color ? `background:var(${it.color})` : ''}"></div></div>
      <div class="hval">${fmt(it.v)}${it.pct != null ? `<span class="pct">${it.pct}%</span>` : ''}</div>
    </div>`).join('') + `</div>`;
}

// ---- 1. 利用の全体 ----
const monthTurns = columns(monthKeys.map(m => ({
  label: monthLabel(m) + (m === partialMonth ? '*' : ''), v: months[m].turns,
  tip: `${m}${m === partialMonth ? partialNote : ''} の質問`,
})));
const monthConvs = columns(monthKeys.map(m => ({
  label: monthLabel(m) + (m === partialMonth ? '*' : ''), v: months[m].convs,
  tip: `${m}${m === partialMonth ? partialNote : ''} の会話`,
})));

// ---- 2. いつ ----
const hourItems = Array.from({ length: 24 }, (_, h) => ({ label: h % 3 === 0 ? `${h}時` : '', v: D.hour[h] || 0, tip: `${h}時台` }));
const dowOrder = ['月', '火', '水', '木', '金', '土', '日'];
const dowItems = dowOrder.map(k => ({ label: k, v: D.dow[k] || 0, tip: `${k}曜日`, muted: k === '土' || k === '日' }));
const schoolHours = sum([9, 10, 11, 12].map(h => D.hour[h] || 0));
const homeHours = sum([17, 18, 19, 20].map(h => D.hour[h] || 0));
const weekday = sum(['月', '火', '水', '木', '金'].map(k => D.dow[k] || 0));

// ---- 3. 何に ----
const purposeTotals = Object.entries(D.purpose).map(([k, v]) => ({ key: k, label: k.replace('いせちゃん', 'ISEちゃん'), v: sum(Object.values(v)) }))
  .sort((a, b) => b.v - a.v);
const purposeAll = sum(purposeTotals.map(p => p.v));
const scienceKeys = ['理科の質問・実験の相談', '理科の教材や資料をさがす'];
purposeTotals.forEach(p => { p.pct = Math.round(p.v / purposeAll * 100); p.muted = !scienceKeys.includes(p.key); });
const sciencePurpose = sum(purposeTotals.filter(p => scienceKeys.includes(p.key)).map(p => p.v));
const sciencePct = Math.round(sciencePurpose / purposeAll * 100);
const otherSubjAug = (D.purpose['他の教科の勉強'] || {})['08'] || 0;

// ---- 4. 分野 ----
const unitColors = { '物理': '--series-1', '化学': '--series-2', '生物': '--series-3', '地学': '--series-4' };
const unitTotals = Object.entries(D.unit).map(([k, v]) => ({ label: k, v: sum(Object.values(v)), color: unitColors[k] }));
const unitAll = sum(unitTotals.map(u => u.v));
unitTotals.forEach(u => { u.pct = Math.round(u.v / unitAll * 100); });
const unitSorted = [...unitTotals].sort((a, b) => b.v - a.v);
const unitMonths = [...new Set(Object.values(D.unit).flatMap(v => Object.keys(v)))].sort();
function unitStack() {
  const h = 200, f = frame(h, Math.max(...unitMonths.map(m => sum(Object.values(D.unit).map(v => v[m] || 0)))));
  const slot = (W - 8 - f.padL) / unitMonths.length, bw = Math.min(64, slot * 0.55);
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="月別・分野別の質問数">${f.grid}` + unitMonths.map((m, i) => {
    const cx = f.padL + slot * i + slot / 2;
    let acc = 0, segs = '';
    for (const u of ['物理', '化学', '生物', '地学']) {
      const v = (D.unit[u] || {})[m] || 0;
      if (!v) continue;
      const y0 = f.y(acc), y1 = f.y(acc + v);
      segs += `<rect x="${cx - bw / 2}" y="${y1 + 1}" width="${bw}" height="${Math.max(0, y0 - y1 - 2)}" rx="2" style="fill:var(${unitColors[u]})"><title>${Number(m)}月　${u} ${fmt(v)} 件</title></rect>`;
      acc += v;
    }
    const lbl = `${Number(m)}月${('2026-' + m) === partialMonth ? '*' : ''}`;
    return segs + `<text x="${cx}" y="${f.y(acc) - 6}" text-anchor="middle" class="direct">${fmt(acc)}</text>` +
      `<text x="${cx}" y="${h - 6}" text-anchor="middle" class="tick">${lbl}</text>`;
  }).join('') + `</svg>`;
}

// ---- 5. 教材 ----
const matItems = D.materials.map(m => ({ label: m.title, v: m.n, href: `https://ise-rika.cf.ocha.ac.jp/${m.id}` }));

// ---- 総括（数字から組み立てる。毎日の更新で自動で変わる） ----
const spanMonths = Math.max(1, Math.round(days.length / 30.4));
const busiestMonth = monthKeys.reduce((a, b) => (months[b].turns > months[a].turns ? b : a));
const summary = `記録を始めた${Number(D.since.slice(5, 7))}月${Number(D.since.slice(8))}日から約${spanMonths}か月で、ISEちゃんには <b>${fmt(totalTurns)} 件</b>の質問が寄せられ、${days.length}日のうち <b>${activeDays}日</b>で使われました。` +
  `いちばん多く使われたのは${monthLabel(busiestMonth)}（${fmt(months[busiestMonth].turns)} 件）です。` +
  `朝の授業の時間帯と、夕方の家庭での時間帯の両方で使われており、学校と家庭の両方で学びを支えています。` +
  `理科の質問では${unitSorted[0].label}がいちばん多く（${unitSorted[0].pct}%）、回答の中で理科教材データベースの教材ページを <b>${fmt(totalLinks)} 回</b>案内しました。` +
  `よく案内した教材は「${esc(D.materials[0].title)}」です。`;

// ---- 実際のやり取り（直近14日・最大30件） ----
function recentSection() {
  const R = D.recent || [];
  if (!R.length) return '';
  const short = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);
  const items = R.map(r => {
    const label = r.cat ? r.cat.replace('いせちゃん', 'ISEちゃん') : '';
    const longA = r.answer.length > 160;
    return `<article class="conv">
<div class="meta"><span>${esc(r.jst.replace(/-/g, '/'))}</span>${label ? `<span class="tag">${esc(label)}</span>` : ''}${r.turns > 1 ? `<span class="turns">この会話で ${fmt(r.turns)} 往復</span>` : ''}</div>
<p class="q"><b>質問</b>${esc(r.question)}</p>
${longA ? `<details class="a"><summary><b>ISEちゃん</b>${esc(short(r.answer, 160))}</summary><p>${esc(r.answer)}</p></details>`
        : `<p class="a"><b>ISEちゃん</b>${esc(r.answer)}</p>`}
</article>`;
  }).join('');
  return `<section>
<h2>実際のやり取り（直近2週間）</h2>
<p class="lead">ISEちゃんとの会話から、新しいものを最大30件載せています。各会話の最初の質問と、ISEちゃんの最初の回答です。長い回答は押すと全文が開きます。</p>
<div class="convs">${items}</div>
<p class="notes">それより前の会話の全文が必要な場合は、ご連絡いただければ表計算ソフトで開ける形でお送りします。</p>
</section>`;
}

// ---- 表（グラフの数字を表でも） ----
const monthTable = `<table><thead><tr><th>月</th><th>質問</th><th>会話</th></tr></thead><tbody>` +
  monthKeys.map(m => `<tr><td>${m}${m === partialMonth ? partialNote : ''}</td><td>${fmt(months[m].turns)}</td><td>${fmt(months[m].convs)}</td></tr>`).join('') +
  `<tr class="total"><td>合計</td><td>${fmt(totalTurns)}</td><td>${fmt(totalConvs)}</td></tr></tbody></table>`;

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ISEちゃん 利用レポート</title>
<style>
:root{color-scheme:light;--bg:#f6f5f2;--surface-1:#fcfcfb;--border:#e4e2dc;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#7a7873;
--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--accent:#2a78d6;--accent-soft:rgba(42,120,214,.14);--muted-bar:#c9c6bd;--grid:#ebe9e3}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--bg:#121211;--surface-1:#1a1a19;--border:#2e2d2a;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#9a988f;
--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--accent:#3987e5;--accent-soft:rgba(57,135,229,.18);--muted-bar:#4a4944;--grid:#2a2927}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#121211;--surface-1:#1a1a19;--border:#2e2d2a;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#9a988f;
--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--accent:#3987e5;--accent-soft:rgba(57,135,229,.18);--muted-bar:#4a4944;--grid:#2a2927}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text-primary);font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;line-height:1.7}
.wrap{max-width:820px;margin:0 auto;padding:24px 16px 64px}
header h1{font-size:26px;margin:0 0 4px}header p{margin:0;color:var(--text-secondary);font-size:14px}
section{background:var(--surface-1);border:1px solid var(--border);border-radius:14px;padding:20px 20px 16px;margin-top:20px}
h2{font-size:19px;margin:0 0 4px}.lead{color:var(--text-secondary);font-size:14px;margin:0 0 12px}
h3{font-size:15px;margin:18px 0 4px;color:var(--text-secondary)}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:8px 0 4px}
.tile{border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.tile .n{font-size:30px;font-weight:700;line-height:1.2}.tile .n small{font-size:14px;font-weight:600;margin-left:2px}
.tile .k{font-size:13px;color:var(--text-secondary)}
@media (max-width:640px){.tiles{grid-template-columns:repeat(2,1fr)}.tile .n{font-size:24px}}
svg{width:100%;height:auto;display:block;overflow:visible}
.grid{stroke:var(--grid);stroke-width:1}.tick{fill:var(--text-muted);font-size:11px}
.bar{fill:var(--accent)}.bar.muted{fill:var(--muted-bar)}.line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round}
.area{fill:var(--accent-soft)}.dot{fill:var(--accent);stroke:var(--surface-1);stroke-width:2}
.direct{fill:var(--text-secondary);font-size:11px;font-weight:600}
.hit:hover .bar{opacity:.8}
.hbars{display:flex;flex-direction:column;gap:8px;margin:6px 0}
.hrow{display:grid;grid-template-columns:minmax(0,15em) 1fr 5.5em;gap:10px;align-items:center;font-size:14px}
.hbars.wide .hrow{grid-template-columns:1fr 4.5em}.hbars.wide .htrack{grid-column:1/3;grid-row:2}.hbars.wide .hlabel{white-space:normal}
.hlabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hlabel a{color:var(--text-primary)}
.htrack{height:14px;background:var(--grid);border-radius:4px;overflow:hidden}.hfill{height:100%;background:var(--accent);border-radius:4px}.hfill.muted{background:var(--muted-bar)}
.hval{text-align:right;font-variant-numeric:tabular-nums}.pct{color:var(--text-muted);font-size:12px;margin-left:6px}
@media (max-width:640px){.hrow{grid-template-columns:1fr 4.5em}.htrack{grid-column:1/3;grid-row:2}}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--text-secondary);margin:6px 0}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.summary{background:var(--surface-1);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:12px;padding:14px 18px;margin-top:18px;font-size:15px}
.summary h2{font-size:16px;margin:0 0 4px}.summary p{margin:0}
.point{background:var(--accent-soft);border-radius:10px;padding:10px 14px;font-size:14px;margin:10px 0 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media (max-width:640px){.two{grid-template-columns:1fr}}
details{margin-top:10px;font-size:13px;color:var(--text-secondary)}table{border-collapse:collapse;margin-top:6px}td,th{padding:3px 12px;border-bottom:1px solid var(--border);text-align:right}td:first-child,th:first-child{text-align:left}tr.total td{font-weight:700}
.convs{display:flex;flex-direction:column;gap:10px}
.conv{border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:14px}
.conv .meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--text-muted);margin-bottom:4px}
.conv .tag{background:var(--accent-soft);color:var(--text-secondary);border-radius:6px;padding:0 6px}
.conv p{margin:4px 0;white-space:pre-wrap;word-break:break-word}.conv b{display:inline-block;margin-right:8px;font-size:12px;color:var(--text-secondary)}
.conv details summary{cursor:pointer;list-style:none;white-space:pre-wrap}.conv details summary::after{content:' 続きを読む';color:var(--accent);font-size:12px}
.conv details[open] summary{display:none}
.notes{font-size:13px;color:var(--text-secondary)}.notes li{margin:4px 0}
footer{margin-top:20px;font-size:12px;color:var(--text-muted)}
</style></head><body><div class="wrap">
<header><h1>ISEちゃん 利用レポート</h1>
<p>お茶の水女子大学 理科教材データベースの AI アシスタント「ISEちゃん」の利用状況　｜　記録開始 ${D.since.replace(/-/g, '/')}　｜　更新 ${esc(stamp || '')}</p></header>

<div class="summary"><h2>まとめ</h2><p>${summary}</p></div>

<section>
<h2>これだけ使われています</h2>
<p class="lead">記録を始めた ${Number(D.since.slice(5, 7))}月${Number(D.since.slice(8))}日からの合計です。</p>
<div class="tiles">
<div class="tile"><div class="n">${fmt(totalTurns)}<small>件</small></div><div class="k">ISEちゃんへの質問</div></div>
<div class="tile"><div class="n">${fmt(totalConvs)}<small>件</small></div><div class="k">会話の数</div></div>
<div class="tile"><div class="n">${fmt(activeDays)}<small>日</small></div><div class="k">使われた日（${days.length}日のうち）</div></div>
<div class="tile"><div class="n">${fmt(totalLinks)}<small>回</small></div><div class="k">教材ページを案内した回答</div></div>
</div>
<h3>質問数の累計</h3>
${cumulativeLine()}
<h3>日ごとの質問数</h3>
${dailyBars()}
<h3>月ごとの質問数</h3>${monthTurns}
<h3>月ごとの会話の数</h3>${monthConvs}
<p class="notes">* ${monthLabel(partialMonth)}は${partialNote.replace(/[（）]/g, '')}の数字です。「会話」は ISEちゃんとのひと続きのやりとり、「質問」はその中で送られた1回1回の入力です。</p>
<details><summary>月ごとの数字を表で見る</summary>${monthTable}</details>
</section>

<section>
<h2>いつ使われているか</h2>
<p class="lead">時間帯と曜日ごとの質問数です（記録開始からの合計）。</p>
<h3>時間帯</h3>
${columns(hourItems, { h: 180, valueLabels: false })}
<h3>曜日</h3>
${columns(dowItems, { h: 180 })}
<p class="point">朝 9〜12時に大きな山（${fmt(schoolHours)} 件）、夕方 17〜20時にもう一つの山（${fmt(homeHours)} 件）があります。平日が全体の ${Math.round(weekday / totalTurns * 100)}% を占めており、授業の中での利用と、家に帰ってからの利用の両方があることがうかがえます。</p>
</section>

<section>
<h2>どんなことに使われているか</h2>
<p class="lead">会話の最初の質問を、内容から8つに分けました（${fmt(purposeAll)} 件）。青が理科に関するものです。</p>
${hbars(purposeTotals)}
<p class="point">理科の質問・実験の相談と教材さがしを合わせると ${fmt(sciencePurpose)} 件（${sciencePct}%）で、理科の学びに使われている会話が大きな柱です。あわせて、ほかの教科の勉強や作文・発表の手伝いなど、学習全般の相談相手としても使われています。ほかの教科の質問は夏休みの8月に ${fmt(otherSubjAug)} 件と大きく増えており、宿題の時期と重なっています。</p>
</section>

<section>
<h2>理科のどの分野が聞かれているか</h2>
<p class="lead">理科に関する質問（${fmt(unitAll)} 件）を、物理・化学・生物・地学に分けました。</p>
<div class="legend">${unitTotals.map(u => `<span><i style="background:var(${u.color})"></i>${u.label}</span>`).join('')}</div>
${hbars(unitSorted)}
<h3>月ごとの分野の内訳</h3>
${unitStack()}
<p class="point">${unitSorted[0].label}（${unitSorted[0].pct}%）がいちばん多く、次いで${unitSorted[1].label}（${unitSorted[1].pct}%）です。</p>
</section>

<section>
<h2>人気の教材</h2>
<p class="lead">ISEちゃんが回答の中で案内した、理科教材データベースの教材ページの上位です。題名から教材ページを開けます。</p>
${hbars(matItems, { unit: '回', wide: true })}
</section>

${recentSection()}

<section>
<h2>このレポートについて</h2>
<ul class="notes">
<li>数字は、ISEちゃんの対話の記録（${D.since.replace(/-/g, '/')} から）を集計したものです。それより前の利用は記録していません。</li>
<li>利用者を区別する情報（名前・端末など）は記録していないため、「何人が使ったか」は分かりません。「会話の数」がおおよその目安になります。</li>
<li>「どんなことに使われているか」「分野」の分類は、AI が質問の文面から判断したもので、目安としてご覧ください。</li>
<li>「実際のやり取り」は直近2週間の会話から最大30件です。それより前の会話の全文が必要な場合は、ご連絡いただければ表計算ソフトで開ける形でお送りします。</li>
</ul>
</section>
<footer>株式会社インネクサス</footer>
</div></body></html>`;

fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB) turns=${totalTurns} convs=${totalConvs} days=${activeDays}/${days.length}`);
