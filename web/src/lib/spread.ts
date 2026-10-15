'use client';
import { decodeErrorResult, decodeFunctionResult, encodeDeployData, encodeFunctionData, parseAbi, parseEther, type Abi, type Address, type Hex } from 'viem';
import artifact from './spreadArtifact.json';
import { QUOTERS, SERVICES, TOKENS } from './services';

export const spreadAbi = artifact.abi as Abi;
export const SPREAD_BYTECODE = artifact.bytecode as Hex;

/** Matches PolicyPilotSpreadVault. 5 bps is the floor, not a forecast. */
export const MIN_PROFIT_BPS = 5;
export const KEEPER_BPS = 1_000;
export const PROTOCOL_BPS = 1_000;
export const SPREAD_CAP = parseEther('1');
export const MAX_TRADE_BPS = 10_000;
/** 500,000 gas at the 100 gwei minimum base fee. A revert still costs the gas limit. */
export const ROUGH_GAS_WEI = 500_000n * 100_000_000_000n;

export type VenueId = 'uniswap' | 'pancake';

const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);

export const VENUES: Record<VenueId, { name: string; router: Address; quoter: Address; fee: number }> = {
  uniswap: { name: 'Uniswap', router: SERVICES.find(s => s.id === 'uniswap')!.address!, quoter: QUOTERS.uniswap.address, fee: QUOTERS.uniswap.fee },
  pancake: { name: 'PancakeSwap', router: SERVICES.find(s => s.id === 'pancake')!.address!, quoter: QUOTERS.pancake.address, fee: QUOTERS.pancake.fee },
};

export const venueIndex = (id: VenueId): 0 | 1 => (id === 'uniswap' ? 0 : 1);

export function floorProfit(amount: bigint): bigint {
  return (amount * BigInt(MIN_PROFIT_BPS)) / 10_000n;
}

export function splitProfit(profit: bigint): { bounty: bigint; fee: bigint; pool: bigint } {
  const bounty = (profit * BigInt(KEEPER_BPS)) / 10_000n;
  const fee = (profit * BigInt(PROTOCOL_BPS)) / 10_000n;
  return { bounty, fee, pool: profit - bounty - fee };
}

/** True only when the quoted MON back clears the contract floor and a rough gas cost. */
export function clearsFloor(amount: bigint, wmonBack: bigint): { profit: bigint; floor: bigint; bounty: bigint; fee: bigint; pool: bigint; ok: boolean } {
  const profit = wmonBack > amount ? wmonBack - amount : 0n;
  const floor = floorProfit(amount);
  const split = splitProfit(profit);
  return { profit, floor, ...split, ok: floor > 0n && profit >= floor && profit > ROUGH_GAS_WEI };
}

export function chooseSell(uniUsdc: bigint, cakeUsdc: bigint): { sell: VenueId; buy: VenueId; usdc: bigint } | null {
  if (uniUsdc <= 0n && cakeUsdc <= 0n) return null;
  if (uniUsdc >= cakeUsdc && uniUsdc > 0n) return { sell: 'uniswap', buy: 'pancake', usdc: uniUsdc };
  if (cakeUsdc > 0n) return { sell: 'pancake', buy: 'uniswap', usdc: cakeUsdc };
  return null;
}

export function minOuts(amount: bigint, usdc: bigint, wmonBack: bigint): { minUsdc: bigint; minWmon: bigint } {
  const floorBack = amount + floorProfit(amount);
  const slipped = (wmonBack * 99n) / 100n;
  return { minUsdc: (usdc * 99n) / 100n > 0n ? (usdc * 99n) / 100n : 1n, minWmon: slipped > floorBack ? slipped : floorBack };
}

export type SpreadGate = { ok: boolean; code: string; label: string; detail: string };

