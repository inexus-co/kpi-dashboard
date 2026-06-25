#!/usr/bin/env bash
# Web分析(GA4): 公開フェーズ（AI寸評反映→内側HTML描画→暗号化→履歴再封緘→push）。
# 事前に ga4-prepare.sh を実行し、ga4_data.json / ga4_notify.json が生成済みであること。
# AI寸評 ga4_ai.json は任意（無ければ render-ga4.js が数値由来の自動ハイライトでフォールバック）。
# 必要環境変数: DASHBOARD_PASSWORD（閲覧PW）, CACHE_KEY（キャッシュ暗号鍵）
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"; : "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"

if [ ! -f "$C/ga4/ga4_data.json" ]; then
  echo "[ERROR] $C/ga4/ga4_data.json がありません。先に ga4-prepare.sh を実行してください。" >&2
  exit 1
fi

echo "[1/4] render inner HTML (AI寸評は ga4_ai.json があれば反映)"
node $B/render-ga4.js "$C/ga4/ga4_data.json" "$C/ga4/ga4_ai.json" "$C/ga4-inner.html"

echo "[2/4] encrypt + wrap -> web-analytics.html"
node $B/encrypt-wrap.js "$C/ga4-inner.html" web-analytics.html "$DASHBOARD_PASSWORD" "Web分析（GA4）ダッシュボード（要パスワード）"

echo "[3/4] reseal history cache"
tar -c -C auto cache/ga4/history.json | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-ga4.enc

echo "[4/4] push"
bash $B/git-push-retry.sh "Update Web分析(GA4) dashboard (${DNOW})" web-analytics.html auto/cache-ga4.enc
