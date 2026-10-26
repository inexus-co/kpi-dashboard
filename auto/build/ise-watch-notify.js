#!/usr/bin/env node
/**
 * 見守りの知らせを Slack の #ptnr-お茶の水女子大学 へ送る（2026-10-24）。
 *
 * 使い方: node auto/build/ise-watch-notify.js auto/cache/ise_watch.json [--print]
 *   - ise_watch.json が空（[]）なら何もしない（NONE と出す）。
 *   - 環境変数 INEXUS_NOTIFY_BOT_TOKEN があれば、会社の共通の通知 bot として送る（SENT と出す）。
 *   - 無ければ送らずに文面だけ出して NO-TOKEN で終わる。スキルはその文面を Slack のコネクタでそのまま送る（渡邉さんの名前で出る）。
 *   - --print … 送らずに文面だけ出す。
 *
 * なぜ＝①文面を AI が毎回書くと揺れるので、ここで決める。
 *       ②渡邉さんの名前ではなく、システムの知らせと分かる bot から送りたい（2026-10-24 渡邉さん）。bot は会社の共通のものを使う。
 *       ③「こんな書き込みがありました」だけでは、受けた先生方が次に何をすればいいか分からない（同上）
 *         ⇒ 前後のやり取りを見に行けるリンク（ページの #watch）と、こちらで分かること・お願いしたいことを添える。
 */
const fs = require('fs');
const CHANNEL = 'C08SVEUKW01';                          // #ptnr-お茶の水女子大学
const MENTIONS = '<@U0AE0TEFUFQ> <@U0ADMFYBQ4X>';       // 貞光先生・吉村先生
const URL = 'https://inexus-co.github.io/kpi-dashboard/ise-analysis.html#watch';

const [file, flag] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!rows.length) { console.log('NONE'); process.exit(0); }

const text = [
  MENTIONS,
  '【ISEちゃん 見守りの自動通知】',
  'ISEちゃんへの質問の中に、命や身の安全にかかわる心配な内容がありました。',
  ...rows.map(r => `・${r.jst}「${r.question}」`),
  '',
  '前後のやり取りと ISEちゃんの返答は、利用レポートの「見守り」の節でご覧いただけます（パスワードは利用レポートと同じです）。',
  URL,
  '',
  'このお知らせは、ご参考までにお送りしているものです（ご返信は不要です）。',
  '内容によって学内でのご対応を検討される場合は、弊社までお知らせください。接続元の通信の記録は約30日で消えますので、それまでにご連絡いただければ保存いたします。',
].join('\n');

const token = process.env.INEXUS_NOTIFY_BOT_TOKEN;
if (flag === '--print' || !token) {
  console.log(text);
  console.log(flag === '--print' ? 'PRINT' : 'NO-TOKEN');
  process.exit(0);
}
fetch('https://slack.com/api/chat.postMessage', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ channel: CHANNEL, text, unfurl_links: false }),
}).then(r => r.json()).then(d => {
  if (d.ok) { console.log(`SENT ${d.ts}`); return; }
  console.log(text);
  console.log(`FAILED ${d.error}`);
  process.exit(2);
}).catch(e => { console.log(text); console.log(`FAILED ${e.message}`); process.exit(2); });
