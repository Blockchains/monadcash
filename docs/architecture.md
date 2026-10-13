# Architecture
Off-chain request (invoice key, recipient, amount) -> executor derives requestId = keccak256(chainId, contract, key, recipient, amount)
-> reads `executed(id)` (skip if consumed) -> `simulateContract` (policy pre-check) -> `execute(id, recipient, amount)`.
On-chain checks in order: executor role, paused, replay, zero amount, allowlist, per-request limit, cumulative budget; then effects (mark executed, totalSpent) and event; then SafeERC20 transfer (CEI).
Admin: setRecipient, setExecutor, transferAdmin (single-step), setPerRequestLimit, setBudget, setPaused. Contract holds the asset; no withdraw function (see limitations).
