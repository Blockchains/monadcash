#!/usr/bin/env bash
# Live PolicyPilot demo on Monad testnet. Requires: ETH_PRIVATE_KEY (executor+admin key, read from env by cast),
# PP (PolicyPilot address), R1, R2 (allowlisted recipients). Writes JSON lines to stdout.
set -uo pipefail
RPC=${RPC:-https://testnet-rpc.monad.xyz/}
BAD=${BAD:-0x000000000000000000000000000000000000dEaD}
FROM=$(cast wallet address --private-key "$ETH_PRIVATE_KEY")
id() { cast keccak "$1"; }
send() { # label, sig, args... ; reverting txs are sent with a fixed gas limit so they land on-chain
  local label=$1; shift
  local sim; sim=$(cast call --rpc-url "$RPC" --from "$FROM" "$PP" "$@" 2>&1 | tr -d '\n' | sed 's/"/'"'"'/g' | cut -c1-300)
  local out; out=$(cast send --rpc-url "$RPC" --private-key "$ETH_PRIVATE_KEY" --json --gas-limit 200000 "$PP" "$@" 2>&1)
  local h b s; h=$(jq -r .transactionHash <<<"$out" 2>/dev/null); b=$(jq -r .blockNumber <<<"$out" 2>/dev/null); s=$(jq -r .status <<<"$out" 2>/dev/null)
  echo "{\"label\":\"$label\",\"tx\":\"$h\",\"block\":\"$b\",\"status\":\"$s\",\"eth_call_preflight\":\"$sim\"}"
}
send valid_execute_1  "execute(bytes32,address,uint256)" "$(id req-1)" "$R1" 100000000000000000000
send valid_execute_2  "execute(bytes32,address,uint256)" "$(id req-2)" "$R2" 100000000000000000000
send replay_req_1     "execute(bytes32,address,uint256)" "$(id req-1)" "$R1" 10000000000000000000
send reject_recipient "execute(bytes32,address,uint256)" "$(id req-3)" "$BAD" 10000000000000000000
send reject_per_request_limit "execute(bytes32,address,uint256)" "$(id req-4)" "$R1" 150000000000000000000
send reject_budget    "execute(bytes32,address,uint256)" "$(id req-5)" "$R1" 60000000000000000000
send pause            "setPaused(bool)" true
send reject_paused    "execute(bytes32,address,uint256)" "$(id req-6)" "$R1" 10000000000000000000
send unpause          "setPaused(bool)" false
