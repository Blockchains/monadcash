# Deploying PolicyPilot to Monad testnet (reproduction guide)

Network: Monad testnet, chain id `10143`, RPC `https://testnet-rpc.monad.xyz/`, explorer https://testnet.monadexplorer.com/.
Current deployment record: [`deployments/monad-testnet.json`](../deployments/monad-testnet.json). Test token only — no real value.

## 1. Tooling
```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
git clone https://github.com/Blockchains/policypilot-monad && cd policypilot-monad
git clone --depth 1 --branch v1.17.0 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.7.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge test -vv
```

## 2. Create a throwaway testnet wallet
```bash
cast wallet new            # note the address; store the key OUTSIDE the repo
mkdir -p ~/.policypilot && chmod 700 ~/.policypilot
printf 'MONAD_TESTNET_PRIVATE_KEY=0x...\n' > ~/.policypilot/wallet.env && chmod 600 ~/.policypilot/wallet.env
```
Never commit or print the key (`.env`, `*.key`, `broadcast/`, `cache/` are git-ignored).

## 3. Fund it from the faucet
Request testnet MON at https://faucet.monad.xyz/ (or https://testnet.monad.xyz/), then:
```bash
cast balance <ADDRESS> --rpc-url https://testnet-rpc.monad.xyz/ --ether   # must be > 0 (deploy used ~0.6 MON est.)
```

## 4. Environment
```bash
set -a; source ~/.policypilot/wallet.env; set +a
export RPC=https://testnet-rpc.monad.xyz/
export PRIVATE_KEY=$MONAD_TESTNET_PRIVATE_KEY
export RECIPIENT_1=0x77962b77c30762BAF6996eE8a517826d8eeD533b   # any addresses you choose
export RECIPIENT_2=0xE7E3E8B6237160fEFe1EE1408f76969BE8eA8895
# optional: export EXECUTOR=<other address>  (defaults to deployer)
```

## 5. Deploy (MockToken + PolicyPilot, policy config, funding)
```bash
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --slow
```
`script/Deploy.s.sol` deploys `MockToken`, deploys `PolicyPilot(asset, admin=deployer, executor, perRequestLimit=100e18, budget=250e18)`,
allowlists the two recipients and mints 1000 mUSD to the contract. Addresses/hashes land in `broadcast/Deploy.s.sol/10143/run-latest.json`.

## 6. Verify source (Sourcify, as documented at docs.monad.xyz)
```bash
forge verify-contract <TOKEN> src/MockToken.sol:MockToken --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org
forge verify-contract <POLICYPILOT> src/PolicyPilot.sol:PolicyPilot --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org \
  --constructor-args $(cast abi-encode "c(address,address,address,uint256,uint256)" <TOKEN> <ADMIN> <EXECUTOR> 100000000000000000000 250000000000000000000)
```

## 7. Run the live demo
```bash
ETH_PRIVATE_KEY=$MONAD_TESTNET_PRIVATE_KEY PP=<POLICYPILOT> R1=$RECIPIENT_1 R2=$RECIPIENT_2 ./script/demo-testnet.sh
```
Sends: 2 valid executes, a replay, recipient / per-request-limit / budget rejections, pause → rejected execute → unpause.
Each rejection is first simulated with `eth_call` (revert reason captured), then sent on-chain with a fixed gas limit so a
**reverted** transaction is recorded (gas is still charged). Output is one JSON line per step.

## 8. Open the frontend
https://blockchains.github.io/policypilot-monad/ (defaults to the testnet deployment), or locally
`cd frontend && python3 -m http.server` → http://localhost:8000/?rpc=<RPC>&addr=<POLICYPILOT>.
For a new deployment update `frontend/deployment.json` (copy of `deployments/monad-testnet.json`) so demo tx receipts/events are listed.
