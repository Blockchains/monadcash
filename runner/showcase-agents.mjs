// PolicyPilot showcase agents: real autonomous agents operated BY THE TEAM against AgentVaults on Monad.
// Each persona gets its own vault (created via the factory) and its own agent key. The vault enforces
// the policy on-chain; the runner just tries things. Spend tracking with a hard auto-stop, then recovery.
//
//   OWNER_ENV=~/.policypilot/mainnet-wallet.env  (MONAD_MAINNET_PRIVATE_KEY) — never logged
//   RPC, FACTORY, CHAIN_ID, STOP_AT (total MON consumed, default 1000), OWNER_RESERVE (deployer never drops below, default 5), USER_HEADROOM (global-cap room left for users, default 1), HOURS, INTERVAL_S, BURST_ROUNDS
//   node runner/showcase-agents.mjs [run|recover|status]
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, encodeFunctionData, parseAbi, decodeEventLog } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { VaultAgent, agentVaultAbi, agentVaultFactoryAbi, ZERO_ADDRESS } from '../packages/agent-kit/dist/index.js';

const HOME = os.homedir(); const E = process.env;
const RPC = E.RPC || 'https://rpc.monad.xyz'; const CID = Number(E.CHAIN_ID || 143);
const FACTORY = E.FACTORY || '0x8738B74778502ff3623A8319837A819d8dBdEeB7';
const STOP_AT = parseEther(E.STOP_AT || '1000'); const RESERVE = parseEther(E.OWNER_RESERVE || '5'); // never let the deployer drop below this
const USER_HEADROOM = parseEther(E.USER_HEADROOM || '1'); // alpha global deposit cap kept free for real users const HOURS = Number(E.HOURS || 4); const INTERVAL = Number(E.INTERVAL_S || 240) * 1000;
const HOURS = Number(E.HOURS || 4); const INTERVAL = Number(E.INTERVAL_S || 240) * 1000;
const BURST = Number(E.BURST_ROUNDS || 8); const TAG = E.TAG || String(CID);
const KEYS = E.KEYS_FILE || path.join(HOME, `.policypilot/showcase-agents-${TAG}.json`);
const PUB = E.PUBLIC_OUT || path.resolve(path.dirname(new URL(import.meta.url).pathname), `../web/public/showcase-agents-${TAG}.json`);
const LEDGER = E.LEDGER || `/workspace/policypilot/evidence/showcase-ledger-${TAG}.jsonl`;
const EXP = 'https://monadvision.com';
const ownerKey = E.OWNER_KEY || Object.fromEntries(fs.readFileSync((E.OWNER_ENV || '~/.policypilot/mainnet-wallet.env').replace('~', HOME), 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0, 2).map(s => s.trim())))['MONAD_MAINNET_PRIVATE_KEY'];
const chain = { id: CID, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pc = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 800, timeout: 20_000 }) });
const owner = privateKeyToAccount(ownerKey); const ow = createWalletClient({ account: owner, chain, transport: http(RPC, { retryCount: 3, timeout: 20_000 }) });
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`watchdog: ${what} took > ${ms / 1000}s`)), ms))]);

// ---- verified mainnet addresses (same as web/src/lib/services.ts; all fork-tested) ----
const T = { WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', sMON: '0xA3227C5969757783154C60bF0bC1944180ed81B9', aprMON: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', gMON: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081' };
const UNI = '0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900', PCS = '0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C';
const QUOTER = { [UNI]: ['0x661e93cca42afacb172121ef892830ca3b70f08d', 3000], [PCS]: ['0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', 500] };
const R = { kuru: ['0xd651346d7c789536ebf06dc72aE3C8502cd695CC', '0xffa5210a', 255], uni: [UNI, '0x04e45aaf', 3], pcs: [PCS, '0x04e45aaf', 3], kintsu: [T.sMON, '0x1c3477dd', 1], apriori: [T.aprMON, '0x6e553f65', 1], magma: [T.gMON, '0x5f3896d3', 0], wrap: [T.WMON, '0xd0e30db0', 255], unwrap: [T.WMON, '0x2e1a7d4d', 255] };
const routerAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)']);
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const wmonAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256)']);
const kintsuAbi = parseAbi(['function deposit(uint96 minShares,address receiver) payable returns (uint96)']);
const aprAbi = parseAbi(['function deposit(uint256 assets,address receiver) payable returns (uint256)']);
const magmaAbi = parseAbi(['function depositMON(address receiver,uint256 referralId) payable']);
// Kuru: https://docs.kuru.io/contracts/Contract-addresses (fork-tested: test_fork_kuru_mon_to_usdc)
const KURU = '0xd651346d7c789536ebf06dc72aE3C8502cd695CC', KURU_MKT = '0x065C9d28E428A0db40191a54d33d5b7c71a9C394';
const kuruAbi = parseAbi(['function anyToAnySwap(address[] markets,bool[] isBuy,bool[] nativeSend,address debitToken,address creditToken,uint256 amount,uint256 minAmountOut) payable returns (uint256)']);
const rule = k => ({ target: R[k][0], selector: R[k][1], recipientWord: R[k][2] });

