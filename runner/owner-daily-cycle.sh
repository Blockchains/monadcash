#!/usr/bin/env bash
# OWNER-SIDE half of the daily cycle. Runs ONLY where the deployer key lives (the box), never in GitHub.
# AgentVault.withdraw()/deposit() are onlyOwner, so agents cannot do this part.
#   runner/owner-daily-cycle.sh sweep    # every team vault: withdraw(owner, MON balance) -> deployer (never emergencyWithdrawAll, never pauses)
#   runner/owner-daily-cycle.sh refund   # deployer: plain-transfer each team vault up to its target, then top agents up to AGENT_TARGET
#   runner/owner-daily-cycle.sh all      # sweep then refund (run ~10 min after the 04:07 UTC GitHub daily-sweep)
# DRY_RUN=1 (default) simulates every call with eth_call --from <owner> and does NOT load the key.
# DRY_RUN=0 loads MONAD_MAINNET_PRIVATE_KEY from OWNER_ENV (default ~/.policypilot/mainnet-wallet.env); never printed.
# Safety: destination of the sweep is the hard-coded deployer; refunds only go to vault/agent addresses in
# runner/agent-refill-config-143.json; the deployer never drops below RESERVE (5 MON). Tokens (WMON/USDC/LSTs) are
# reported but only withdrawn with TOKENS=1 (LSTs cannot be unstaked here).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
OWNER=0xc0c4E411e41bECAD6DA860F67063C2D6363a6113
R=${RPC:-https://rpc.monad.xyz}; CFG=runner/agent-refill-config-143.json
DRY=${DRY_RUN:-1}; RESERVE=${RESERVE:-5}; AGENT_TARGET=${AGENT_TARGET:-30}; IDLE_AGENT_TARGET=${IDLE_AGENT_TARGET:-2}
IDLE_IDS=" dca3 staker3 payroll3 rogue3 "   # not run by showcase-agents.yml: keep them at gas dust
TOK="0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 0xA3227C5969757783154C60bF0bC1944180ed81B9 0x0c65A0BC65a5D819235B71F554D210D3F80E0852 0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081"
[ "$(jq -r .owner $CFG | tr A-F a-f)" = "$(echo $OWNER | tr A-F a-f)" ] || { echo "config owner != hard-coded deployer"; exit 1; }
K=""
if [ "$DRY" = 0 ]; then K=$(grep '^MONAD_MAINNET_PRIVATE_KEY=' "${OWNER_ENV:-$HOME/.policypilot/mainnet-wallet.env}" | cut -d= -f2-); [ -n "$K" ] || { echo "no owner key"; exit 1; }
  [ "$(cast wallet address --private-key "$K" | tr A-F a-f)" = "$(echo $OWNER | tr A-F a-f)" ] || { echo "key is not the deployer"; exit 1; }; fi
tx() { # to sig args... [--value X]
  if [ "$DRY" = 0 ]; then cast send "$@" --private-key "$K" --rpc-url "$R" --json | jq -r '"\(.transactionHash) \(.status)"'
  else cast call "$@" --from $OWNER --rpc-url "$R" >/dev/null 2>&1 && echo "dry-run ok" || echo "dry-run REVERTS"; fi; }
eth() { cast balance -e "$1" --rpc-url "$R"; }
ge() { python3 -c "import sys;sys.exit(0 if float('$1')>=float('$2') else 1)"; }
pairs() { jq -r '.agents[]|.id as $i|.agent as $a|.vaults[]|"\($i) \(.vault) \($a) \(.targetMon)"' $CFG; }
echo "deployer before: $(eth $OWNER) MON (dry_run=$DRY)"
sweep() {
  pairs | while read id v a t; do
    [ "$(cast call $v 'owner()(address)' --rpc-url $R | tr A-F a-f)" = "$(echo $OWNER | tr A-F a-f)" ] || { echo "$id: not owned by deployer, skip"; continue; }
    b=$(cast balance $v --rpc-url $R)
    if [ "$b" != 0 ]; then echo "sweep $id $v $(cast from-wei $b) MON: $(tx $v 'withdraw(address,uint256)' $OWNER $b)"; else echo "sweep $id: empty"; fi
    if [ "${TOKENS:-0}" = 1 ]; then for t in $TOK; do tb=$(cast call $t 'balanceOf(address)(uint256)' $v --rpc-url $R | cut -d' ' -f1)
      [ "$tb" != 0 ] && echo "  token $t $tb: $(tx $v 'withdrawToken(address,address,uint256)' $t $OWNER $tb)"; done; fi
  done; }
fund() { # kind id addr target
  cur=$(eth $3); amt=$(python3 -c "print(max(0, round($4-$cur, 4)))"); ge 0.1 "$amt" && { echo "fund $1 $2: at target ($cur)"; return; }
  ob=$(eth $OWNER); ge "$(python3 -c "print($ob-$amt)")" "$RESERVE" || { echo "fund $1 $2: STOP, deployer would drop below $RESERVE MON reserve"; return; }
  # plain MON transfer (vault receive()), as topup.sh did: deposit() is capped at vaultCap (1 MON on v1/v2-factory vaults)
  if [ "$DRY" = 0 ]; then echo "fund $1 $2 +$amt: $(cast send $3 --value ${amt}ether --private-key "$K" --rpc-url $R --json | jq -r '"\(.transactionHash) \(.status)"')"
  else cast call $3 --value ${amt}ether --from $OWNER --rpc-url $R >/dev/null 2>&1 && echo "fund $1 $2 +$amt: dry-run ok" || echo "fund $1 $2 +$amt: dry-run REVERTS"; fi; }
refund() {
  pairs | while read id v a t; do fund vault $id $v $t; done
  jq -r '.agents[]|"\(.id) \(.agent)"' $CFG | while read id a; do case "$IDLE_IDS" in *" $id "*) fund agent $id $a $IDLE_AGENT_TARGET;; *) fund agent $id $a $AGENT_TARGET;; esac; done; }
case "${1:-}" in sweep) sweep;; refund) refund;; all) sweep; refund;; *) echo "usage: $0 sweep|refund|all"; exit 2;; esac
echo "deployer after: $(eth $OWNER) MON"; unset K
