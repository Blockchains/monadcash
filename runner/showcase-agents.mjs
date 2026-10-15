// PolicyPilot showcase agents: real autonomous agents operated BY THE TEAM against AgentVaults on Monad.
// Each persona gets its own vault (created via the factory) and its own agent key. The vault enforces
// the policy on-chain; the runner just tries things. Spend tracking with a hard auto-stop, then recovery.
//
//   OWNER_ENV=~/.policypilot/mainnet-wallet.env  (MONAD_MAINNET_PRIVATE_KEY) — never logged
//   RPC, FACTORY, CHAIN_ID, STOP_AT (total MON consumed, default 1000), OWNER_RESERVE (deployer never drops below, default 5), USER_HEADROOM (global-cap room left for users, default 1), HOURS, INTERVAL_S, BURST_ROUNDS
//   node runner/showcase-agents.mjs [run|recover|status]
//
// GitHub Actions mode (AGENTS_ONLY=1): agent keys only (AGENT_KEY_<ID> secrets), vault addresses from the committed
// public config. `run` performs ONE round over ALL personas (each in its own try/catch), `check` is a keyless health
// check, `publish` rebuilds the public snapshot from the ledger. Looping is done by runner/showcase-loop.sh.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, encodeFunctionData, decodeFunctionResult, decodeAbiParameters, parseAbi, keccak256, toHex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { VaultAgent, agentVaultAbi, agentVaultFactoryAbi, ZERO_ADDRESS } from '../packages/agent-kit/dist/index.js';

const HOME = os.homedir(); const E = process.env;
const RPC = E.RPC || 'https://rpc.monad.xyz'; const CID = Number(E.CHAIN_ID || 143);
const FACTORY = E.FACTORY || '0x52727226aF0efe2bfe3E5c97e46B704613344a92'; // v3 (1000 MON vault cap, 100000 MON global). New creates only.
const LEGACY_FACTORIES = (E.LEGACY_FACTORIES || '0x0342d29055d77ba155c50233f550539E3029BA6a,0x8738B74778502ff3623A8319837A819d8dBdEeB7').split(',').filter(Boolean); // v2, then v1
const STOP_AT = parseEther(E.STOP_AT || '1000'); const RESERVE = parseEther(E.OWNER_RESERVE || '5'); // never let the deployer drop below this
const USER_HEADROOM = parseEther(E.USER_HEADROOM || '1'); // alpha global deposit cap kept free for real users
const HOURS = Number(E.HOURS || 4); const INTERVAL = Number(E.INTERVAL_S || 240) * 1000;
const BURST = Number(E.BURST_ROUNDS || 8); const TAG = E.TAG || String(CID);
const KEYS = E.KEYS_FILE || path.join(HOME, `.policypilot/showcase-agents-${TAG}.json`);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PUB = E.PUBLIC_OUT || path.resolve(HERE, `../web/public/showcase-agents-${TAG}.json`);
const LEDGER = E.LEDGER || `/workspace/policypilot/evidence/showcase-ledger-${TAG}.jsonl`;
const EXP = 'https://monadvision.com';
const AGENTS_ONLY = E.AGENTS_ONLY === '1'; // GitHub Actions mode: agent keys only, never the deployer key
const DRY_RUN = E.DRY_RUN === '1'; // build + simulate every action, send nothing, write nothing
const CFG_FILE = E.CONFIG || path.resolve(HERE, `showcase-config-${CID}.json`);
const cmd = process.argv[2] || 'run';
const readCfg = () => JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
const ownerKey = AGENTS_ONLY ? null : (E.OWNER_KEY || Object.fromEntries(fs.readFileSync((E.OWNER_ENV || '~/.policypilot/mainnet-wallet.env').replace('~', HOME), 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0, 2).map(s => s.trim())))['MONAD_MAINNET_PRIVATE_KEY']);
const chain = { id: CID, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pc = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 800, timeout: 20_000 }) });
const owner = AGENTS_ONLY ? { address: readCfg().owner } : privateKeyToAccount(ownerKey);
const ow = AGENTS_ONLY ? null : createWalletClient({ account: owner, chain, transport: http(RPC, { retryCount: 3, timeout: 20_000 }) });
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`watchdog: ${what} took > ${ms / 1000}s`)), ms))]);
const errMsg = e => String(e?.shortMessage || e?.message || e).split('\n')[0].slice(0, 200);

