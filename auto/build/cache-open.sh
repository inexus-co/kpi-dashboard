#!/usr/bin/env bash
# 使い方: bash auto/build/cache-open.sh <encファイル名 例: cache-saiten.enc>
# 必要環境変数: CACHE_KEY
set -euo pipefail
: "${CACHE_KEY:?CACHE_KEY not set}"
ENC="${1:?usage: cache-open.sh <enc-file>}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
mkdir -p auto/cache
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -in "auto/$ENC" | tar -x -C auto
echo "cache opened from $ENC"; ls auto/cache auto/cache/slack_archive 2>/dev/null || true
