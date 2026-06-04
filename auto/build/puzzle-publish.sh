#!/usr/bin/env bash
# まなんでパズル ダッシュボード生成・キャッシュ再封緘・push（repoルートで実行）
# 前提: auto/cache/ に puzzle_records.json と ai_puzzle.json が生成済み
# 必要環境変数: DASHBOARD_PASSWORD, CACHE_KEY, （pushにPATを使う場合）GITHUB_PAT
set -euo pipefail
: "${DASHBOARD_PASSWORD:?DASHBOARD_PASSWORD not set}"
: "${CACHE_KEY:?CACHE_KEY not set}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y/%-m/%-d %H:%M:%S')"
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
echo "[1/4] render inner"
node $B/render-puzzle.js $B/templates/puzzle-feedback-template.html $C/puzzle_records.json $C/ai_puzzle.json $C/puzzle-inner.html "$NOW"
echo "[2/4] encrypt + wrap"
node $B/encrypt-wrap.js $C/puzzle-inner.html puzzle-feedback.html "$DASHBOARD_PASSWORD" "まなんでパズル フィードバック ダッシュボード（要パスワード）"
echo "[3/4] reseal cache"
tar -c -C auto cache/slack_archive | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache.enc
echo "[4/4] commit & push"
git config user.email "rikiei.watanabe@inexus-co.com"
git config user.name "KPI Dashboard Bot"
git add puzzle-feedback.html auto/cache.enc
if git diff --cached --quiet; then echo "no changes"; exit 0; fi
git commit -m "Update まなんでパズル フィードバックダッシュボード (${DNOW})" >/dev/null
if [ "${SKIP_PUSH:-}" = "1" ]; then echo "SKIP_PUSH=1: pushせず終了"; git log --oneline -1; echo DONE; exit 0; fi
if [ -n "${GITHUB_PAT:-}" ]; then
  git push "https://x-access-token:${GITHUB_PAT}@github.com/inexus-co/kpi-dashboard.git" HEAD:main 2>&1 | sed -E "s#${GITHUB_PAT}#***#g" | tail -2
else
  git push origin HEAD:main 2>&1 | tail -2
fi
git log --oneline -1
echo DONE
