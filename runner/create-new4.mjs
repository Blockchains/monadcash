// One-off: create the v3 team showcase vaults (DCA, Staker incl. Kuru, Payroll, Rogue) on the v3 factory.
// New agent keys are written ONLY to ~/.policypilot/showcase-agents-143v3.json (0600); never printed.
//   RPC=... FACTORY=... node runner/create-v3.mjs
import fs from 'node:fs'; import os from 'node:os';
import { createPublicClient, createWalletClient, http, parseEther, encodeFunctionData, decodeEventLog } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { agentVaultFactoryAbi } from '../packages/agent-kit/dist/index.js';
const RPC = process.env.RPC || 'https://rpc.monad.xyz'; const FACTORY = process.env.FACTORY;
const KEYS = process.env.KEYS_FILE || os.homedir() + '/.policypilot/showcase-agents-143v3.json';
const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const env = Object.fromEntries(fs.readFileSync(os.homedir() + '/.policypilot/mainnet-wallet.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0, 2).map(s => s.trim())));
const owner = privateKeyToAccount(env.MONAD_MAINNET_PRIVATE_KEY);
const pc = createPublicClient({ chain, transport: http(RPC, { timeout: 30000, retryCount: 3 }) }); const ow = createWalletClient({ account: owner, chain, transport: http(RPC) });
const T = { WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', sMON: '0xA3227C5969757783154C60bF0bC1944180ed81B9', aprMON: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', gMON: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081' };
const UNI = '0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900', PCS = '0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C';
const R = { kuru: ['0xd651346d7c789536ebf06dc72aE3C8502cd695CC', '0xffa5210a', 255], uni: [UNI, '0x04e45aaf', 3], pcs: [PCS, '0x04e45aaf', 3], kintsu: [T.sMON, '0x1c3477dd', 1], apriori: [T.aprMON, '0x6e553f65', 1], magma: [T.gMON, '0x5f3896d3', 0], wrap: [T.WMON, '0xd0e30db0', 255], unwrap: [T.WMON, '0x2e1a7d4d', 255] };
const rule = k => ({ target: R[k][0], selector: R[k][1], recipientWord: R[k][2] });
const cfg = JSON.parse(fs.readFileSync(new URL('./showcase-config-143.json', import.meta.url), 'utf8'));
const team = cfg.agents.map(a => a.agent).filter(Boolean);
const P = [
  { id: 'mm', cap: '0.05', budget: '5', deposit: '2', rules: ['kuru', 'uni', 'unwrap'], caps: [[T.USDC, 5_000_000n], [T.WMON, parseEther('1')]] },
  { id: 'rebalancer', cap: '0.05', budget: '5', deposit: '2', rules: ['wrap', 'unwrap'], caps: [] },
  { id: 'tipper', cap: '0.005', budget: '1', deposit: '1', rules: [], caps: [], payees: team },
  { id: 'tester', cap: '0.05', budget: '2', deposit: '1', rules: ['wrap', 'unwrap', 'uni'], caps: [[T.WMON, parseEther('0.5')]], payees: [owner.address] },
];
const st = fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : { agents: {} };
const save = () => fs.writeFileSync(KEYS, JSON.stringify(st, null, 1), { mode: 0o600 });
for (const p of P) if (!st.agents[p.id]) { st.agents[p.id] = { key: generatePrivateKey() }; save(); }
const addr = id => privateKeyToAccount(st.agents[id].key).address;
for (const p of P) {
  const a = st.agents[p.id]; if (a.vault) { console.log(p.id, 'exists', a.vault); continue; }
  const data = encodeFunctionData({ abi: agentVaultFactoryAbi, functionName: 'createVault', args: [addr(p.id), parseEther(p.cap), parseEther(p.budget), p.payees || [], p.rules.map(rule), p.caps.map(([token, cap]) => ({ token, cap }))] });
  const value = parseEther(p.deposit); const gas = (await pc.estimateGas({ account: owner.address, to: FACTORY, data, value }) * 115n) / 100n;
  const hash = await ow.sendTransaction({ to: FACTORY, data, value, gas }); const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('create failed ' + p.id + ' ' + hash);
  const ev = r.logs.map(l => { try { return decodeEventLog({ abi: agentVaultFactoryAbi, ...l }); } catch { return null; } }).find(e => e?.eventName === 'VaultCreated');
  a.vault = ev.args.vault; a.agent = addr(p.id); a.tx = hash; save();
  console.log(p.id, 'vault', a.vault, 'agent', a.agent, 'tx', hash);
}
for (const p of P) { const a = st.agents[p.id]; if (a.gasTx) continue;
  const h = await ow.sendTransaction({ to: a.agent, value: parseEther('1') }); await pc.waitForTransactionReceipt({ hash: h }); a.gasTx = h; save(); console.log(p.id, 'gas 1 MON', h); }