const PERSONAS = [
  { id: 'dca', name: 'DCA bot', emoji: '📈', about: 'Buys a little USDC with MON on Uniswap and PancakeSwap every round, then periodically swaps it back to MON and unwraps.',
    cap: '0.03', budget: '1', deposit: '0.6', gas: '1.2', rules: ['uni', 'pcs', 'unwrap'], caps: [[T.USDC, 5_000_000n], [T.WMON, parseEther('1')]], payees: false },
  { id: 'staker', name: 'Staker', emoji: '🥩', about: 'Stakes tiny amounts of MON into Kintsu (sMON), aPriori (aprMON) and Magma (gMON), wraps/unwraps WMON, and swaps a little on Kuru.',
    cap: '0.03', budget: '1', deposit: '0.5', gas: '1.0', rules: ['kintsu', 'apriori', 'magma', 'wrap', 'unwrap', 'kuru'], caps: [], payees: false },
  { id: 'payroll', name: 'Payroll', emoji: '💸', about: 'Pays small MON salaries to an allowlist of team-owned addresses.',
    cap: '0.03', budget: '1', deposit: '0.5', gas: '0.6', rules: [], caps: [], payees: true },
  { id: 'rogue', name: 'Rogue agent', emoji: '😈', about: 'Deliberately tries out-of-policy actions (over cap, strangers, draining tokens, paying itself, owner-only calls). Every attempt is sent on-chain and reverted by the vault.',
    cap: '0.01', budget: '0.02', deposit: '0.05', gas: '0.6', rules: ['uni'], caps: [], payees: true },
];

// ---- state ----
const st = fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : { agents: {} };
const save = () => { fs.mkdirSync(path.dirname(KEYS), { recursive: true }); fs.writeFileSync(KEYS, JSON.stringify(st, null, 1), { mode: 0o600 }); fs.chmodSync(KEYS, 0o600); };
for (const p of PERSONAS) if (!st.agents[p.id]) { st.agents[p.id] = { key: generatePrivateKey() }; save(); }
const acct = id => privateKeyToAccount(st.agents[id].key);
const wcOf = id => createWalletClient({ account: acct(id), chain, transport: http(RPC, { retryCount: 3, timeout: 20_000 }) });
const ledger = []; if (fs.existsSync(LEDGER)) for (const l of fs.readFileSync(LEDGER, 'utf8').split('\n')) if (l) ledger.push(JSON.parse(l));
const rec = e => { const x = { ts: new Date().toISOString(), ...e }; ledger.push(x); fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.appendFileSync(LEDGER, JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v) + '\n'); return x; };

async function holdings() {
  let t = await pc.getBalance({ address: owner.address });
  for (const p of PERSONAS) { t += await pc.getBalance({ address: acct(p.id).address }); if (st.agents[p.id].vault) t += await pc.getBalance({ address: st.agents[p.id].vault }); }
  return t;
}
async function consumed() { const h = await holdings(); return { h, used: BigInt(st.baseline) - h }; }

async function ownerTx(label, persona, to, data, value = 0n) {
  const gas = (await pc.estimateGas({ account: owner.address, to, data, value }) * 115n) / 100n;
  const hash = await ow.sendTransaction({ to, data, value, gas }); const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  log('owner', r.status, label, hash); rec({ persona, actor: 'owner', label, status: r.status === 'success' ? 'owner' : 'owner-failed', tx: hash, block: r.blockNumber, fee: r.gasUsed * r.effectiveGasPrice });
  if (r.status !== 'success') throw new Error('owner tx failed: ' + label); return r;
}
async function transfer(label, persona, to, value) {
  const hash = await ow.sendTransaction({ to, value, gas: 21000n }); const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  log('owner', r.status, label, hash); rec({ persona, actor: 'owner', label, status: 'owner', tx: hash, block: r.blockNumber, fee: r.gasUsed * r.effectiveGasPrice, value });
}

