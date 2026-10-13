import { PolicyPilot } from "generated";
const ID = "policy";
const base = { id: ID, budget: undefined, perRequestLimit: undefined, paused: undefined, totalSpent: 0n, executions: 0 };
PolicyPilot.Executed.handler(async ({ event, context }) => {
  context.Execution.set({ id: event.params.requestId, requestId: event.params.requestId, recipient: event.params.recipient,
    amount: event.params.amount, totalSpent: event.params.totalSpent, blockNumber: event.block.number, txHash: event.transaction.hash });
  const s = (await context.PolicyState.get(ID)) ?? base;
  context.PolicyState.set({ ...s, totalSpent: event.params.totalSpent, executions: s.executions + 1 });
});
PolicyPilot.RecipientSet.handler(async ({ event, context }) => {
  context.Recipient.set({ id: event.params.recipient, allowed: event.params.allowed });
});
const upd = (f: object) => async ({ context }: any) => { const s = (await context.PolicyState.get(ID)) ?? base; context.PolicyState.set({ ...s, ...f }); };
PolicyPilot.BudgetSet.handler(async (a) => upd({ budget: a.event.params.budget })(a));
PolicyPilot.PerRequestLimitSet.handler(async (a) => upd({ perRequestLimit: a.event.params.limit })(a));
PolicyPilot.PausedSet.handler(async (a) => upd({ paused: a.event.params.paused })(a));
