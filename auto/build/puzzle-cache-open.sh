#!/usr/bin/env bash
# キャッシュ復号: auto/cache-puzzle.enc -> auto/cache/slack_archive/
# 必要環境変数: CACHE_KEY
set -euo pipefail
: "${CACHE_KEY:?CACHE_KEY not set}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
mkdir -p auto/cache
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -k "$CACHE_KEY" -in auto/cache-puzzle.enc | tar -x -C auto
echo "cache opened:"; ls auto/cache/slack_archive
