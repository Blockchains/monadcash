import { BaseError, decodeErrorResult, encodeFunctionData, keccak256, toHex, type Account, type Address, type Chain, type Hash, type Hex, type PublicClient, type Transport, type WalletClient } from 'viem';
import { agentVaultAbi, agentVaultFactoryAbi } from './vault-abi.js';
export { agentVaultAbi, agentVaultFactoryAbi };

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export type CallOpts = { approveToken: Address; approveAmount: bigint; outToken: Address; minOut: bigint };
export const NO_OPTS: CallOpts = { approveToken: ZERO_ADDRESS, approveAmount: 0n, outToken: ZERO_ADDRESS, minOut: 0n };
/** An agent action against an AgentVault: either a payment (execute) or an allowlisted dapp call (executeCall). */
export type VaultAction =
  | { kind: 'pay'; recipient: Address; amount: bigint; requestId?: Hex }
  | { kind: 'call'; target: Address; value: bigint; data: Hex; opts?: Partial<CallOpts>; requestId?: Hex }
  | { kind: 'raw'; data: Hex }; // any vault function (used to demonstrate owner-only calls being rejected)
export type VaultResult =
  | { status: 'allowed'; hash: Hash; blockNumber: bigint; gasUsed: bigint; feeWei: bigint }
  | { status: 'blocked'; reason: string; args?: readonly unknown[]; hash?: Hash; blockNumber?: bigint; gasUsed?: bigint; feeWei?: bigint; onchain: boolean };

export function decodeVaultRevert(e: unknown): { error: string; args?: readonly unknown[] } {
  const msg = String((e as any)?.message ?? e);
  let w: any = null; for (let x: any = e, i = 0; x && i < 10; x = x.cause, i++) { const d = x?.data?.data ?? x?.data; if (typeof d === 'string' && d.startsWith('0x')) { w = { data: d }; break; } }
  const raw: string | undefined = w?.data && w.data.length >= 10 ? w.data : (() => { const c = /custom error (0x[0-9a-fA-F]{8}):?\s*([0-9a-fA-F]*)/.exec(msg); return c ? c[1] + c[2] : undefined; })();
  if (raw) { try { const d = decodeErrorResult({ abi: agentVaultAbi, data: raw as Hex }); return { error: d.errorName, args: d.args }; } catch { /* unknown */ } }
  const n = /reverted with the following reason:\s*\n?([A-Za-z]+)/.exec(msg) ?? /Error: ([A-Za-z]+)\(/.exec(msg);
  return { error: n ? n[1] : ((e as any)?.shortMessage ?? msg.split('\n')[0]) };
}
const rid = (s: string): Hex => keccak256(toHex(`${s}:${Date.now()}:${Math.random()}`));

export function encodeVaultAction(a: VaultAction): Hex {
  if (a.kind === 'raw') return a.data;
  if (a.kind === 'pay') return encodeFunctionData({ abi: agentVaultAbi, functionName: 'execute', args: [a.requestId ?? rid('pay'), a.recipient, a.amount] } as any);
  return encodeFunctionData({ abi: agentVaultAbi, functionName: 'executeCall', args: [a.requestId ?? rid('call'), a.target, a.value, a.data, { ...NO_OPTS, ...a.opts }] } as any);
}

/** Agent-side client for an AgentVault. The vault (on-chain) is the policy; this just simulates and sends. */
export class VaultAgent {
  constructor(readonly vault: Address, private pc: PublicClient, private wc: WalletClient<Transport, Chain, Account>) {}
  get agent(): Address { return this.wc.account.address; }
  async simulate(a: VaultAction): Promise<{ ok: true; gas: bigint } | { ok: false; error: string; args?: readonly unknown[] }> {
    try { const gas = await this.pc.estimateGas({ account: this.agent, to: this.vault, data: encodeVaultAction(a) }); return { ok: true, gas }; }
    catch (e) {
      const d = decodeVaultRevert(e);
      if (agentVaultAbi.some((x: any) => x.type === 'error' && x.name === d.error)) return { ok: false, ...d };
      // some RPCs drop revert data on eth_estimateGas; eth_call usually keeps it
      try { await this.pc.request({ method: 'eth_call', params: [{ from: this.agent, to: this.vault, data: encodeVaultAction(a) }, 'latest'] } as any); } catch (e2) { const d2 = decodeVaultRevert(e2); if (agentVaultAbi.some((x: any) => x.type === 'error' && x.name === d2.error)) return { ok: false, ...d2 }; }
      return { ok: false, ...d };
    }
  }
  /**
   * Simulate, then send. If the vault rejects the action, by default nothing is sent (no gas).
   * With `broadcastBlocked`, the rejected tx is still broadcast with a small fixed gas limit so the
   * block is recorded on-chain (used by the showcase "rogue agent" to prove enforcement publicly).
   */
  async run(a: VaultAction, o: { broadcastBlocked?: boolean; blockedGas?: bigint; gasBuffer?: number } = {}): Promise<VaultResult> {
    const sim = await this.simulate(a);
    if (!sim.ok && !o.broadcastBlocked) return { status: 'blocked', reason: sim.error, args: sim.args, onchain: false };
    const gas = sim.ok ? (sim.gas * BigInt(Math.round((o.gasBuffer ?? 1.2) * 100))) / 100n : (o.blockedGas ?? 100_000n);
    const hash = await this.wc.sendTransaction({ to: this.vault, data: encodeVaultAction(a), gas, chain: this.wc.chain, account: this.wc.account });
    const r = await this.pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
    const fee = r.gasUsed * r.effectiveGasPrice;
    if (r.status === 'success') return { status: 'allowed', hash, blockNumber: r.blockNumber, gasUsed: r.gasUsed, feeWei: fee };
    return { status: 'blocked', reason: sim.ok ? 'Reverted' : sim.error, args: sim.ok ? undefined : sim.args, hash, blockNumber: r.blockNumber, gasUsed: r.gasUsed, feeWei: fee, onchain: true };
  }
}

/** Monad mainnet AgentVaultFactory (v3, 1000 MON per-vault cap, 100000 MON global cap). New vaults use this. The app stops a new vault at that 1000 MON cap. */
export const MAINNET_FACTORY = '0x52727226aF0efe2bfe3E5c97e46B704613344a92' as Address;
/** Earlier factories. v2 is 1 MON per vault and 1000 MON global. v1 is 1 MON per vault and 10 MON global. */
export const MAINNET_LEGACY_FACTORIES = ['0x0342d29055d77ba155c50233f550539E3029BA6a', '0x8738B74778502ff3623A8319837A819d8dBdEeB7'] as Address[];
