// 30-minute refill for the PolicyPilot showcase agents (operated by the team). GitHub Actions, agent keys only.
//   1. ShowcaseRefiller.refill(false): anything below its min goes back to target (vaults 1 MON, rogue 0.5; agents 20,
//      idle "3" agents 0.5). The refiller can only pay its fixed allowlist and never tops above target.
//   2. fallback: an agent tops up ONLY its own vault (config), from MON above its own targetMon, max 1 MON per run
//   3. alerts: paused team vault, refiller float below 1 day of burn, any team vault above 1.5 MON native
//   - destinations come only from the committed config; the on-chain owner/executor must match, the key must derive
//     to the configured agent address, and vaults that are also in showcase-config-143.json must match it exactly
//   - paused vaults are never touched (no setPaused here: unpause stays manual) and are reported for the alert issue
//   - balances are re-read right before every send
// Keys come from AGENT_KEY_<ID> env vars and are never printed. DRY_RUN=1 simulates and sends nothing.
// Outputs: markdown to $GITHUB_STEP_SUMMARY (or stdout) and machine-readable result to $OUT (default agent-refill.json).
import fs from 'node:fs'; import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const E = process.env;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CFG = JSON.parse(fs.readFileSync(E.REFILL_CONFIG || path.join(HERE, 'agent-refill-config-143.json'), 'utf8'));
const SHOW = JSON.parse(fs.readFileSync(path.join(HERE, 'showcase-config-143.json'), 'utf8'));
const RPC = E.RPC || 'https://rpc.monad.xyz';
const DRY = E.DRY_RUN === '1';
const OUT = E.OUT || 'agent-refill.json';
const EXP = 'https://monadvision.com';
const CAP = parseEther(CFG.maxPerAgentPerRunMon);
const REFILLER = getAddress(CFG.refiller), FLOAT_ALERT = parseEther(CFG.alertFloatBelowMon), VAULT_ALERT = parseEther(CFG.alertVaultAboveMon);
const refAbi = parseAbi(['function owner() view returns (address)', 'function refill(bool full) returns (uint256)', 'function pending(bool full) view returns (uint256 total, uint256 count)', 'function readyAt() view returns (uint256)', 'function isCaller(address) view returns (bool)']);
const MIN_SEND = parseEther(CFG.minSendMon);
const OWNER = getAddress(CFG.owner);
const chain = { id: CFG.chainId, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pc = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 800, timeout: 20_000 }) });
const vaultAbi = parseAbi(['function owner() view returns (address)', 'function executor() view returns (address)', 'function paused() view returns (bool)']);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const errMsg = e => String(e?.shortMessage || e?.message || e).split('\n')[0].slice(0, 200);
const fmt = w => Number(formatEther(w)).toFixed(4);
const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const floorTo = (w, step = 10n ** 14n) => (w / step) * step; // round down to 0.0001 MON
const min = (...xs) => xs.reduce((a, b) => (b < a ? b : a));
const bal = a => pc.getBalance({ address: a, blockTag: 'latest' });
const read = (v, fn) => pc.readContract({ address: v, abi: vaultAbi, functionName: fn });

if (pc.chain.id !== Number(await pc.getChainId())) throw new Error('RPC chain id mismatch');
if (getAddress(SHOW.owner) !== OWNER) throw new Error('owner in refill config differs from showcase-config-143.json');
const allowed = new Set(CFG.agents.flatMap(a => a.vaults.map(v => getAddress(v.vault))));

