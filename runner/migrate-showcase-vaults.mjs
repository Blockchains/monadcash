// ONE-TIME, BOX-ONLY (owner key). PolicyPilot showcase agents (operated by the team). ALPHA / UNAUDITED.
// Copies each old team vault's policy (executor, perPaymentCap, recipients, call rules, token caps) into a new
// ShowcaseAgentVault (agent-callable sweepToOwner()/unpause()) created by ShowcaseVaultFactory.
//   node runner/migrate-showcase-vaults.mjs plan            -> prints the copied policies (read-only)
//   MONAD_MAINNET_PRIVATE_KEY=... node runner/migrate-showcase-vaults.mjs create <depositMon>
// HISTORICAL (one-time, 2026-10-18). Since PR #43 the team vaults' caps/budgets are max; the copied caps are not recorded.
// The key is read from env and never printed. Output: runner/showcase-vaults-v4-143.json
import fs from 'node:fs'; import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseAbi, getAddress, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'agent-refill-config-143.json'), 'utf8'));
const FACTORY = getAddress('0x7611405605a9d630f3e7f4703897fcf1dc17f945');
const BUDGET = parseEther('1000');
const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } } };
const pc = createPublicClient({ chain, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const vAbi = parseAbi(['function executor() view returns (address)', 'function owner() view returns (address)', 'function perPaymentCap() view returns (uint256)', 'function allowedRecipient(address) view returns (bool)', 'function callRule(address,bytes4) view returns (bool allowed, uint8 recipientWord)', 'function tokenCap(address) view returns (uint256)']);
const fAbi = parseAbi(['struct CallRuleInit { address target; bytes4 selector; uint8 recipientWord; }', 'struct TokenCapInit { address token; uint256 cap; }',
  'function createVault(address executor, uint256 perPaymentCap, uint256 budget, address[] recipients, CallRuleInit[] rules, TokenCapInit[] caps) payable returns (address)',
  'event VaultCreated(address indexed owner, address indexed vault, address indexed executor)']);
const T = { WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', sMON: '0xA3227C5969757783154C60bF0bC1944180ed81B9', aprMON: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', gMON: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081' };
const RULES = [['0xd651346d7c789536ebf06dc72aE3C8502cd695CC', '0xffa5210a'], ['0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900', '0x04e45aaf'], ['0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C', '0x04e45aaf'],
  [T.sMON, '0x1c3477dd'], [T.aprMON, '0x6e553f65'], [T.gMON, '0x5f3896d3'], [T.WMON, '0xd0e30db0'], [T.WMON, '0x2e1a7d4d']];
const OWNER = getAddress(CFG.owner);
const cands = [OWNER, ...CFG.agents.map(a => getAddress(a.agent))];
const rd = (v, f, args) => pc.readContract({ address: v, abi: vAbi, functionName: f, args });
const plan = [];
for (const a of CFG.agents) for (const { vault } of a.vaults) {
  const [executor, owner, cap] = await Promise.all([rd(vault, 'executor'), rd(vault, 'owner'), rd(vault, 'perPaymentCap')]);
  if (getAddress(owner) !== OWNER || getAddress(executor) !== getAddress(a.agent)) throw new Error(`${a.id}: owner/executor mismatch`);
  const recipients = []; for (const c of cands) if (await rd(vault, 'allowedRecipient', [c])) recipients.push(c);
  const rules = []; for (const [t, s] of RULES) { const [ok, w] = await rd(vault, 'callRule', [t, s]); if (ok) rules.push({ target: getAddress(t), selector: s, recipientWord: w }); }
  const caps = []; for (const t of [T.USDC, T.WMON]) { const c = await rd(vault, 'tokenCap', [t]); if (c > 0n) caps.push({ token: getAddress(t), cap: c }); }
  plan.push({ id: a.id, old: vault, executor: getAddress(executor), perPaymentCap: cap, recipients, rules, caps });
}
const show = x => JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v);
if (process.argv[2] !== 'create') { for (const p of plan) console.log(show(p)); process.exit(0); }
const dep = parseEther(process.argv[3] || '2');
const acct = privateKeyToAccount(process.env.MONAD_MAINNET_PRIVATE_KEY.startsWith('0x') ? process.env.MONAD_MAINNET_PRIVATE_KEY : '0x' + process.env.MONAD_MAINNET_PRIVATE_KEY);
if (acct.address !== OWNER) throw new Error('key is not the deployer');
const wc = createWalletClient({ account: acct, chain, transport: http(undefined, { retryCount: 3 }) });
const OUTF = path.join(HERE, 'showcase-vaults-v4-143.json');
const out = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : { label: 'PolicyPilot showcase agents (operated by the team)', note: 'ALPHA / UNAUDITED. ShowcaseAgentVaults (agent-callable sweepToOwner keeps 1 MON; agent-callable unpause).', factory: FACTORY, vaults: {} };
for (const p of plan) {
  if (out.vaults[p.id]) { console.log(p.id, 'exists', out.vaults[p.id].vault); continue; } // idempotent
  const reserve = parseEther('5'), bal = await pc.getBalance({ address: OWNER });
  if (bal < dep + reserve + parseEther('1')) throw new Error('would break the 5 MON reserve');
  const hash = await wc.writeContract({ address: FACTORY, abi: fAbi, functionName: 'createVault', args: [p.executor, p.perPaymentCap, BUDGET, p.recipients, p.rules, p.caps], value: dep });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success') throw new Error(`${p.id} create reverted ${hash}`);
  const ev = parseEventLogs({ abi: fAbi, logs: r.logs, eventName: 'VaultCreated' })[0];
  out.vaults[p.id] = { vault: getAddress(ev.args.vault), executor: p.executor, old: p.old, createdTx: hash }; // caps/budget not recorded: limits were removed on 2026-10-18 (PR #43)
  fs.writeFileSync(OUTF, JSON.stringify(out, null, 2) + '\n');
  console.log(p.id, out.vaults[p.id].vault, hash);
}
