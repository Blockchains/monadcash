import { formatEther, formatUnits, parseAbi, type Address, type PublicClient } from 'viem';
import { TOKENS, type TokenSym } from './services';
import { erc20, mon, monUsdcPrice, type VaultState } from './vault';

export const COLORS: Record<'MON' | TokenSym, string> = {
  MON: '#A78BFA', WMON: '#DDD6FE', USDC: '#34D399', sMON: '#FBBF24', aprMON: '#22D3EE', gMON: '#FB7185',
};

export type Holding = {
  sym: 'MON' | TokenSym;
  amount: bigint;
  decimals: number;
  monValue: bigint | null;
  /** live = quoted or redeemable 1:1; par = counted 1:1 because the contract publishes no rate */
  priced: 'live' | 'par' | 'none';
  note: string;
  color: string;
};

export type Book = {
  holdings: Holding[];
  navMon: bigint;
  usdcPerMon: bigint | null;
  venue: string | null;
  venues: { id: string; name: string; icon: string; usdcPerMon: bigint | null }[];
  hasPar: boolean;
};

const ONE = 10n ** 18n;
const erc4626 = parseAbi(['function convertToAssets(uint256 shares) view returns (uint256)']);

/** MON amounts under 1 keep 4 decimals so a staking rate (0.0300 vs 0.0273 shares) stays visible. */
export function fmtMon(wei: bigint): string {
  const n = Number(formatEther(wei));
  if (!Number.isFinite(n)) return '0';
  if (n !== 0 && Math.abs(n) < 1e-4) return n.toExponential(2);
  const digits = Math.abs(n) < 1 ? 4 : 2;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: 4 });
}
export function fmtAmt(amount: bigint, decimals: number, max = 6): string {
  const n = Number(formatUnits(amount, decimals));
  if (!Number.isFinite(n)) return '0';
  if (n !== 0 && Math.abs(n) < 10 ** -max) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}
export function navUsdc(navMon: bigint, usdcPerMon: bigint | null): bigint | null {
  if (!usdcPerMon || usdcPerMon <= 0n) return null;
  return (navMon * usdcPerMon) / ONE;
}
export function pctOf(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  return Number((part * 10000n) / whole) / 100;
}

