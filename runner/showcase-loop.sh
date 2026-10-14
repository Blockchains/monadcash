#!/usr/bin/env bash
# Near-continuous showcase: one full agent round (all vaults) every INTERVAL_S seconds (default 10 min) for DURATION_MIN minutes.
# Each round is a fresh node process (a crash never kills the loop); the ledger + public snapshot are committed after
# every round by runner/showcase-commit.sh (COMMIT=1). Exit 3 = the per-tx spend guard tripped (stop early).
#   INTERVAL_S / DURATION_MIN: explicit values win (workflow_dispatch inputs). When unset, the defaults come from
#   runner/showcase-loop.env and are re-read after every round, so a change merged to main applies within one round.
#   DURATION_MIN max 340 (= 5h40m, under the 6h GitHub-hosted job limit), COMMIT (default 1)
#   KILL_VAR (default SHOWCASE_ENABLED): the loop also stops within one round when this repo variable is no longer 'true'
set -uo pipefail
cd "$(dirname "$0")/.."
COMMIT=${COMMIT:-1}; KILL_VAR=${KILL_VAR:-SHOWCASE_ENABLED}
defaults() { INTERVAL_S_DEFAULT=600; DURATION_MIN_DEFAULT=340; [ -f runner/showcase-loop.env ] && . runner/showcase-loop.env; }
interval() { if [ -n "${INTERVAL_S:-}" ]; then echo "$INTERVAL_S"; else defaults; echo "$INTERVAL_S_DEFAULT"; fi; }
defaults; DURATION_MIN=${DURATION_MIN:-$DURATION_MIN_DEFAULT}
[ "$DURATION_MIN" -gt 340 ] 2>/dev/null && DURATION_MIN=340   # GitHub-hosted jobs die at 6h
start=$(date +%s); end=$(( start + DURATION_MIN * 60 )); i=0
echo "loop: ${DURATION_MIN} min, one round every $(interval)s${INTERVAL_S:+ (fixed)}, commit=${COMMIT}"
while :; do
  i=$((i + 1)); t0=$(date +%s)
  echo "::group::round $i ($(date -u +%H:%M:%SZ), $(( (end - t0) / 60 )) min left)"
  ROUND_SPACING_S=$(interval) node runner/showcase-agents.mjs run; rc=$?   # the runner also paces itself to this spacing
  echo "::endgroup::"
  if [ "$COMMIT" = "1" ]; then bash runner/showcase-commit.sh "$i" || echo "::warning::commit/push of round $i failed (will retry next round)"; fi
  if [ "$rc" -eq 3 ]; then echo "::error::spend guard tripped: stopping the loop"; exit 3; fi
  [ "$rc" -ne 0 ] && echo "::warning::round $i exited with $rc (continuing)"
  # kill switch mid-run (best effort: needs actions:read on GITHUB_TOKEN; ignored when unavailable)
  if [ -n "${GITHUB_REPOSITORY:-}" ] && command -v gh >/dev/null 2>&1; then
    v=$(gh variable get "$KILL_VAR" --repo "$GITHUB_REPOSITORY" 2>/dev/null) && [ "$v" != "true" ] && { echo "kill switch: $KILL_VAR=$v, stopping"; exit 0; }
  fi
  now=$(date +%s); [ "$now" -ge "$end" ] && break
  iv=$(interval); s=$(( iv - (now - t0) )); echo "next round in ${s}s (interval ${iv}s)"; [ "$s" -gt 0 ] && sleep "$s"
  [ $(( $(date +%s) + 45 )) -ge "$end" ] && break   # not enough time left for another round
done
echo "loop done: $i rounds in $(( ($(date +%s) - start) / 60 )) min"
