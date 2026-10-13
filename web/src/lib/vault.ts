'use client';
import { createPublicClient, decodeErrorResult, decodeFunctionData, encodeFunctionData, formatEther, http, keccak256, parseAbi, toHex, type Abi, type Address, type Hex, type PublicClient } from 'viem';
import ABI from './vault-abi.json';
import { LIVE, QUOTERS, SERVICES, TOKENS, type Service, type TokenSym } from './services';

export const factoryAbi = ABI.factory as Abi; export const vaultAbi = ABI.vault as Abi;
const errAbi = (ABI.vault as any[]).filter(x => x.type === 'error') as Abi;
export const ZERO = '0x0000000000000000000000000000000000000000' as Address;

export type Net = { id: 143 | 10143; key: 'mainnet' | 'testnet'; name: string; hex: Hex; rpc: string; exp: string; factory: Address; faucet?: string; publicRpc: string };
export const NETS: Record<'mainnet' | 'testnet', Net> = {
  mainnet: { id: 143, key: 'mainnet', name: 'Mainnet', hex: '0x8f', rpc: 'https://rpc.monad.xyz', publicRpc: 'https://rpc.monad.xyz', exp: 'https://monadvision.com', factory: '0x8738B74778502ff3623A8319837A819d8dBdEeB7' },
  testnet: { id: 10143, key: 'testnet', name: 'Testnet', hex: '0x279f', rpc: 'https://testnet-rpc.monad.xyz', publicRpc: 'https://testnet-rpc.monad.xyz', exp: 'https://testnet.monadexplorer.com', factory: '0x2E40E06C0B864caF87cCB00f31e6EE2d0689cDd7', faucet: 'https://faucet.monad.xyz' },
};
/** ?net=mainnet|testnet, plus ?rpc= & ?factory= overrides used for local fork testing. */
export function resolveNet(): Net {
  if (typeof window === 'undefined') return NETS.mainnet;
  const q = new URLSearchParams(location.search);
  const key = (q.get('net') as 'mainnet' | 'testnet') || (localStorage.getItem('pp.netkey') as any) || 'mainnet';
  const n = { ...(NETS[key] ?? NETS.mainnet) };
  if (q.get('rpc')) n.rpc = q.get('rpc')!; if (q.get('factory')) n.factory = q.get('factory') as Address;
  return n;
}
export const chainOf = (n: Net) => ({ id: n.id, name: `Monad ${n.name}`, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [n.rpc] } }, blockExplorers: { default: { name: 'Explorer', url: n.exp } } }) as const;
export const pubOf = (n: Net) => createPublicClient({ chain: chainOf(n), transport: http(n.rpc, { batch: false, retryCount: 4, retryDelay: 500 }) }) as PublicClient;
export const services = (n: Net) => (n.id === 143 ? SERVICES : SERVICES.filter(s => s.id === 'pay').concat(SERVICES.filter(s => s.id !== 'pay').map(s => ({ ...s, status: 'soon' as const, why: s.why ?? 'Mainnet only: these are mainnet contracts.' }))));

export const mon = (v: bigint | number | string, d = 4) => `${Number(formatEther(BigInt(v))).toLocaleString(undefined, { maximumFractionDigits: d })} MON`;
export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const rid = (t: string) => keccak256(toHex(`${t}:${Date.now()}:${Math.random()}`));

