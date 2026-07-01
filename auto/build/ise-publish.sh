#!/usr/bin/env bash
# いせちゃん（ise-rika 対話ログ）利用状況ダッシュボード（ise-chat-usage.html）暗号化・push
# 社外（お茶の水女子大学）向け公開ページ。ISE_EXTERNAL_PASSWORD と DASHBOARD_PASSWORD の
# どちらでも開けるよう2パスワードで暗号化する（encrypt-wrap.js の複数パスワード対応）。
#
# 前提: auto/cache/ise-inner.html に平文の内側HTMLが用意済み。
#       現時点、内側HTMLの生成（BigQuery取得→描画）は未自動化で手動更新
#       （他ダッシュボードのような build-ise.js はまだ無い）。
# 必要環境変数: DASHBOARD_PASSWORD（社内共通）, ISE_EXTERNAL_PASSWORD（お茶大専用）
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"
: "${ISE_EXTERNAL_PASSWORD:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"

echo "[1/2] encrypt + wrap -> ise-chat-usage.html（社外用＋社内共通の2パスワードで復号可）"
node "$B/encrypt-wrap.js" "$C/ise-inner.html" ise-chat-usage.html \
  "$ISE_EXTERNAL_PASSWORD" "いせちゃん 対話ログ ダッシュボード（要パスワード）" \
  "$DASHBOARD_PASSWORD"

echo "[2/2] push"
bash "$B/git-push-retry.sh" "Update いせちゃん 対話ログ dashboard (${DNOW})" ise-chat-usage.html