async function setup() {
  if (!st.baseline) { st.baseline = (await holdings()).toString(); st.startedAt = new Date().toISOString(); save(); log('baseline', formatEther(BigInt(st.baseline)), 'MON'); }
  const agentAddrs = PERSONAS.map(p => acct(p.id).address);
  for (const p of PERSONAS) {
    const a = st.agents[p.id];
    if (!a.vault) {
      const recipients = p.payees ? (p.id === 'payroll' ? [owner.address, ...agentAddrs.filter(x => x !== acct('payroll').address)] : [owner.address]) : [];
      const data = encodeFunctionData({ abi: agentVaultFactoryAbi, functionName: 'createVault', args: [acct(p.id).address, parseEther(p.cap), parseEther(p.budget), recipients, p.rules.map(rule), p.caps.map(([token, cap]) => ({ token, cap }))] });
      const r = await ownerTx(`Create ${p.name} vault (policy + deposit, 1 tx)`, p.id, FACTORY, data, parseEther(p.deposit));
      const vs = await pc.readContract({ address: FACTORY, abi: agentVaultFactoryAbi, functionName: 'vaultsOf', args: [owner.address] });
      a.vault = vs[vs.length - 1]; a.createdTx = r.transactionHash; save(); log(p.name, 'vault', a.vault);
    }
    const g = await pc.getBalance({ address: acct(p.id).address });
    if (g < parseEther(p.gas) / 4n) await transfer(`Fund ${p.name} agent gas`, p.id, acct(p.id).address, parseEther(p.gas) - g);
  }
}

const vread = (v, f, args) => pc.readContract({ address: v, abi: agentVaultAbi, functionName: f, args });
const tbal = (tok, who) => pc.readContract({ address: tok, abi: erc20, functionName: 'balanceOf', args: [who] });
const quote = async (router, tin, tout, amt) => { const [q, fee] = QUOTER[router]; const r = await pc.simulateContract({ address: q, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: tin, tokenOut: tout, amountIn: amt, fee, sqrtPriceLimitX96: 0n }] }); return [r.result[0], fee]; };
const swapCall = async (vault, router, tin, tout, amt, label) => { const [q, fee] = await quote(router, tin, tout, amt); const minOut = (q * 97n) / 100n;
  return { label, action: { kind: 'call', target: router, value: tin === T.WMON ? amt : 0n, data: encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: tin, tokenOut: tout, fee, recipient: vault, amountIn: amt, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }), opts: tin === T.WMON ? { outToken: tout, minOut } : { approveToken: tin, approveAmount: amt, outToken: tout, minOut } } }; };
const rnd = (lo, hi) => parseEther((lo + Math.random() * (hi - lo)).toFixed(4));