/** Estimated MON value of everything sitting in the vault. Prices come from the same on-chain quoters the swaps use. */
export async function loadBook(pub: PublicClient, s: VaultState, mainnet: boolean): Promise<Book> {
  if (!mainnet) {
    const holdings: Holding[] = [{ sym: 'MON', amount: s.bal, decimals: 18, monValue: s.bal, priced: 'live', note: 'Native MON inside the vault.', color: COLORS.MON }];
    return { holdings: holdings.filter(h => h.amount > 0n), navMon: s.bal, usdcPerMon: null, venue: null, venues: [], hasPar: false };
  }
  const wantApr = (s.toks.aprMON ?? 0n) > 0n;
  const wantG = (s.toks.gMON ?? 0n) > 0n;
  const [px, aprRate, gRate] = await Promise.all([
    monUsdcPrice(pub, s.v).catch(() => null),
    (wantApr ? pub.readContract({ address: TOKENS.aprMON.address, abi: erc4626, functionName: 'convertToAssets', args: [ONE] }) : Promise.resolve(null)).catch(() => null) as Promise<bigint | null>,
    (wantG ? pub.readContract({ address: TOKENS.gMON.address, abi: erc4626, functionName: 'convertToAssets', args: [ONE] }) : Promise.resolve(null)).catch(() => null) as Promise<bigint | null>,
  ]);
  const price = px && px.usdcPerMon > 0n ? px : null;
  const holdings: Holding[] = [];
  if (s.bal > 0n) holdings.push({ sym: 'MON', amount: s.bal, decimals: 18, monValue: s.bal, priced: 'live', note: 'Native MON inside the vault.', color: COLORS.MON });
  const w = s.toks.WMON ?? 0n;
  if (w > 0n) holdings.push({ sym: 'WMON', amount: w, decimals: 18, monValue: w, priced: 'live', note: 'Wrapped MON, redeemable 1:1 back to MON.', color: COLORS.WMON });
  const usdc = s.toks.USDC ?? 0n;
  if (usdc > 0n) {
    const monValue = price ? (usdc * ONE) / price.usdcPerMon : null;
    holdings.push({
      sym: 'USDC', amount: usdc, decimals: 6, monValue, priced: monValue === null ? 'none' : 'live', color: COLORS.USDC,
      note: price ? `Valued at the ${price.venue} price.` : 'No MON/USDC quote right now, so this USDC is left out of the total.',
    });
  }
  const lst = (sym: 'sMON' | 'aprMON' | 'gMON', rate: bigint | null, protocol: string) => {
    const amount = s.toks[sym] ?? 0n;
    if (amount === 0n) return;
    if (sym !== 'sMON' && rate && rate > 0n) {
      const per = Number(formatEther(rate)).toLocaleString(undefined, { maximumFractionDigits: 4 });
      holdings.push({
        sym, amount, decimals: 18, monValue: (amount * rate) / ONE, priced: 'live', color: COLORS[sym],
        note: `1 ${sym} = ${per} MON via convertToAssets. Cash-out returns the token; redeem it in ${protocol}.`,
      });
      return;
    }
    holdings.push({
      sym, amount, decimals: 18, monValue: amount, priced: 'par', color: COLORS[sym],
      note: sym === 'sMON'
        ? 'Kintsu does not publish convertToAssets on this contract, so sMON is shown 1:1 with MON. Cash-out returns the token; redeem it in Kintsu.'
        : `${protocol}'s exchange rate was unreadable, so this is shown 1:1. Cash-out returns the token; redeem it in ${protocol}.`,
    });
  };
  lst('sMON', null, 'Kintsu');
  lst('aprMON', aprRate, 'aPriori');
  lst('gMON', gRate, 'Magma');
  const navMon = holdings.reduce((a, h) => a + (h.monValue ?? 0n), 0n);
  return { holdings, navMon, usdcPerMon: price?.usdcPerMon ?? null, venue: price?.venue ?? null, venues: px?.venues ?? [], hasPar: holdings.some(h => h.priced === 'par') };
}

export async function readToks(pub: PublicClient, vault: Address): Promise<Record<TokenSym, bigint>> {
  const out = {} as Record<TokenSym, bigint>;
  await Promise.all((Object.keys(TOKENS) as TokenSym[]).map(async k => {
    out[k] = await pub.readContract({ address: TOKENS[k].address, abi: erc20, functionName: 'balanceOf', args: [vault] }).catch(() => 0n) as bigint;
  }));
  return out;
}

export type Sample = { t: number; v: number };
export const PX_KEY = 'pp.px.monusdc';
export const navKey = (v: string) => `pp.nav.${v.toLowerCase()}`;

