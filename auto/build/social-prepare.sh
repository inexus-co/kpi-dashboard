#!/usr/bin/env bash
# ソーシャル分析（YouTube）: データ準備フェーズ（取得＋履歴更新＋集計）。pushはしない。
# 既存の parse 系（差分取得→集計JSON出力）に相当。この後 routine が AI寸評を作文し、social-publish.sh で描画・push する。
# 必要環境変数: CACHE_KEY, YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID
set -euo pipefail
: "${CACHE_KEY:?}"; : "${YOUTUBE_API_KEY:?}"; : "${YOUTUBE_CHANNEL_ID:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')"
mkdir -p "$C/social"
# 前回実行の AI寸評が残っていれば消す（クラウドはクリーン環境だが、ローカル再実行対策）
rm -f "$C/social/social_ai.json"

echo "[1/3] open history cache (if any)"
if [ -f auto/cache-social.enc ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -in auto/cache-social.enc | tar -x -C auto
  echo "  history opened: $(wc -c < "$C/social/history.json" 2>/dev/null || echo 0) bytes"
else
  echo "  (初回: 履歴キャッシュなし。空から開始)"
fi

echo "[2/3] fetch youtube snapshot"
node $B/social-fetch.js "$C/social/youtube_snapshot.json"

echo "[3/3] merge history + compute data/notify"
node $B/build-social.js "$C/social/history.json" "$C/social/youtube_snapshot.json" \
  "$C/social/social_data.json" "$C/social/social_notify.json" "$NOW"

echo "PREPARED: $C/social/social_data.json / $C/social/social_notify.json"
echo "  （次: social_data.json と social_notify.json を読んで AI寸評 social_ai.json を作文 → social-publish.sh）"
