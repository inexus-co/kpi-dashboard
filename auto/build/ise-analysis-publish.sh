#!/usr/bin/env bash
# ISEちゃん 利用レポート（ise-analysis.html）暗号化・push
# 社外（お茶の水女子大学）向け。旧ページ ise-chat-usage.html と同じ2つのパスワードで開ける。
# 前提: auto/cache/ise_analysis.json（ise-analysis-assemble.js）と auto/cache/ise-analysis-inner.html（build-ise-analysis.js）が用意済み。
# 必要環境変数: DASHBOARD_PASSWORD（社内共通）, ISE_EXTERNAL_PASSWORD（お茶大専用）
set -euo pipefail
. "$(dirname "$0")/env-recover.sh"
: "${DASHBOARD_PASSWORD:?}"
: "${ISE_EXTERNAL_PASSWORD:?}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
B=auto/build; C=auto/cache
DNOW="$(TZ=Asia/Tokyo date '+%Y-%m-%d')"
# 質問の合計が前回の公開より減っていたら止める（ログが欠けた疑い。累計は減らないはず）
TOTAL="$(node -e 'const d=require(process.argv[1]);console.log(d.daily.reduce((s,r)=>s+r.turns,0))' "$ROOT/$C/ise_analysis.json")"
PREV="$(git log -1 --format=%s -- ise-analysis.html | sed -n 's/.*質問 \([0-9][0-9]*\) 件.*/\1/p')"
if [ -n "$PREV" ] && [ "$TOTAL" -lt "$PREV" ]; then
  echo "STOP: 質問の合計が前回より減った（前回 ${PREV} → 今回 ${TOTAL}）。公開しない"; exit 1
fi
echo "[1/2] encrypt + wrap -> ise-analysis.html"
node "$B/encrypt-wrap.js" "$C/ise-analysis-inner.html" ise-analysis.html \
  "$ISE_EXTERNAL_PASSWORD" "ISEちゃん 利用レポート（要パスワード）" \
  "$DASHBOARD_PASSWORD"
echo "[2/2] push"
bash "$B/git-push-retry.sh" "Update ISEちゃん 利用レポート (${DNOW}・質問 ${TOTAL} 件)" ise-analysis.html
