// One-off: unpause the legacy DCA vault (approved) and recover the v1 Staker/Payroll/Rogue vaults + their agent gas. Legacy DCA vault funds are left alone.
import fs from 'node:fs'; import os from 'node:os';
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { agentVaultAbi } from '../packages/agent-kit/dist/index.js';
const RPC = 'https://rpc.monad.xyz'; const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const env = Object.fromEntries(fs.readFileSync(os.homedir() + '/.policypilot/mainnet-wallet.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0, 2).map(s => s.trim())));
const st = JSON.parse(fs.readFileSync(os.homedir() + '/.policypilot/showcase-agents-143.json', 'utf8'));
const pc = createPublicClient({ chain, transport: http(RPC, { timeout: 20000, retryCount: 3 }) }); const owner = privateKeyToAccount(env.MONAD_MAINNET_PRIVATE_KEY);
const ow = createWalletClient({ account: owner, chain, transport: http(RPC) });
const L = '/workspace/policypilot/evidence/showcase-ledger-143v2.jsonl'; const rec = x => fs.appendFileSync(L, JSON.stringify({ ts: new Date().toISOString(), era: 'migration', ...x }) + '\n');
const otx = async (label, persona, to, data) => { const gas = (await pc.estimateGas({ account: owner.address, to, data }) * 115n) / 100n; const h = await ow.sendTransaction({ to, data, gas }); const r = await pc.waitForTransactionReceipt({ hash: h }); console.log(r.status, label, `https://monadvision.com/tx/${h}`); rec({ persona, actor: 'owner', label, status: 'owner', tx: h }); return h; };
const T = ['0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', '0xA3227C5969757783154C60bF0bC1944180ed81B9', '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081'];
const erc = parseAbi(['function balanceOf(address) view returns (uint256)']);
const dca = st.agents.dca.vault;
if (await pc.readContract({ address: dca, abi: agentVaultAbi, functionName: 'paused' })) await otx('Owner unpauses the legacy DCA bot vault', 'dca1', dca, encodeFunctionData({ abi: agentVaultAbi, functionName: 'setPaused', args: [false] }));
for (const id of ['staker', 'payroll', 'rogue']) {
  const v = st.agents[id].vault;
  for (const t of T) { const b = await pc.readContract({ address: t, abi: erc, functionName: 'balanceOf', args: [v] }); if (b > 0n) await otx(`Owner pulls tokens out of v1 ${id} vault`, id, v, encodeFunctionData({ abi: agentVaultAbi, functionName: 'withdrawToken', args: [t, owner.address, b] })); }
  if (await pc.getBalance({ address: v }) > 0n) await otx(`Owner pulls all MON out of v1 ${id} vault`, id, v, encodeFunctionData({ abi: agentVaultAbi, functionName: 'withdraw', args: [ (await import('viem')).getAddress(process.env.OWNER || '0xc0c4E411e41bECAD6DA860F67063C2D6363a6113'), await pc.getBalance({ address: v }) ] }));
  const ag = privateKeyToAccount(st.agents[id].key); const w = createWalletClient({ account: ag, chain, transport: http(RPC) });
  const g = await pc.getBalance({ address: ag.address }); const gp = await pc.getGasPrice(); const fee = 21000n * gp * 2n;
  if (g > fee) { const h = await w.sendTransaction({ to: owner.address, value: g - fee, gas: 21000n, maxFeePerGas: gp * 2n, maxPriorityFeePerGas: gp / 50n }); const r = await pc.waitForTransactionReceipt({ hash: h }); console.log(r.status, `sweep v1 ${id} agent gas`, formatEther(g - fee)); rec({ persona: id, actor: 'agent-sweep', label: `Return v1 ${id} agent gas`, status: 'owner', tx: h }); }
}
