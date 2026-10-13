# Threat model
| Threat | Mitigation | Residual |
|---|---|---|
| Compromised executor key | Bounded by allowlist, per-request limit, cumulative budget; admin can pause / rotate executor | Executor can drain up to remaining budget to allowlisted recipients |
| Replay / double payment | requestId mapping set before transfer; deterministic id derivation in executor | Different keys for same invoice = two payments (off-chain dedupe needed) |
| Reentrancy via token | CEI ordering; state set before external call | Non-standard tokens (fee-on-transfer) cause accounting drift – unsupported |
| Compromised admin | Out of scope; recommend multisig (Safe) as admin | Single-step admin transfer – typo risk |
| Upgrade risk | Non-upgradeable | Bugs require redeploy |
