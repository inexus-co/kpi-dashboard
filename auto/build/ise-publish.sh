#!/usr/bin/env bash
# いせちゃん（ise-rika 対話ログ）利用状況ダッシュボード（ise-chat-usage.html）暗号化・push
# 社外（お茶の水女子大学）向け公開ページ。ISE_EXTERNAL_PASSWORD と DASHBOARD_PASSWORD の
# どちらでも開けるよう2パスワードで暗号化する（encrypt-wrap.js の複数パスワード対応）。
#
# 前提: auto/cache/ise-inner.html に平文の内側HTMLが用意済み
#       （増分アーカイブ auto/cache/ise_archive.json から build-ise.js で生成する。
#        手順の詳細はRoutineプロンプト側が唯一の正）。
#       auto/cache/ise_archive.json / ise_ai.json / ise_meta.json は永続キャッシュとして
#       cache-ise.enc に再暗号化し、ダッシュボードと一緒に push する。
# 必要環境変数: DASHBOARD_PASSWORD（社内共通）, ISE_EXTERNAL_PASSWORD（お茶大専用）, CACHE_KEY
set -euo pipefail
. "$(dirname "$0")/env-recover.sh"
: "${DASHBOARD_PASSWORD:?}"
: "${ISE_EXTERNAL_PASSWORD:?}"
: "${CACHE_KEY:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"

echo "[1/3] encrypt + wrap -> ise-chat-usage.html（社外用＋社内共通の2パスワードで復号可）"
node "$B/encrypt-wrap.js" "$C/ise-inner.html" ise-chat-usage.html \
  "$ISE_EXTERNAL_PASSWORD" "いせちゃん 対話ログ ダッシュボード（要パスワード）" \
  "$DASHBOARD_PASSWORD"

echo "[2/3] 永続キャッシュを再暗号化 -> cache-ise.enc"
tar -c -C auto cache/ise_archive.json cache/ise_ai.json cache/ise_meta.json \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -out auto/cache-ise.enc

echo "[3/3] push"
bash "$B/git-push-retry.sh" "Update いせちゃん 対話ログ dashboard (${DNOW})" ise-chat-usage.html auto/cache-ise.enc