async function nextAction(p, round) {
  const v = st.agents[p.id].vault; const me = acct(p.id).address;
  if (p.id === 'dca') {
    const step = round % 5;
    if (step === 4) { const u = await tbal(T.USDC, v); if (u > 1000n) return swapCall(v, round % 10 === 4 ? UNI : PCS, T.USDC, T.WMON, u, `DCA bot takes profit: swaps ${Number(u) / 1e6} USDC → WMON`); }
    const w = await tbal(T.WMON, v); if (w > 0n) return { label: `DCA bot unwraps ${formatEther(w)} WMON → MON`, action: { kind: 'call', target: T.WMON, value: 0n, data: encodeFunctionData({ abi: wmonAbi, functionName: 'withdraw', args: [w] }), opts: { minOut: w } } };
    const amt = rnd(0.01, 0.02); const r = step % 2 ? PCS : UNI;
    return swapCall(v, r, T.WMON, T.USDC, amt, `DCA bot buys USDC with ${formatEther(amt)} MON on ${r === UNI ? 'Uniswap v3' : 'PancakeSwap v3'}`);
  }
  if (p.id === 'staker') {
    const amt = rnd(0.005, 0.012); const s = round % 6;
    if (s === 5) { const a3 = rnd(0.008, 0.015); const sim = await pc.simulateContract({ account: v, address: KURU, abi: kuruAbi, functionName: 'anyToAnySwap', args: [[KURU_MKT], [false], [true], ZERO_ADDRESS, T.USDC, a3, 1n], value: a3 }); const minOut = (sim.result * 97n) / 100n;
      return { label: `Staker swaps ${formatEther(a3)} MON → USDC on Kuru (order book)`, action: { kind: 'call', target: KURU, value: a3, data: encodeFunctionData({ abi: kuruAbi, functionName: 'anyToAnySwap', args: [[KURU_MKT], [false], [true], ZERO_ADDRESS, T.USDC, a3, minOut] }), opts: { outToken: T.USDC, minOut } } }; }
    if (s === 0) return { label: `Staker stakes ${formatEther(amt)} MON → sMON (Kintsu)`, action: { kind: 'call', target: T.sMON, value: amt, data: encodeFunctionData({ abi: kintsuAbi, functionName: 'deposit', args: [1n, v] }), opts: { outToken: T.sMON, minOut: 1n } } };
    if (s === 1) return { label: `Staker stakes ${formatEther(amt)} MON → aprMON (aPriori)`, action: { kind: 'call', target: T.aprMON, value: amt, data: encodeFunctionData({ abi: aprAbi, functionName: 'deposit', args: [amt, v] }), opts: { outToken: T.aprMON, minOut: 1n } } };
    if (s === 2) return { label: `Staker stakes ${formatEther(amt)} MON → gMON (Magma)`, action: { kind: 'call', target: T.gMON, value: amt, data: encodeFunctionData({ abi: magmaAbi, functionName: 'depositMON', args: [v, 0n] }), opts: { outToken: T.gMON, minOut: 1n } } };
    if (s === 3) { const a2 = rnd(0.01, 0.025); return { label: `Staker wraps ${formatEther(a2)} MON → WMON`, action: { kind: 'call', target: T.WMON, value: a2, data: encodeFunctionData({ abi: wmonAbi, functionName: 'deposit' }), opts: { outToken: T.WMON, minOut: a2 } } }; }
    const w = await tbal(T.WMON, v); if (w > 0n) return { label: `Staker unwraps ${formatEther(w)} WMON → MON`, action: { kind: 'call', target: T.WMON, value: 0n, data: encodeFunctionData({ abi: wmonAbi, functionName: 'withdraw', args: [w] }), opts: { minOut: w } } };
    return nextAction(p, round + 1);
  }
  if (p.id === 'payroll') {
    const payees = [owner.address, ...PERSONAS.filter(x => x.id !== 'payroll').map(x => acct(x.id).address)]; const to = payees[round % payees.length]; const amt = rnd(0.005, 0.025);
    const who = to === owner.address ? 'the team treasury' : `the ${PERSONAS.find(x => acct(x.id).address === to).name} agent`;
    return { label: `Payroll pays ${formatEther(amt)} MON to ${who}`, action: { kind: 'pay', recipient: to, amount: amt } };
  }
  // rogue: always out-of-policy
  const attacks = [
    () => ({ label: 'Rogue tries to pay 0.5 MON (50× its 0.01 per-action cap)', action: { kind: 'pay', recipient: owner.address, amount: parseEther('0.5') } }),
    () => ({ label: 'Rogue tries to pay a stranger (0x…dEaD)', action: { kind: 'pay', recipient: '0x000000000000000000000000000000000000dEaD', amount: parseEther('0.005') } }),
    () => ({ label: 'Rogue tries USDC.transfer() to itself (draining tokens)', action: { kind: 'call', target: T.USDC, value: 0n, data: encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [me, 1n] }) } }),
    () => ({ label: 'Rogue tries a Uniswap swap that pays itself instead of the vault', action: { kind: 'call', target: UNI, value: parseEther('0.005'), data: encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: T.WMON, tokenOut: T.USDC, fee: 3000, recipient: me, amountIn: parseEther('0.005'), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }) } }),
    () => ({ label: 'Rogue tries to withdraw the vault to itself (owner-only)', action: { kind: 'raw', data: encodeFunctionData({ abi: agentVaultAbi, functionName: 'withdraw', args: [me, parseEther('0.01')] }) } }),
    () => ({ label: 'Rogue tries to stake via Kintsu (not on its allowlist)', action: { kind: 'call', target: T.sMON, value: parseEther('0.005'), data: encodeFunctionData({ abi: kintsuAbi, functionName: 'deposit', args: [1n, v] }) } }),
    () => ({ label: 'Rogue tries to raise its own budget (owner-only)', action: { kind: 'raw', data: encodeFunctionData({ abi: agentVaultAbi, functionName: 'setBudget', args: [parseEther('100')] }) } }),
  ];
  return attacks[round % attacks.length]();
}

