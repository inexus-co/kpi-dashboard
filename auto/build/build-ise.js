#!/usr/bin/env node
/*
 * build-ise.js
 * いせちゃん（ise-rika 対話AI）対話ログダッシュボードの「内側HTML(平文)」を生成する。
 * データは生成時に焼き込み、SVGチャートも生データから座標計算する（Chart.js等は使わない）。
 * 暗号化は別途 encrypt-wrap.js が担当（既存の build-kids.js と同じ「inner生成 → encrypt-wrap」方式）。
 *
 * 入力 : <raw.json>       … BigQuery execute_sql_readonly の返却JSONそのまま（ise-queries.sql の実行結果）
 *        [ai.json]        … AI分類 {classifications:{<会話の起点response_id>: "learn"|"chat"|"find"}}（任意・無ければ質問の内訳は非表示）
 * 出力 : <out_inner.html> … 平文の自己完結ダッシュボードHTML
 *
 * 使い方: node auto/build/build-ise.js <raw.json> <out_inner.html> [updated] [ai.json]
 */
"use strict";
const fs = require("fs");

const [, , RAW, OUT, updatedArg, aiArg] = process.argv;
if (!RAW || !OUT) {
  console.error("usage: node build-ise.js <raw.json> <out_inner.html> [updated] [ai.json]");
  process.exit(1);
}

// ---------- BigQuery結果のパース（build-kids.js と同じ unwrap 方式） ----------
function unwrap(obj) {
  if (typeof obj === "string") obj = JSON.parse(obj);
  if (obj && typeof obj === "object") {
    if ("schema" in obj && "rows" in obj) return obj;
    if (obj.structuredContent) return unwrap(obj.structuredContent);
    if (Array.isArray(obj.content) && obj.content[0] && "text" in obj.content[0]) {
      return unwrap(obj.content[0].text);
    }
  }
  throw new Error("BigQuery結果の形式を認識できません");
}
function loadRows(filePath) {
  const obj = unwrap(JSON.parse(fs.readFileSync(filePath, "utf8")));
  const fields = (obj.schema && obj.schema.fields ? obj.schema.fields : []).map((f) => f.name);
  return (obj.rows || []).map((row) => {
    const rec = {};
    (row.f || []).forEach((cell, i) => { rec[fields[i]] = cell ? cell.v : null; });
    return rec;
  });
}

let ai = { classifications: {} };
if (aiArg && fs.existsSync(aiArg)) {
  try { ai = JSON.parse(fs.readFileSync(aiArg, "utf8")); } catch (e) { /* AI分類なしで続行 */ }
}

// ---------- 生データ → ターン配列 ----------
// jst の型は DATETIME (BigQuery) で "YYYY-MM-DDTHH:MM:SS.ssssss" 形式。JSTのまま扱う（TZ変換しない）。
function parseJst(s) { return new Date(s.replace(" ", "T") + "Z"); } // UTCとして解釈しミリ秒比較用の相対値だけ使う

const rows = loadRows(RAW)
  .filter((r) => r.question != null)
  .map((r) => ({
    ts: parseJst(r.jst),
    jst: r.jst,
    question: r.question || "",
    answer: r.answer || "",
    answerLen: (r.answer || "").length,
    error: r.error === true || r.error === "true",
    rid: r.rid || null,
    prevRid: r.prevRid || null,
  }))
  .sort((a, b) => a.ts - b.ts);

// ---------- ターン → 会話へグルーピング（response_id → previous_response_id の連鎖） ----------
const byRid = new Map(rows.map((t) => [t.rid, t]));
function rootOf(t) {
  let cur = t;
  const seen = new Set();
  while (cur.prevRid && byRid.has(cur.prevRid) && !seen.has(cur.rid)) {
    seen.add(cur.rid);
    cur = byRid.get(cur.prevRid);
  }
  return cur.rid || t.rid;
}
const convMap = new Map();
for (const t of rows) {
  const rootId = rootOf(t);
  if (!convMap.has(rootId)) convMap.set(rootId, []);
  convMap.get(rootId).push(t);
}
const conversations = [...convMap.entries()]
  .map(([rootId, turns]) => {
    turns.sort((a, b) => a.ts - b.ts);
    return {
      rootId,
      turns,
      startTs: turns[0].ts,
      endTs: turns[turns.length - 1].ts,
      firstQuestion: turns[0].question,
    };
  })
  .sort((a, b) => a.startTs - b.startTs);

// ---------- 集計 ----------
const totalTurns = rows.length;
const totalConvs = conversations.length;
const totalErrors = rows.filter((t) => t.error).length;
const avgTurns = totalConvs ? totalTurns / totalConvs : 0;
const longest = conversations.reduce((a, b) => (b.turns.length > (a ? a.turns.length : 0) ? b : a), null);

