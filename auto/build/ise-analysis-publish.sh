#!/usr/bin/env bash
# ISEちゃん 利用レポート（ise-analysis.html）暗号化・push
# 社外（お茶の水女子大学）向け。旧ページ ise-chat-usage.html と同じ2つのパスワードで開ける。
# 前提: auto/cache/ise-analysis-inner.html が build-ise-analysis.js で用意済み（集計の数字だけで作る）。
# 必要環境変数: DASHBOARD_PASSWORD（社内共通）, ISE_EXTERNAL_PASSWORD（お茶大専用）
set -euo pipefail
. "$(dirname "$0")/env-recover.sh"
: "${DASHBOARD_PASSWORD:?}"
: "${ISE_EXTERNAL_PASSWORD:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
echo "[1/2] encrypt + wrap -> ise-analysis.html"
node "$B/encrypt-wrap.js" "$C/ise-analysis-inner.html" ise-analysis.html \
  "$ISE_EXTERNAL_PASSWORD" "ISEちゃん 利用レポート（要パスワード）" \
  "$DASHBOARD_PASSWORD"
echo "[2/2] push"
bash "$B/git-push-retry.sh" "Update ISEちゃん 利用レポート (${DNOW})" ise-analysis.html