async function act(p, round) {
  const a = st.agents[p.id]; const ag = new VaultAgent(a.vault, pc, wcOf(p.id));
  let nx; try { nx = await nextAction(p, round); } catch (e) { log(p.name, 'build failed', e.shortMessage || e.message); return; }
  const isRogue = p.id === 'rogue';
  const r = await ag.run(nx.action, { broadcastBlocked: isRogue, blockedGas: 80_000n, gasBuffer: 1.12 });
  if (r.status === 'blocked' && !r.onchain) { log(p.name, 'skipped (would be blocked off-chain):', r.reason, nx.label); rec({ persona: p.id, actor: 'agent', label: nx.label, status: 'precheck-blocked', reason: r.reason }); return r; }
  const reason = r.status === 'blocked' ? `${r.reason}${r.args ? '(' + r.args.map(String).join(', ') + ')' : ''}` : undefined;
  log(p.name, r.status, nx.label, reason ?? '', `${EXP}/tx/${r.hash}`, `gas ${r.gasUsed}`);
  rec({ persona: p.id, actor: 'agent', label: nx.label, status: r.status, reason, tx: r.hash, block: r.blockNumber, gasUsed: r.gasUsed, fee: r.feeWei });
  return r;
}

async function maintain(p) {
  const a = st.agents[p.id]; if (p.id === 'rogue') return;
  const [bal, spent, budget] = await Promise.all([pc.getBalance({ address: a.vault }), vread(a.vault, 'totalSpent'), vread(a.vault, 'budget')]);
  if (budget - spent < parseEther('0.1')) await ownerTx(`Owner raises ${p.name} budget by 0.5 MON`, p.id, a.vault, encodeFunctionData({ abi: agentVaultAbi, functionName: 'setBudget', args: [budget + parseEther('0.5')] }));
  if (bal < parseEther('0.12')) {
    const [gc, td] = await Promise.all([pc.readContract({ address: FACTORY, abi: agentVaultFactoryAbi, functionName: 'globalCap' }), pc.readContract({ address: FACTORY, abi: agentVaultFactoryAbi, functionName: 'totalDeposited' })]);
    const room = gc - td - USER_HEADROOM; const amt = room >= parseEther('0.4') ? parseEther('0.4') : room >= parseEther('0.1') ? room : 0n;
    if (amt > 0n) await ownerTx(`Owner tops up ${p.name} vault with ${formatEther(amt)} MON`, p.id, a.vault, encodeFunctionData({ abi: agentVaultAbi, functionName: 'deposit' }), amt);
    else log(p.name, `no top-up: alpha global deposit cap nearly full (${formatEther(td)}/${formatEther(gc)} MON); keeping ${formatEther(USER_HEADROOM)} MON free for real users`);
  }
  const g = await pc.getBalance({ address: acct(p.id).address }); if (g < parseEther('0.15')) await transfer(`Top up ${p.name} agent gas`, p.id, acct(p.id).address, parseEther('0.4'));
}

function publish(extra = {}) {
  const c = s => ledger.filter(x => x.actor === 'agent' && x.status === s).length;
  const per = Object.fromEntries(PERSONAS.map(p => [p.id, { allowed: ledger.filter(x => x.persona === p.id && x.status === 'allowed').length, blocked: ledger.filter(x => x.persona === p.id && x.status === 'blocked').length }]));
  const out = { label: 'PolicyPilot showcase agents (operated by the team)', note: 'These vaults and agent keys are run by the PolicyPilot team to demonstrate the product. They are not external users.', chainId: CID, explorer: EXP, factory: FACTORY, owner: owner.address, startedAt: st.startedAt, updatedAt: new Date().toISOString(),
    totals: { allowed: c('allowed'), blocked: c('blocked'), ownerTxs: ledger.filter(x => x.actor === 'owner').length, monConsumed: extra.used != null ? formatEther(extra.used) : st.lastUsed },
    agents: PERSONAS.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, about: p.about, vault: st.agents[p.id].vault, agent: acct(p.id).address, perActionCapMON: p.cap, ...per[p.id] })),
    recent: ledger.filter(x => x.tx).slice(-60).reverse().map(x => ({ ts: x.ts, persona: x.persona, actor: x.actor, label: x.label, status: x.status, reason: x.reason, tx: x.tx })), status: extra.status || 'running' };
  if (extra.used != null) { st.lastUsed = formatEther(extra.used); save(); }
  fs.writeFileSync(PUB, JSON.stringify(out, null, 1));
}