const MATERIAL_RE = /https:\/\/ise-rika\.cf\.ocha\.ac\.jp\/(\d+)/g;
// 同じ行に説明文があればそれをそのまま使う（1行完結の箇条書き向け）。
// URLだけの行（説明が上の行に分かれている箇条書き）のときだけ、空行に当たるまで遡って連結する。
function materialContext(lines, lineIdx, url) {
  const sameLine = lines[lineIdx].replace(url, "").trim();
  if (sameLine.length > 3) return sameLine;
  const parts = [];
  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 3); i--) {
    const t = lines[i].trim();
    if (!t) break;
    parts.unshift(t);
  }
  return parts.join(" ");
}
function materialLabelAndGrade(context, id) {
  const gradeMatch = context.match(/(小\d|中\d)\s*向け/);
  let label = gradeMatch ? context.slice(0, gradeMatch.index) : context;
  label = label.replace(/^[\s\d.．、・\-]+/, "").split("／")[0].trim();
  if (!label) label = context.replace(/^[\s\d.．、・\-]+/, "").trim();
  return { label: label ? label.slice(0, 40) : `教材 #${id}`, grade: gradeMatch ? gradeMatch[0].replace(/\s+/g, "") : "" };
}
const materials = new Map(); // id -> {id, url, label, grade, count}
for (const t of rows) {
  const lines = t.answer.split("\n");
  lines.forEach((line, lineIdx) => {
    let m;
    const re = new RegExp(MATERIAL_RE);
    while ((m = re.exec(line))) {
      const id = m[1];
      const url = m[0];
      const context = materialContext(lines, lineIdx, url);
      const cur = materials.get(id);
      if (cur) cur.count += 1;
      else materials.set(id, { id, url, count: 1, ...materialLabelAndGrade(context, id) });
    }
  });
}
const materialList = [...materials.values()].sort((a, b) => b.count - a.count);

const convClassCounts = { learn: 0, chat: 0, find: 0, unclassified: 0 };
for (const c of conversations) {
  const cls = ai.classifications && ai.classifications[c.rootId];
  const key = cls === "learn" || cls === "chat" || cls === "find" ? cls : "unclassified";
  convClassCounts[key] += c.turns.length;
}
const hasClassification = convClassCounts.unclassified < totalTurns;

// 時間帯（0-5/6-11/12-17/18-23）と日別
const HOUR_BUCKETS = [
  { key: "night", label: "深夜 0–5時", from: 0, to: 5 },
  { key: "morning", label: "朝 6–11時", from: 6, to: 11 },
  { key: "noon", label: "昼 12–17時", from: 12, to: 17 },
  { key: "evening", label: "夜 18–23時", from: 18, to: 23 },
];
const hourCounts = HOUR_BUCKETS.map((b) => ({
  ...b,
  count: rows.filter((t) => t.ts.getUTCHours() >= b.from && t.ts.getUTCHours() <= b.to).length,
})).filter((b) => b.count > 0);

const dayMap = new Map();
for (const t of rows) {
  const day = t.jst.slice(0, 10);
  if (!dayMap.has(day)) dayMap.set(day, { turns: 0, convs: new Set() });
  const d = dayMap.get(day);
  d.turns += 1;
  d.convs.add(rootOf(t));
}
const allDays = [...dayMap.entries()].map(([day, d]) => ({ day, turns: d.turns, convs: d.convs.size }));
const recentDays = allDays.slice(-7);