// ---- verified mainnet addresses (same as web/src/lib/services.ts; all fork-tested) ----
const T = { WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', sMON: '0xA3227C5969757783154C60bF0bC1944180ed81B9', aprMON: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', gMON: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081' };
const UNI = '0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900', PCS = '0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C';
const QUOTER = { [UNI]: ['0x661e93cca42afacb172121ef892830ca3b70f08d', 3000], [PCS]: ['0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', 500] };
// Kuru: https://docs.kuru.io/contracts/Contract-addresses (fork-tested: test_fork_kuru_mon_to_usdc)
const KURU = '0xd651346d7c789536ebf06dc72aE3C8502cd695CC', KURU_MKT = '0x065C9d28E428A0db40191a54d33d5b7c71a9C394';
const R = { kuru: [KURU, '0xffa5210a', 255], uni: [UNI, '0x04e45aaf', 3], pcs: [PCS, '0x04e45aaf', 3], kintsu: [T.sMON, '0x1c3477dd', 1], apriori: [T.aprMON, '0x6e553f65', 1], magma: [T.gMON, '0x5f3896d3', 0], wrap: [T.WMON, '0xd0e30db0', 255], unwrap: [T.WMON, '0x2e1a7d4d', 255] };
const routerAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)']);
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const wmonAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256)']);
const kintsuAbi = parseAbi(['function deposit(uint96 minShares,address receiver) payable returns (uint96)']);
const aprAbi = parseAbi(['function deposit(uint256 assets,address receiver) payable returns (uint256)']);
const magmaAbi = parseAbi(['function depositMON(address receiver,uint256 referralId) payable']);
const kuruAbi = parseAbi(['function anyToAnySwap(address[] markets,bool[] isBuy,bool[] nativeSend,address debitToken,address creditToken,uint256 amount,uint256 minAmountOut) payable returns (uint256)']);
const rule = k => ({ target: R[k][0], selector: R[k][1], recipientWord: R[k][2] });

// `attack` personas deliberately send out-of-policy actions and broadcast the reverts; everyone else only sends what passes.
const PERSONAS = [
  { id: 'dca', name: 'DCA bot', emoji: '📈', about: 'Buys a little USDC with MON on Uniswap and PancakeSwap every round, then periodically swaps it back to MON and unwraps.',
    cap: '0.03', budget: '5', deposit: '0.9', gas: '1.0', rules: ['uni', 'pcs', 'unwrap'], caps: [[T.USDC, 5_000_000n], [T.WMON, parseEther('1')]], payees: false },
  { id: 'staker', name: 'Staker', emoji: '🥩', about: 'Stakes tiny amounts of MON into Kintsu (sMON), aPriori (aprMON) and Magma (gMON), wraps/unwraps WMON, and swaps a little on Kuru.',
    cap: '0.03', budget: '5', deposit: '0.9', gas: '1.0', rules: ['kintsu', 'apriori', 'magma', 'wrap', 'unwrap', 'kuru'], caps: [], payees: false },
  { id: 'payroll', name: 'Payroll', emoji: '💸', about: 'Pays small MON salaries to an allowlist of team-owned addresses.',
    cap: '0.03', budget: '5', deposit: '0.9', gas: '0.8', rules: [], caps: [], payees: true },
  { id: 'rogue', name: 'Rogue agent', emoji: '😈', about: 'Deliberately tries out-of-policy actions (over cap, strangers, draining tokens, paying itself, owner-only calls). Every attempt is sent on-chain and reverted by the vault.',
    cap: '0.01', budget: '0.02', deposit: '0.05', gas: '0.8', rules: ['uni'], caps: [], payees: true, attack: true },
  ...(E.LEGACY_DCA === '0' ? [] : [{ id: 'dca1', legacy: true, name: 'DCA bot (v1 vault)', emoji: '📉', about: 'The original DCA bot on the first (legacy) factory: same strategy, no owner top-ups.',
    cap: '0.03', budget: '1', deposit: '0', gas: '0', rules: ['uni', 'pcs', 'unwrap'], caps: [], payees: false }]),
  // ---- new personas (vaults + AGENT_KEY_<ID> secrets are created by the owner; until then they are skipped with a logged reason) ----
  { id: 'mm', name: 'Kuru market maker', emoji: '📗', about: 'Two-sided flow on Kuru’s on-chain order book: sells a clip of MON for USDC, then buys MON back with the USDC (approval capped by the vault), round after round.',
    cap: '0.03', budget: '5', deposit: '0.9', gas: '1.0', rules: ['kuru', 'uni', 'unwrap'], caps: [[T.USDC, 5_000_000n], [T.WMON, parseEther('1')]], payees: false },
  { id: 'rebalancer', name: 'Wrap/unwrap rebalancer', emoji: '⚖️', about: 'Keeps the vault near a 50/50 split of MON and WMON: wraps when WMON is short, unwraps when it is long. Only WMON.deposit/withdraw are allowlisted.',
    cap: '0.03', budget: '5', deposit: '0.9', gas: '0.8', rules: ['wrap', 'unwrap'], caps: [], payees: false },
  { id: 'tipper', name: 'Tipper', emoji: '🪙', about: 'Streams micro-tips (0.001–0.004 MON) to an allowlist of team addresses. A tiny per-action cap makes anything bigger impossible.',
    cap: '0.005', budget: '2', deposit: '0.5', gas: '0.6', rules: [], caps: [], payees: true },
  { id: 'tester', name: 'Policy tester', emoji: '🧪', about: 'Probes the exact edges of its policy: wraps exactly the cap (allowed), then cap + 1 wei (blocked), replays a used requestId (blocked), swaps on Uniswap with the output sent to itself (blocked), pays a stranger (blocked). Blocked attempts are broadcast so the revert is public.',
    cap: '0.01', budget: '2', deposit: '0.5', gas: '0.8', rules: ['wrap', 'unwrap', 'uni'], caps: [[T.WMON, parseEther('1')]], payees: true, attack: true },
];
const byId = id => PERSONAS.find(p => p.id === id);

