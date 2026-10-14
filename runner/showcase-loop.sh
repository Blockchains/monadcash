#!/usr/bin/env bash
# Near-continuous showcase: one full agent round (all vaults) every INTERVAL_S seconds for DURATION_MIN minutes.
# Each round is a fresh node process (a crash never kills the loop); the ledger + public snapshot are committed after
# every round by runner/showcase-commit.sh (COMMIT=1). Exit 3 = the per-tx spend guard tripped (stop early).
#   DURATION_MIN (default 340 = 5h40m, under the 6h GitHub-hosted job limit), INTERVAL_S (default 120), COMMIT (default 1)
#   KILL_VAR (default SHOWCASE_ENABLED): the loop also stops within one round when this repo variable is no longer 'true'
set -uo pipefail
cd "$(dirname "$0")/.."
DURATION_MIN=${DURATION_MIN:-340}; INTERVAL_S=${INTERVAL_S:-120}; COMMIT=${COMMIT:-1}; KILL_VAR=${KILL_VAR:-SHOWCASE_ENABLED}
[ "$DURATION_MIN" -gt 340 ] 2>/dev/null && DURATION_MIN=340   # GitHub-hosted jobs die at 6h
start=$(date +%s); end=$(( start + DURATION_MIN * 60 )); i=0
echo "loop: ${DURATION_MIN} min, one round every ${INTERVAL_S}s, commit=${COMMIT}"
while :; do
  i=$((i + 1)); t0=$(date +%s)
  echo "::group::round $i ($(date -u +%H:%M:%SZ), $(( (end - t0) / 60 )) min left)"
  node runner/showcase-agents.mjs run; rc=$?
  echo "::endgroup::"
  if [ "$COMMIT" = "1" ]; then bash runner/showcase-commit.sh "$i" || echo "::warning::commit/push of round $i failed (will retry next round)"; fi
  if [ "$rc" -eq 3 ]; then echo "::error::spend guard tripped: stopping the loop"; exit 3; fi
  [ "$rc" -ne 0 ] && echo "::warning::round $i exited with $rc (continuing)"
  # kill switch mid-run (best effort: needs actions:read on GITHUB_TOKEN; ignored when unavailable)
  if [ -n "${GITHUB_REPOSITORY:-}" ] && command -v gh >/dev/null 2>&1; then
    v=$(gh variable get "$KILL_VAR" --repo "$GITHUB_REPOSITORY" 2>/dev/null) && [ "$v" != "true" ] && { echo "kill switch: $KILL_VAR=$v, stopping"; exit 0; }
  fi
  now=$(date +%s); [ "$now" -ge "$end" ] && break
  s=$(( INTERVAL_S - (now - t0) )); [ "$s" -gt 0 ] && sleep "$s"
  [ $(( $(date +%s) + 45 )) -ge "$end" ] && break   # not enough time left for another round
done
echo "loop done: $i rounds in $(( ($(date +%s) - start) / 60 )) min"
