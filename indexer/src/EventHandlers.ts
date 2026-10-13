import { indexer } from "envio";

type Ctx = any;
type Ev = any;

async function state(context: Ctx, event: Ev) {
  const id = event.srcAddress.toLowerCase();
  return (
    (await context.PolicyState.get(id)) ?? {
      id, budget: undefined, perRequestLimit: undefined, paused: undefined,
      totalSpent: 0n, executions: 0, lastBlock: event.block.number,
    }
  );
}

function log(context: Ctx, event: Ev, kind: string, detail: string) {
  context.PolicyEvent.set({
    id: `${event.block.number}-${event.logIndex}`,
    kind, detail,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
}

indexer.onEvent({ contract: "PolicyPilot", event: "Executed" }, async ({ event, context }) => {
  const p = event.params;
  context.Execution.set({
    id: p.requestId, requestId: p.requestId, recipient: p.recipient.toLowerCase(),
    amount: p.amount, totalSpent: p.totalSpent,
    blockNumber: event.block.number, timestamp: event.block.timestamp, txHash: event.transaction.hash,
  });
  const s = await state(context, event);
  context.PolicyState.set({ ...s, totalSpent: p.totalSpent, executions: s.executions + 1, lastBlock: event.block.number });
  log(context, event, "Executed", `${p.recipient} ${p.amount}`);
});

indexer.onEvent({ contract: "PolicyPilot", event: "RecipientSet" }, async ({ event, context }) => {
  const r = event.params.recipient.toLowerCase();
  context.Recipient.set({ id: r, allowed: event.params.allowed, updatedBlock: event.block.number });
  log(context, event, "RecipientSet", `${r} ${event.params.allowed}`);
});

indexer.onEvent({ contract: "PolicyPilot", event: "BudgetSet" }, async ({ event, context }) => {
  const s = await state(context, event);
  context.PolicyState.set({ ...s, budget: event.params.budget, lastBlock: event.block.number });
  log(context, event, "BudgetSet", `${event.params.budget}`);
});

indexer.onEvent({ contract: "PolicyPilot", event: "PerRequestLimitSet" }, async ({ event, context }) => {
  const s = await state(context, event);
  context.PolicyState.set({ ...s, perRequestLimit: event.params.limit, lastBlock: event.block.number });
  log(context, event, "PerRequestLimitSet", `${event.params.limit}`);
});

indexer.onEvent({ contract: "PolicyPilot", event: "PausedSet" }, async ({ event, context }) => {
  const s = await state(context, event);
  context.PolicyState.set({ ...s, paused: event.params.paused, lastBlock: event.block.number });
  log(context, event, "PausedSet", `${event.params.paused}`);
});