// ---- state ----
const st = !AGENTS_ONLY && fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : { agents: {} };
const save = () => { if (AGENTS_ONLY) return; fs.mkdirSync(path.dirname(KEYS), { recursive: true }); fs.writeFileSync(KEYS, JSON.stringify(st, null, 1), { mode: 0o600 }); fs.chmodSync(KEYS, 0o600); };
const cfgAgent = id => (AGENTS_ONLY ? readCfg().agents.find(x => x.id === id) : null);
if (AGENTS_ONLY) { // keys come only from env (encrypted Actions secrets); vault addresses from the committed public config
  const cfg = readCfg(); st.agents = {}; st.startedAt = cfg.startedAt;
  for (const p of PERSONAS) { const secret = `AGENT_KEY_${p.id.toUpperCase()}`; const k = E[secret]; const c = cfg.agents.find(x => x.id === p.id); st.agents[p.id] = { key: k || null, vault: c?.vault || null, secret, skip: k ? null : `secret ${secret} not configured (persona pending)` }; }
}
for (const p of PERSONAS) if (!st.agents[p.id]) { if (AGENTS_ONLY) continue; st.agents[p.id] = { key: generatePrivateKey() }; save(); }
const hasKey = id => !!st.agents[id]?.key;
const acct = id => privateKeyToAccount(st.agents[id].key);
const agentAddr = id => (hasKey(id) ? acct(id).address : (cfgAgent(id)?.agent || null));
const wcOf = id => createWalletClient({ account: acct(id), chain, transport: http(RPC, { retryCount: 3, timeout: 20_000 }) });
const ledger = []; if (fs.existsSync(LEDGER)) for (const l of fs.readFileSync(LEDGER, 'utf8').split('\n')) if (l) ledger.push(JSON.parse(l));
const rec = e => { const x = { ts: new Date().toISOString(), ...e }; ledger.push(x); if (DRY_RUN) return x; fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.appendFileSync(LEDGER, JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v) + '\n'); return x; };
const lastOf = id => [...ledger].reverse().find(x => x.persona === id && (x.actor === 'agent' || x.actor === 'runner'));
/** Skips are logged to the ledger once per reason (not every round), so the ledger shows *why* a persona is idle without flooding. */
const sameReason = (a, b) => String(a ?? '').replace(/[\d.]+/g, '#') === String(b ?? '').replace(/[\d.]+/g, '#'); // ignore fluctuating amounts
function skip(p, reason) { const l = lastOf(p.id); log(p.name, 'skip:', reason); if (l?.status === 'skipped' && sameReason(l.reason, reason)) return; rec({ persona: p.id, actor: 'runner', status: 'skipped', label: `${p.name} skipped: ${reason}`, reason }); }
const roundOf = id => ledger.filter(x => x.persona === id && x.actor === 'agent').length; // per-persona step counter that survives restarts

