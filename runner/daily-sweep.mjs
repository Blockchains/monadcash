// Daily sweep (GitHub Actions, agent keys only): every team agent sends its gas surplus above the floor to the
// deployer, so the deployer can re-fund agents and vaults for the next day.
//   - destination is the hard-coded DEPLOYER constant below (never from input/env/config; config owner must match it)
//   - agents keep agentFloorMon (8 MON, same floor as agent-refill) plus the gas for the transfer
//   - team vaults are NOT swept here: AgentVault.withdraw() is onlyOwner (checked on-chain for all 13 vaults), and the
//     owner key is never in GitHub. The summary lists what the owner-side sweep (runner/owner-daily-cycle.sh) would pull.
//   - never pauses/unpauses vaults. DRY_RUN=1 sends nothing. MAX_PER_AGENT_MON caps each agent (blank = all surplus).
import fs from 'node:fs'; import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const DEPLOYER = '0xc0c4E411e41bECAD6DA860F67063C2D6363a6113'; // hard-coded destination
const E = process.env;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'agent-refill-config-143.json'), 'utf8'));
const RPC = E.RPC || 'https://rpc.monad.xyz';
const DRY = E.DRY_RUN === '1';
const OUT = E.OUT || 'daily-sweep.json';
const EXP = 'https://monadvision.com';
const FLOOR = parseEther(CFG.agentFloorMon), MIN_SEND = parseEther('0.1');
const MAXA = E.MAX_PER_AGENT_MON && E.MAX_PER_AGENT_MON.trim() ? parseEther(E.MAX_PER_AGENT_MON.trim()) : null;
if (getAddress(CFG.owner) !== getAddress(DEPLOYER)) throw new Error('config owner is not the hard-coded deployer: refusing');
const TOKENS = { WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', sMON: '0xA3227C5969757783154C60bF0bC1944180ed81B9', aprMON: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', gMON: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081' };
const chain = { id: CFG.chainId, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pc = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 800, timeout: 20_000 }) });
const vaultAbi = parseAbi(['function owner() view returns (address)', 'function paused() view returns (bool)']);
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const errMsg = e => String(e?.shortMessage || e?.message || e).split('\n')[0].slice(0, 200);
const fmt = w => (w == null ? '?' : Number(formatEther(w)).toFixed(4));
const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const bal = a => pc.getBalance({ address: a });
if (Number(await pc.getChainId()) !== CFG.chainId) throw new Error('RPC chain id mismatch');