// ---------- plain-English reasons ----------
const byAddr: Record<string, { name: string; icon: string }> = {};
for (const s of SERVICES) if (s.address) byAddr[s.address.toLowerCase()] = { name: s.name, icon: s.icon };
for (const [k, t] of Object.entries(TOKENS)) byAddr[t.address.toLowerCase()] ??= { name: k, icon: '🪙' };
const SELS: Record<string, string> = { '0xa9059cbb': 'transfer' }; for (const s of SERVICES) for (const r of s.rules ?? []) SELS[r.selector] = r.fn.split('(')[0];
export const dappName = (a: string) => byAddr[String(a).toLowerCase()]?.name ?? short(a);
export type Reason = { name: string | null; args?: readonly any[]; raw?: string };
const PLAIN: Record<string, (a: readonly any[]) => string> = {
  PerPaymentCapExceeded: a => `Over the per-action cap: tried ${mon(a[0])}, but the cap is ${mon(a[1])}.`,
  BudgetExceeded: a => `Over budget: tried ${mon(a[0])}, only ${mon(a[1])} left.`,
  RecipientNotAllowed: a => `${short(a[0])} isn't an approved payee.`,
  CallNotAllowed: a => `${dappName(a[0])} → ${SELS[String(a[1]).toLowerCase()] ?? a[1]} isn't an allowed service action.`,
  RecipientMustBeVault: a => `Tried to send the output to ${short(a[0])} instead of back to the vault.`,
  TokenCapExceeded: a => `Token approval ${a[1]} is over the cap of ${a[2]}.`,
  MinOutNotMet: a => `Slippage guard: got ${a[0]}, needed at least ${a[1]}.`,
  RequestAlreadyExecuted: () => 'Replay blocked: that request already ran.',
  Paused: () => 'The owner paused this agent.', NotExecutor: () => "This key isn't the vault's agent.", NotOwner: () => 'Only the vault owner can do that.',
  VaultCapExceeded: a => `Vault cap: the balance would be ${mon(a[0])}, but the max is ${mon(a[1])}.`, GlobalCapExceeded: () => 'The alpha deposit cap for all vaults is reached.',
  InsufficientBalance: a => `The vault only holds ${mon(a[1] ?? 0n)}.`, ForbiddenSelector: () => 'Approve/transfer functions can never be allowlisted.', ForbiddenTarget: () => "That address can't be a service target.",
  UserRejected: () => 'You cancelled in your wallet.',
};
export function reasonOf(e: any): Reason {
  let x = e;
  while (x) {
    const d = x.data?.data ?? x.data;
    if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) { try { const r = decodeErrorResult({ abi: errAbi, data: d as Hex }); return { name: r.errorName, args: r.args as any }; } catch { /* next */ } }
    if (x.data?.errorName) return { name: x.data.errorName, args: x.data.args };
    x = x.cause;
  }
  const m = e?.shortMessage || e?.message || String(e);
  if (e?.code === 4001 || /reject|denied|cancel/i.test(m)) return { name: 'UserRejected' };
  return { name: null, raw: String(m).split('\n')[0] };
}
export const plain = (r?: Reason | null) => (r?.name && PLAIN[r.name] ? PLAIN[r.name](r.args ?? []) : r?.raw || r?.name || 'Reverted');
export const parseRecorded = (s?: string): Reason => { const m = /^(\w+)\((.*)\)$/.exec(s || ''); if (!m) return { name: null, raw: s }; return { name: m[1], args: m[2] ? m[2].split(', ').map(x => (/^\d+$/.test(x) ? BigInt(x) : x)) : [] }; };

// ---------- policy -> createVault args ----------
export type Policy = { budgetOn: boolean; budget: number; capOn: boolean; cap: number; deposit: number; gas: number; services: string[]; payees: Address[]; startPaused: boolean };
export function buildCreate(executor: Address, owner: Address, p: Policy) {
  const toWei = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
  const budget = p.budgetOn ? toWei(p.budget) : 10n ** 18n; // off = bounded only by the 1 MON vault cap
  const cap = p.capOn ? toWei(Math.min(p.cap, p.budgetOn ? p.budget : 1)) : budget;
  const rules: { target: Address; selector: Hex; recipientWord: number }[] = []; const capMap = new Map<Address, bigint>();
  for (const s of LIVE.filter(s => p.services.includes(s.id) && s.address)) {
    for (const r of s.rules ?? []) rules.push({ target: s.address!, selector: r.selector, recipientWord: r.recipientWord });
    for (const c of s.tokenCaps ?? []) { const a = TOKENS[c.token].address; capMap.set(a, (capMap.get(a) ?? 0n) > c.cap ? capMap.get(a)! : c.cap); }
  }
  const caps = [...capMap].map(([token, cap]) => ({ token, cap }));
  const recipients = p.services.includes('pay') ? [...new Set([owner, ...p.payees])] : [];
  const args = [executor, cap, budget, recipients, rules, caps] as const;
  return { data: encodeFunctionData({ abi: factoryAbi, functionName: 'createVault', args: args as any }), value: toWei(p.deposit), cap, budget, rules, caps, recipients };
}

