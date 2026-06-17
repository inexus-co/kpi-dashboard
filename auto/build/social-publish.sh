#!/usr/bin/env bash
# ソーシャル分析（YouTube）ダッシュボード social-analytics.html 生成・暗号化・キャッシュ封緘・push（repoルートで実行）
# 既存の kids-publish.sh / feedback-publish.sh と同じ様式。
#
# 流れ: 履歴キャッシュを開く → YouTube取得 → 履歴に追記＋内側HTML生成 → 暗号化 → 履歴を再封緘 → push
# 必要環境変数: DASHBOARD_PASSWORD（閲覧PW）, CACHE_KEY（キャッシュ暗号鍵）,
#               YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"; : "${CACHE_KEY:?}"
: "${YOUTUBE_API_KEY:?}"; : "${YOUTUBE_CHANNEL_ID:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')"
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
mkdir -p "$C/social"

echo "[1/5] open history cache (if any)"
if [ -f auto/cache-social.enc ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -in auto/cache-social.enc | tar -x -C auto
  echo "  history opened: $(ls -la $C/social/history.json 2>/dev/null | awk '{print $5}') bytes"
else
  echo "  (初回: 履歴キャッシュなし。空から開始)"
fi

echo "[2/5] fetch youtube snapshot"
node $B/social-fetch.js "$C/social/youtube_snapshot.json"

echo "[3/5] merge history + build inner"
node $B/build-social.js "$C/social/history.json" "$C/social/youtube_snapshot.json" "$C/social-inner.html" "$NOW"

echo "[4/5] encrypt + wrap -> social-analytics.html"
node $B/encrypt-wrap.js "$C/social-inner.html" social-analytics.html "$DASHBOARD_PASSWORD" "ソーシャル分析ダッシュボード（要パスワード）"

echo "[5/5] reseal history cache + push"
tar -c -C auto cache/social/history.json | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-social.enc
bash $B/git-push-retry.sh "Update ソーシャル分析 dashboard (${DNOW})" social-analytics.html auto/cache-social.enc
