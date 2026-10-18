// Daily cycle (GitHub Actions, agent keys only; PolicyPilot showcase agents, operated by the team):
//   1. every agent exits its shares of the team clip/spread pools (MON comes back to the agent itself)
//   2. every agent sends its MON above its targetMon (20; idle "3" agents 0.5) to the hard-coded deployer
//   3. one agent calls ShowcaseRefiller.refill(true): vaults back to 1 MON (rogue 0.5) and agents back to target
//   4. reports any team vault holding > alertVaultAboveMon (1.5) native MON (owner-only withdraw: alert issue)
//   - destination is the hard-coded DEPLOYER constant below (never from input/env/config; config owner must match it)
//   - agents keep their targetMon plus the gas for the transfer, so the sweep can never strand an agent
//   - team vault MON is never withdrawn here (AgentVault.withdraw() is onlyOwner; the owner key is never in GitHub).
//     Vaults stay at <= 1 MON because the only MON inflow to a vault is the refiller (capped at target).
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
const MIN_SEND = parseEther('0.1');
const REFILLER = getAddress(CFG.refiller); const VAULT_ALERT = parseEther(CFG.alertVaultAboveMon);
const MAXA = E.MAX_PER_AGENT_MON && E.MAX_PER_AGENT_MON.trim() ? parseEther(E.MAX_PER_AGENT_MON.trim()) : null;
if (getAddress(CFG.owner) !== getAddress(DEPLOYER)) throw new Error('config owner is not the hard-coded deployer: refusing');
const TOKENS = { WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', sMON: '0xA3227C5969757783154C60bF0bC1944180ed81B9', aprMON: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', gMON: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081' };
const chain = { id: CFG.chainId, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pc = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 800, timeout: 20_000 }) });
const vaultAbi = parseAbi(['function owner() view returns (address)', 'function paused() view returns (bool)']);
const poolAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function withdraw(uint256 shares) returns (uint256)']);
const refAbi = parseAbi(['function owner() view returns (address)', 'function refill(bool full) returns (uint256)', 'function pending(bool full) view returns (uint256 total, uint256 count)', 'function readyAt() view returns (uint256)', 'function windowLeft() view returns (uint256)', 'function isCaller(address) view returns (bool)']);
// team clip/spread pools: every 'deployed' row in the committed ledger (withdraw() only ever pays msg.sender)
const POOLS = [...new Set(fs.readFileSync(path.join(HERE, 'ledger/showcase-143.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(r => r && (r.persona === 'clip' || r.persona === 'spread') && r.status === 'deployed' && r.pool).map(r => getAddress(r.pool)))];
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const errMsg = e => String(e?.shortMessage || e?.message || e).split('\n')[0].slice(0, 200);
const fmt = w => (w == null ? '?' : Number(formatEther(w)).toFixed(4));
const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const bal = a => pc.getBalance({ address: a });
if (Number(await pc.getChainId()) !== CFG.chainId) throw new Error('RPC chain id mismatch');

const res = { dryRun: DRY, deployer: DEPLOYER, maxPerAgentMon: MAXA ? formatEther(MAXA) : 'all', agents: [], vaults: [], txs: [], problems: [] };
res.deployerBefore = await bal(DEPLOYER); res.floatBefore = await bal(REFILLER); res.pools = [];
if (getAddress(await pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'owner' })) !== getAddress(DEPLOYER)) throw new Error('refiller owner is not the deployer: refusing');
const keyed = [];
for (const a of CFG.agents) {
  const agent = getAddress(a.agent);
  const FLOOR = parseEther(a.targetMon);
  const row = { id: a.id, agent, target: FLOOR, before: await bal(agent), after: null, sent: 0n, poolOut: 0n, note: '' };
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
  const wc = createWalletClient({ account: acct, chain, transport: http(RPC, { retryCount: 2, timeout: 20_000 }) });
  keyed.push({ id: a.id, agent, wc });
  // 1. pool exits (MON returns to this agent)
  for (const pool of POOLS) {
    try {
      const sh = await pc.readContract({ address: pool, abi: poolAbi, functionName: 'balanceOf', args: [agent] });
      if (sh === 0n) continue;
      if (DRY) { res.pools.push({ id: a.id, pool, dry: true }); continue; }
      const pb = await bal(pool);
      const hash = await wc.writeContract({ address: pool, abi: poolAbi, functionName: 'withdraw', args: [sh] });
      const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
      const out = pb - await bal(pool); row.poolOut += out > 0n ? out : 0n;
      res.txs.push({ id: a.id, kind: 'pool-exit', from: pool, to: agent, amountMon: formatEther(out > 0n ? out : 0n), hash, status: r.status });
      log(a.id, 'pool exit', short(pool), fmt(out), r.status, `${EXP}/tx/${hash}`);
    } catch (e) { res.problems.push(`${a.id}: pool exit ${short(pool)} failed: ${errMsg(e)}`); }
  }
  try {
    const ab = await bal(agent); // re-read right before sending
    if (ab <= FLOOR) { row.note = `at/below its ${a.targetMon} MON target`; continue; }
    const fees = await pc.estimateFeesPerGas();
    const gas = (await pc.estimateGas({ account: agent, to: DEPLOYER, value: MIN_SEND })) * 12n / 10n;
    let amt = ab - FLOOR - gas * fees.maxFeePerGas;
    if (MAXA && amt > MAXA) amt = MAXA;
    amt = (amt / 10n ** 14n) * 10n ** 14n;
    if (amt < MIN_SEND) { row.note = 'surplus too small'; continue; }
    if (DRY) { row.note = `dry-run: would send ${fmt(amt)} MON`; log(a.id, row.note); continue; }
    const hash = await wc.sendTransaction({ to: DEPLOYER, value: amt, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
    res.txs.push({ id: a.id, kind: 'sweep', from: agent, to: DEPLOYER, amountMon: formatEther(amt), hash, status: r.status, block: r.blockNumber.toString() });
    if (r.status === 'success') { row.sent = amt; row.note = `-${fmt(amt)} MON → deployer`; } else { row.note = `tx ${r.status}`; res.problems.push(`${a.id}: ${hash} ${r.status}`); }
    log(a.id, '->', 'deployer', fmt(amt), 'MON', r.status, `${EXP}/tx/${hash}`);
  } catch (e) { row.note = `send failed: ${errMsg(e)}`; res.problems.push(`${a.id}: ${row.note}`); log(a.id, row.note); }
}
// 3. refiller re-fund to targets (one agent pays the gas)
res.refill = { note: '' };
try {
  const [p, ready, wl] = await Promise.all([pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'pending', args: [true] }), pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'readyAt' }), pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'windowLeft' })]);
  res.refill.pending = p[0]; res.refill.count = Number(p[1]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (p[0] === 0n) res.refill.note = 'nothing below target';
  else if (ready > now) res.refill.note = `cooldown until ${new Date(Number(ready) * 1000).toISOString()}`;
  else if (DRY) res.refill.note = `dry-run: would refill ${fmt(p[0])} MON to ${p[1]} recipients (24h cap left ${fmt(wl)})`;
  else {
    let caller = null, cb = 0n;
    for (const k of keyed) { const b = await bal(k.agent); if (b > cb && await pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'isCaller', args: [k.agent] })) { caller = k; cb = b; } }
    if (!caller) throw new Error('no keyed agent can call the refiller');
    const est = await pc.estimateContractGas({ address: REFILLER, abi: refAbi, functionName: 'refill', args: [true], account: caller.agent });
    const hash = await caller.wc.writeContract({ address: REFILLER, abi: refAbi, functionName: 'refill', args: [true], gas: est * 13n / 10n }); // Monad charges the gas limit
    const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
    res.txs.push({ id: caller.id, kind: 'refiller.refill(true)', from: REFILLER, to: 'allowlist', amountMon: '', hash, status: r.status });
    res.refill.note = `refill(true) by ${caller.id}: ${r.status}`; log(res.refill.note, `${EXP}/tx/${hash}`);
    if (r.status !== 'success') res.problems.push(`refiller refill ${hash} ${r.status}`);
  }
} catch (e) { res.refill.note = `failed: ${errMsg(e)}`; res.problems.push(`refiller: ${res.refill.note}`); }
for (const r of res.agents) r.after = await bal(r.agent);
for (const v of res.vaults) v.after = await bal(v.vault);
res.deployerAfter = await bal(DEPLOYER); res.floatAfter = await bal(REFILLER);
res.vaultsAbove = res.vaults.filter(v => v.after > VAULT_ALERT).map(v => ({ id: v.id, vault: v.vault, mon: formatEther(v.after) }));
const vaultMon = res.vaults.reduce((s, v) => s + v.after, 0n);