async function holdings() {
  let t = await pc.getBalance({ address: owner.address });
  for (const p of PERSONAS) { if (!hasKey(p.id)) continue; t += await pc.getBalance({ address: acct(p.id).address }); if (st.agents[p.id].vault) t += await pc.getBalance({ address: st.agents[p.id].vault }); }
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
      const recipients = p.payees ? (['payroll', 'tipper'].includes(p.id) ? [owner.address, ...agentAddrs.filter(x => x !== acct(p.id).address)] : [owner.address]) : [];
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
const minBig = (a, b) => (a < b ? a : b);
const wrapCall = (amt, label) => ({ label, action: { kind: 'call', target: T.WMON, value: amt, data: encodeFunctionData({ abi: wmonAbi, functionName: 'deposit' }), opts: { outToken: T.WMON, minOut: amt } } });
const unwrapCall = (w, label) => ({ label, action: { kind: 'call', target: T.WMON, value: 0n, data: encodeFunctionData({ abi: wmonAbi, functionName: 'withdraw', args: [w] }), opts: { minOut: w } } });
/** Kuru MON → USDC (sell base for quote). Quoted with a plain simulation from the vault. */
async function kuruSell(v, amt, label) {
  const sim = await pc.simulateContract({ account: v, address: KURU, abi: kuruAbi, functionName: 'anyToAnySwap', args: [[KURU_MKT], [false], [true], ZERO_ADDRESS, T.USDC, amt, 1n], value: amt }); const minOut = (sim.result * 97n) / 100n;
  return { label, action: { kind: 'call', target: KURU, value: amt, data: encodeFunctionData({ abi: kuruAbi, functionName: 'anyToAnySwap', args: [[KURU_MKT], [false], [true], ZERO_ADDRESS, T.USDC, amt, minOut] }), opts: { outToken: T.USDC, minOut } } };
}
/** Kuru USDC → MON (buy base with quote). The router pulls USDC via transferFrom, so this is quoted THROUGH the vault
 *  (eth_call of executeCall from the agent: the vault's exact approval + call + reset happen in the simulation). */
async function kuruBuy(vault, agent, usdc, label) {
  const data = encodeFunctionData({ abi: kuruAbi, functionName: 'anyToAnySwap', args: [[KURU_MKT], [true], [false], T.USDC, ZERO_ADDRESS, usdc, 1n] });
  const opts = { approveToken: T.USDC, approveAmount: usdc, outToken: ZERO_ADDRESS, minOut: 1n };
  const call = encodeFunctionData({ abi: agentVaultAbi, functionName: 'executeCall', args: [keccak256(toHex(`kuru-quote:${Date.now()}`)), KURU, 0n, data, opts] });
  const ret = await pc.call({ account: agent, to: vault, data: call });
  const bytesOut = decodeFunctionResult({ abi: agentVaultAbi, functionName: 'executeCall', data: ret.data }); // executeCall returns the dapp's raw return data
  const [out] = decodeAbiParameters([{ type: 'uint256' }], bytesOut); const minOut = (out * 97n) / 100n;
  return { label: label(out), action: { kind: 'call', target: KURU, value: 0n, data: encodeFunctionData({ abi: kuruAbi, functionName: 'anyToAnySwap', args: [[KURU_MKT], [true], [false], T.USDC, ZERO_ADDRESS, usdc, minOut] }), opts: { ...opts, minOut } } };
}
async function allowedPayees(v, candidates) { const out = []; for (const c of candidates) if (c && await vread(v, 'allowedRecipient', [c]).catch(() => false)) out.push(c); return out; }

async function nextAction(p, round) {
  const v = st.agents[p.id].vault; const me = agentAddr(p.id); const [cap0, bal] = await Promise.all([vread(v, 'perPaymentCap'), pc.getBalance({ address: v })]);
  const cap = minBig(cap0, bal); // never ask for more MON than the vault holds: a precheck-blocked round is a wasted round
  const needMon = () => { if (cap === 0n) throw Object.assign(new Error('vault holds no MON for a value action (owner must deposit)'), { skip: true }); };
  if (p.id.startsWith('dca')) {
    const step = round % 5;
    if (step === 4) { const u = await tbal(T.USDC, v); if (u > 1000n) return swapCall(v, round % 10 === 4 ? UNI : PCS, T.USDC, T.WMON, u, `DCA bot takes profit: swaps ${Number(u) / 1e6} USDC → WMON`); }
    const w = await tbal(T.WMON, v); if (w > 0n) return unwrapCall(w, `DCA bot unwraps ${formatEther(w)} WMON → MON`);
    needMon(); const amt = minBig(rnd(0.01, 0.02), cap); const r = step % 2 ? PCS : UNI;
    return swapCall(v, r, T.WMON, T.USDC, amt, `DCA bot buys USDC with ${formatEther(amt)} MON on ${r === UNI ? 'Uniswap v3' : 'PancakeSwap v3'}`);
  }
  if (p.id === 'staker') {
    const amt = minBig(rnd(0.005, 0.012), cap); const s = round % 6;
    if (s !== 4) needMon(); // step 4 (unwrap) needs no MON
    if (s === 5) { const a3 = minBig(rnd(0.008, 0.015), cap); return kuruSell(v, a3, `Staker swaps ${formatEther(a3)} MON → USDC on Kuru (order book)`); }
    if (s === 0) return { label: `Staker stakes ${formatEther(amt)} MON → sMON (Kintsu)`, action: { kind: 'call', target: T.sMON, value: amt, data: encodeFunctionData({ abi: kintsuAbi, functionName: 'deposit', args: [1n, v] }), opts: { outToken: T.sMON, minOut: 1n } } };
    if (s === 1) return { label: `Staker stakes ${formatEther(amt)} MON → aprMON (aPriori)`, action: { kind: 'call', target: T.aprMON, value: amt, data: encodeFunctionData({ abi: aprAbi, functionName: 'deposit', args: [amt, v] }), opts: { outToken: T.aprMON, minOut: 1n } } };
    if (s === 2) return { label: `Staker stakes ${formatEther(amt)} MON → gMON (Magma)`, action: { kind: 'call', target: T.gMON, value: amt, data: encodeFunctionData({ abi: magmaAbi, functionName: 'depositMON', args: [v, 0n] }), opts: { outToken: T.gMON, minOut: 1n } } };
    if (s === 3) { const a2 = minBig(rnd(0.01, 0.025), cap); return wrapCall(a2, `Staker wraps ${formatEther(a2)} MON → WMON`); }
    const w = await tbal(T.WMON, v); if (w > 0n) return unwrapCall(w, `Staker unwraps ${formatEther(w)} WMON → MON`);
    return nextAction(p, round + 1);
  }
  if (p.id === 'payroll' || p.id === 'tipper') {
    const candidates = [owner.address, ...PERSONAS.filter(x => x.id !== p.id).map(x => agentAddr(x.id))];
    const payees = await allowedPayees(v, candidates); if (!payees.length) throw Object.assign(new Error('no allowlisted payee among the team addresses (owner must setRecipient)'), { skip: true });
    needMon(); const to = payees[round % payees.length]; const amt = p.id === 'tipper' ? minBig(rnd(0.001, 0.004), cap) : minBig(rnd(0.005, 0.025), cap);
    const who = to === owner.address ? 'the team treasury' : `the ${PERSONAS.find(x => agentAddr(x.id) === to)?.name ?? 'team'} agent`;
    return { label: `${p.name} ${p.id === 'tipper' ? 'tips' : 'pays'} ${formatEther(amt)} MON to ${who}`, action: { kind: 'pay', recipient: to, amount: amt } };
  }
  if (p.id === 'mm') {
    const u = await tbal(T.USDC, v);
    if (round % 2 === 1 && u >= 100n) { // buy side: USDC → MON on Kuru; if the order book can't fill, take the USDC back to MON via Uniswap + unwrap
      try { return await kuruBuy(v, me, u, out => `Market maker buys ${formatEther(out)} MON with ${Number(u) / 1e6} USDC on Kuru (order book)`); }
      catch (e) { log(p.name, 'Kuru buy side unavailable, falling back to Uniswap:', errMsg(e)); const w = await tbal(T.WMON, v); if (w > 0n) return unwrapCall(w, `Market maker unwraps ${formatEther(w)} WMON → MON`); return swapCall(v, UNI, T.USDC, T.WMON, u, `Market maker swaps ${Number(u) / 1e6} USDC → WMON on Uniswap v3 (Kuru buy side unavailable)`); }
    }
    const w = await tbal(T.WMON, v); if (w > 0n) return unwrapCall(w, `Market maker unwraps ${formatEther(w)} WMON → MON`);
    needMon(); const amt = minBig(rnd(0.004, 0.009), cap); return kuruSell(v, amt, `Market maker sells ${formatEther(amt)} MON → USDC on Kuru (order book)`);
  }
  if (p.id === 'rebalancer') {
    const [b, w] = await Promise.all([pc.getBalance({ address: v }), tbal(T.WMON, v)]); const target = (b + w) / 2n;
    const clamp = x => minBig(x < parseEther('0.002') ? parseEther('0.002') : x > parseEther('0.02') ? parseEther('0.02') : x, cap);
    if (w < target) { const amt = clamp(target - w); return wrapCall(amt, `Rebalancer wraps ${formatEther(amt)} MON → WMON (WMON ${formatEther(w)} < target ${formatEther(target)})`); }
    const amt = minBig(clamp(w - target), w); if (amt === 0n) throw Object.assign(new Error('nothing to rebalance (vault holds no MON or WMON)'), { skip: true });
    return unwrapCall(amt, `Rebalancer unwraps ${formatEther(amt)} WMON → MON (WMON ${formatEther(w)} > target ${formatEther(target)})`);
  }
  if (p.id === 'tester') {
    const s = round % 6; const idOf = n => keccak256(toHex(`tester:${v}:${n}`));
    const w = await tbal(T.WMON, v);
    if (s === 0) { const x = wrapCall(cap0, `Policy tester wraps exactly the ${formatEther(cap0)} MON cap (boundary: allowed)`); x.action.requestId = idOf(round); return x; }
    if (s === 1) return { label: `Policy tester wraps cap + 1 wei (${formatEther(cap0 + 1n)} MON): expects PerPaymentCapExceeded`, expectBlocked: true, action: wrapCall(cap0 + 1n).action };
    if (s === 2) { const x = wrapCall(parseEther('0.001'), 'Policy tester replays the requestId of its last allowed call: expects RequestAlreadyExecuted'); x.action.requestId = idOf(round - 2); return { ...x, expectBlocked: true }; }
    if (s === 3) return { label: 'Policy tester swaps on Uniswap with the output sent to itself: expects RecipientMustBeVault', expectBlocked: true, action: { kind: 'call', target: UNI, value: parseEther('0.001'), data: encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: T.WMON, tokenOut: T.USDC, fee: 3000, recipient: me, amountIn: parseEther('0.001'), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }) } };
    if (s === 4) return { label: 'Policy tester pays a stranger (0x…dEaD): expects RecipientNotAllowed', expectBlocked: true, action: { kind: 'pay', recipient: '0x000000000000000000000000000000000000dEaD', amount: parseEther('0.001') } };
    if (w > 0n) return unwrapCall(w, `Policy tester unwraps ${formatEther(w)} WMON → MON (allowed)`);
    return nextAction(p, round + 1);
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
  return { ...attacks[round % attacks.length](), expectBlocked: true };
}