// ---------- SVGチャート座標計算（応答文字数の時系列） ----------
const CHART_W = 720, CHART_H = 210, PAD_L = 8, PAD_R = 8, PAD_TOP = 16, PAD_BOTTOM = 34;
const plotTop = PAD_TOP, plotBottom = CHART_H - PAD_BOTTOM, plotLeft = PAD_L, plotRight = CHART_W - PAD_R;
const tMin = rows.length ? rows[0].ts.getTime() : 0;
const tMax = rows.length ? rows[rows.length - 1].ts.getTime() : 1;
const tSpan = Math.max(tMax - tMin, 1);
const lenMax = rows.length ? Math.max(...rows.map((t) => t.answerLen)) : 1;
function xOf(t) { return plotLeft + ((t.ts.getTime() - tMin) / tSpan) * (plotRight - plotLeft); }
function yOf(len) { return plotBottom - (len / lenMax) * (plotBottom - plotTop); }
const points = rows.map((t) => ({ x: xOf(t), y: yOf(t.answerLen), t }));
const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const areaPath = points.length
  ? `M${points[0].x.toFixed(1)},${plotBottom} ` +
    points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${points[points.length - 1].x.toFixed(1)},${plotBottom} Z`
  : "";
const peak = rows.length ? rows.reduce((a, b) => (b.answerLen > a.answerLen ? b : a)) : null;
const peakPoint = peak ? { x: xOf(peak), y: yOf(peak.answerLen) } : null;
const convStarts = conversations.slice(1).map((c) => ({ x: xOf(c.turns[0]), label: c.firstQuestion.slice(0, 10) }));
const gridMidLabel = Math.round((lenMax / 2) / 50) * 50;

// ---------- HTMLエスケープ ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function truncate(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }

const CLASS_LABEL = { learn: "学ぶ・つくる（学習支援・記述作成）", chat: "きもち・ざつだん（雑談・見守り）", find: "教材をさがす（教材検索）" };
const CLASS_COLOR = { learn: "var(--copper)", chat: "var(--coral)", find: "var(--teal)" };

const updated = updatedArg || new Date().toISOString();
const dataRangeLabel = rows.length ? `${rows[0].jst.slice(0, 16).replace("T", " ")} → ${rows[rows.length - 1].jst.slice(0, 16).replace("T", " ")}` : "データなし";
const daySpan = allDays.length;

const CONV_DISPLAY_LIMIT = 50;
const MATERIAL_DISPLAY_LIMIT = 24;
const convsToShow = conversations.slice(-CONV_DISPLAY_LIMIT).reverse();
const convOmitted = conversations.length - convsToShow.length;
const materialsToShow = materialList.slice(0, MATERIAL_DISPLAY_LIMIT);
const materialsOmitted = materialList.length - materialsToShow.length;

// ---------- HTMLセクション生成 ----------
function renderSpecimens() {
  if (!rows.length) return "";
  const n = Math.min(5, rows.length);
  const step = Math.max(1, Math.floor(rows.length / n));
  const picks = [];
  for (let i = 0; i < rows.length && picks.length < n; i += step) picks.push(rows[i]);
  return picks
    .map((t) => `<span class="spec"><span class="t">${esc(t.jst.slice(11, 16))}</span><span class="q">${esc(truncate(t.question, 22))}</span></span>`)
    .join("\n          ");
}

function renderIntentPanel() {
  if (!hasClassification) {
    return `<div class="panel">
        <h3>質問の内訳</h3>
        <p class="phint">AIによる分類はまだありません（次回以降のAI集計で表示されます）</p>
      </div>`;
  }
  const total = totalTurns || 1;
  const rows2 = ["learn", "chat", "find"]
    .map((k) => ({ k, n: convClassCounts[k], pct: Math.round((convClassCounts[k] / total) * 100) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  return `<div class="panel">
        <h3>質問の内訳</h3>
        <p class="phint">「何のために聞いている？」をAIが分類（全${total}ターン）</p>
        <div class="bars in-target">
          ${rows2
            .map(
              (r) => `<div class="brow">
            <div class="btop"><span class="name">${CLASS_LABEL[r.k]}</span><span class="val"><b>${r.n}</b> ／ ${r.pct}%</span></div>
            <div class="track"><span class="bar" style="--w:${r.pct}%;--c:${CLASS_COLOR[r.k]}"></span></div>
          </div>`
            )
            .join("\n          ")}
        </div>
      </div>`;
}

function renderTimePanel() {
  const total = totalTurns || 1;
  const bars = hourCounts
    .sort((a, b) => b.count - a.count)
    .map((b) => `<div class="brow">
            <div class="btop"><span class="name">${b.label}</span><span class="val"><b>${b.count}</b> ／ ${Math.round((b.count / total) * 100)}%</span></div>
            <div class="track"><span class="bar" style="--w:${Math.round((b.count / total) * 100)}%;--c:var(--blue)"></span></div>
          </div>`).join("\n          ");
  const days = recentDays
    .map((d) => `<div class="day"><span class="d">${esc(d.day)}</span><div class="n num">${d.turns}<span class="su"> ターン</span></div><span class="d">${d.convs} 会話</span></div>`)
    .join("\n          ");
  return `<div class="panel">
        <h3>いつ聞いている？</h3>
        <p class="phint">時間帯別のやりとり数（全${total}ターン）</p>
        <div class="bars in-target">
          ${bars}
        </div>
        <div class="daysplit">
          ${days}
        </div>
      </div>`;
}

function renderChart() {
  if (!rows.length) return `<p class="insight">データがまだありません。</p>`;
  const gridLines = `<line x1="${plotLeft}" y1="${plotTop}" x2="${plotRight}" y2="${plotTop}"/><line x1="${plotLeft}" y1="${((plotTop + plotBottom) / 2).toFixed(1)}" x2="${plotRight}" y2="${((plotTop + plotBottom) / 2).toFixed(1)}"/><line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"/>`;
  const boundaries = convStarts
    .map((c) => `<line x1="${c.x.toFixed(1)}" y1="${plotTop + 4}" x2="${c.x.toFixed(1)}" y2="${plotBottom}"/>`)
    .join("");
  const boundaryLabels = convStarts
    .map((c) => `<text class="glab" x="${Math.min(c.x + 3, plotRight - 60).toFixed(1)}" y="${plotTop + 14}">${esc(c.label)}</text>`)
    .join("");
  const peakLabel = peak
    ? `<circle class="peakdot" cx="${peakPoint.x.toFixed(1)}" cy="${peakPoint.y.toFixed(1)}" r="4.5" fill="#B4652E"/>
      <text class="peak peaklabel" x="${Math.max(peakPoint.x - 6, 90).toFixed(1)}" y="${(peakPoint.y - 2).toFixed(1)}" text-anchor="end">${peak.answerLen.toLocaleString()}字 ・ ${esc(truncate(peak.question, 16))}</text>`
    : "";
  return `<div class="chartbox">
        <svg viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="応答文字数の時系列。最大は${peak ? peak.answerLen : 0}字。">
          <g stroke="#CBD7E0" stroke-width="1">${gridLines}</g>
          <text class="axis" x="${plotLeft}" y="${plotTop - 4}">字数</text>
          <text class="axis" x="${plotLeft}" y="${((plotTop + plotBottom) / 2 + 3).toFixed(1)}">${gridMidLabel}</text>
          <text class="axis" x="${plotLeft}" y="${plotBottom + 12}">0</text>
          <g stroke="#728398" stroke-width="1" stroke-dasharray="3 4" opacity=".45">${boundaries}</g>
          ${boundaryLabels}
          <path class="depthfill" fill="rgba(29,98,179,.14)" d="${areaPath}"/>
          <path class="depthline" fill="none" stroke="#1D62B3" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pathLength="1" d="${linePath}"/>
          ${peakLabel}
        </svg>
      </div>`;
}