const res = { dryRun: DRY, floorMon: 'per-agent targetMon', capMon: CFG.maxPerAgentPerRunMon, agents: [], vaults: [], txs: [], paused: [], problems: [] };
const agents = [];
for (const a of CFG.agents) {
  const agent = getAddress(a.agent);
  const s = SHOW.agents.find(x => x.id === a.id);
  const row = { id: a.id, agent, floor: parseEther(a.targetMon), hasKey: false, before: null, after: null, sent: 0n, note: '' };
  res.agents.push(row);
  if (s && (getAddress(s.agent) !== agent || !a.vaults.some(v => getAddress(v.vault) === getAddress(s.vault)))) { row.note = 'config mismatch with showcase-config-143.json: skipped'; res.problems.push(`${a.id}: ${row.note}`); continue; }
  const key = (E[a.secret] || '').trim();
  let acct = null;
  if (key) {
    try { acct = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`); } catch { row.note = `${a.secret} is not a valid key: skipped`; }
    if (acct && acct.address !== agent) { row.note = `${a.secret} does not derive to the configured agent: skipped`; acct = null; }
  } else row.note = `${a.secret} not available: read-only`;
  if (row.note && key) res.problems.push(`${a.id}: ${row.note}`);
  row.hasKey = !!acct;
  agents.push({ cfg: a, row, acct, wc: acct ? createWalletClient({ account: acct, chain, transport: http(RPC, { retryCount: 2, timeout: 20_000 }) }) : null });
}

// ---- snapshot before ----
for (const { cfg, row } of agents) {
  row.before = await bal(row.agent);
  for (const v of cfg.vaults) {
    const vault = getAddress(v.vault); const vr = { id: cfg.id, vault, target: parseEther(v.targetMon), before: null, after: null, paused: null, ok: false, note: '' };
    res.vaults.push(vr);
    try {
      const [o, ex, p, code] = await Promise.all([read(vault, 'owner'), read(vault, 'executor'), read(vault, 'paused'), pc.getCode({ address: vault })]);
      vr.paused = p; vr.before = await bal(vault);
      if (!code || code === '0x') vr.note = 'no contract code';
      else if (getAddress(o) !== OWNER) vr.note = `owner ${short(o)} is not the team owner`;
      else if (getAddress(ex) !== row.agent) vr.note = `executor ${short(ex)} is not this agent`;
      else vr.ok = true;
      if (p) res.paused.push({ id: cfg.id, vault });
    } catch (e) { vr.note = `read failed: ${errMsg(e)}`; }
    if (!vr.ok) res.problems.push(`${cfg.id} vault ${short(vault)}: ${vr.note}`);
  }
}

// ---- refiller (box-free float): normal refill of anything below its min, never above target ----
res.refiller = { address: REFILLER, note: '' };
try {
  if (getAddress(await pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'owner' })) !== OWNER) throw new Error('refiller owner is not the team owner');
  res.refiller.floatBefore = await bal(REFILLER);
  const [p, ready] = await Promise.all([pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'pending', args: [false] }), pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'readyAt' })]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (p[0] === 0n) res.refiller.note = 'nothing below min';
  else if (ready > now) res.refiller.note = `cooldown until ${new Date(Number(ready) * 1000).toISOString()}`;
  else if (res.refiller.floatBefore === 0n) res.refiller.note = 'float empty';
  else if (DRY) res.refiller.note = `dry-run: would refill ${fmt(p[0])} MON to ${p[1]} recipients`;
  else {
    let c = null, cb = 0n;
    for (const x of agents) { if (!x.acct) continue; const b = await bal(x.row.agent); if (b > cb && await pc.readContract({ address: REFILLER, abi: refAbi, functionName: 'isCaller', args: [x.row.agent] })) { c = x; cb = b; } }
    if (!c) throw new Error('no keyed agent can call the refiller');
    const est = await pc.estimateContractGas({ address: REFILLER, abi: refAbi, functionName: 'refill', args: [false], account: c.row.agent });
    const hash = await c.wc.writeContract({ address: REFILLER, abi: refAbi, functionName: 'refill', args: [false], gas: est * 13n / 10n });
    const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
    res.txs.push({ id: c.cfg.id, from: REFILLER, to: 'allowlist (refill(false))', amountMon: formatEther(p[0]), hash, status: r.status, block: r.blockNumber.toString() });
    res.refiller.note = `refill(false) by ${c.cfg.id}: ${r.status}`; log(res.refiller.note, `${EXP}/tx/${hash}`);
    if (r.status !== 'success') res.problems.push(`refiller refill ${hash} ${r.status}`);
  }
} catch (e) { res.refiller.note = `failed: ${errMsg(e)}`; res.problems.push(`refiller: ${res.refiller.note}`); }

// ---- fallback: an agent tops up its own vault from MON above its own target ----
for (const { cfg, row, acct } of agents) {
  if (!acct) { for (const vr of res.vaults.filter(x => x.id === cfg.id)) if (vr.ok) vr.note = 'agent key not available: not refilled'; continue; }
  const wc = createWalletClient({ account: acct, chain, transport: http(RPC, { retryCount: 2, timeout: 20_000 }) });
  const FLOOR = row.floor; let left = CAP;
  for (const vr of res.vaults.filter(x => x.id === cfg.id)) {
    if (!vr.ok) continue;
    if (vr.paused) { vr.note = 'paused: not refilled (unpause is manual)'; continue; }
    if (!allowed.has(vr.vault)) throw new Error('destination not in config'); // belt and braces
    try {
      // re-read everything right before sending
      const [vb, ab, p] = await Promise.all([bal(vr.vault), bal(row.agent), read(vr.vault, 'paused')]);
      if (p) { vr.paused = true; vr.note = 'paused: not refilled (unpause is manual)'; if (!res.paused.some(x => x.vault === vr.vault)) res.paused.push({ id: cfg.id, vault: vr.vault }); continue; }
      const deficit = vr.target > vb ? vr.target - vb : 0n;
      if (deficit < MIN_SEND) { vr.note = 'at target'; continue; }
      if (ab <= FLOOR) { vr.note = `agent at/below its ${cfg.targetMon} MON target: left to the refiller`; continue; }
      const fees = await pc.estimateFeesPerGas();
      const gas = (await pc.estimateGas({ account: row.agent, to: vr.vault, value: MIN_SEND })) * 12n / 10n;
      const gasCost = gas * fees.maxFeePerGas; // Monad charges the gas limit
      const spare = ab > FLOOR + gasCost ? ab - FLOOR - gasCost : 0n;
      const amt = floorTo(min(deficit, left, spare));
      if (amt < MIN_SEND) { vr.note = `spare above floor too small (${fmt(spare)} MON)`; continue; }
      if (DRY) { vr.note = `dry-run: would send ${fmt(amt)} MON`; log(cfg.id, vr.note); continue; }
      const hash = await wc.sendTransaction({ to: vr.vault, value: amt, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
      const ok = r.status === 'success';
      res.txs.push({ id: cfg.id, from: row.agent, to: vr.vault, amountMon: formatEther(amt), hash, status: r.status, block: r.blockNumber.toString() });
      if (ok) { left -= amt; row.sent += amt; vr.note = `+${fmt(amt)} MON`; } else { vr.note = `tx ${r.status}`; res.problems.push(`${cfg.id}: refill tx ${hash} ${r.status}`); }
      log(cfg.id, '->', short(vr.vault), fmt(amt), 'MON', r.status, `${EXP}/tx/${hash}`);
    } catch (e) { vr.note = `send failed: ${errMsg(e)}`; res.problems.push(`${cfg.id}: ${vr.note}`); log(cfg.id, vr.note); }
  }
}

// ---- snapshot after + alert ----
let spare = 0n;
for (const { row } of agents) { row.after = await bal(row.agent); if (row.hasKey && row.after > row.floor) spare += row.after - row.floor; }
for (const vr of res.vaults) vr.after = await bal(vr.vault).catch(() => null);
res.combinedSpareMon = formatEther(spare);
const floatNow = await bal(REFILLER).catch(() => null); res.refiller.floatAfter = floatNow;
res.floatMon = floatNow == null ? '?' : formatEther(floatNow);
const above = res.vaults.filter(v => v.after != null && v.after > VAULT_ALERT).map(v => ({ id: v.id, vault: v.vault, mon: formatEther(v.after) }));
res.alert = { paused: res.paused, lowFloat: floatNow != null && floatNow < FLOAT_ALERT, floatMon: res.floatMon, floatThresholdMon: CFG.alertFloatBelowMon, vaultsAbove: above, vaultThresholdMon: CFG.alertVaultAboveMon };
res.alert.active = res.paused.length > 0 || res.alert.lowFloat || above.length > 0;

// ---- step summary ----
const L = [];
L.push(`## Agent refill ${DRY ? '(dry run)' : ''}`, '', `Refiller [${short(REFILLER)}](${EXP}/address/${REFILLER}): ${res.refiller.note} · float **${res.refiller.floatBefore == null ? '?' : fmt(res.refiller.floatBefore)} → ${floatNow == null ? '?' : fmt(floatNow)} MON** (alert below ${CFG.alertFloatBelowMon}) · vaults above ${CFG.alertVaultAboveMon} MON: ${above.length ? above.map(v => v.id).join(', ') : 'none'} · agent MON above target: ${fmt(spare)}`, '');
L.push('### Team vaults', '', '| vault | address | paused | before | after | target | result |', '|---|---|---|---:|---:|---:|---|');
for (const v of res.vaults) L.push(`| ${v.id} | [${short(v.vault)}](${EXP}/address/${v.vault}) | ${v.paused} | ${v.before == null ? '?' : fmt(v.before)} | ${v.after == null ? '?' : fmt(v.after)} | ${fmt(v.target)} | ${v.note} |`);
L.push('', '### Agent gas wallets', '', '| agent | address | key | before | after | sent |', '|---|---|---|---:|---:|---:|');
for (const a of res.agents) L.push(`| ${a.id} | [${short(a.agent)}](${EXP}/address/${a.agent}) | ${a.hasKey ? 'yes' : 'no'} | ${a.before == null ? '?' : fmt(a.before)} | ${a.after == null ? '?' : fmt(a.after)} | ${fmt(a.sent)} |`);
L.push('', '### Transactions', '');
if (res.txs.length) for (const t of res.txs) L.push(`- ${t.id}: ${t.amountMon} MON → ${short(t.to)} · ${t.status} · [${t.hash}](${EXP}/tx/${t.hash})`); else L.push('- none');
if (res.paused.length) L.push('', `**Paused team vaults (owner must setPaused(false)):** ${res.paused.map(p => `${p.id} ${p.vault}`).join(', ')}`);
if (res.problems.length) L.push('', '### Problems', '', ...res.problems.map(p => `- ${p}`));
const md = L.join('\n') + '\n';
if (E.GITHUB_STEP_SUMMARY) fs.appendFileSync(E.GITHUB_STEP_SUMMARY, md); else console.log(md);
fs.writeFileSync(OUT, JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? formatEther(v) : v), 1));
log('done:', res.txs.length, 'tx(s), combined spare', fmt(spare), 'MON, paused', res.paused.length, res.alert.active ? '(ALERT)' : '');
process.exit(0); // viem keeps sockets open; do not hang the job
