# PolicyPilot (Monad) – bounded transaction execution reference implementation

**Pitch video (2 min):** [watch](https://blockchains.github.io/policypilot-monad/demo.html) · [download MP4](https://blockchains.github.io/policypilot-monad/pitch.mp4)

**Demo video:** [watch](https://blockchains.github.io/policypilot-monad/demo.html) · [download MP4](https://blockchains.github.io/policypilot-monad/demo.mp4)
Status: IMPLEMENTED + TESTED locally (Foundry, anvil) and DEPLOYED to Monad testnet (test token only; not mainnet).
- `src/PolicyPilot.sol` non-upgradeable contract (OpenZeppelin v5.7.0 SafeERC20). `src/MockToken.sol` test-only.
- `test/PolicyPilot.t.sol` 14 unit + 2 fuzz + 3 invariants (1 invariant suite).
- `executor/` viem deterministic executor + `e2e-anvil.mjs` local demo (writes evidence JSON).
- `frontend/index.html` static read-only viewer (RPC mode, or Envio indexer mode via `?indexer=`).
- `indexer/` Envio HyperIndex indexer for all PolicyPilot events (local).
Run: `forge test -vv`; `anvil &`; `cd executor && node e2e-anvil.mjs`.
Deploy yourself: see [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Live on Monad testnet (chain 10143)
- **PolicyPilot:** [`0x583fDB6441a9bCE517CF5bb15b9dB7340BB57D4E`](https://testnet.monadexplorer.com/address/0x583fDB6441a9bCE517CF5bb15b9dB7340BB57D4E) (Sourcify verified, exact runtime match)
- **MockToken (mUSD, test-only):** [`0xE2966C817267FC7E63362895Cf55C6cb2548b9E3`](https://testnet.monadexplorer.com/address/0xE2966C817267FC7E63362895Cf55C6cb2548b9E3) (Sourcify verified)
- Policy: executor = admin = `0x549D8c5D94f8ec4Ea488a0283f8EbF16b509b411`, 2 allowlisted recipients, per-request limit 100 mUSD, budget 250 mUSD, funded 1000 mUSD.
- Live viewer: https://blockchains.github.io/policypilot-monad/ · Record: [`deployments/monad-testnet.json`](deployments/monad-testnet.json) · Reproduce: [`docs/DEPLOY.md`](docs/DEPLOY.md)

| demo step | result | tx |
|---|---|---|
| valid_execute_1 | success | [0x8e799909dd71…](https://testnet.monadexplorer.com/tx/0x8e799909dd7155cac966ff15e14eb72d7cbaedc8bc8b58952f5392ed8b260305) |
| valid_execute_2 | success | [0x593705cc5d3b…](https://testnet.monadexplorer.com/tx/0x593705cc5d3bbcd6932cc37574e73bd97937ccbeca76bb151c00788ec6e451c3) |
| replay_req_1 | reverted | [0x618511db3427…](https://testnet.monadexplorer.com/tx/0x618511db34273878d7b83bb8bd1af5b2062e7c94fe3a806db30a2efae7da52f9) |
| reject_recipient | reverted | [0x475a58183dc2…](https://testnet.monadexplorer.com/tx/0x475a58183dc244e3eb5caddd2dbcd4085a54e7da54f738b82eeb24dff85aeb6a) |
| reject_per_request_limit | reverted | [0x540ff26d3148…](https://testnet.monadexplorer.com/tx/0x540ff26d3148eb511c8967b17fe05df194502d9bfd142d6f55076e6def3601a4) |
| reject_budget | reverted | [0xc61f401a6e45…](https://testnet.monadexplorer.com/tx/0xc61f401a6e45d60766c9772d85b00894fc5dbc824fca5e850f5c50ed63fdad59) |
| pause | success | [0x195ac238401b…](https://testnet.monadexplorer.com/tx/0x195ac238401bf6fd8681fe6591bc976e037bd5850aa5331759b82750939fcfa7) |
| reject_paused | reverted | [0x1bbaf1dfb8ba…](https://testnet.monadexplorer.com/tx/0x1bbaf1dfb8badf94241c3e150293315d09831ae138fb14904b05b99c55023977) |
| unpause | success | [0x919240de6de0…](https://testnet.monadexplorer.com/tx/0x919240de6de013e59d3038b7a6f9493e5e065bdf9d0c78debb16e4f666dffc26) |

Rejections are real on-chain **reverted** transactions (sent with a fixed gas limit after an `eth_call` preflight captured the revert reason).

## Envio HyperIndex indexer (optional data source)
`indexer/` is an Envio HyperIndex project that indexes every PolicyPilot event on Monad testnet (PerRequestLimitSet, BudgetSet, RecipientSet, Executed, PausedSet) into `PolicyState`, `Execution`, `Recipient` and an append-only `PolicyEvent` audit log, served over GraphQL.
The viewer reads state, execution history and the audit log from it when opened with `?indexer=<graphql url>` (or `indexerUrl` in `frontend/deployment.json`), and falls back to direct RPC otherwise or if the indexer is unreachable.
- Verified against the live contract: all 8 events indexed; indexer values match direct `cast call` reads (budget 250, limit 100, totalSpent 200 mUSD, paused false). Evidence: [`docs/envio-indexer-check.txt`](docs/envio-indexer-check.txt). Video (45 s): [envio-demo.mp4](https://blockchains.github.io/policypilot-monad/envio-demo.mp4).
- **Local only**: not hosted (no Envio Cloud), so the public site runs in RPC mode. Uses the public Monad RPC as source, so no HyperSync token or Envio account is needed. Run: [`indexer/README.md`](indexer/README.md).
