# PolicyPilot Envio HyperIndex indexer

Indexes every policy event emitted by the live PolicyPilot contract on **Monad testnet** (chain 10143,
`0x583fDB6441a9bCE517CF5bb15b9dB7340BB57D4E`, from block 70561954) into Postgres and serves it over GraphQL (Hasura).
The read-only frontend uses it as an optional data source (`?indexer=<graphql url>`), falling back to direct RPC.

**Honest status:** runs locally only. Not hosted on Envio Cloud, so the public GitHub Pages site uses RPC mode
unless you point it at your own indexer. Uses the public Monad RPC as the data source (`for: sync`), so it needs no
HyperSync API token and no Envio account. Testnet, unaudited, no real users or funds.

## What it indexes (schema.graphql)
| Entity | From events | Used by frontend for |
|---|---|---|
| `PolicyState` (id = contract) | BudgetSet, PerRequestLimitSet, PausedSet, Executed | budget, cap, paused, totalSpent, remaining, execution count |
| `Execution` (id = requestId) | Executed | execution history table |
| `Recipient` | RecipientSet | allowlist |
| `PolicyEvent` | all of the above | append-only audit log |

Rejected requests revert on-chain and emit no event, so they cannot be indexed; the frontend shows them from
receipts in `deployment.json`.

## Run (judges)
Requires Node >= 22.15 and Docker.

```bash
cd indexer
npm install
npx envio dev            # starts Postgres + Hasura in Docker, runs codegen, indexes
# GraphQL: http://localhost:8080/v1/graphql (Hasura console password: testing)
```

Then serve the frontend and open it in indexer mode:
```bash
cd ../frontend && python3 -m http.server 8000
# http://localhost:8000/?indexer=http://localhost:8080/v1/graphql
```

Example query:
```graphql
{ PolicyState { budget perRequestLimit paused totalSpent executions }
  Execution(order_by:{blockNumber:asc}) { requestId recipient amount totalSpent txHash }
  PolicyEvent(order_by:[{blockNumber:asc},{logIndex:asc}]) { blockNumber kind detail } }
```
Expected (current testnet state): 8 PolicyEvents (PerRequestLimitSet, BudgetSet, 2x RecipientSet, 2x Executed,
2x PausedSet), totalSpent 200e18, budget 250e18, paused false.

### If Docker container-to-container networking is broken on your machine
On our build box, Hasura could not reach Postgres over the Docker bridge network, so we used:
```bash
npx envio dev   # once, creates envio-postgres on host port 5433, then Ctrl-C
docker rm -f envio-hasura
docker run -d --name envio-hasura --network host \
  -e HASURA_GRAPHQL_DATABASE_URL=postgres://postgres:testing@127.0.0.1:5433/envio-dev \
  -e HASURA_GRAPHQL_ADMIN_SECRET=testing -e HASURA_GRAPHQL_UNAUTHORIZED_ROLE=public \
  -e HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES=true -e HASURA_GRAPHQL_ENABLE_CONSOLE=true hasura/graphql-engine:v2.43.0
set -a; . ./local-start.env; set +a; npx envio start
```
(`local-start.env` only has local dev defaults, no secrets.)

Evidence of a verified run: see `../docs/envio-indexer-check.txt`.
