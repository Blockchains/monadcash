import { BaseError, decodeErrorResult, encodeFunctionData, keccak256, toHex, type Account, type Address, type Chain, type Hash, type Hex, type PublicClient, type Transport, type WalletClient } from 'viem';
import { policyPilotAbi } from './abi.js';
export { policyPilotAbi };

/** Custom errors of the deployed PolicyPilot contract (names match the ABI exactly). */
export type PolicyError = 'Paused' | 'ZeroAmount' | 'ZeroAddress' | 'NotExecutor' | 'RecipientNotAllowed' | 'PerRequestLimitExceeded' | 'BudgetExceeded' | 'RequestAlreadyExecuted' | 'NotAdmin';
export type PolicyCheck =
  | { ok: true; remaining: bigint; perRequestLimit: bigint }
  | { ok: false; error: PolicyError | string; args?: readonly unknown[]; stage: 'precheck' | 'simulation' };
export type PaymentResult = { status: 'executed'; hash: Hash; requestId: Hex; blockNumber: bigint } | { status: 'rejected'; check: Extract<PolicyCheck, { ok: false }>; requestId: Hex };

export type PolicyClientOptions = {
  address: Address;
  publicClient: PublicClient;
  /** Needed only for executeSafePayment. Its account must be the contract's executor. */
  walletClient?: WalletClient<Transport, Chain, Account>;
};

export function decodePolicyRevert(e: unknown): { error: string; args?: readonly unknown[] } {
  if (e instanceof BaseError) {
    const w = e.walk((x: any) => typeof x?.data === 'string' && x.data.startsWith('0x')) as any;
    if (w?.data && w.data.length >= 10) { try { const d = decodeErrorResult({ abi: policyPilotAbi, data: w.data as Hex }); return { error: d.errorName, args: d.args }; } catch { /* unknown */ } }
    const named = /reverted with the following reason:\s*\n?([A-Za-z]+)/.exec(e.message) ?? /Error: ([A-Za-z]+)\(/.exec(e.message);
    if (named) return { error: named[1] };
    return { error: e.shortMessage };
  }
  return { error: String(e) };
}

export const requestIdFor = (key: string): Hex => keccak256(toHex(key));

export class PolicyClient {
  readonly address: Address; private pc: PublicClient; private wc?: WalletClient<Transport, Chain, Account>;
  constructor(o: PolicyClientOptions) { this.address = o.address; this.pc = o.publicClient; this.wc = o.walletClient; }
  private read<T>(functionName: any, args?: readonly unknown[]): Promise<T> { return this.pc.readContract({ address: this.address, abi: policyPilotAbi, functionName, args } as any) as Promise<T>; }

  async state() {
    const [budget, totalSpent, remaining, perRequestLimit, paused, executor] = await Promise.all([
      this.read<bigint>('budget'), this.read<bigint>('totalSpent'), this.read<bigint>('remainingBudget'), this.read<bigint>('perRequestLimit'), this.read<boolean>('paused'), this.read<Address>('executor')]);
    return { budget, totalSpent, remaining, perRequestLimit, paused, executor };
  }

  /** Client-side precheck in contract order, then a real eth_call of execute() from the executor. Never sends a tx. */
  async checkPolicy(recipient: Address, amount: bigint, requestId: Hex = requestIdFor(`check-${recipient}-${amount}-${Date.now()}`)): Promise<PolicyCheck> {
    const s = await this.state();
    const [allowed, done] = await Promise.all([this.read<boolean>('allowedRecipient', [recipient]), this.read<boolean>('executed', [requestId])]);
    const fail = (error: PolicyError, args?: readonly unknown[]): PolicyCheck => ({ ok: false, error, args, stage: 'precheck' });
    if (s.paused) return fail('Paused');
    if (done) return fail('RequestAlreadyExecuted', [requestId]);
    if (amount === 0n) return fail('ZeroAmount');
    if (!allowed) return fail('RecipientNotAllowed', [recipient]);
    if (amount > s.perRequestLimit) return fail('PerRequestLimitExceeded', [amount, s.perRequestLimit]);
    if (amount > s.remaining) return fail('BudgetExceeded', [amount, s.remaining]);
    const from = this.wc?.account.address ?? s.executor;
    try {
      await this.pc.call({ account: from, to: this.address, data: encodeFunctionData({ abi: policyPilotAbi, functionName: 'execute', args: [requestId, recipient, amount] }) });
    } catch (e) { return { ok: false, stage: 'simulation', ...decodePolicyRevert(e) }; }
    return { ok: true, remaining: s.remaining, perRequestLimit: s.perRequestLimit };
  }

  /** Checks policy first; only sends execute() when the check passes. requestId gives idempotency (replays are rejected). */
  async executeSafePayment(recipient: Address, amount: bigint, opts: { requestId?: Hex; idempotencyKey?: string } = {}): Promise<PaymentResult> {
    if (!this.wc) throw new Error('executeSafePayment needs a walletClient whose account is the executor');
    const requestId = opts.requestId ?? requestIdFor(opts.idempotencyKey ?? `pay-${recipient}-${amount}-${Date.now()}-${Math.random()}`);
    const check = await this.checkPolicy(recipient, amount, requestId);
    if (!check.ok) return { status: 'rejected', check, requestId };
    const hash = await this.wc.writeContract({ address: this.address, abi: policyPilotAbi, functionName: 'execute', args: [requestId, recipient, amount], chain: this.wc.chain, account: this.wc.account });
    const r = await this.pc.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') return { status: 'rejected', check: { ok: false, error: 'TxReverted', stage: 'simulation' }, requestId };
    return { status: 'executed', hash, requestId, blockNumber: r.blockNumber };
  }
}
export * from './vault.js';
