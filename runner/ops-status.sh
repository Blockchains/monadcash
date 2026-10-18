#!/usr/bin/env bash
# Heartbeat: merge one job's result into web/public/ops-status-143.json and push it to main with [skip ci].
# Live at https://raw.githubusercontent.com/Blockchains/policypilot-monad/main/web/public/ops-status-143.json and on
# Pages (https://blockchains.github.io/policypilot-monad/ops-status-143.json) after the next Pages deploy (the
# watchdog re-deploys Pages when its copy is over an hour old). Never fails the caller. No keys are ever involved.
#   usage: runner/ops-status.sh refill|sweep|watchdog <result.json>
set -uo pipefail
cd "$(dirname "$0")/.."
SEC=${1:?section}; IN=${2:?json}; F=web/public/ops-status-143.json
[ -s "$IN" ] || { echo "heartbeat: no $IN"; exit 0; }
jq -e '.dryRun == true' "$IN" >/dev/null 2>&1 && { echo "heartbeat: dry run, not recorded"; exit 0; }
RUN="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-Blockchains/policypilot-monad}/actions/runs/${GITHUB_RUN_ID:-0}"
case "$SEC" in
  refill) SUM='{at:(.finishedAt // $now), run:$run, event:$ev, txs:(.txs|map({id, to, amountMon, hash, status})), refiller:.refiller.note, floatMon:.floatMon, deployerMon:.deployerMon, unpaused:(.unpaused // []), stillPaused:.paused, problems:.problems, alertActive:.alert.active, vaults:(.vaults|map({id, vault, mon:.after, paused})), agents:(.agents|map({id, agent, mon:.after}))}' ;;
  sweep)  SUM='{at:(.finishedAt // $now), run:$run, event:$ev, txs:(.txs|map({id, kind, amountMon, hash, status})), vaultsSweptMon, deployerBefore, deployerAfter, floatBefore, floatAfter, refill:.refill.note, problems, vaults:(.vaults|map({id, vault, mon:.after, swept, paused})), agents:(.agents|map({id, agent, mon:.after, sent}))}' ;;
  *)      SUM='. + {at:$now, run:$run, event:$ev}' ;;
esac
git config user.name "policypilot-ops-bot"; git config user.email "ops-bot@users.noreply.github.com"
for try in 1 2 3 4 5; do
  git fetch -q origin main && git reset -q --hard origin/main || { sleep $((try * 3)); continue; }
  [ -s "$F" ] || echo '{}' > "$F"
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq --arg sec "$SEC" --arg now "$now" --arg run "$RUN" --arg ev "${GITHUB_EVENT_NAME:-local}" --slurpfile r "$IN" \
    '. + {label:"PolicyPilot showcase agents (operated by the team)", note:"ALPHA / UNAUDITED. Heartbeat of the box-free ops jobs (agent-refill every 30 min, daily-sweep once a day, ops-watchdog hourly).", updatedAt:$now, deployer:"0xc0c4E411e41bECAD6DA860F67063C2D6363a6113"} | .[$sec] = ($r[0] | '"$SUM"')' \
    "$F" > "$F.tmp" && mv "$F.tmp" "$F" || { echo "heartbeat: jq failed"; exit 0; }
  git add "$F"; git diff --cached --quiet && exit 0
  git commit -q -m "ops: $SEC heartbeat [skip ci]" && git push -q origin HEAD:main && { echo "heartbeat: $SEC pushed"; exit 0; }
  sleep $((try * 3))
done
echo "heartbeat: push failed"; exit 0
