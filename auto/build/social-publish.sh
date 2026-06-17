#!/usr/bin/env bash
# ソーシャル分析（YouTube）: 公開フェーズ（AI寸評反映→リッチ内側HTML描画→暗号化→履歴再封緘→push）。
# 事前に social-prepare.sh を実行し、social_data.json / social_notify.json が生成済みであること。
# AI寸評 social_ai.json は任意（無ければ render-social.js が数値由来の自動ハイライトでフォールバック）。
# 必要環境変数: DASHBOARD_PASSWORD（閲覧PW）, CACHE_KEY（キャッシュ暗号鍵）
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"; : "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"

if [ ! -f "$C/social/social_data.json" ]; then
  echo "[ERROR] $C/social/social_data.json がありません。先に social-prepare.sh を実行してください。" >&2
  exit 1
fi

echo "[1/4] render rich inner HTML (AI寸評は social_ai.json があれば反映)"
node $B/render-social.js "$C/social/social_data.json" "$C/social/social_ai.json" "$C/social-inner.html"

echo "[2/4] encrypt + wrap -> social-analytics.html"
node $B/encrypt-wrap.js "$C/social-inner.html" social-analytics.html "$DASHBOARD_PASSWORD" "ソーシャル分析ダッシュボード（要パスワード）"

echo "[3/4] reseal history cache"
tar -c -C auto cache/social/history.json | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-social.enc

echo "[4/4] push"
bash $B/git-push-retry.sh "Update ソーシャル分析 dashboard (${DNOW})" social-analytics.html auto/cache-social.enc
