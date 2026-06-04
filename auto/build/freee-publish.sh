#!/usr/bin/env bash
# freee経営ダッシュボード(freee.html) 生成・確定キャッシュ再封緘・push（repoルートで実行）
# 前提: auto/cache/ に current_fetch.json と ai.json が生成済み、cache-freee.enc 復号済み
# 必要環境変数: DASHBOARD_PASSWORD, CACHE_KEY
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"; : "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
echo "[1/4] merge freee data"
node $B/merge-current.js $C/current_fetch.json $C/freee_closed_cache.json $C/freee_raw.json
echo "[2/4] build freee inner"
node $B/compute-model.js $C/freee_raw.json $B/templates/freee-template.html $C/freee-inner.html $C/ai.json
echo "[3/4] encrypt + wrap"
node $B/encrypt-wrap.js $C/freee-inner.html freee.html "$DASHBOARD_PASSWORD" "株式会社インネクサス｜経営ダッシュボード（要パスワード）"
echo "[4/4] reseal + push"
tar -c -C auto cache/freee_closed_cache.json | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-freee.enc
bash $B/git-push-retry.sh "Update freee 経営ダッシュボード (${DNOW})" freee.html auto/cache-freee.enc