function renderThreads() {
  if (!convsToShow.length) return `<p class="insight">会話がまだありません。</p>`;
  const threads = convsToShow
    .map((c) => {
      const when = c.turns.length > 1 ? `${c.startTs.toISOString().slice(5, 10).replace("-", "-")} ${c.turns[0].jst.slice(11, 16)} → ${c.turns[c.turns.length - 1].jst.slice(11, 16)}` : `${c.turns[0].jst.slice(0, 10)} ${c.turns[0].jst.slice(11, 16)}`;
      const cls = (ai.classifications && ai.classifications[c.rootId]) || null;
      const chip = cls ? `<span class="chip ${cls === "learn" ? "learn" : cls === "find" ? "find" : "chat"}">${CLASS_LABEL[cls].split("（")[0]}</span>` : "";
      const turnsHtml = c.turns
        .map(
          (t) => `<div class="turn">
            <div class="msg q"><span class="ava">Q</span><span class="body">${esc(t.question)}</span></div>
            <div class="msg a"><span class="ava">い</span><span class="body">${esc(truncate(t.answer.replace(/\s+/g, " "), 120))}</span></div>
          </div>`
        )
        .join("\n          ");
      return `<article class="thread">
        <div class="thead">
          <span class="when">${esc(when)}</span>
          ${chip}
          <span class="turns-badge"><b>${c.turns.length}</b> ターン</span>
        </div>
        <div class="turns">
          ${turnsHtml}
        </div>
      </article>`;
    })
    .join("\n\n      ");
  const omitNote = convOmitted > 0 ? `<p class="insight">※ 直近${CONV_DISPLAY_LIMIT}件を表示（他 ${convOmitted}件は割愛）</p>` : "";
  return threads + "\n      " + omitNote;
}

