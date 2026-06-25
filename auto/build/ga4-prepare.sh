#!/usr/bin/env bash
# Web分析(GA4): データ準備フェーズ（履歴開封→GA4 fetch→冪等マージ→集計）。pushはしない。
# この後 routine が AI寸評を作文し、ga4-publish.sh で描画・push する（social と同じ二相）。
# 必要環境変数: CACHE_KEY ＋ GA4認証（GA4_SA_KEY_B64 または GOOGLE_APPLICATION_CREDENTIALS）
#   ※ GA4_PROPERTY_ID は ga4-fetch.js の既定 289134520。変える場合のみ指定。
set -euo pipefail
: "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
NOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')"
mkdir -p "$C/ga4"
# 前回実行の AI寸評が残っていれば消す（クラウドはクリーン環境だが、ローカル再実行対策）
rm -f "$C/ga4/ga4_ai.json"

echo "[1/3] open history cache (if any)"
if [ -f auto/cache-ga4.enc ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -in auto/cache-ga4.enc | tar -x -C auto
  echo "  history opened: $(wc -c < "$C/ga4/history.json" 2>/dev/null || echo 0) bytes"
else
  echo "  (初回: 履歴キャッシュなし。空から開始)"
fi

echo "[2/3] fetch GA4 snapshot (Data API v1 直結・BigQuery非経由)"
GA4_OUT="$C/ga4/ga4_snapshot.json" node $B/ga4-fetch.js

echo "[3/3] merge history + compute data/notify"
node $B/build-ga4.js "$C/ga4/history.json" "$C/ga4/ga4_snapshot.json" \
  "$C/ga4/ga4_data.json" "$C/ga4/ga4_notify.json" "$NOW"

echo "PREPARED: $C/ga4/ga4_data.json / $C/ga4/ga4_notify.json"
echo "  （次: ga4_data.json と ga4_notify.json を読んで AI寸評 ga4_ai.json を作文 → ga4-publish.sh）"
