#!/usr/bin/env bash
# Copies ONLY the showcase agent executor keys into encrypted GitHub Actions secrets (never the deployer key).
# Needs: gh auth login (repo admin). Values are piped via stdin and never printed. Personas missing from the keys file are skipped.
set -euo pipefail
REPO=${REPO:-Blockchains/policypilot-monad}; KEYS=${KEYS:-$HOME/.policypilot/showcase-agents-143v2.json}
for id in ${IDS:-dca staker payroll rogue dca1 mm rebalancer tipper tester}; do
  if ! node -e "const a=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).agents[process.argv[2]]; if(!a||!a.key) process.exit(1)" "$KEYS" "$id"; then echo "skip $id (not in $KEYS)"; continue; fi
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).agents[process.argv[2]].key)" "$KEYS" "$id" \
    | gh secret set "AGENT_KEY_$(echo $id | tr a-z A-Z)" --repo "$REPO"
  echo "set AGENT_KEY_$(echo $id | tr a-z A-Z)"
done
echo "Next: touch ~/.policypilot/showcase-143v2.handoff   (box runner exits WITHOUT recovering funds)"
echo "Then: gh variable set SHOWCASE_ENABLED --body true --repo $REPO"
