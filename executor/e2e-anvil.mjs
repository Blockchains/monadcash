// Local-only e2e demo. Uses anvil's well-known PUBLIC dev accounts (no real funds, not secrets).
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import fs from 'node:fs';
import { executeRequest } from './executor.mjs';
const art = n => JSON.parse(fs.readFileSync(new URL(`../out/${n}.sol/${n}.json`, import.meta.url)));
const PP = art('PolicyPilot'), TK = art('MockToken');
const rpc = process.env.RPC ?? 'http://127.0.0.1:8545';
const ANVIL0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil default dev key
const ANVIL1 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // anvil default dev key
const admin = privateKeyToAccount(ANVIL0), execA = privateKeyToAccount(ANVIL1);
const pub = createPublicClient({ chain: foundry, transport: http(rpc) });
const wa = createWalletClient({ account: admin, chain: foundry, transport: http(rpc) });
const we = createWalletClient({ account: execA, chain: foundry, transport: http(rpc) });
const dep = async (a, args=[]) => (await pub.waitForTransactionReceipt({ hash: await wa.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }) })).contractAddress;
const send = async (address, abi, functionName, args) => pub.waitForTransactionReceipt({ hash: await wa.writeContract({ address, abi, functionName, args }) });
const token = await dep(TK);
const pp = await dep(PP, [token, admin.address, execA.address, parseUnits('100',18), parseUnits('250',18)]);
const bob = '0x000000000000000000000000000000000000b0b0', eve = '0x000000000000000000000000000000000000e0e0';
await send(token, TK.abi, 'mint', [pp, parseUnits('1000',18)]);
await send(pp, PP.abi, 'setRecipient', [bob, true]);
const ctx = { pub, wallet: we, abi: PP.abi, address: pp };
const steps = [];
for (const [key, r, a] of [['inv-001', bob, '60'], ['inv-001', bob, '60'], ['inv-002', eve, '10'], ['inv-003', bob, '101'], ['inv-004', bob, '100'], ['inv-005', bob, '100']]) {
  const res = await executeRequest({ ...ctx, key, recipient: r, amount: parseUnits(a,18) });
  steps.push({ key, recipient: r, amount: a, ...res }); console.log(key, a, res.status, res.reason ?? '');
}
const bal = await pub.readContract({ address: token, abi: TK.abi, functionName: 'balanceOf', args: [bob] });
const spent = await pub.readContract({ address: pp, abi: PP.abi, functionName: 'totalSpent' });
const out = { generatedAt: new Date().toISOString(), network: 'local anvil (chainId 31337) - NOT a public network', token, policyPilot: pp, steps, bobBalance: bal.toString(), totalSpent: spent.toString() };
fs.writeFileSync(process.env.OUT ?? 'e2e-evidence.json', JSON.stringify(out, null, 2));
console.log('totalSpent', spent.toString(), 'bob', bal.toString());
