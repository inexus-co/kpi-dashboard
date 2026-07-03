#!/usr/bin/env bash
# 環境変数設定の改行欠落などで CACHE_KEY が他の変数の値の中に紛れ込んでいる場合に回収する。
# 例: ISE_EXTERNAL_PASSWORD='xxx CACHE_KEY=abc123...' → CACHE_KEY を抽出して export
# 各 publish/prepare スクリプトの先頭（CACHE_KEY チェックの前）で source すること。
# シークレットのため値そのものは絶対に出力しない。
if [ -z "${CACHE_KEY:-}" ]; then
  CACHE_KEY="$(env | grep -m1 -oE 'CACHE_KEY=[A-Za-z0-9]+' | cut -d= -f2- || true)"
  if [ -n "$CACHE_KEY" ]; then
    export CACHE_KEY
    echo "env-recover: CACHE_KEY を他の環境変数の値から回収しました。環境変数設定（Routine/環境の設定画面）で ISE_EXTERNAL_PASSWORD と CACHE_KEY を別々の行に分離してください。" >&2
  fi
fi