// ---------- agent actions ----------
const routerAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)']);
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const wmonAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256)']);
const kintsuAbi = parseAbi(['function deposit(uint96 minShares,address receiver) payable returns (uint96)']);
const aprAbi = parseAbi(['function deposit(uint256 assets,address receiver) payable returns (uint256)']);
const magmaAbi = parseAbi(['function depositMON(address receiver,uint256 referralId) payable']);
const NONE = { approveToken: ZERO, approveAmount: 0n, outToken: ZERO, minOut: 0n };
const svc = (id: string) => SERVICES.find(s => s.id === id)! as Service & { address: Address };
export const vcall = (v: Address, fn: string, args: readonly unknown[]) => ({ to: v, data: encodeFunctionData({ abi: vaultAbi, functionName: fn as any, args: args as any }) });

export type AgentAction = { label: string; dapp: string; icon: string; req: { to: Address; data: Hex }; value: bigint };
export async function buildAction(pub: PublicClient, kind: string, vault: Address, owner: Address, executor: Address, amount: bigint, cap: bigint): Promise<AgentAction> {
  const call = (s: string, value: bigint, data: Hex, out: { outToken: Address; minOut: bigint }, label: string) => {
    const x = svc(s); return { label, dapp: x.name, icon: x.icon, value, req: vcall(vault, 'executeCall', [rid(s), x.address, value, data, { ...NONE, ...out }]) };
  };
  const swap = async (id: 'uniswap' | 'pancake') => {
    const Q = QUOTERS[id]; const q = await pub.simulateContract({ address: Q.address, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: TOKENS.WMON.address, tokenOut: TOKENS.USDC.address, amountIn: amount, fee: Q.fee, sqrtPriceLimitX96: 0n }] });
    const minOut = (q.result[0] * 97n) / 100n;
    const data = encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: TOKENS.WMON.address, tokenOut: TOKENS.USDC.address, fee: Q.fee, recipient: vault, amountIn: amount, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
    return call(id, amount, data, { outToken: TOKENS.USDC.address, minOut }, `Agent swaps ${formatEther(amount)} MON → USDC on ${svc(id).name}`);
  };
  switch (kind) {
    case 'pay': return { label: `Agent pays ${formatEther(amount)} MON to ${short(owner)}`, dapp: 'Pay people', icon: '💸', value: amount, req: vcall(vault, 'execute', [rid('pay'), owner, amount]) };
    case 'wmon': return call('wmon', amount, encodeFunctionData({ abi: wmonAbi, functionName: 'deposit' }), { outToken: TOKENS.WMON.address, minOut: amount }, `Agent wraps ${formatEther(amount)} MON → WMON`);
    case 'uniswap': return swap('uniswap');
    case 'pancake': return swap('pancake');
    case 'kintsu': return call('kintsu', amount, encodeFunctionData({ abi: kintsuAbi, functionName: 'deposit', args: [1n, vault] }), { outToken: TOKENS.sMON.address, minOut: 1n }, `Agent stakes ${formatEther(amount)} MON → sMON (Kintsu)`);
    case 'apriori': return call('apriori', amount, encodeFunctionData({ abi: aprAbi, functionName: 'deposit', args: [amount, vault] }), { outToken: TOKENS.aprMON.address, minOut: 1n }, `Agent stakes ${formatEther(amount)} MON → aprMON (aPriori)`);
    case 'magma': return call('magma', amount, encodeFunctionData({ abi: magmaAbi, functionName: 'depositMON', args: [vault, 0n] }), { outToken: TOKENS.gMON.address, minOut: 1n }, `Agent stakes ${formatEther(amount)} MON → gMON (Magma)`);
    // attacks
    case 'x-cap': return { label: `Agent tries to spend ${formatEther(cap * 2n)} MON (2× cap)`, dapp: 'Pay people', icon: '😈', value: cap * 2n, req: vcall(vault, 'execute', [rid('x'), owner, cap * 2n]) };
    case 'x-stranger': return { label: 'Agent tries to pay a stranger', dapp: 'Pay people', icon: '😈', value: 1n, req: vcall(vault, 'execute', [rid('x'), '0x000000000000000000000000000000000000dEaD', 1n]) };
    case 'x-drain': return { label: 'Agent tries USDC.transfer() to itself', dapp: 'USDC', icon: '😈', value: 0n, req: vcall(vault, 'executeCall', [rid('x'), TOKENS.USDC.address, 0n, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [executor, 1n] }), NONE]) };
    case 'x-self': return { label: 'Agent tries a swap that pays itself', dapp: 'Uniswap v3', icon: '😈', value: 1000n, req: vcall(vault, 'executeCall', [rid('x'), svc('uniswap').address, 1000n, encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: TOKENS.WMON.address, tokenOut: TOKENS.USDC.address, fee: 3000, recipient: executor, amountIn: 1000n, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }), NONE]) };
    case 'x-withdraw': return { label: 'Agent tries to withdraw the vault', dapp: 'Owner-only', icon: '😈', value: 0n, req: vcall(vault, 'withdraw', [executor, 1n]) };
  }
  throw new Error('unknown action ' + kind);
}

