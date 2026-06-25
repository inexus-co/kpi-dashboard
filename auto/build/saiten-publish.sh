#!/usr/bin/env bash
# 採点くん/まなんでパズル KPI(index.html) 生成・キャッシュ再封緘・push（repoルートで実行）
# 前提: auto/cache/slack_archive/C08R1MRSXDF.txt がマージ済み
# 必要環境変数: DASHBOARD_PASSWORD, CACHE_KEY
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"; : "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y/%-m/%-d %H:%M:%S')"
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
echo "[1/3] build saiten inner"
# AIサマリー(良い点/課題)があれば焼き込む。$C/ai_saiten.json はキャッシュに同梱され実行間で持続する。
node $B/build-saiten.js $B/templates/saiten-artifact.html $C/slack_archive/C08R1MRSXDF.txt $C/saiten-inner.html "$NOW" $C/ai_saiten.json
echo "[2/3] encrypt + wrap"
node $B/encrypt-wrap.js $C/saiten-inner.html index.html "$DASHBOARD_PASSWORD" "採点くん / まなんでパズル KPIダッシュボード（要パスワード）"
echo "[3/3] reseal + push"
AI_FILE=""; [ -f "$C/ai_saiten.json" ] && AI_FILE="cache/ai_saiten.json"
tar -c -C auto cache/slack_archive/C08R1MRSXDF.txt cache/slack_archive/C08R1MRSXDF.meta.json $AI_FILE | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-saiten.enc
bash $B/git-push-retry.sh "Update 採点くん/まなんでパズル dashboard (${DNOW})" index.html auto/cache-saiten.enc
