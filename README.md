# PolicyPilot (Monad) – bounded transaction execution reference implementation

**Demo video:** [watch](https://blockchains.github.io/policypilot-monad/demo.html) · [download MP4](https://blockchains.github.io/policypilot-monad/demo.mp4)
Status: IMPLEMENTED + TESTED locally (Foundry, anvil). NOT DEPLOYED to any public network.
- `src/PolicyPilot.sol` non-upgradeable contract (OpenZeppelin v5.7.0 SafeERC20). `src/MockToken.sol` test-only.
- `test/PolicyPilot.t.sol` 14 unit + 2 fuzz + 3 invariants (1 invariant suite).
- `executor/` viem deterministic executor + `e2e-anvil.mjs` local demo (writes evidence JSON).
- `frontend/index.html` static read-only viewer.
Run: `forge test -vv`; `anvil &`; `cd executor && node e2e-anvil.mjs`.
Monad testnet deploy (needs approval + funded testnet key via env, never committed):
`forge create src/PolicyPilot.sol:PolicyPilot --rpc-url $MONAD_TESTNET_RPC --private-key $KEY --constructor-args <asset> <admin> <executor> <limit> <budget>`