// ---------- reads ----------
export type VaultState = { v: Address; owner: Address; executor: Address; cap: bigint; budget: bigint; spent: bigint; paused: boolean; bal: bigint; agentBal: bigint; toks: Partial<Record<TokenSym, bigint>>; key: string | null; rules: string[] };
export async function readVault(pub: PublicClient, n: Net, v: Address): Promise<VaultState> {
  const rd = (f: string, args?: unknown[]) => pub.readContract({ address: v, abi: vaultAbi, functionName: f as any, args: args as any }) as Promise<any>;
  const [owner, executor, cap, budget, spent, paused, bal] = await Promise.all([rd('owner'), rd('executor'), rd('perPaymentCap'), rd('budget'), rd('totalSpent'), rd('paused'), pub.getBalance({ address: v })]);
  const agentBal = await pub.getBalance({ address: executor });
  const toks: VaultState['toks'] = {}; const rules: string[] = [];
  if (n.id === 143) {
    await Promise.all((Object.keys(TOKENS) as TokenSym[]).map(async k => { toks[k] = await pub.readContract({ address: TOKENS[k].address, abi: erc20, functionName: 'balanceOf', args: [v] }).catch(() => 0n); }));
    await Promise.all(LIVE.filter(s => s.address).map(async s => { const r = s.rules![0]; const ok = await rd('callRule', [s.address, r.selector]).catch(() => null); if (ok && (ok === true || ok?.[0] === true || ok?.allowed === true)) rules.push(s.id); }));
  }
  const allowedOwner = await rd('allowedRecipient', [owner]).catch(() => false); if (allowedOwner) rules.push('pay');
  return { v, owner, executor, cap, budget, spent, paused, bal, agentBal, toks, key: localStorage.getItem(`pp.agentkey.${executor.toLowerCase()}`), rules };
}