async function act(p, round) {
  const a = st.agents[p.id]; const ag = new VaultAgent(a.vault, pc, wcOf(p.id));
  let nx; try { nx = await nextAction(p, round); } catch (e) { if (e.skip) { skip(p, e.message); return; } log(p.name, 'build failed', errMsg(e)); rec({ persona: p.id, actor: 'runner', status: 'error', label: `${p.name}: could not build action: ${errMsg(e)}` }); return; }
  if (DRY_RUN) { const sim = await ag.simulate(nx.action); log('[dry-run]', p.name, nx.label, '→', sim.ok ? `would pass (gas ${sim.gas})` : `would be blocked: ${sim.error}${sim.args ? '(' + sim.args.map(String).join(', ') + ')' : ''}`); return { status: sim.ok ? 'allowed' : 'blocked', dry: true, expectBlocked: !!nx.expectBlocked }; }
  const r = await ag.run(nx.action, { broadcastBlocked: !!nx.expectBlocked, blockedGas: 80_000n, gasBuffer: 1.12 });
  if (r.status === 'blocked' && !r.onchain) { log(p.name, 'skipped (would be blocked off-chain):', r.reason, nx.label); rec({ persona: p.id, actor: 'agent', label: nx.label, status: 'precheck-blocked', reason: r.reason }); return r; }
  const reason = r.status === 'blocked' ? `${r.reason}${r.args ? '(' + r.args.map(String).join(', ') + ')' : ''}` : undefined;
  log(p.name, r.status, nx.label, reason ?? '', `${EXP}/tx/${r.hash}`, `gas ${r.gasUsed}`);
  rec({ persona: p.id, actor: 'agent', label: nx.label, status: r.status, reason, tx: r.hash, block: r.blockNumber, gasUsed: r.gasUsed, fee: r.feeWei });
  return r;
}

