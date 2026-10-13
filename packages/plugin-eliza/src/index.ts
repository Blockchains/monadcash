import type { Action, IAgentRuntime, Memory, Plugin, Provider, ProviderResult, State, HandlerCallback, ActionResult } from '@elizaos/core';
import { createPublicClient, createWalletClient, defineChain, formatUnits, getAddress, http, isAddress, parseUnits, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PolicyClient } from '@policypilot/agent-kit';

/** Reference deployment on Monad testnet (Sourcify-verified). Override with POLICYPILOT_ADDRESS. */
export const DEFAULT_POLICYPILOT = '0x583fDB6441a9bCE517CF5bb15b9dB7340BB57D4E' as Address;
const DEFAULT_RPC = 'https://testnet-rpc.monad.xyz';

function setting(rt: IAgentRuntime, k: string): string | undefined { const v = rt.getSetting(k); return v == null || v === '' ? undefined : String(v); }

export function makeClient(rt: IAgentRuntime, withSigner: boolean): PolicyClient {
  const rpc = setting(rt, 'POLICYPILOT_RPC') ?? DEFAULT_RPC;
  const chainId = Number(setting(rt, 'POLICYPILOT_CHAIN_ID') ?? 10143);
  const chain = defineChain({ id: chainId, name: chainId === 10143 ? 'Monad Testnet' : `chain ${chainId}`, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const address = getAddress(setting(rt, 'POLICYPILOT_ADDRESS') ?? DEFAULT_POLICYPILOT);
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  if (!withSigner) return new PolicyClient({ address, publicClient: publicClient as any });
  const key = setting(rt, 'POLICYPILOT_EXECUTOR_KEY'); // secret: read from runtime settings, never logged or echoed
  if (!key) throw new Error('POLICYPILOT_EXECUTOR_KEY is not set');
  const walletClient = createWalletClient({ account: privateKeyToAccount(key as Hex), chain, transport: http(rpc) });
  return new PolicyClient({ address, publicClient: publicClient as any, walletClient });
}

/** Pulls "pay 12.5 to 0xabc…" style intents out of free text. */
export function parsePaymentIntent(text: string): { recipient: Address; amount: string } | null {
  const addr = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
  const amt = text.replace(/0x[a-fA-F0-9]{40}/g, ' ').match(/(\d+(?:\.\d+)?)/)?.[1];
  if (!addr || !amt || !isAddress(addr)) return null;
  return { recipient: getAddress(addr), amount: amt };
}

export const executePolicyPayment: Action = {
  name: 'EXECUTE_POLICY_PAYMENT',
  similes: ['POLICY_PAYMENT', 'SAFE_PAYMENT', 'PAY_WITH_POLICY'],
  description: 'Pay an allowlisted recipient through the PolicyPilot contract on Monad. The on-chain policy (allowlist, per-request cap, budget, pause, replay protection) is checked first and the payment is refused with the exact contract error if it would fail.',
  validate: async (rt: IAgentRuntime, message: Memory) => !!setting(rt, 'POLICYPILOT_EXECUTOR_KEY') && !!parsePaymentIntent(message.content?.text ?? ''),
  handler: async (rt: IAgentRuntime, message: Memory, _state?: State, options?: Record<string, unknown>, callback?: HandlerCallback): Promise<ActionResult> => {
    const intent = (options?.recipient && options?.amount) ? { recipient: getAddress(String(options.recipient)), amount: String(options.amount) } : parsePaymentIntent(message.content?.text ?? '');
    if (!intent) { const text = 'I need a recipient address and an amount, e.g. "pay 10 to 0x…".'; await callback?.({ text }); return { success: false, text, error: 'NoIntent' }; }
    const kit = makeClient(rt, true);
    const idempotencyKey = String(options?.idempotencyKey ?? message.id ?? `${intent.recipient}-${intent.amount}`);
    const r = await kit.executeSafePayment(intent.recipient, parseUnits(intent.amount, 18), { idempotencyKey });
    if (r.status === 'rejected') {
      const text = `Payment refused by policy: ${r.check.error}. Nothing was sent.`;
      await callback?.({ text, actions: ['EXECUTE_POLICY_PAYMENT'] });
      return { success: false, text, error: r.check.error, data: { requestId: r.requestId, stage: r.check.stage } };
    }
    const text = `Paid ${intent.amount} to ${intent.recipient}. tx ${r.hash}`;
    await callback?.({ text, actions: ['EXECUTE_POLICY_PAYMENT'] });
    return { success: true, text, data: { hash: r.hash, requestId: r.requestId, blockNumber: r.blockNumber.toString() } };
  },
  examples: [[
    { name: '{{user1}}', content: { text: 'Pay 10 to 0x77962b77c30762BAF6996eE8a517826d8eeD533b for the invoice' } },
    { name: '{{agent}}', content: { text: 'Checking the on-chain policy, then paying.', actions: ['EXECUTE_POLICY_PAYMENT'] } },
  ]],
};

export const policyStateProvider: Provider = {
  name: 'POLICYPILOT_STATE',
  description: 'Live PolicyPilot limits: remaining budget, per-request cap and whether payouts are paused.',
  dynamic: true,
  get: async (rt: IAgentRuntime): Promise<ProviderResult> => {
    try {
      const s = await makeClient(rt, false).state();
      const f = (v: bigint) => formatUnits(v, 18);
      return { text: `PolicyPilot: ${s.paused ? 'PAUSED (no payouts possible)' : 'active'}; remaining budget ${f(s.remaining)} of ${f(s.budget)}; max per payment ${f(s.perRequestLimit)}.`,
        values: { policyPaused: s.paused, policyRemaining: f(s.remaining), policyPerRequestLimit: f(s.perRequestLimit) } };
    } catch (e) { return { text: `PolicyPilot state unavailable: ${e instanceof Error ? e.message : String(e)}` }; }
  },
};

export const policyPilotPlugin: Plugin = {
  name: 'policypilot',
  description: 'Policy-bounded payments for agents on Monad (PolicyPilot).',
  actions: [executePolicyPayment],
  providers: [policyStateProvider],
};
export default policyPilotPlugin;