function renderMaterials() {
  if (!materialsToShow.length) return `<p class="insight">案内された教材はまだありません。</p>`;
  const items = materialsToShow
    .map(
      (m) => `<a class="mat" href="${esc(m.url)}" target="_blank" rel="noopener"><span class="id">#${esc(m.id)}</span><span><span class="mt">${esc(m.label)}</span><span class="grade">${esc(m.grade)}${m.count > 1 ? `　${m.count}回言及` : ""}</span></span></a>`
    )
    .join("\n      ");
  const omitNote = materialsOmitted > 0 ? `<p class="insight">※ 言及回数の多い${MATERIAL_DISPLAY_LIMIT}件を表示（他 ${materialsOmitted}件は割愛）</p>` : "";
  return `<div class="mats">
      ${items}
    </div>
    ${omitNote}`;
}

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>いせちゃん 対話ログ</title>
<style>
  :root{
    --paper:#E7EDF1;
    --paper-line:#D6E0E7;
    --card:#FBFCFE;
    --card-2:#F2F6F9;
    --ink:#152742;
    --ink-2:#3D5069;
    --ink-3:#728398;
    --rule:#CBD7E0;
    --blue:#1D62B3;
    --blue-deep:#123F73;
    --copper:#B4652E;
    --teal:#0C877D;
    --coral:#D2504E;
    --amber:#C98A12;
    --good:#2C8A6B;

    --jp:"Hiragino Kaku Gothic ProN","Hiragino Sans","BIZ UDPGothic","Yu Gothic",YuGothic,"Meiryo",sans-serif;
    --jp-round:"Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN","Yu Gothic",var(--jp);
    --mono:ui-monospace,"SF Mono",SFMono-Regular,"Menlo","Consolas","Roboto Mono",monospace;

    --wrap:1080px;
  }

  *{box-sizing:border-box}
  body{margin:0}
  .page{
    font-family:var(--jp);
    color:var(--ink);
    background-color:var(--paper);
    background-image:
      linear-gradient(var(--paper-line) 1px,transparent 1px),
      linear-gradient(90deg,var(--paper-line) 1px,transparent 1px);
    background-size:26px 26px;
    background-position:-1px -1px;
    line-height:1.72;
    -webkit-font-smoothing:antialiased;
    padding:clamp(18px,4vw,52px) clamp(16px,4vw,40px) 72px;
  }
  .wrap{max-width:var(--wrap);margin:0 auto}

  a{color:var(--blue-deep);text-underline-offset:3px;text-decoration-thickness:1px}
  a:focus-visible{outline:2px solid var(--blue);outline-offset:3px;border-radius:2px}

  .eyebrow{
    font-family:var(--mono);
    font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;
    color:var(--ink-3);margin:0 0 14px;
  }
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}

  .flow{display:flex;flex-direction:column;gap:clamp(2.6rem,6vw,4.2rem)}

  .mast{
    position:relative;
    background:var(--card);
    border:1px solid var(--rule);
    border-radius:8px;
    padding:clamp(22px,4vw,44px);
    box-shadow:0 1px 0 #fff inset, 0 18px 40px -30px rgba(18,63,115,.55);
    overflow:hidden;
  }
  .mast::before{
    content:"い";
    font-family:var(--jp-round);font-weight:700;
    position:absolute;top:-14px;right:22px;
    width:52px;height:52px;line-height:52px;text-align:center;
    background:var(--blue);color:#fff;border-radius:50%;
    box-shadow:0 8px 18px -8px rgba(29,98,179,.9);
    font-size:1.4rem;
  }
  .mast-grid{display:grid;grid-template-columns:1.35fr .9fr;gap:clamp(20px,4vw,44px);align-items:start}
  h1{
    font-family:var(--jp);font-weight:700;
    font-size:clamp(1.85rem,4.6vw,3.05rem);
    line-height:1.24;letter-spacing:.01em;margin:0 0 16px;
    text-wrap:balance;
  }
  h1 .hl{
    background:linear-gradient(180deg,transparent 62%,rgba(29,98,179,.20) 62%);
    padding:0 .06em;
  }
  .lead{font-size:1.02rem;color:var(--ink-2);margin:0 0 20px;max-width:40ch}
  .metaline{
    font-family:var(--mono);font-size:.74rem;color:var(--ink-3);
    letter-spacing:.02em;line-height:1.9;
    border-top:1px dashed var(--rule);padding-top:14px;
    word-break:break-word;
  }
  .metaline b{color:var(--ink-2);font-weight:600}

  .headline{
    display:flex;flex-direction:column;gap:14px;
    background:var(--card-2);border:1px solid var(--rule);border-radius:8px;
    padding:20px 22px;
  }
  .hstat{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
  .hstat + .hstat{border-top:1px solid var(--rule);padding-top:14px}
  .hstat .k{font-size:.92rem;color:var(--ink-2)}
  .hstat .v{font-family:var(--mono);font-weight:600;font-size:clamp(2rem,5vw,2.7rem);line-height:1;color:var(--ink)}
  .hstat .v.zero{color:var(--good)}
  .hstat .u{font-size:.78rem;color:var(--ink-3);margin-left:4px}

  .note{
    margin:20px 0 0;font-size:.86rem;color:var(--ink-2);
    background:rgba(201,138,18,.10);border:1px solid rgba(201,138,18,.35);
    border-radius:6px;padding:10px 14px;
  }
  .note b{color:var(--copper)}

  .specimens{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}
  .spec{
    display:inline-flex;align-items:center;gap:9px;
    background:var(--card);border:1px solid var(--rule);border-radius:999px;
    padding:6px 13px 6px 10px;font-size:.87rem;color:var(--ink);
  }
  .spec .t{font-family:var(--mono);font-size:.72rem;color:var(--ink-3)}
  .spec .q::before{content:"“"}
  .spec .q::after{content:"”"}

  .sec-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:20px;flex-wrap:wrap}
  h2{font-family:var(--jp);font-weight:700;font-size:clamp(1.2rem,2.4vw,1.5rem);margin:0;letter-spacing:.01em;text-wrap:balance}
  .sec-head .sub{font-size:.9rem;color:var(--ink-3);max-width:44ch}

  .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
  .kpi{
    background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:16px 16px 15px;
    display:flex;flex-direction:column;gap:6px;min-width:0;
  }
  .kpi .lab{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
  .kpi .big{font-family:var(--mono);font-weight:600;font-size:clamp(1.7rem,3.2vw,2.15rem);line-height:1;color:var(--ink);display:flex;align-items:baseline;gap:5px}
  .kpi .big .su{font-size:.72rem;font-weight:500;color:var(--ink-3)}
  .kpi .cap{font-size:.78rem;color:var(--ink-2)}
  .kpi.accent{border-color:rgba(44,138,107,.5)}
  .kpi.accent .big{color:var(--good)}

  .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .panel{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:clamp(18px,2.5vw,26px)}
  .panel h3{margin:0 0 4px;font-size:1.02rem;font-weight:700}
  .panel .phint{margin:0 0 20px;font-size:.85rem;color:var(--ink-3)}

  .bars{display:flex;flex-direction:column;gap:16px}
  .brow .btop{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:10px}
  .brow .name{font-size:.92rem;color:var(--ink)}
  .brow .val{font-family:var(--mono);font-size:.86rem;color:var(--ink-2)}
  .brow .val b{color:var(--ink);font-weight:600}
  .track{height:12px;background:var(--card-2);border:1px solid var(--rule);border-radius:999px;overflow:hidden}
  .bar{display:block;height:100%;width:var(--w);border-radius:999px;background:var(--c,var(--blue))}

  .insight{margin:22px 0 0;font-size:.88rem;color:var(--ink-2);border-left:3px solid var(--rule);padding-left:14px}
  .insight b{color:var(--ink)}

  .daysplit{display:flex;gap:12px;margin-top:22px;padding-top:18px;border-top:1px dashed var(--rule);overflow-x:auto}
  .day{flex:1 0 84px;background:var(--card-2);border:1px solid var(--rule);border-radius:6px;padding:12px 14px}
  .day .d{font-family:var(--mono);font-size:.72rem;color:var(--ink-3);letter-spacing:.04em;white-space:nowrap}
  .day .n{font-family:var(--mono);font-weight:600;font-size:1.5rem;color:var(--ink);line-height:1.2}
  .day .n .su{font-size:.72rem;font-weight:500;color:var(--ink-3)}

  .depth{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:clamp(18px,2.5vw,26px)}
  .chartbox{overflow-x:auto;margin-top:8px}
  .chartbox svg{width:100%;min-width:520px;height:auto;display:block}
  .axis{font-family:var(--mono);font-size:10px;fill:#728398}
  .glab{font-family:var(--mono);font-size:9.5px;fill:#728398}
  .peak{font-family:var(--mono);font-size:11px;fill:#B4652E;font-weight:600}

  .threads{display:flex;flex-direction:column;gap:16px}
  .thread{background:var(--card);border:1px solid var(--rule);border-radius:8px;overflow:hidden}
  .thead{display:flex;align-items:center;gap:12px;padding:13px 18px;background:var(--card-2);border-bottom:1px solid var(--rule);flex-wrap:wrap}
  .thead .when{font-family:var(--mono);font-size:.78rem;color:var(--ink-2);letter-spacing:.02em}
  .chip{font-size:.74rem;font-weight:600;padding:3px 10px;border-radius:999px;letter-spacing:.02em;color:#fff}
  .chip.learn{background:var(--copper)}
  .chip.find{background:var(--teal)}
  .chip.chat{background:var(--coral)}
  .turns-badge{margin-left:auto;font-family:var(--mono);font-size:.76rem;color:var(--ink-3)}
  .turns-badge b{color:var(--ink);font-weight:600}

  .turns{padding:8px 18px 16px}
  .turn{padding:12px 0;border-bottom:1px dashed var(--rule)}
  .turn:last-child{border-bottom:0}
  .msg{display:flex;gap:11px;align-items:flex-start}
  .msg + .msg{margin-top:9px}
  .ava{flex:0 0 auto;width:26px;height:26px;border-radius:6px;display:grid;place-items:center;font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--ink-2);background:var(--card-2);border:1px solid var(--rule);margin-top:1px}
  .msg.a .ava{border-radius:50%;background:var(--blue);color:#fff;border-color:var(--blue);font-family:var(--jp-round);font-weight:700}
  .msg .body{min-width:0}
  .msg.q .body{font-size:.98rem;color:var(--ink);font-weight:600}
  .msg.a .body{font-size:.92rem;color:var(--ink-2)}

  .mats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .mat{display:flex;gap:12px;align-items:baseline;background:var(--card);border:1px solid var(--rule);border-radius:7px;padding:12px 15px}
  .mat .id{font-family:var(--mono);font-size:.74rem;color:var(--teal);font-weight:600;flex:0 0 auto}
  .mat .mt{font-size:.9rem;color:var(--ink)}
  .mat .grade{font-family:var(--mono);font-size:.7rem;color:var(--ink-3);display:block;margin-top:2px}

  .propose{background:linear-gradient(180deg,rgba(29,98,179,.05),var(--card));border:1px solid var(--rule);border-radius:8px;padding:clamp(20px,3vw,32px)}
  .aitag{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--blue-deep);background:rgba(29,98,179,.10);border:1px solid rgba(29,98,179,.25);border-radius:999px;padding:5px 12px;margin-bottom:16px}
  .aitag i{width:14px;height:14px;border-radius:50%;background:var(--blue);color:#fff;font-family:var(--jp-round);font-style:normal;font-weight:700;font-size:.6rem;display:grid;place-items:center}
  .plead{margin:0 0 24px;font-size:1rem;color:var(--ink-2);max-width:68ch}
  .plead b{color:var(--ink)}
  .pcards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .pcard{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:19px 19px 20px;display:flex;flex-direction:column;gap:9px}
  .pcard .pnum{font-family:var(--mono);font-size:.72rem;font-weight:600;letter-spacing:.1em;color:var(--blue)}
  .pcard h4{margin:0;font-size:1.01rem;font-weight:700;color:var(--ink);text-wrap:balance;line-height:1.4}
  .pcard p{margin:0;font-size:.87rem;color:var(--ink-2)}
  .pcard p b{color:var(--ink)}
  .pcard .metric{margin-top:2px;font-family:var(--mono);font-size:.72rem;color:var(--ink-3);border-top:1px dashed var(--rule);padding-top:9px}
  .pnote{margin:22px 0 0;font-size:.9rem;color:var(--ink-2);border-left:3px solid var(--amber);padding-left:14px}
  .pnote b{color:var(--ink)}

  .foot{border-top:1px solid var(--rule);padding-top:20px;color:var(--ink-3);font-size:.8rem;line-height:1.85}
  .foot .mono{color:var(--ink-2)}
  .foot b{color:var(--ink-2)}

  @media (max-width:860px){
    .mast-grid{grid-template-columns:1fr}
    .kpis{grid-template-columns:repeat(3,1fr)}
    .cols{grid-template-columns:1fr}
    .pcards{grid-template-columns:1fr}
  }
  @media (max-width:560px){
    .kpis{grid-template-columns:repeat(2,1fr)}
    .mats{grid-template-columns:1fr}
    .hstat .v{font-size:2.1rem}
  }
</style>
</head>
<body>
<div class="page">
<div class="wrap flow">

  <header class="mast">
    <p class="eyebrow">お茶の水女子大学 理科教材データベース ／ 対話AI</p>
    <div class="mast-grid">
      <div>
        <h1>いせちゃんは、いま<br><span class="hl">何を聞かれている</span>のか。</h1>
        <p class="lead">子どもたちが「いせちゃん」に投げかけた質問と、その応答の記録。BigQueryの対話ログを毎日自動で可視化しています。</p>
        <p class="metaline">
          <b>DATA</b> ${esc(dataRangeLabel)} &nbsp;·&nbsp;
          <b>SOURCE</b> inexus-prod.ise_analytics &nbsp;·&nbsp;
          <b>SERVICE</b> ise-api (Cloud Run / prod)
        </p>
        <div class="specimens">
          ${renderSpecimens()}
        </div>
      </div>
      <div class="headline">
        <div class="hstat"><span class="k">会話</span><span><span class="v num">${totalConvs}</span><span class="u">件</span></span></div>
        <div class="hstat"><span class="k">やりとり</span><span><span class="v num">${totalTurns}</span><span class="u">ターン</span></span></div>
        <div class="hstat"><span class="k">エラー</span><span><span class="v num${totalErrors === 0 ? " zero" : ""}">${totalErrors}</span><span class="u">件</span></span></div>
      </div>
    </div>
    <p class="note"><b>運用開始${daySpan}日目のデータです。</b> 毎日自動で更新されます。</p>
  </header>

  <section>
    <div class="sec-head">
      <h2>稼働サマリー</h2>
      <p class="sub mono">${esc(dataRangeLabel)}</p>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="lab">会話数</span><span class="big"><span class="num">${totalConvs}</span><span class="su">件</span></span><span class="cap">対話セッション</span></div>
      <div class="kpi"><span class="lab">質問ターン</span><span class="big"><span class="num">${totalTurns}</span><span class="su">回</span></span><span class="cap">子どもからの発話</span></div>
      <div class="kpi"><span class="lab">平均往復</span><span class="big"><span class="num">${avgTurns.toFixed(1)}</span><span class="su">ターン</span></span><span class="cap">1会話あたり</span></div>
      <div class="kpi"><span class="lab">最長会話</span><span class="big"><span class="num">${longest ? longest.turns.length : 0}</span><span class="su">ターン</span></span><span class="cap">${longest ? esc(truncate(longest.firstQuestion, 12)) : "-"}</span></div>
      <div class="kpi"><span class="lab">案内した教材</span><span class="big"><span class="num">${materialList.length}</span><span class="su">件</span></span><span class="cap">ise-rika DB へ誘導</span></div>
      <div class="kpi accent"><span class="lab">エラー率</span><span class="big"><span class="num">${totalTurns ? Math.round((totalErrors / totalTurns) * 100) : 0}</span><span class="su">%</span></span><span class="cap">${totalErrors === 0 ? "全応答が正常" : `${totalErrors}件でエラー`}</span></div>
    </div>
  </section>

  <section>
    <div class="cols">
      ${renderIntentPanel()}
      ${renderTimePanel()}
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>深掘りするほど、いせちゃんの答えは長くなる傾向</h2>
      <p class="sub">応答の文字数を時系列で。会話の切れ目を点線で表示。</p>
    </div>
    <div class="depth in-target">
      ${renderChart()}
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>会話ログ — 実際のやりとり</h2>
      <p class="sub">直近の会話を新しい順に表示（応答は要約表示・<span class="mono">い</span> ＝ いせちゃんの返答）。</p>
    </div>
    <div class="threads">
      ${renderThreads()}
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>いせちゃんが案内した教材</h2>
      <p class="sub">対話中に提示された ise-rika データベースの教材（実リンク・言及の多い順）</p>
    </div>
    ${renderMaterials()}
  </section>

  <section>
    <div class="sec-head">
      <h2>この先、もっと使われるために</h2>
      <p class="sub">データではなく、iNexus AI からの提案です。</p>
    </div>
    <div class="propose">
      <span class="aitag"><i>い</i>iNexus AI からの提案</span>
      <p class="plead">このボードは「いま、どう使われているか」を映しています。ここからユーザーの定着を伸ばす鍵は、<b>「質問に的確に答えられているか」を測り、改善につなげること</b>。ただし今のログでは、その“的確さ”と“定着”はまだ測れません（会話をまたいで同じ子を追う手がかりも、回答への評価もログに無いためです）。次の計測を少し足すだけで、見えるようになります。</p>
      <div class="pcards">
        <div class="pcard">
          <span class="pnum">01 ／ まず効く</span>
          <h4>ユーザーを識別する<br>（匿名IDでOK）</h4>
          <p>今は「同じ子が翌日また来たか」が追えません。匿名の <b>ユーザーID</b> を発行するだけで、定着そのものが測れます。</p>
          <span class="metric">→ 再訪率・継続率・1人あたり会話数</span>
        </div>
        <div class="pcard">
          <span class="pnum">02 ／ まず効く</span>
          <h4>回答に 👍 / 👎 の<br>一言フィードバック</h4>
          <p>「役に立った？」の1タップで、<b>的確に答えられた割合</b>が直接わかります。低評価の質問＝改善対象も見えます。</p>
          <span class="metric">→ 解決率・改善すべき質問の特定</span>
        </div>
        <div class="pcard">
          <span class="pnum">03 ／ その次に</span>
          <h4>質問の意図を<br>自動でタグ付け</h4>
          <p>「教材さがし／学習支援／きもち」などを自動分類すれば、<b>何が求められ、何に応えきれていないか</b>を継続把握できます。</p>
          <span class="metric">→ 意図別の需要マップと解決率</span>
        </div>
      </div>
      <p class="pnote"><b>実装は軽めです。</b> 多くはアプリのログ出力に項目を足すだけ。BigQuery 側はスキーマが自動で拡張されるので、追加工事はほぼ不要です。まずは <b>01・02</b> の2つが、定着への効き目が最大です。</p>
    </div>
  </section>

  <footer class="foot">
    <p><b>データソース</b> ｜ <span class="mono">inexus-prod.ise_analytics.run_googleapis_com_stdout</span>（Cloud Run <span class="mono">ise-api</span> の stdout ログを Cloud Logging 経由で BigQuery に転送）</p>
    <p><b>集計</b> ｜ ${esc(dataRangeLabel)}（JST）。「質問の内訳」はAIによる推定分類。</p>
    <p><b>更新について</b> ｜ このダッシュボードは日次で自動更新されます（BigQueryから直接再生成）。最終更新: ${esc(updated)}</p>
  </footer>

</div>
</div>
</body>
</html>`;

fs.writeFileSync(OUT, html);
console.log("wrote", OUT, `(${html.length} bytes, ${totalConvs} conversations, ${totalTurns} turns)`);