async function maintain(p) {
  const a = st.agents[p.id]; if (p.attack || p.legacy || AGENTS_ONLY) return;
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
  const per = Object.fromEntries(PERSONAS.map(p => { const l = lastOf(p.id); return [p.id, { allowed: ledger.filter(x => x.persona === p.id && x.status === 'allowed').length, blocked: ledger.filter(x => x.persona === p.id && x.status === 'blocked').length, lastSkip: l?.status === 'skipped' ? { ts: l.ts, reason: l.reason } : undefined }]; }));
  const out = { label: 'PolicyPilot showcase agents (operated by the team)', note: 'These vaults and agent keys are run by the PolicyPilot team to demonstrate the product. They are not external users.', chainId: CID, explorer: EXP, factory: FACTORY, legacyFactories: LEGACY_FACTORIES, owner: owner.address, startedAt: st.startedAt, updatedAt: new Date().toISOString(),
    totals: { allowed: c('allowed'), blocked: c('blocked'), ownerTxs: ledger.filter(x => x.actor === 'owner').length, skipped: ledger.filter(x => x.status === 'skipped').length, monConsumed: AGENTS_ONLY ? undefined : (extra.used != null ? formatEther(extra.used) : st.lastUsed) },
    agents: PERSONAS.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, about: p.about, vault: st.agents[p.id].vault || null, agent: agentAddr(p.id), perActionCapMON: p.cap, pending: !st.agents[p.id].vault, ...per[p.id] })),
    recent: ledger.filter(x => x.tx).slice(-60).reverse().map(x => ({ ts: x.ts, persona: x.persona, actor: x.actor, label: x.label, status: x.status, reason: x.reason, tx: x.tx })), status: extra.status || 'running' };
  if (extra.used != null) { st.lastUsed = formatEther(extra.used); save(); }
  if (DRY_RUN) return out;
  fs.writeFileSync(PUB, JSON.stringify(out, null, 1));
  if (!AGENTS_ONLY) fs.writeFileSync(CFG_FILE, JSON.stringify({ note: 'Public config for the GitHub Actions showcase runner (no keys). Keys live only in encrypted Actions secrets AGENT_KEY_<ID>. The runner verifies on-chain that each key is the executor of its vault and otherwise looks the vault up by executor across the v3 factory and the v2 and v1 factories.', chainId: CID, factory: FACTORY, legacyFactories: LEGACY_FACTORIES, owner: owner.address, startedAt: st.startedAt, agents: PERSONAS.map(p => ({ id: p.id, name: p.name, vault: st.agents[p.id].vault, agent: acct(p.id).address, secret: `AGENT_KEY_${p.id.toUpperCase()}` })) }, null, 1));
  return out;
}

async function recover() {
  log('recovering…');
  for (const p of PERSONAS) {
    const a = st.agents[p.id]; if (!a.vault || p.legacy) continue; // legacy vaults are left alone
    for (const [sym, tok] of Object.entries(T)) { const b = await tbal(tok, a.vault).catch(() => 0n); if (b > 0n) await ownerTx(`Owner pulls ${sym} out of ${p.name} vault`, p.id, a.vault, encodeFunctionData({ abi: agentVaultAbi, functionName: 'withdrawToken', args: [tok, owner.address, b] })).catch(e => log('withdrawToken failed', sym, e.message)); }
    // withdraw(owner, balance), never emergencyWithdrawAll: that one pauses the vault and the agents would then be stuck
    if (await pc.getBalance({ address: a.vault }) > 0n) await ownerTx(`Owner pulls all MON out of ${p.name} vault (no pause)`, p.id, a.vault, encodeFunctionData({ abi: agentVaultAbi, functionName: 'withdraw', args: [owner.address, await pc.getBalance({ address: a.vault })] })).catch(e => log('withdraw failed', e.message));
    const w = wcOf(p.id); const g = await pc.getBalance({ address: w.account.address }); const gp = await pc.getGasPrice();
    const gl = await pc.estimateGas({ account: w.account.address, to: owner.address, value: 1n }).catch(() => 21000n); const fee = gl * gp * 2n;
    if (g > fee) { const hash = await w.sendTransaction({ to: owner.address, value: g - fee, gas: gl, maxFeePerGas: gp * 2n, maxPriorityFeePerGas: gp / 50n }).catch(e => log('sweep failed', p.name, e.shortMessage)); if (hash) { const r = await pc.waitForTransactionReceipt({ hash }); rec({ persona: p.id, actor: 'agent-sweep', label: `Return ${p.name} agent gas to the owner`, status: r.status === 'success' ? 'owner' : 'owner-failed', tx: hash }); log('sweep', r.status, p.name, hash); } }
  }
  // token balances now held by the owner (not counted as recovered MON — conservative)
  const toks = {}; for (const [s, t] of Object.entries(T)) toks[s] = (await tbal(t, owner.address)).toString(); st.ownerTokensAfter = toks; save();
}

