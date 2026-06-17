#!/usr/bin/env bash
# まなんでパズル ダッシュボード生成・キャッシュ再封緘・push（repoルートで実行）
# 前提: auto/cache/ に puzzle_records.json と ai_puzzle.json が生成済み
# 必要環境変数: DASHBOARD_PASSWORD, CACHE_KEY
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"; : "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y/%-m/%-d %H:%M:%S')"
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
echo "[1/3] render inner"
node $B/render-puzzle.js $B/templates/puzzle-feedback-template.html $C/puzzle_records.json $C/ai_puzzle.json $C/puzzle-inner.html "$NOW"
echo "[2/3] encrypt + wrap"
node $B/encrypt-wrap.js $C/puzzle-inner.html puzzle-feedback.html "$DASHBOARD_PASSWORD" "まなんでパズル フィードバック ダッシュボード（要パスワード）"
echo "[3/3] reseal + push"
tar -c -C auto cache/slack_archive/C08RCL7P5PA.txt cache/slack_archive/C08RCL7P5PA.meta.json | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-puzzle.enc
bash $B/git-push-retry.sh "Update まなんでパズル フィードバックダッシュボード (${DNOW})" puzzle-feedback.html auto/cache-puzzle.enc
