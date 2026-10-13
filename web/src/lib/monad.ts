import { createPublicClient, defineChain, http, decodeErrorResult, encodeFunctionData, BaseError, type Address, type Hex, type PublicClient } from 'viem';
import { policyPilotAbi } from './abi';
export { policyPilotAbi };

export const monadTestnet = defineChain({
  id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } }, testnet: true,
});
export const monadMainnet = defineChain({
  id: 143, name: 'Monad Mainnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://monadvision.com' } },
});

/** The deployed PolicyPilot reference instance (testnet, Sourcify exact match). Never redeployed. */
export const DEPLOYMENT = {
  chain: monadTestnet,
  policyPilot: '0x583fDB6441a9bCE517CF5bb15b9dB7340BB57D4E' as Address,
  token: '0xE2966C817267FC7E63362895Cf55C6cb2548b9E3' as Address, // gitleaks:allow public testnet ERC-20 contract address, not a secret
  deployBlock: 70561954n,
  sourcify: 'https://repo.sourcify.dev/10143/0x583fDB6441a9bCE517CF5bb15b9dB7340BB57D4E',
} as const;

export const MAINNET = { factory: '0x0342d29055d77ba155c50233f550539E3029BA6a' as Address, legacyFactory: '0x8738B74778502ff3623A8319837A819d8dBdEeB7' as Address, showcaseVault: '0x379e0C3Ecba46d62dAdCf26dBecd0F26A2cdCA97' as Address };

export function client(rpc?: string): PublicClient {
  return createPublicClient({ chain: monadTestnet, transport: http(rpc ?? monadTestnet.rpcUrls.default.http[0]) }) as PublicClient;
}
export const explorerTx = (h: string) => `${monadTestnet.blockExplorers.default.url}/tx/${h}`;
export const explorerAddr = (a: string) => `${monadTestnet.blockExplorers.default.url}/address/${a}`;

export type PolicySnapshot = { budget: bigint; totalSpent: bigint; remaining: bigint; perRequestLimit: bigint; paused: boolean; executor: Address; admin: Address; vaultBalance: bigint; block: bigint };

const erc20BalanceAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

export async function readPolicy(pc: PublicClient, addr: Address = DEPLOYMENT.policyPilot): Promise<PolicySnapshot> {
  const c = { address: addr, abi: policyPilotAbi } as const;
  const [budget, totalSpent, remaining, perRequestLimit, paused, executor, admin, block] = await Promise.all([
    pc.readContract({ ...c, functionName: 'budget' }), pc.readContract({ ...c, functionName: 'totalSpent' }),
    pc.readContract({ ...c, functionName: 'remainingBudget' }), pc.readContract({ ...c, functionName: 'perRequestLimit' }),
    pc.readContract({ ...c, functionName: 'paused' }), pc.readContract({ ...c, functionName: 'executor' }),
    pc.readContract({ ...c, functionName: 'admin' }), pc.getBlockNumber()]);
  const asset = await pc.readContract({ ...c, functionName: 'asset' });
  const vaultBalance = await pc.readContract({ address: asset, abi: erc20BalanceAbi, functionName: 'balanceOf', args: [addr] });
  return { budget, totalSpent, remaining, perRequestLimit, paused, executor, admin, vaultBalance, block };
}

export type CheckResult = { ok: true; via: 'eth_call' } | { ok: false; error: string; args?: readonly unknown[]; via: 'precheck' | 'eth_call' };

/** Client-side precheck mirroring PolicyPilot.execute's ordering of checks. */
export function precheck(s: Pick<PolicySnapshot, 'paused' | 'perRequestLimit' | 'remaining'>, allowed: boolean, recipient: Address, amount: bigint): CheckResult | null {
  if (s.paused) return { ok: false, error: 'Paused', via: 'precheck' };
  if (amount === 0n) return { ok: false, error: 'ZeroAmount', via: 'precheck' };
  if (!allowed) return { ok: false, error: 'RecipientNotAllowed', args: [recipient], via: 'precheck' };
  if (amount > s.perRequestLimit) return { ok: false, error: 'PerRequestLimitExceeded', args: [amount, s.perRequestLimit], via: 'precheck' };
  if (amount > s.remaining) return { ok: false, error: 'BudgetExceeded', args: [amount, s.remaining], via: 'precheck' };
  return null;
}

export function decodeRevert(e: unknown): { error: string; args?: readonly unknown[] } {
  let data: Hex | undefined;
  if (e instanceof BaseError) { const w = e.walk((x: any) => typeof x?.data === 'string' && x.data.startsWith('0x')) as any; data = w?.data; }
  if (data && data.length >= 10) { try { const d = decodeErrorResult({ abi: policyPilotAbi, data }); return { error: d.errorName, args: d.args }; } catch { /* unknown selector */ } }
  return { error: e instanceof BaseError ? e.shortMessage : String(e) };
}

/** Real eth_call of execute() from the on-chain executor: returns PASS or the exact custom error name. */
export async function simulateExecute(pc: PublicClient, from: Address, recipient: Address, amount: bigint, requestId: Hex, addr: Address = DEPLOYMENT.policyPilot): Promise<CheckResult> {
  const data = encodeFunctionData({ abi: policyPilotAbi, functionName: 'execute', args: [requestId, recipient, amount] });
  try { await pc.call({ account: from, to: addr, data }); return { ok: true, via: 'eth_call' }; }
  catch (e) { return { ok: false, via: 'eth_call', ...decodeRevert(e) }; }
}
