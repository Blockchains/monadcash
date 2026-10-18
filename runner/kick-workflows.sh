#!/usr/bin/env bash
# PolicyPilot showcase agents (operated by the team). Box-free backup trigger for the two money workflows.
# Measured: GitHub's scheduler fires this repo's crons only every few hours (hourly crons ran 3-5 h apart, and the new
# */30 agent-refill cron did not fire at all for hours). The showcase loop is always running, so it dispatches:
#   - agent-refill.yml when its newest run is older than 28 min
#   - daily-sweep.yml once per UTC day after 04:07 UTC (if no real daily-sweep run was created since 04:00 UTC)
#   - ops-watchdog.yml when its newest run is older than 55 min (the watchdog has its own crons too)
# Called from runner/showcase-commit.sh after every round. Needs `actions: write` on GITHUB_TOKEN. Never fails the caller.
set -uo pipefail
[ -n "${GITHUB_REPOSITORY:-}" ] && command -v gh >/dev/null 2>&1 || w=$(gh run list -R "$R" -w ops-watchdog.yml -L 1 --json createdAt -q '.[0].createdAt // "1970-01-01T00:00:00Z"' 2>/dev/null) || exit 0
if [ $(( now - $(date -u -d "$w" +%s) )) -gt 3300 ]; then
  gh workflow run ops-watchdog.yml -R "$R" -f kick=true >/dev/null 2>&1 && echo "kick: ops-watchdog dispatched"
fi
exit 0
R=$GITHUB_REPOSITORY; now=$(date -u +%s)
t=$(gh run list -R "$R" -w agent-refill.yml -L 1 --json createdAt -q '.[0].createdAt // "1970-01-01T00:00:00Z"' 2>/dev/null) || w=$(gh run list -R "$R" -w ops-watchdog.yml -L 1 --json createdAt -q '.[0].createdAt // "1970-01-01T00:00:00Z"' 2>/dev/null) || exit 0
if [ $(( now - $(date -u -d "$w" +%s) )) -gt 3300 ]; then
  gh workflow run ops-watchdog.yml -R "$R" -f kick=true >/dev/null 2>&1 && echo "kick: ops-watchdog dispatched"
fi
exit 0
if [ $(( now - $(date -u -d "$t" +%s) )) -gt 1680 ]; then
  gh workflow run agent-refill.yml -R "$R" -f kick=true -f dry_run=false >/dev/null 2>&1 && echo "kick: agent-refill dispatched"
fi
if [ "$(date -u +%H%M)" -ge 407 ] 2>/dev/null; then
  since=$(date -u +%Y-%m-%dT04:00:00Z)
  n=$(gh run list -R "$R" -w daily-sweep.yml -L 20 --json createdAt,displayTitle 2>/dev/null | jq --arg s "$since" '[.[]|select(.displayTitle=="daily-sweep" and .createdAt>=$s)]|length') || w=$(gh run list -R "$R" -w ops-watchdog.yml -L 1 --json createdAt -q '.[0].createdAt // "1970-01-01T00:00:00Z"' 2>/dev/null) || exit 0
if [ $(( now - $(date -u -d "$w" +%s) )) -gt 3300 ]; then
  gh workflow run ops-watchdog.yml -R "$R" -f kick=true >/dev/null 2>&1 && echo "kick: ops-watchdog dispatched"
fi
exit 0
  [ "$n" = 0 ] && gh workflow run daily-sweep.yml -R "$R" -f kick=true -f dry_run=false >/dev/null 2>&1 && echo "kick: daily-sweep dispatched"
fi
w=$(gh run list -R "$R" -w ops-watchdog.yml -L 1 --json createdAt -q '.[0].createdAt // "1970-01-01T00:00:00Z"' 2>/dev/null) || exit 0
if [ $(( now - $(date -u -d "$w" +%s) )) -gt 3300 ]; then
  gh workflow run ops-watchdog.yml -R "$R" -f kick=true >/dev/null 2>&1 && echo "kick: ops-watchdog dispatched"
fi
exit 0
