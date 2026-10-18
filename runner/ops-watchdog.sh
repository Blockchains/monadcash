#!/usr/bin/env bash
# PolicyPilot showcase agents (operated by the team). Watchdog for the box-free money jobs (no keys involved):
#   - agent-refill: no successful run in 65 min and none queued/running -> re-dispatch (kick=true)
#   - daily-sweep: after 05:00 UTC, no successful real sweep since 04:00 UTC and none queued/running -> re-dispatch
#   - Pages heartbeat: Pages copy of ops-status-143.json more than 60 min behind main -> re-deploy pages.yml
#   - ONE issue (mentions @Blockchains) only on REPEATED failure: last 3 agent-refill runs failed, or last 2 real
#     daily-sweeps failed, or no successful refill for 3 h despite re-dispatch. Closed automatically once healthy.
# Writes its result to ${OUT:-/tmp/ops-watchdog.json} for the heartbeat.
set -uo pipefail
R=${GITHUB_REPOSITORY:?}; now=$(date -u +%s); OUT=${OUT:-/tmp/ops-watchdog.json}
ts() { date -u -d "$1" +%s 2>/dev/null || echo 0; }
did=(); prob=()
# ---- agent-refill
J=$(gh run list -R "$R" -w agent-refill.yml -L 20 --json status,conclusion,createdAt,event) || J='[]'
act=$(jq '[.[]|select(.status!="completed")]|length' <<<"$J")
lastok=$(jq -r '[.[]|select(.conclusion=="success")][0].createdAt // "1970-01-01T00:00:00Z"' <<<"$J")
refill_age=$(( now - $(ts "$lastok") ))
if [ "$act" = 0 ] && [ "$refill_age" -gt 3900 ]; then
  gh workflow run agent-refill.yml -R "$R" -f kick=true -f dry_run=false && did+=("re-dispatched agent-refill (last success ${lastok})")
fi
rf=$(jq '[.[]|select(.status=="completed")|.conclusion] as $c | ([$c|to_entries[]|select(.value!="failure")|.key]|min // ($c|length))' <<<"$J")
[ "$rf" -ge 3 ] && prob+=("agent-refill: the last ${rf} runs failed")
[ "$refill_age" -gt 10800 ] && prob+=("agent-refill: no successful run for $((refill_age/60)) min (last ${lastok})")
# ---- daily-sweep
S=$(gh run list -R "$R" -w daily-sweep.yml -L 20 --json status,conclusion,createdAt,displayTitle) || S='[]'
since=$(date -u +%Y-%m-%dT04:00:00Z)
okToday=$(jq --arg s "$since" '[.[]|select(.displayTitle=="daily-sweep" and .conclusion=="success" and .createdAt>=$s)]|length' <<<"$S")
sact=$(jq '[.[]|select(.status!="completed")]|length' <<<"$S")
if [ "$(date -u +%H%M)" -ge 0500 ] && [ "$okToday" = 0 ] && [ "$sact" = 0 ]; then
  gh workflow run daily-sweep.yml -R "$R" -f kick=true -f dry_run=false && did+=("re-dispatched daily-sweep (no successful sweep since ${since})")
fi
sf=$(jq '[.[]|select(.displayTitle=="daily-sweep" and .status=="completed")|.conclusion] as $c | ([$c|to_entries[]|select(.value!="failure")|.key]|min // ($c|length))' <<<"$S")
[ "$sf" -ge 2 ] && prob+=("daily-sweep: the last ${sf} real sweeps failed")
lastsweep=$(jq -r '[.[]|select(.displayTitle=="daily-sweep" and .conclusion=="success")][0].createdAt // "1970-01-01T00:00:00Z"' <<<"$S")
[ $(( now - $(ts "$lastsweep") )) -gt 108000 ] && prob+=("daily-sweep: no successful real sweep for over 30 h (last ${lastsweep})")
# ---- Pages heartbeat freshness
raw=$(curl -fsS -m 15 "https://raw.githubusercontent.com/$R/main/web/public/ops-status-143.json?$now" | jq -r '.updatedAt // empty' 2>/dev/null)
pg=$(curl -fsS -m 15 "https://${R%%/*}.github.io/${R#*/}/ops-status-143.json?$now" | jq -r '.updatedAt // empty' 2>/dev/null)
pact=$(gh run list -R "$R" -w pages.yml -L 3 --json status -q '[.[]|select(.status!="completed")]|length' 2>/dev/null || echo 1)
if [ -n "$raw" ] && [ "$pact" = 0 ] && [ $(( $(ts "$raw") - $(ts "${pg:-1970-01-01T00:00:00Z}") )) -gt 3600 ]; then
  gh workflow run pages.yml -R "$R" && did+=("re-deployed Pages (heartbeat on Pages was ${pg:-missing}, main ${raw})")
fi
# ---- result + issue
jq -n --arg lastRefillOk "$lastok" --arg lastSweepOk "$lastsweep" --argjson refillFails "$rf" --argjson sweepFails "$sf" \
  --arg actions "$(printf '%s\n' "${did[@]:-}")" --arg problems "$(printf '%s\n' "${prob[@]:-}")" \
  '{lastRefillOk:$lastRefillOk, lastSweepOk:$lastSweepOk, refillConsecutiveFailures:$refillFails, sweepConsecutiveFailures:$sweepFails,
    actions:($actions|split("\n")|map(select(length>0))), problems:($problems|split("\n")|map(select(length>0)))}' > "$OUT"
cat "$OUT"
TITLE='ops-watchdog: repeated failures in agent-refill / daily-sweep'
NUM=$(gh issue list -R "$R" --state all --limit 200 --json number,title,state | jq -r --arg t "$TITLE" '[.[]|select(.title==$t)]|sort_by(.number)|.[0].number // empty')
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/$R/actions/runs/${GITHUB_RUN_ID:-0}"
if [ "${#prob[@]}" = 0 ]; then
  if [ -n "$NUM" ] && [ "$(gh issue view "$NUM" -R "$R" --json state -q .state)" = OPEN ]; then gh issue close "$NUM" -R "$R" --comment "Healthy again. $RUN_URL"; fi
  exit 0
fi
BODY=$(printf '@Blockchains the box-free ops jobs are failing repeatedly (the watchdog already re-dispatched them).\n\n%s\n\nLast check: %s\n' "$(printf -- '- %s\n' "${prob[@]}")" "$RUN_URL")
if [ -z "$NUM" ]; then gh issue create -R "$R" --title "$TITLE" --body "$BODY"
else
  [ "$(gh issue view "$NUM" -R "$R" --json state -q .state)" = OPEN ] || { gh issue reopen "$NUM" -R "$R"; gh issue comment "$NUM" -R "$R" --body "@Blockchains failing again. $RUN_URL"; }
  gh issue edit "$NUM" -R "$R" --body "$BODY"
fi
exit 0
