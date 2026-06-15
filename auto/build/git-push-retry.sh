#!/usr/bin/env bash
# 使い方: bash auto/build/git-push-retry.sh "<コミットメッセージ>" <file1> [file2...]
# 同時刻に複数Routineが走っても競合しないよう pull --rebase + リトライでpushする。
# push成功後は作業ブランチを同期（stop hook対策）し、7日より古いclaude/*ブランチを掃除する。
set -euo pipefail
# push許可OFF / GITHUB_PAT未設定時に対話プロンプトで固まらず即失敗させる（忘れやすい罠の早期検知）
export GIT_TERMINAL_PROMPT=0
MSG="${1:?usage: git-push-retry.sh <msg> <files...>}"; shift
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
git config user.email "noreply@anthropic.com"
git config user.name "KPI Dashboard Bot"
git add "$@"
if git diff --cached --quiet; then echo "no changes"; exit 0; fi
git commit -m "$MSG" >/dev/null
if [ "${SKIP_PUSH:-}" = "1" ]; then echo "SKIP_PUSH=1: pushせず終了"; git log --oneline -1; echo DONE; exit 0; fi
CURRENT_BRANCH="$(git branch --show-current)"

mask(){ if [ -n "${GITHUB_PAT:-}" ]; then sed -E "s#${GITHUB_PAT}#***#g"; else cat; fi; }

cleanup_old_branches(){
  # 7日より古い claude/* 作業ブランチをリモートから削除（現在のブランチは除く）
  local REMOTE="$1" now ref ts b
  git fetch "$REMOTE" '+refs/heads/claude/*:refs/remotes/cleanup/*' 2>/dev/null || return 0
  now=$(date +%s)
  git for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/remotes/cleanup/ | while read -r ref ts; do
    [ $((now - ts)) -gt 604800 ] || continue
    b="claude/${ref#cleanup/}"
    [ "$b" = "$CURRENT_BRANCH" ] && continue
    echo "cleanup: delete old branch $b"
    git push "$REMOTE" --delete "$b" 2>&1 | mask | tail -1 || true
  done
  return 0
}

for i in 1 2 3 4 5; do
  if [ -n "${GITHUB_PAT:-}" ]; then
    REMOTE="https://x-access-token:${GITHUB_PAT}@github.com/inexus-co/kpi-dashboard.git"
  else
    REMOTE="origin"
  fi
  git pull --rebase "$REMOTE" main 2>&1 | mask | tail -1
  if git push "$REMOTE" HEAD:main 2>&1 | mask | tail -2; then
    # 作業ブランチを同期（stop hookが未pushコミットと誤検知しないように）
    if [ -n "$CURRENT_BRANCH" ] && [ "$CURRENT_BRANCH" != "main" ]; then
      git push "$REMOTE" HEAD:"$CURRENT_BRANCH" 2>&1 | mask | tail -1 || true
    fi
    cleanup_old_branches "$REMOTE"
    git log --oneline -1; echo DONE; exit 0
  fi
  echo "push retry $i"; sleep $((RANDOM % 10 + 5))
done
echo "push failed after retries" >&2
echo "  ヒント: Routineの権限タブで「git push許可」がONか、または環境変数 GITHUB_PAT（書き込み権限）が設定されているか確認してください。" >&2
exit 1