// ---- GitHub Actions mode helpers ----
/** Find the owner's vault (v3, then v2, then v1) whose executor is `agent`. */
async function vaultByExecutor(agent) {
  for (const f of [FACTORY, ...LEGACY_FACTORIES]) {
    const vs = await pc.readContract({ address: f, abi: agentVaultFactoryAbi, functionName: 'vaultsOf', args: [owner.address] }).catch(() => []);
    for (const v of [...vs].reverse()) if ((await vread(v, 'executor').catch(() => '')).toLowerCase() === agent.toLowerCase()) return v;
  }
  return null;
}
/** Resolve + verify every persona's vault against the chain (the committed config can lag behind a vault migration). */
async function resolveVaults() {
  for (const p of PERSONAS) {
    const a = st.agents[p.id]; if (!a.key) continue; const me = acct(p.id).address;
    const ex = a.vault ? await vread(a.vault, 'executor').catch(() => null) : null;
    if (ex && ex.toLowerCase() === me.toLowerCase()) continue;
    const found = await vaultByExecutor(me).catch(() => null);
    if (found) { log(p.name, `config vault ${a.vault ?? '(none)'} is not run by this key; using ${found} (found by executor on-chain)`); a.vault = found; a.resolved = true; }
    else a.skip = a.vault ? `agent key ${me} is not the executor of ${a.vault} (owner must setExecutor, or fix the secret/config)` : `no vault with executor ${me} found for owner ${owner.address} (owner must create it)`;
  }
}
/** Reasons a persona must sit this round out. Only genuine blockers; policy rejections are left to the vault. */
async function preflight(p, MIN_GAS) {
  const a = st.agents[p.id]; if (a.skip) return a.skip;
  const me = acct(p.id).address;
  const [paused, gas, bal, budget, spent] = await Promise.all([vread(a.vault, 'paused'), pc.getBalance({ address: me }), pc.getBalance({ address: a.vault }), vread(a.vault, 'budget'), vread(a.vault, 'totalSpent')]);
  if (paused) return 'vault is paused (owner must setPaused(false); CI holds no owner key)';
  if (gas < MIN_GAS) return `agent gas ${formatEther(gas)} MON < ${formatEther(MIN_GAS)} MON (owner must top up the agent wallet)`;
  if (p.attack) return null; // blocked attempts need gas only
  const MIN_VAULT = parseEther('0.005'); const rem = budget > spent ? budget - spent : 0n;
  const w = ['rebalancer', 'tester', 'mm', 'dca', 'dca1', 'staker'].includes(p.id) ? await tbal(T.WMON, a.vault).catch(() => 0n) : 0n;
  const u = ['mm', 'dca', 'dca1'].includes(p.id) ? await tbal(T.USDC, a.vault).catch(() => 0n) : 0n;
  if (bal < MIN_VAULT && w === 0n && u < 100n) return `vault balance ${formatEther(bal)} MON is too low (owner must deposit)`;
  if (rem < parseEther('0.001') && w === 0n && u < 100n) return `budget exhausted (${formatEther(spent)}/${formatEther(budget)} MON spent; owner must setBudget)`;
  return null;
}
/** Minimum spacing between rounds, enforced by the runner itself so the cadence holds whoever calls it (and so a
 *  change merged to runner/showcase-loop.env applies to an already-running loop on its next round).
 *  ROUND_SPACING_S env wins; otherwise INTERVAL_S_DEFAULT from runner/showcase-loop.env; 0 disables. */
async function paceRound() {
  let spacing = Number(E.ROUND_SPACING_S ?? NaN);
  if (!Number.isFinite(spacing)) { const f = path.resolve(HERE, 'showcase-loop.env'); const m = fs.existsSync(f) ? /^INTERVAL_S_DEFAULT=(\d+)/m.exec(fs.readFileSync(f, 'utf8')) : null; spacing = m ? Number(m[1]) : 0; }
  if (!(spacing > 0) || !fs.existsSync(PUB)) return;
  const last = Date.parse(JSON.parse(fs.readFileSync(PUB, 'utf8')).updatedAt); if (!Number.isFinite(last)) return;
  const wait = Math.min(spacing * 1000 - (Date.now() - last), spacing * 1000);
  if (wait > 0) { log(`pacing: last round ${Math.round((Date.now() - last) / 1000)}s ago; waiting ${Math.ceil(wait / 1000)}s to keep ${spacing}s between rounds`); await sleep(wait); }
}
/** One round: every persona gets a turn, each isolated by try/catch so one failure never blocks the others. */
async function runRound() {
  const MAX_FEE = parseEther(E.MAX_FEE_MON || '0.15'); const MIN_GAS = parseEther(E.MIN_AGENT_GAS || '0.08'); let guard = false;
  await within(resolveVaults(), 120_000, 'resolveVaults').catch(e => log('resolveVaults', errMsg(e)));
  for (const p of PERSONAS) {
    try {
      const why = await within(preflight(p, MIN_GAS), 60_000, 'preflight'); if (why) { skip(p, why); continue; }
      const r = await within(act(p, roundOf(p.id)), 240_000, 'act');
      if (r?.feeWei && r.feeWei > MAX_FEE) { log(`SPEND GUARD: ${p.name} fee ${formatEther(r.feeWei)} > ${formatEther(MAX_FEE)} MON`); guard = true; }
    } catch (e) { log(p.name, 'error', errMsg(e)); rec({ persona: p.id, actor: 'runner', status: 'error', label: `${p.name}: ${errMsg(e)}` }); }
  }
  publish({ status: 'running (GitHub Actions)' });
  return guard;
}

