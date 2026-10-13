# Demo script (~2 min, local)
1. `forge test -vv` – show 17/17 passing incl. invariants (128k calls).
2. `anvil` in second terminal; `node executor/e2e-anvil.mjs`.
3. Narrate 6 steps: inv-001 EXECUTED; inv-001 again SKIPPED (replay); inv-002 RecipientNotAllowed; inv-003 PerRequestLimitExceeded; inv-004 EXECUTED; inv-005 BudgetExceeded (160 spent of 250, 100 requested).
4. Open frontend/index.html, paste address from evidence JSON, show totalSpent=160e18.
(Recording a video is a user action; none exists yet.)
