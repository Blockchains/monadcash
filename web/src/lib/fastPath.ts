'use client';
import { createPublicClient, http, keccak256, parseGwei, toFunctionSelector, webSocket, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SERVICES, TOKENS } from './services';
import { chainOf, type Net, type VaultState } from './vault';

/**
 * Transaction gas limits. Monad charges the gas limit, not gas used
 * (https://docs.monad.xyz/developer-essentials/gas-pricing).
 *
 * Call-gas ceilings are locked by test/GasProfile.t.sol (gasleft around the call).
 * Forge traces of the inner frame, which exclude the test contract's overhead:
 *   execute 107164, deposit 39663, withdraw 47792, setPaused 45051,
 *   prime deposit 125606, prime withdraw 62303.
 * A transaction limit adds ~21000 intrinsic and calldata, plus a small cushion.
 * If GasProfileTest fails, raise these in the same change.
 */
export const GAS = {
  pay: 140_000n,
  vaultDeposit: 75_000n,
  vaultWithdraw: 85_000n,
  pause: 80_000n,
  primeDeposit: 160_000n,
  primeWithdraw: 100_000n,
} as const;

const DEPOSIT = toFunctionSelector('function deposit()');
const WITHDRAW = toFunctionSelector('function withdraw(address,uint256)');
const PAUSE = toFunctionSelector('function setPaused(bool)');

/** Fixed limit for owner calls whose cost was measured. Anything else returns undefined. */
export function fixedOwnerGas(data?: Hex): bigint | undefined {
  if (!data || data.length < 10) return undefined;
  const sel = data.slice(0, 10).toLowerCase();
  if (sel === DEPOSIT) return GAS.vaultDeposit;
  if (sel === WITHDRAW) return GAS.vaultWithdraw;
  if (sel === PAUSE) return GAS.pause;
  return undefined;
}

/** 2% or 3000 gas, whichever is larger. Replaces the old 30% buffer, which Monad bills in full. */
export function cushion(estimate: bigint): bigint {
  const extra = estimate / 50n > 3000n ? estimate / 50n : 3000n;
  return estimate + extra;
}

export async function pricedGas(pub: Pick<PublicClient, 'estimateGas'>, account: Address, req: { to?: Address; data?: Hex; value?: bigint }): Promise<bigint> {
  const est = await pub.estimateGas({ account, to: req.to, data: req.data, value: req.value ?? 0n });
  return cushion(est);
}

type PolicyView = Pick<VaultState, 'executor' | 'owner' | 'paused' | 'cap' | 'budget' | 'spent' | 'bal' | 'rules'>;
export type LocalVerdict = { ok: true } | { ok: false; name: string; args?: readonly unknown[] };

function attachedOf(kind: string, amount: bigint, cap: bigint): bigint {
  if (kind === 'unwrap' || kind === 'x-drain' || kind === 'x-withdraw' || kind === 'usdctowmon') return 0n;
  if (kind === 'x-cap') return cap * 2n;
  if (kind === 'x-stranger') return 1n;
  if (kind === 'x-self') return 1000n;
  return amount;
}

/**
 * Certain rejects only, from the vault snapshot already in memory.
 * Unsure cases return ok so the chain (one estimateGas, or eth_call when nothing will be sent) decides.
 */
export function evaluateVault(s: PolicyView, signer: Address, kind: string, amount: bigint, to?: Address): LocalVerdict {
  const attached = attachedOf(kind, amount, s.cap);
  if (signer.toLowerCase() !== s.executor.toLowerCase()) return { ok: false, name: 'NotExecutor' };
  if (kind === 'x-withdraw') {
    if (s.executor.toLowerCase() !== s.owner.toLowerCase()) return { ok: false, name: 'NotOwner' };
    return { ok: true };
  }
  if (s.paused) return { ok: false, name: 'Paused' };
  if (kind === 'x-stranger') return { ok: false, name: 'RecipientNotAllowed', args: ['0x000000000000000000000000000000000000dEaD'] };
  if (kind === 'x-drain') return { ok: false, name: 'CallNotAllowed', args: [TOKENS.USDC.address, '0xa9059cbb'] };
  if (kind === 'x-self') {
    const uni = SERVICES.find(x => x.id === 'uniswap')?.address ?? '0x0000000000000000000000000000000000000000';
    return { ok: false, name: 'CallNotAllowed', args: [uni, '0x04e45aaf'] };
  }
  if ((kind === 'pay' || kind === 'payto' || kind === 'x-cap') && attached === 0n) return { ok: false, name: 'ZeroAmount' };
  if (attached > s.cap) return { ok: false, name: 'PerPaymentCapExceeded', args: [attached, s.cap] };
  const remaining = s.budget > s.spent ? s.budget - s.spent : 0n;
  if (attached > remaining) return { ok: false, name: 'BudgetExceeded', args: [attached, remaining] };
  if (attached > s.bal) return { ok: false, name: 'InsufficientBalance', args: [attached, s.bal] };
  // `rules` includes 'pay' only when the owner is an allowlisted recipient. A pay-to-address
  // target is not in that snapshot, so it is left for one eth_call instead of a false reject.
  if (kind === 'pay' && !s.rules.includes('pay')) return { ok: false, name: 'RecipientNotAllowed', args: [s.owner] };
  if (kind === 'payto' && to && to.toLowerCase() === s.owner.toLowerCase() && !s.rules.includes('pay')) return { ok: false, name: 'RecipientNotAllowed', args: [to] };
  return { ok: true };
}

