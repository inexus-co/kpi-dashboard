#!/usr/bin/env bash
# 使い方: bash auto/build/git-push-retry.sh "<コミットメッセージ>" <file1> [file2...]
# 同時刻に複数Routineが走っても競合しないよう pull --rebase + リトライでpushする
set -euo pipefail
MSG="${1:?usage: git-push-retry.sh <msg> <files...>}"; shift
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
git config user.email "noreply@anthropic.com"
git config user.name "KPI Dashboard Bot"
git add "$@"
if git diff --cached --quiet; then echo "no changes"; exit 0; fi
git commit -m "$MSG" >/dev/null
if [ "${SKIP_PUSH:-}" = "1" ]; then echo "SKIP_PUSH=1: pushせず終了"; git log --oneline -1; echo DONE; exit 0; fi
CURRENT_BRANCH="$(git branch --show-current)"
for i in 1 2 3 4 5; do
  if [ -n "${GITHUB_PAT:-}" ]; then
    REMOTE="https://x-access-token:${GITHUB_PAT}@github.com/inexus-co/kpi-dashboard.git"
    git pull --rebase "$REMOTE" main 2>&1 | sed -E "s#${GITHUB_PAT}#***#g" | tail -1
    if git push "$REMOTE" HEAD:main 2>&1 | sed -E "s#${GITHUB_PAT}#***#g" | tail -2; then
      # sync feature branch to stop-hook sees no unpushed commits
      if [[ -n "$CURRENT_BRANCH" && "$CURRENT_BRANCH" != "main" ]]; then
        git push "$REMOTE" HEAD:"$CURRENT_BRANCH" 2>&1 | sed -E "s#${GITHUB_PAT}#***#g" | tail -1 || true
      fi
      git log --oneline -1; echo DONE; exit 0; fi
  else
    git pull --rebase origin main 2>&1 | tail -1
    if git push origin HEAD:main 2>&1 | tail -2; then
      if [[ -n "$CURRENT_BRANCH" && "$CURRENT_BRANCH" != "main" ]]; then
        git push origin HEAD:"$CURRENT_BRANCH" 2>&1 | tail -1 || true
      fi
      git log --oneline -1; echo DONE; exit 0; fi
  fi
  echo "push retry $i"; sleep $((RANDOM % 10 + 5))
done
echo "push failed after retries"; exit 1
