#!/usr/bin/env bash
# ISEちゃん 利用レポート：毎朝の処理を1本で流す（GCP の Cloud Run のジョブから呼ぶ・2026-11-03〜）。
#   分類（新しい質問だけ Claude）→ 集計（BigQuery）→ 組み立て → ページ → 暗号化して公開 → 見守りの知らせ
# それまでは PC-Win の Claude のルーティンがスキル ise-analysis-report の手順どおり流していた。
# 途中で AI が判断する場面が無くなったので、エージェントを通さずスクリプトで流す（渡邉さん「A で進めて」）。
#
# 動かす場所の前提（Cloud Run のジョブ・サービスアカウント ise-report-reader として動く）:
#   - BigQuery・Secret Manager はメタデータサーバーのトークンで読む（鍵のファイルは要らない）
#   - 環境変数（Secret Manager から差し込む）: DASHBOARD_PASSWORD・ISE_EXTERNAL_PASSWORD・INEXUS_NOTIFY_BOT_TOKEN。GitHub への push は kpi-dashboard だけに書けるデプロイキー（ise-deploy-key）
#   - 失敗したら #op-alert へ bot で1行知らせて、終了コード 1 で終わる（Cloud Run のジョブの記録にも残る）
#   - ISE_DRY_RUN=1 のときは、公開（push）と Slack への知らせをしない（切り替え前の試し・2026-11-03）
# 🚨 会話の本文は auto/cache の中だけ。画面（ログ）に出すのは件数・トークン・料金だけ。
set -uo pipefail
if [ "${ISE_DRY_RUN:-}" = "1" ]; then export SKIP_PUSH=1; echo "DRY RUN：公開と知らせはしません"; fi
cd "$(git rev-parse --show-toplevel)"
B=auto/build; C=auto/cache
ALERT_CHANNEL=C08QGD1C3HU   # #op-alert

alert() {
  [ "${ISE_DRY_RUN:-}" = "1" ] && { echo "ALERT（DRY RUN・送らない）$1"; return 0; }
  local msg="ISEちゃん 利用レポートの毎朝の処理が止まりました：$1（Cloud Run のジョブ ise-daily の記録を見てください）"
  echo "ALERT $1"
  [ -n "${INEXUS_NOTIFY_BOT_TOKEN:-}" ] || return 0
  node -e '
    fetch("https://slack.com/api/chat.postMessage", { method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: "Bearer " + process.env.INEXUS_NOTIFY_BOT_TOKEN },
      body: JSON.stringify({ channel: process.argv[1], text: process.argv[2] }) })
      .then(r => r.json()).then(j => console.log(j.ok ? "alert sent" : "alert failed: " + j.error));
  ' "$ALERT_CHANNEL" "$msg"
}

# 1回だけやり直す（たまたまの通信の失敗で止めない）。2回とも失敗なら知らせて止める。
step() {
  local name="$1"; shift
  "$@" && return 0
  echo "RETRY $name"; sleep 10
  "$@" && return 0
  alert "$name で失敗"; exit 1
}

mkdir -p "$C/ise-q"
step 分類 node "$B/ise-classify.js"
step 集計 node "$B/ise-bq-fetch.js" "$C/ise-q"
step 組み立て node "$B/ise-analysis-assemble.js" "$C/ise-q" "$C/ise_analysis.json"
step ページ node "$B/build-ise-analysis.js" "$C/ise_analysis.json" "$C/ise-analysis-inner.html" "$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')"

# 公開は「質問の合計が前回より減った（STOP）」なら止まる。そのときも見守りの知らせは出す（知らせを止めない）。
PUB=0
bash "$B/ise-analysis-publish.sh" || { PUB=1; alert "公開（STOP かどうかはジョブの記録で確かめる）"; }

# 見守りの知らせ（公開の後＝リンク先にもう載っているように）。bot で送れなければ知らせて止める。
if [ "${ISE_DRY_RUN:-}" = "1" ]; then node -e 'const w=require(process.argv[1]);console.log("DRY RUN 見守りの知らせ（送らない）:", (w.items||w.watch||[]).length, "件")' "$C/ise_watch.json" 2>/dev/null; echo DONE; exit $PUB; fi
OUT="$(node "$B/ise-watch-notify.js" "$C/ise_watch.json" 2>&1)"; RC=$?
LAST="$(printf '%s\n' "$OUT" | tail -1)"
echo "$LAST"
case "$LAST" in
  NONE*|SENT*) ;;
  *) alert "見守りの知らせ（${LAST:0:60}）"; exit 1 ;;
esac
[ $RC -eq 0 ] || exit 1
exit $PUB