/** Public WebSocket endpoints. Empty when `?rpc=` replaced the public list, so fork tests stay on that RPC. */
export function socketUrls(net: Net): string[] {
  if (!net.rpcs?.length) return [];
  if (net.id === 143) return ['wss://rpc.monad.xyz', 'wss://rpc3.monad.xyz'];
  if (net.id === 10143) return ['wss://testnet-rpc.monad.xyz', 'wss://rpc-testnet.monadinfra.com'];
  return [];
}

let lastBaseFee = parseGwei('100');
function noteBaseFee(fee: bigint) { if (fee > 0n) lastBaseFee = fee; }

/** What the user can be charged up to. They pay base + priority, and the cost lever on Monad is the gas limit. */
export function feeCaps() {
  return { maxFeePerGas: lastBaseFee * 2n + parseGwei('2'), maxPriorityFeePerGas: parseGwei('2') };
}

const clients = new Map<string, PublicClient>();
function wsOf(net: Net, url: string): PublicClient {
  const key = `w:${net.id}:${url}`;
  let c = clients.get(key);
  if (!c) {
    c = createPublicClient({ chain: chainOf(net), transport: webSocket(url, { keepAlive: true, reconnect: true, timeout: 12_000 }) });
    clients.set(key, c);
  }
  return c;
}
function httpOf(net: Net, url: string): PublicClient {
  const key = `h:${net.id}:${url}`;
  let c = clients.get(key);
  if (!c) {
    c = createPublicClient({ chain: chainOf(net), transport: http(url, { batch: false, retryCount: 0, timeout: 12_000 }) });
    clients.set(key, c);
  }
  return c;
}

/** Two warm sockets. The HTTP poll in the page stays until the first head arrives. */
export function watchHeads(net: Net, onHead: (block: bigint) => void): () => void {
  const urls = socketUrls(net).slice(0, 2);
  if (!urls.length) return () => {};
  let seen = -1n;
  const stops: (() => void)[] = [];
  for (const url of urls) {
    const stop = wsOf(net, url).watchBlocks({
      onBlock(block) {
        const n = block.number;
        if (n == null || n <= seen) return;
        seen = n;
        if (block.baseFeePerGas) noteBaseFee(block.baseFeePerGas);
        onHead(n);
      },
      onError() { /* the HTTP poll covers a dead socket */ },
    });
    stops.push(stop);
  }
  return () => { for (const s of stops) { try { s(); } catch { /* already closed */ } } };
}

function blob(e: unknown): string {
  const x = e as { shortMessage?: string; details?: string; message?: string };
  return `${x?.shortMessage ?? ''} ${x?.details ?? ''} ${x?.message ?? ''}`.toLowerCase();
}
export function isUserReject(e: unknown): boolean {
  const code = (e as { code?: number })?.code;
  return code === 4001 || /reject|denied|cancel/i.test(blob(e));
}
/** Second attempt keeps the gas limit and drops fee caps. Reverts and cancellations are not retried. */
export function shouldRetryWithoutFees(e: unknown): boolean {
  if (isUserReject(e)) return false;
  return !/revert|insufficient funds|exceeds the balance|nonce too low|replacement transaction/.test(blob(e));
}

function isKnown(e: unknown): boolean {
  const m = blob(e);
  return m.includes('already known') || m.includes('nonce too low') || m.includes('already imported') || m.includes('known transaction');
}

async function broadcastRaw(net: Net, serialized: Hex): Promise<Hex> {
  const httpUrls = (net.rpcs?.length ? net.rpcs : [net.rpc]).slice(0, 2);
  const targets = [...socketUrls(net).slice(0, 2).map(u => wsOf(net, u)), ...httpUrls.map(u => httpOf(net, u))];
  try {
    return await Promise.any(targets.map(async c => {
      try { return await c.sendRawTransaction({ serializedTransaction: serialized }); }
      catch (e) { if (isKnown(e)) return keccak256(serialized); throw e; }
    }));
  } catch (e) {
    const inner = (e as AggregateError).errors ?? [e];
    if (inner.some(isKnown)) return keccak256(serialized);
    throw inner[0] ?? e;
  }
}

const nonceNext = new Map<string, number>();
const lane = new Map<string, Promise<unknown>>();

/**
 * Sign once with the agent key held in this browser, then race the same raw transaction
 * to the WebSocket pool and two HTTP endpoints. Wallet-popup transactions cannot do this.
 */
export function sendWithKey(net: Net, key: Hex, req: { to: Address; data?: Hex; value?: bigint; gas: bigint }, nonceSource: PublicClient): Promise<Hex> {
  const account = privateKeyToAccount(key);
  const id = account.address.toLowerCase();
  const prev = lane.get(id) ?? Promise.resolve();
  const job = prev.catch(() => undefined).then(async () => {
    let nonce = nonceNext.get(id);
    if (nonce == null) {
      nonce = await nonceSource.getTransactionCount({ address: account.address, blockTag: 'pending' });
      nonceNext.set(id, nonce);
    }
    const fees = feeCaps();
    const serialized = await account.signTransaction({
      chainId: net.id, to: req.to, data: req.data, value: req.value ?? 0n, gas: req.gas, nonce,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, type: 'eip1559',
    });
    try {
      const hash = await broadcastRaw(net, serialized);
      nonceNext.set(id, nonce + 1);
      return hash;
    } catch (e) {
      nonceNext.delete(id);
      throw e;
    }
  });
  lane.set(id, job.then(() => undefined, () => undefined));
  return job;
}
