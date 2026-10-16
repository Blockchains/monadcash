#!/usr/bin/env bash
# Commit the public tape read. [skip ci] keeps the hourly job off the test workflow.
# Pages picks the file up on the next content deploy; the page also reads the raw file.
set -uo pipefail
cd "$(dirname "$0")/../.."
FILE=web/public/research/live.json
BRANCH=${BRANCH:-${GITHUB_REF_NAME:-main}}
MSG="tape: public read ${GITHUB_RUN_NUMBER:-local} [skip ci]"
git config user.name "policypilot-tape-bot"
git config user.email "tape-bot@users.noreply.github.com"
git add -- "$FILE"
git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
git commit -q -m "$MSG" || exit 1
for try in 1 2 3 4 5; do
  git fetch -q origin "$BRANCH" || { sleep $((try * 4)); continue; }
  if git rebase -q -X theirs "origin/$BRANCH"; then
    git push -q origin "HEAD:$BRANCH" && { echo "pushed: $MSG"; exit 0; }
  else
    echo "rebase conflict: rereading on origin/$BRANCH"
    git rebase --abort 2>/dev/null || true
    git reset -q --hard "origin/$BRANCH"
    node web/scripts/tape-refresh.mjs || echo "reread failed"
    git add -- "$FILE"
    git diff --cached --quiet || git commit -q -m "$MSG"
    git push -q origin "HEAD:$BRANCH" && { echo "pushed (reread): $MSG"; exit 0; }
  fi
  sleep $((try * 4))
done
echo "push failed after retries"
exit 1
