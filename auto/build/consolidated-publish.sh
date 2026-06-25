#!/usr/bin/env bash
# 統合KPIダッシュボード(all.html) 生成・push（repoルートで実行）
# 公開済みの各ダッシュボードHTMLを DASHBOARD_PASSWORD で復号 → タブUIに丸ごと埋め込み →
# 同じパスワードで再暗号化して all.html を出力する。新しいデータ源・キャッシュ鍵は不要。
#
# 前提: リポジトリ直下に各ダッシュボードの最新公開HTML（index.html ほか）が揃っていること。
#       クラウドのスケジュール実行は毎回リポを clone するため、既存7ジョブの「後」に走らせれば
#       最新版を取り込める（数分ずらして push 競合を回避）。
# 必要環境変数: DASHBOARD_PASSWORD（閲覧PW＝再暗号化にも使用）
set -euo pipefail
: "${DASHBOARD_PASSWORD:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
mkdir -p "$C"
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"

echo "[1/3] build consolidated inner (公開HTMLを復号して統合)"
node $B/build-consolidated.js "$DASHBOARD_PASSWORD" "$C/consolidated-inner.html"

echo "[2/3] encrypt + wrap -> all.html"
node $B/encrypt-wrap.js "$C/consolidated-inner.html" all.html "$DASHBOARD_PASSWORD" "インネクサス｜統合KPIダッシュボード（要パスワード）"

echo "[3/3] push"
bash $B/git-push-retry.sh "Update 統合ダッシュボード (all.html) (${DNOW})" all.html
