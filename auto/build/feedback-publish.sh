#!/usr/bin/env bash
# 採点くんフィードバック(saiten-feedback.html) 生成・キャッシュ再封緘・push（repoルートで実行）
# 前提: auto/cache/ に feedback_records.json と ai_feedback.json が生成済み
# 必要環境変数: DASHBOARD_PASSWORD, CACHE_KEY
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"; : "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y/%-m/%-d %H:%M:%S')"
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
echo "[1/3] render feedback inner"
node $B/render-feedback.js $B/templates/feedback-artifact.html $C/feedback_records.json $C/ai_feedback.json $C/feedback-inner.html "$NOW"
echo "[2/3] encrypt + wrap"
node $B/encrypt-wrap.js $C/feedback-inner.html saiten-feedback.html "$DASHBOARD_PASSWORD" "採点くん フィードバック ダッシュボード（要パスワード）"
echo "[3/3] reseal + push"
tar -c -C auto cache/slack_archive/C09L6KHTRJ7.txt cache/slack_archive/C09L6KHTRJ7.meta.json | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-feedback.enc
bash $B/git-push-retry.sh "Update 採点くん フィードバックダッシュボード (${DNOW})" saiten-feedback.html auto/cache-feedback.enc
