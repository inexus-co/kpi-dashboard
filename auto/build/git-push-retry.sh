#!/usr/bin/env bash
# 使い方: bash auto/build/git-push-retry.sh "<コミットメッセージ>" <file1> [file2...]
# 同時刻に複数Routineが走っても競合しないよう pull --rebase + リトライでpushする
set -euo pipefail
MSG="${1:?usage: git-push-retry.sh <msg> <files...>}"; shift
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
git config user.email "rikiei.watanabe@inexus-co.com"
git config user.name "KPI Dashboard Bot"
git add "$@"
if git diff --cached --quiet; then echo "no changes"; exit 0; fi
git commit -m "$MSG" >/dev/null
if [ "${SKIP_PUSH:-}" = "1" ]; then echo "SKIP_PUSH=1: pushせず終了"; git log --oneline -1; echo DONE; exit 0; fi
for i in 1 2 3 4 5; do
  if [ -n "${GITHUB_PAT:-}" ]; then
    git pull --rebase "https://x-access-token:${GITHUB_PAT}@github.com/inexus-co/kpi-dashboard.git" main 2>&1 | sed -E "s#${GITHUB_PAT}#***#g" | tail -1
    if git push "https://x-access-token:${GITHUB_PAT}@github.com/inexus-co/kpi-dashboard.git" HEAD:main 2>&1 | sed -E "s#${GITHUB_PAT}#***#g" | tail -2; then
      git log --oneline -1; echo DONE; exit 0; fi
  else
    git pull --rebase origin main 2>&1 | tail -1
    if git push origin HEAD:main 2>&1 | tail -2; then git log --oneline -1; echo DONE; exit 0; fi
  fi
  echo "push retry $i"; sleep $((RANDOM % 10 + 5))
done
echo "push failed after retries"; exit 1