// ---------- history ----------
export type Ev = { tx?: Hex; from?: string; label: string; kind?: string; status: 'allowed' | 'blocked' | 'owner'; simulated?: boolean; dapp: string; icon: string; value: bigint; block?: bigint; fee?: bigint; gasUsed?: bigint; reason?: Reason | null; input?: Hex; vault?: Address; src: 'showcase' | 'you'; ts?: number };
const LOCAL = (n: Net) => `pp.hist.${n.id}`;
export const localHist = (n: Net): any[] => { try { return JSON.parse(localStorage.getItem(LOCAL(n)) || '[]'); } catch { return []; } };
export const addLocal = (n: Net, e: Record<string, unknown>) => { const h = localHist(n); h.unshift({ ...e, ts: Date.now() }); localStorage.setItem(LOCAL(n), JSON.stringify(h.slice(0, 200), (_k, v) => (typeof v === 'bigint' ? v.toString() : v))); };
async function pool<T, R>(items: T[], k: number, fn: (t: T) => Promise<R>) { const out: (R | null)[] = []; let i = 0; await Promise.all(Array.from({ length: k }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]).catch(() => null); } })); return out; }
function classify(tx: any, step: any): Ev {
  const ev: Ev = { tx: tx?.hash ?? step.tx, from: tx?.from ?? step.from, label: step.label, kind: step.kind, value: 0n, dapp: 'Owner', icon: '👤', status: 'owner', src: step.src };
  try {
    const f = decodeFunctionData({ abi: vaultAbi, data: tx.input }) as any;
    if (f.functionName === 'execute') { ev.dapp = 'Pay people'; ev.icon = '💸'; ev.value = f.args[2]; }
    else if (f.functionName === 'executeCall') { const d = byAddr[String(f.args[1]).toLowerCase()]; ev.dapp = d?.name ?? short(f.args[1]); ev.icon = d?.icon ?? '🧩'; ev.value = f.args[2]; }
    else ev.icon = ({ setPaused: '⏸', emergencyWithdrawAll: '🧯', withdraw: '↩️', withdrawToken: '↩️', deposit: '📥' } as any)[f.functionName] ?? '⚙️';
  } catch { try { decodeFunctionData({ abi: factoryAbi, data: tx.input }); ev.icon = '🛡️'; } catch { ev.icon = '⛽'; } }
  return ev;
}
export async function loadHistory(pub: PublicClient, n: Net, base: string): Promise<{ events: Ev[]; showcase: any }> {
  let show: any = null; try { show = await (await fetch(`${base}/showcase-${n.id}.json`, { cache: 'no-store' })).json(); } catch { /* none */ }
  const steps = [...(show?.steps ?? []).map((s: any) => ({ ...s, src: 'showcase' })), ...localHist(n).map(s => ({ ...s, src: 'you' }))];
  const rows = await pool(steps, 3, async (s: any): Promise<Ev> => {
    if (!s.tx) return { label: s.label, simulated: true, status: 'blocked', value: s.value ? BigInt(s.value) : 0n, dapp: s.dapp ?? 'Pay people', icon: s.icon ?? '🛡️', reason: s.revertReason ? parseRecorded(s.revertReason) : null, src: s.src, ts: s.ts };
    const [tx, rc] = await Promise.all([pub.getTransaction({ hash: s.tx }), pub.getTransactionReceipt({ hash: s.tx })]);
    const ev = classify(tx, s); ev.block = rc.blockNumber; ev.gasUsed = rc.gasUsed; ev.fee = rc.gasUsed * rc.effectiveGasPrice; ev.vault = tx.to ?? undefined; ev.input = tx.input; ev.ts = s.ts;
    ev.reason = s.revertReason ? parseRecorded(s.revertReason) : null;
    ev.status = s.kind === 'owner' ? (rc.status === 'success' ? 'owner' : 'blocked') : rc.status === 'success' ? 'allowed' : 'blocked';
    return ev;
  });
  const events = (rows.filter(Boolean) as Ev[]).sort((a, b) => Number((a.block ?? 10n ** 12n) - (b.block ?? 10n ** 12n)) || (a.ts ?? 0) - (b.ts ?? 0));
  return { events, showcase: show };
}
export function decodeInput(input?: Hex) {
  if (!input) return ''; try { const f = decodeFunctionData({ abi: vaultAbi, data: input }) as any; return `${f.functionName}(${(f.args ?? []).map((a: any) => (typeof a === 'object' && a !== null ? JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) : typeof a === 'string' && a.length > 80 ? a.slice(0, 74) + '…' : String(a))).join(', ')})`; } catch { return ''; }
}
export { erc20 };
