#!/usr/bin/env bash
# 競合アプリ定点観測(competitor-monitoring.html) 生成・push（repoルートで実行）
# 前提: auto/cache/competitor_slack.txt に Slack #op-app-review-monitoring(C0B8XRBUA7L) の本文が保存済み
# 必要環境変数: DASHBOARD_PASSWORD（push時は GITHUB_PAT または push許可）
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
echo "[1/3] build inner from slack dump"
python3 "$B/competitor-build.py" "$C/competitor_slack.txt" "$C/competitor-inner.html"
echo "[2/3] encrypt + wrap"
node "$B/encrypt-wrap.js" "$C/competitor-inner.html" competitor-monitoring.html "$DASHBOARD_PASSWORD" "競合アプリ 定点観測ダッシュボード（要パスワード）"
echo "[3/3] push"
bash "$B/git-push-retry.sh" "Update 競合アプリ定点観測ダッシュボード (${DNOW})" competitor-monitoring.html
