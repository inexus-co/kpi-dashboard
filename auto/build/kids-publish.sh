#!/usr/bin/env bash
# まなんでパズル 利用実績ダッシュボード（kids-usage.html）生成・暗号化・push（repoルートで実行）
# 前提: auto/cache/kids_raw/ に BigQuery 6本の結果JSON（cumulative/platform/new_users/dau/creators/engagement）が保存済み
# 必要環境変数: DASHBOARD_PASSWORD
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')"
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"

echo "[1/3] build kids inner"
node $B/build-kids.js $C/kids_raw $C/kids-inner.html "$NOW"

echo "[2/3] encrypt + wrap -> kids-usage.html"
node $B/encrypt-wrap.js $C/kids-inner.html kids-usage.html "$DASHBOARD_PASSWORD" "まなんでパズル 利用実績ダッシュボード（要パスワード）"

echo "[3/3] push"
bash $B/git-push-retry.sh "Update まなんでパズル 利用実績 dashboard (${DNOW})" kids-usage.html