const res = { dryRun: DRY, deployer: DEPLOYER, floorMon: CFG.agentFloorMon, maxPerAgentMon: MAXA ? formatEther(MAXA) : 'all', agents: [], vaults: [], txs: [], problems: [] };
res.deployerBefore = await bal(DEPLOYER);
for (const a of CFG.agents) {
  const agent = getAddress(a.agent);
  const row = { id: a.id, agent, before: await bal(agent), after: null, sent: 0n, note: '' };
  res.agents.push(row);
  for (const v of a.vaults) {
    const vault = getAddress(v.vault); const vr = { id: a.id, vault, before: await bal(vault), after: null, paused: null, tokens: {} };
    try { vr.paused = await pc.readContract({ address: vault, abi: vaultAbi, functionName: 'paused' }); } catch (e) { vr.paused = `? ${errMsg(e)}`; }
    for (const [k, t] of Object.entries(TOKENS)) { const b = await pc.readContract({ address: t, abi: erc20, functionName: 'balanceOf', args: [vault] }).catch(() => 0n); if (b > 0n) vr.tokens[k] = b; }
    res.vaults.push(vr);
  }
  const key = (E[a.secret] || '').trim();
  if (!key) { row.note = 'no key: not swept'; continue; }
  let acct; try { acct = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`); } catch { row.note = 'invalid key: not swept'; res.problems.push(`${a.id}: ${row.note}`); continue; }
  if (acct.address !== agent) { row.note = 'key does not derive to configured agent: not swept'; res.problems.push(`${a.id}: ${row.note}`); continue; }
  try {
    const ab = await bal(agent); // re-read right before sending
    if (ab <= FLOOR) { row.note = `at/below ${CFG.agentFloorMon} MON floor`; continue; }
    const fees = await pc.estimateFeesPerGas();
    const gas = (await pc.estimateGas({ account: agent, to: DEPLOYER, value: MIN_SEND })) * 12n / 10n;
    let amt = ab - FLOOR - gas * fees.maxFeePerGas;
    if (MAXA && amt > MAXA) amt = MAXA;
    amt = (amt / 10n ** 14n) * 10n ** 14n;
    if (amt < MIN_SEND) { row.note = 'surplus too small'; continue; }
    if (DRY) { row.note = `dry-run: would send ${fmt(amt)} MON`; log(a.id, row.note); continue; }
    const wc = createWalletClient({ account: acct, chain, transport: http(RPC, { retryCount: 2, timeout: 20_000 }) });
    const hash = await wc.sendTransaction({ to: DEPLOYER, value: amt, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
    res.txs.push({ id: a.id, from: agent, to: DEPLOYER, amountMon: formatEther(amt), hash, status: r.status, block: r.blockNumber.toString() });
    if (r.status === 'success') { row.sent = amt; row.note = `-${fmt(amt)} MON → deployer`; } else { row.note = `tx ${r.status}`; res.problems.push(`${a.id}: ${hash} ${r.status}`); }
    log(a.id, '->', 'deployer', fmt(amt), 'MON', r.status, `${EXP}/tx/${hash}`);
  } catch (e) { row.note = `send failed: ${errMsg(e)}`; res.problems.push(`${a.id}: ${row.note}`); log(a.id, row.note); }
}
for (const r of res.agents) r.after = await bal(r.agent);
for (const v of res.vaults) v.after = await bal(v.vault);
res.deployerAfter = await bal(DEPLOYER);
const vaultMon = res.vaults.reduce((s, v) => s + v.after, 0n);

const L = [`## Daily sweep ${DRY ? '(dry run)' : ''}`, '', `Destination (hard-coded): deployer [${DEPLOYER}](${EXP}/address/${DEPLOYER}) · agent floor **${CFG.agentFloorMon} MON** · per-agent cap: ${res.maxPerAgentMon}`, '',
  `Deployer: **${fmt(res.deployerBefore)} → ${fmt(res.deployerAfter)} MON**`, '', '### Agent gas wallets (swept here)', '', '| agent | address | before | after | sent | note |', '|---|---|---:|---:|---:|---|'];
for (const a of res.agents) L.push(`| ${a.id} | [${short(a.agent)}](${EXP}/address/${a.agent}) | ${fmt(a.before)} | ${fmt(a.after)} | ${fmt(a.sent)} | ${a.note} |`);
L.push('', '### Team vaults (NOT swept here: withdraw is owner-only; owner-side `runner/owner-daily-cycle.sh` pulls these)', '', '| vault | address | paused | MON before | MON after | tokens (raw units) |', '|---|---|---|---:|---:|---|');
for (const v of res.vaults) L.push(`| ${v.id} | [${short(v.vault)}](${EXP}/address/${v.vault}) | ${v.paused} | ${fmt(v.before)} | ${fmt(v.after)} | ${Object.entries(v.tokens).map(([k, b]) => `${k} ${b}`).join(', ') || '-'} |`);
L.push('', `Team vault MON still held (owner sweep needed): **${fmt(vaultMon)} MON**`, '', '### Transactions', '');
if (res.txs.length) for (const t of res.txs) L.push(`- ${t.id}: ${t.amountMon} MON → deployer · ${t.status} · [${t.hash}](${EXP}/tx/${t.hash})`); else L.push('- none');
if (res.problems.length) L.push('', '### Problems', '', ...res.problems.map(p => `- ${p}`));
const md = L.join('\n') + '\n';
if (E.GITHUB_STEP_SUMMARY) fs.appendFileSync(E.GITHUB_STEP_SUMMARY, md); else console.log(md);
fs.writeFileSync(OUT, JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? formatEther(v) : v), 1));
log('done:', res.txs.length, 'tx(s); deployer', fmt(res.deployerBefore), '->', fmt(res.deployerAfter));
process.exit(res.problems.length && !res.txs.length && !DRY ? 1 : 0);