if (cmd === 'status') { const { h, used } = await consumed(); console.log(JSON.stringify({ holdings: formatEther(h), used: formatEther(used), stopAt: formatEther(STOP_AT), vaults: PERSONAS.map(p => [p.id, st.agents[p.id].vault, agentAddr(p.id)]) }, null, 1)); process.exit(0); }
if (cmd === 'recover') { await recover(); const { used } = await consumed(); publish({ used, status: 'stopped' }); log('final consumed', formatEther(used)); process.exit(0); }

if (AGENTS_ONLY && cmd === 'publish') { publish({ status: 'running (GitHub Actions)' }); log('snapshot rebuilt from the ledger →', PUB); process.exit(0); }
if (AGENTS_ONLY && cmd === 'check') { // keyless health check (also what runs when secrets aren't configured yet)
  await resolveVaults().catch(e => log('resolveVaults', errMsg(e)));
  for (const p of PERSONAS) { const a = st.agents[p.id]; const c = cfgAgent(p.id);
    if (!a.vault) { console.log(p.id.padEnd(10), 'PENDING  · no vault yet · key secret', a.key ? 'present' : 'MISSING', a.skip ? `· ${a.skip}` : ''); continue; }
    const [bal, gas, paused] = await Promise.all([pc.getBalance({ address: a.vault }), agentAddr(p.id) ? pc.getBalance({ address: agentAddr(p.id) }) : 0n, vread(a.vault, 'paused')]);
    console.log(p.id.padEnd(10), 'vault', a.vault, a.resolved ? '(resolved by executor; config says ' + (c?.vault ?? 'none') + ')' : '', formatEther(bal), 'MON · agent gas', formatEther(gas), 'MON · paused', paused, '· key secret', a.key ? 'present' : 'MISSING', a.skip ? `· SKIP: ${a.skip}` : ''); }
  process.exit(0);
}
if (AGENTS_ONLY) {
  if (!PERSONAS.some(p => hasKey(p.id))) { log('no AGENT_KEY_* secrets configured: nothing to run'); publish({ status: 'running (GitHub Actions)' }); process.exit(0); }
  await paceRound();
  const guard = await within(runRound(), 1_500_000, 'round');
  if (guard) { log('SPEND GUARD tripped: stopping the loop'); process.exit(3); }
  process.exit(0);
}
await setup();
const deadline = Date.now() + HOURS * 3600e3; let round = st.round || 0; let stopReason = 'deadline';
fs.writeFileSync(path.join(path.dirname(KEYS), `showcase-${TAG}.pid`), String(process.pid));
let stopFile = path.join(path.dirname(KEYS), `showcase-${TAG}.stop`);
outer: while (Date.now() < deadline) {
  for (const p of PERSONAS) {
    if (fs.existsSync(stopFile)) { stopReason = 'stop file'; break outer; }
    if (fs.existsSync(stopFile.replace('.stop', '.handoff'))) { log('HANDOFF: exiting without recovery (GitHub Actions takes over)'); st.stopReason = 'handoff to GitHub Actions'; save(); publish({ status: 'running (GitHub Actions)' }); process.exit(0); }
    const { used } = await consumed();
    const ob = await pc.getBalance({ address: owner.address });
    if (ob < RESERVE + parseEther('1')) { stopReason = `owner reserve: deployer balance ${formatEther(ob)} MON would approach the ${formatEther(RESERVE)} MON reserve`; break outer; }
    if (used + parseEther('0.3') >= STOP_AT) { stopReason = `spend cap: ${formatEther(used)} MON consumed (stop at ${formatEther(STOP_AT)} incl. 0.3 MON reserve for recovery)`; break outer; }
    try { await within(maintain(p), 300_000, 'maintain'); await within(act(p, round), 300_000, 'act'); } catch (e) { log(p.name, 'error', errMsg(e)); rec({ persona: p.id, actor: 'runner', status: 'error', label: errMsg(e) }); await sleep(5000); }
  }
  round++; st.round = round; save();
  const { used } = await within(consumed(), 120_000, 'consumed'); publish({ used }); fs.writeFileSync(path.join(path.dirname(KEYS), `showcase-${TAG}.heartbeat`), new Date().toISOString()); log(`round ${round} done · consumed ${formatEther(used)} MON`);
  if (round > BURST) await sleep(INTERVAL);
}
log('STOP:', stopReason); st.stopReason = stopReason; save();
await recover(); const { used } = await consumed(); publish({ used, status: `stopped (${stopReason})` }); log('FINAL consumed', formatEther(used), 'MON');