async function recover() {
  log('recovering…');
  for (const p of PERSONAS) {
    const a = st.agents[p.id]; if (!a.vault) continue;
    for (const [sym, tok] of Object.entries(T)) { const b = await tbal(tok, a.vault).catch(() => 0n); if (b > 0n) await ownerTx(`Owner pulls ${sym} out of ${p.name} vault`, p.id, a.vault, encodeFunctionData({ abi: agentVaultAbi, functionName: 'withdrawToken', args: [tok, owner.address, b] })).catch(e => log('withdrawToken failed', sym, e.message)); }
    if (await pc.getBalance({ address: a.vault }) > 0n) await ownerTx(`Owner pulls all MON out of ${p.name} vault (kill-switch)`, p.id, a.vault, encodeFunctionData({ abi: agentVaultAbi, functionName: 'emergencyWithdrawAll' })).catch(e => log('emergency failed', e.message));
    const w = wcOf(p.id); const g = await pc.getBalance({ address: w.account.address }); const gp = await pc.getGasPrice();
    const gl = await pc.estimateGas({ account: w.account.address, to: owner.address, value: 1n }).catch(() => 21000n); const fee = gl * gp * 2n;
    if (g > fee) { const hash = await w.sendTransaction({ to: owner.address, value: g - fee, gas: gl, maxFeePerGas: gp * 2n, maxPriorityFeePerGas: gp / 50n }).catch(e => log('sweep failed', p.name, e.shortMessage)); if (hash) { const r = await pc.waitForTransactionReceipt({ hash }); rec({ persona: p.id, actor: 'agent-sweep', label: `Return ${p.name} agent gas to the owner`, status: r.status === 'success' ? 'owner' : 'owner-failed', tx: hash }); log('sweep', r.status, p.name, hash); } }
  }
  // token balances now held by the owner (not counted as recovered MON — conservative)
  const toks = {}; for (const [s, t] of Object.entries(T)) toks[s] = (await tbal(t, owner.address)).toString(); st.ownerTokensAfter = toks; save();
}

const cmd = process.argv[2] || 'run';
if (cmd === 'status') { const { h, used } = await consumed(); console.log(JSON.stringify({ holdings: formatEther(h), used: formatEther(used), stopAt: formatEther(STOP_AT), vaults: PERSONAS.map(p => [p.id, st.agents[p.id].vault, acct(p.id).address]) }, null, 1)); process.exit(0); }
if (cmd === 'recover') { await recover(); const { used } = await consumed(); publish({ used, status: 'stopped' }); log('final consumed', formatEther(used)); process.exit(0); }

await setup();
const deadline = Date.now() + HOURS * 3600e3; let round = st.round || 0; let stopReason = 'deadline';
fs.writeFileSync(path.join(path.dirname(KEYS), `showcase-${TAG}.pid`), String(process.pid));
let stopFile = path.join(path.dirname(KEYS), `showcase-${TAG}.stop`);
outer: while (Date.now() < deadline) {
  for (const p of PERSONAS) {
    if (fs.existsSync(stopFile)) { stopReason = 'stop file'; break outer; }
    const { used } = await consumed();
    const ob = await pc.getBalance({ address: owner.address });
    if (ob < RESERVE + parseEther('1')) { stopReason = `owner reserve: deployer balance ${formatEther(ob)} MON would approach the ${formatEther(RESERVE)} MON reserve`; break outer; }
    if (used + parseEther('0.3') >= STOP_AT) { stopReason = `spend cap: ${formatEther(used)} MON consumed (stop at ${formatEther(STOP_AT)} incl. 0.3 MON reserve for recovery)`; break outer; }
    try { await within(maintain(p), 300_000, 'maintain'); await within(act(p, round), 300_000, 'act'); } catch (e) { log(p.name, 'error', e.shortMessage || e.message); rec({ persona: p.id, actor: 'runner', status: 'error', label: String(e.shortMessage || e.message).slice(0, 200) }); await sleep(5000); }
  }
  round++; st.round = round; save();
  const { used } = await within(consumed(), 120_000, 'consumed'); publish({ used }); fs.writeFileSync(path.join(path.dirname(KEYS), `showcase-${TAG}.heartbeat`), new Date().toISOString()); log(`round ${round} done · consumed ${formatEther(used)} MON`);
  if (round > BURST) await sleep(INTERVAL);
}
log('STOP:', stopReason); st.stopReason = stopReason; save();
await recover(); const { used } = await consumed(); publish({ used, status: `stopped (${stopReason})` }); log('FINAL consumed', formatEther(used), 'MON');