export function readSamples(key: string): Sample[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: Sample) => x && typeof x.t === 'number' && typeof x.v === 'number' && Number.isFinite(x.v)).slice(-240);
  } catch { return []; }
}
/** Append a sample at most once per `minGap` ms. History lives only in this browser. */
export function pushSample(key: string, value: number, minGap = 15_000): Sample[] {
  const prev = readSamples(key);
  if (!Number.isFinite(value)) return prev;
  const last = prev[prev.length - 1];
  if (last && Date.now() - last.t < minGap) return prev;
  const next = [...prev, { t: Date.now(), v: value }].slice(-240);
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
export function changePct(samples: Sample[]): number | null {
  if (samples.length < 2) return null;
  const a = samples[0].v, b = samples[samples.length - 1].v;
  if (!a) return b === 0 ? 0 : null;
  return ((b - a) / Math.abs(a)) * 100;
}

export type CashStep = { id: string; title: string; detail: string; mode: 'run' | 'note' };

/** What a cash-out will actually do, given the rules and whether this browser can sign as the agent. */
export function cashoutPlan(o: { rules: string[]; canSign: boolean; monBal: bigint; toks: Partial<Record<TokenSym, bigint>>; usdcCap: bigint | null }): CashStep[] {
  const steps: CashStep[] = [];
  const usdc = o.toks.USDC ?? 0n;
  const wmon = o.toks.WMON ?? 0n;
  const venues = (['uniswap', 'pancake'] as const).filter(id => o.rules.includes(id));
  const canSwap = usdc > 0n && o.canSign && venues.length > 0 && o.usdcCap !== null && o.usdcCap > 0n && usdc <= o.usdcCap;
  if (usdc > 0n) {
    let detail: string;
    if (canSwap) detail = `Quotes ${venues.map(id => (id === 'uniswap' ? 'Uniswap' : 'PancakeSwap')).join(' and ')}, sends the swap to the better WMON out, and the vault enforces minOut = quote − 3%. The WMON is then unwrapped to MON.`;
    else if (!venues.length) detail = 'No Uniswap or PancakeSwap rule is on, so USDC cannot be swapped inside the vault. It is returned as USDC.';
    else if (!o.canSign) detail = 'This browser cannot sign as the agent, so USDC is returned as USDC.';
    else if (o.usdcCap === null) detail = 'Checking the vault’s USDC approval cap…';
    else if (o.usdcCap === 0n) detail = 'This vault has no USDC approval cap, so a swap-back is not allowed. USDC is returned as a token.';
    else detail = `The USDC balance is above the vault approval cap of ${formatUnits(o.usdcCap, 6)} USDC, so it is returned as USDC.`;
    steps.push({ id: 'usdc', title: canSwap ? `Swap ${fmtAmt(usdc, 6)} USDC back to MON` : `Return ${fmtAmt(usdc, 6)} USDC as a token`, detail, mode: canSwap ? 'run' : 'note' });
  }
  const canUnwrap = wmon > 0n && o.canSign && o.rules.includes('wmon');
  if (wmon > 0n) {
    steps.push({
      id: 'unwrap', mode: canUnwrap ? 'run' : 'note',
      title: canUnwrap ? `Unwrap ${fmtAmt(wmon, 18, 4)} WMON → MON` : `Return ${fmtAmt(wmon, 18, 4)} WMON as a token`,
      detail: canUnwrap
        ? 'The agent calls WMON withdraw. MON lands back in the vault, then comes to you with the rest.'
        : o.rules.includes('wmon')
          ? 'This browser cannot sign as the agent, so WMON is sent to your wallet as WMON (still 1:1 with MON).'
          : 'Unwrap is not an allowed action on this vault, so WMON is sent to your wallet as WMON.',
    });
  }
  const back: string[] = [];
  for (const sym of ['sMON', 'aprMON', 'gMON'] as const) {
    const b = o.toks[sym] ?? 0n;
    if (b > 0n) back.push(`${fmtAmt(b, 18, 4)} ${sym}`);
  }
  if (usdc > 0n && !canSwap) back.push(`${fmtAmt(usdc, 6)} USDC`);
  if (wmon > 0n && !canUnwrap) back.push(`${fmtAmt(wmon, 18, 4)} WMON`);
  if (back.length) {
    steps.push({
      id: 'tokens', mode: 'run', title: 'Return tokens to the creator',
      detail: `${back.join(', ')} via withdrawToken. Staking receipts (sMON, aprMON, gMON) cannot be unstaked inside this vault — redeem them in Kintsu, aPriori or Magma once they are in your wallet.`,
    });
  }
  if (o.monBal > 0n || canUnwrap || canSwap) {
    steps.push({
      id: 'mon', mode: 'run', title: 'Send MON to the creator',
      detail: canUnwrap || canSwap
        ? 'Withdraws the vault’s MON after the unwrap' + (canSwap ? ' and the USDC swap-back' : '') + '. This is withdraw, which does not pause the vault.'
        : `Withdraws ${mon(o.monBal)}. This is withdraw, which does not pause the vault.`,
    });
  }
  return steps;
}