const L = [`## Daily sweep ${DRY ? '(dry run)' : ''}`, '', `Destination (hard-coded): deployer [${DEPLOYER}](${EXP}/address/${DEPLOYER}) · agents keep their target (20 MON; idle 0.5) · per-agent cap: ${res.maxPerAgentMon}`, '',
  `Deployer: **${fmt(res.deployerBefore)} → ${fmt(res.deployerAfter)} MON** · refiller float [${short(REFILLER)}](${EXP}/address/${REFILLER}): **${fmt(res.floatBefore)} → ${fmt(res.floatAfter)} MON** · refill: ${res.refill.note}`, '', '### Agent gas wallets', '', '| agent | address | target | before | pool exit | swept | after | note |', '|---|---|---:|---:|---:|---:|---:|---|'];
for (const a of res.agents) L.push(`| ${a.id} | [${short(a.agent)}](${EXP}/address/${a.agent}) | ${fmt(a.target)} | ${fmt(a.before)} | ${fmt(a.poolOut)} | ${fmt(a.sent)} | ${fmt(a.after)} | ${a.note} |`);
L.push('', '### Team vaults (target 1 MON, rogue 0.5; the refiller never tops above target; withdraw is owner-only)', '', '| vault | address | paused | MON before | MON after | tokens (raw units) |', '|---|---|---|---:|---:|---|');
for (const v of res.vaults) L.push(`| ${v.id} | [${short(v.vault)}](${EXP}/address/${v.vault}) | ${v.paused} | ${fmt(v.before)} | ${fmt(v.after)} | ${Object.entries(v.tokens).map(([k, b]) => `${k} ${b}`).join(', ') || '-'} |`);
L.push('', `Team vault MON total: **${fmt(vaultMon)} MON**` + (res.vaultsAbove.length ? ` · **above ${CFG.alertVaultAboveMon} MON:** ${res.vaultsAbove.map(v => `${v.id} ${v.mon}`).join(', ')}` : ''), '', '### Transactions', '');
if (res.txs.length) for (const t of res.txs) L.push(`- ${t.kind} ${t.id}: ${t.amountMon} · ${t.status} · [${t.hash}](${EXP}/tx/${t.hash})`); else L.push('- none');
if (res.problems.length) L.push('', '### Problems', '', ...res.problems.map(p => `- ${p}`));
const md = L.join('\n') + '\n';
if (E.GITHUB_STEP_SUMMARY) fs.appendFileSync(E.GITHUB_STEP_SUMMARY, md); else console.log(md);
fs.writeFileSync(OUT, JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? formatEther(v) : v), 1));
log('done:', res.txs.length, 'tx(s); deployer', fmt(res.deployerBefore), '->', fmt(res.deployerAfter));
process.exit(res.problems.length && !res.txs.length && !DRY ? 1 : 0);