export function spreadGate(o: {
  mainnet: boolean; account: boolean; vault: boolean; amount: string; pool: bigint;
  walletBal: bigint | null; quoting: boolean; quoteOk: boolean | null;
}): SpreadGate {
  let wei: bigint;
  try { wei = parseEther(o.amount || '0'); } catch {
    return { ok: false, code: 'amount', label: 'ENTER AN AMOUNT', detail: 'Use a MON amount such as 0.05.' };
  }
  if (wei <= 0n) return { ok: false, code: 'amount', label: 'ENTER AN AMOUNT', detail: 'The amount needs to be more than 0 MON.' };
  if (!o.mainnet) return { ok: false, code: 'net', label: 'MAINNET ONLY', detail: 'These quotes are Uniswap v3 and PancakeSwap v3 on Monad mainnet.' };
  if (!o.vault && wei > SPREAD_CAP) return { ok: false, code: 'cap', label: 'EXCEEDS CAP', detail: 'A spread pool holds at most 1 MON.' };
  if (o.vault && wei > o.pool) return { ok: false, code: 'bal', label: 'LARGER THAN THE POOL', detail: 'A round trip cannot sell more MON than the pool holds.' };
  if (!o.account) return { ok: false, code: 'connect', label: 'CONNECT WALLET', detail: 'One wallet connection opens the pool or submits a round trip.' };
  if (!o.vault) {
    if (o.walletBal != null && wei > o.walletBal) return { ok: false, code: 'wallet', label: 'NOT ENOUGH MON', detail: 'Your wallet does not hold this deposit.' };
    return { ok: true, code: 'open', label: 'READY TO OPEN', detail: 'One signature opens your pool and deposits this MON. There is no promised rate.' };
  }
  if (o.quoting || o.quoteOk == null) return { ok: false, code: 'quote', label: 'QUOTING', detail: 'Asking both pools for this size.' };
  if (!o.quoteOk) return { ok: false, code: 'flat', label: 'NO SPREAD', detail: 'The quote does not clear the 0.05% floor and a rough gas cost. Nothing is sent.' };
  return { ok: true, code: 'go', label: 'SPREAD COVERS THE FLOOR', detail: 'Submit sells on the richer pool and buys back on the other. A loss reverts.' };
}

export type QuoteCall = { to: Address; data: Hex };

export function quoteCall(venue: VenueId, tokenIn: Address, tokenOut: Address, amountIn: bigint): QuoteCall {
  const v = VENUES[venue];
  return {
    to: v.quoter,
    data: encodeFunctionData({
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee: v.fee, sqrtPriceLimitX96: 0n }],
    }),
  };
}

export function forwardQuotes(amount: bigint): QuoteCall[] {
  const wmon = TOKENS.WMON.address;
  const usdc = TOKENS.USDC.address;
  return [quoteCall('uniswap', wmon, usdc, amount), quoteCall('pancake', wmon, usdc, amount)];
}

export function backQuote(venue: VenueId, usdcAmount: bigint): QuoteCall {
  return quoteCall(venue, TOKENS.USDC.address, TOKENS.WMON.address, usdcAmount);
}

export function decodeQuote(data: Hex): bigint {
  const out = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', data });
  return out[0];
}

export function workerUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${base}/spread-worker.js`;
}

export async function fetchCalls(rpc: string, calls: QuoteCall[]): Promise<Hex[]> {
  const rows = await Promise.all(calls.map(async c => {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }),
    });
    const json = await res.json() as { result?: Hex; error?: { message?: string } };
    if (!json.result) throw new Error(json.error?.message || 'Quote failed');
    return json.result;
  }));
  return rows;
}

export function spreadDeployData(treasury: Address): Hex {
  return encodeDeployData({ abi: spreadAbi, bytecode: SPREAD_BYTECODE, args: [treasury, SPREAD_CAP, MIN_PROFIT_BPS, MAX_TRADE_BPS] });
}

export function spreadCaptureData(sell: VenueId, buy: VenueId, amount: bigint, minUsdc: bigint, minWmon: bigint): Hex {
  return encodeFunctionData({ abi: spreadAbi, functionName: 'capture', args: [venueIndex(sell), venueIndex(buy), amount, minUsdc, minWmon] });
}

export function spreadDepositData(): Hex {
  return encodeFunctionData({ abi: spreadAbi, functionName: 'deposit' });
}

export function spreadWithdrawData(shares: bigint): Hex {
  return encodeFunctionData({ abi: spreadAbi, functionName: 'withdraw', args: [shares] });
}

const SPREAD_PLAIN: Record<string, string> = {
  Floor: 'That round trip does not clear the pool’s profit floor.',
  Unprofitable: 'The swap came back short, so the whole round trip reverted.',
  SameVenue: 'The two legs have to be different pools.',
  TradeTooLarge: 'That size is larger than this pool allows.',
  VaultCapExceeded: 'That deposit would pass the 1 MON cap.',
  InsufficientShares: 'Those shares are not in this wallet.',
  WrongNetwork: 'This pool only deploys on Monad mainnet.',
  ZeroAmount: 'The amount needs to be more than 0.',
  TransferFailed: 'The MON transfer failed.',
  ApproveFailed: 'The token approval failed.',
};

export function explainSpread(e: unknown, fallback: string): string {
  let x: unknown = e;
  while (x && typeof x === 'object') {
    const rec = x as { data?: unknown; cause?: unknown };
    const inner = rec.data && typeof rec.data === 'object' ? (rec.data as { data?: unknown }).data : rec.data;
    const data = typeof inner === 'string' ? inner : typeof rec.data === 'string' ? rec.data : undefined;
    if (data && data.startsWith('0x') && data.length >= 10) {
      try { return SPREAD_PLAIN[decodeErrorResult({ abi: spreadAbi, data: data as Hex }).errorName] ?? fallback; } catch { /* next */ }
    }
    x = rec.cause;
  }
  return fallback;
}
