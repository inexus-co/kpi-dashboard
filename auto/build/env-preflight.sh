#!/usr/bin/env bash
# 使い方: bash auto/build/env-preflight.sh <VAR1> [VAR2...]
# 必須環境変数のプリフライトチェック。未設定があれば全て列挙して exit 1。
# 既知の事故パターン: Routineの環境変数設定で、別の変数の値の末尾に「VAR=...」が
# 連結されて注入され、独立した変数として認識されないことがある（2026-07-01〜03 に
# CACHE_KEY が ISE_EXTERNAL_PASSWORD の値に連結されて3日連続で失敗）。検出したら
# どの変数に紛れているかをヒント表示する。値そのものは表示しない（シークレット保護）。
set -euo pipefail
NG=0
for V in "$@"; do
  if [ -n "${!V:-}" ]; then continue; fi
  echo "[PREFLIGHT] 環境変数 ${V} が未設定です" >&2
  HOST="$(env | grep -F "${V}=" | grep -v "^${V}=" | cut -d= -f1 | head -1 || true)"
  if [ -n "$HOST" ]; then
    echo "  ヒント: 変数 ${HOST} の値の中に「${V}=...」が連結されています。" >&2
    echo "         Routineの環境変数設定で ${HOST} の値の末尾を確認し、${V} を独立した変数として登録してください。" >&2
  else
    echo "  ヒント: Routineの環境変数（シークレット）設定に ${V} を追加してください。" >&2
  fi
  NG=1
done
exit $NG
