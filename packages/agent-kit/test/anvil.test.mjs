// Runs against a local anvil (ANVIL_RPC, default http://127.0.0.1:8545). Deploys fresh MockToken + PolicyPilot from forge artifacts.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseUnits, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PolicyClient, requestIdFor } from '../dist/index.js';
const RPC = process.env.ANVIL_RPC || 'http://127.0.0.1:8545';
const art = n => JSON.parse(readFileSync(new URL(`../../../out/${n}.sol/${n}.json`, import.meta.url)));
// anvil default dev keys (public, test-only)
const admin = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const exec = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ok = '0x00000000000000000000000000000000000000a1', stranger = '0x00000000000000000000000000000000000000b2';
let pc, chain, pol, kit, tok; const u = x => parseUnits(String(x), 18);
before(async () => {
  const probe = createPublicClient({ transport: http(RPC) }); const id = await probe.getChainId();
  chain = defineChain({ id, name: 'anvil', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  pc = createPublicClient({ chain, transport: http(RPC) }); const aw = createWalletClient({ account: admin, chain, transport: http(RPC) });
  const dep = async (n, args) => { const a = art(n); const h = await aw.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }); return (await pc.waitForTransactionReceipt({ hash: h })).contractAddress; };
  const T = art('MockToken'), P = art('PolicyPilot');
  tok = await dep('MockToken', []);
  pol = await dep('PolicyPilot', [tok, admin.address, exec.address, u(100), u(250)]);
  const w = async (address, abi, functionName, args) => pc.waitForTransactionReceipt({ hash: await aw.writeContract({ address, abi, functionName, args }) });
  await w(tok, T.abi, 'mint', [pol, u(1000)]); await w(pol, P.abi, 'setRecipient', [ok, true]);
  kit = new PolicyClient({ address: pol, publicClient: pc, walletClient: createWalletClient({ account: exec, chain, transport: http(RPC) }) });
  kit.admin = (fn, args) => w(pol, P.abi, fn, args); kit.bal = a => pc.readContract({ address: tok, abi: T.abi, functionName: 'balanceOf', args: [a] });
});
test('checkPolicy PASS for allowed recipient within limits (eth_call)', async () => { const r = await kit.checkPolicy(ok, u(10)); assert.equal(r.ok, true); });
test('checkPolicy FAIL names exact errors', async () => {
  assert.equal((await kit.checkPolicy(stranger, u(10))).error, 'RecipientNotAllowed');
  assert.equal((await kit.checkPolicy(ok, u(101))).error, 'PerRequestLimitExceeded');
  assert.equal((await kit.checkPolicy(ok, 0n)).error, 'ZeroAmount');
});
test('executeSafePayment pays, then replay is rejected, budget tracked exactly', async () => {
  const r = await kit.executeSafePayment(ok, u(100), { idempotencyKey: 'invoice-1' }); assert.equal(r.status, 'executed');
  assert.equal(await kit.bal(ok), u(100));
  const again = await kit.executeSafePayment(ok, u(1), { idempotencyKey: 'invoice-1' }); assert.equal(again.status, 'rejected'); assert.equal(again.check.error, 'RequestAlreadyExecuted');
  await kit.executeSafePayment(ok, u(100)); const s = await kit.state(); assert.equal(s.totalSpent, u(200)); assert.equal(s.remaining, u(50));
  const over = await kit.executeSafePayment(ok, u(60)); assert.equal(over.status, 'rejected'); assert.equal(over.check.error, 'BudgetExceeded');
  assert.equal(await kit.bal(ok), u(200));
});
test('paused contract rejects, no tx sent', async () => {
  await kit.admin('setPaused', [true]); const before = await pc.getTransactionCount({ address: exec.address });
  const r = await kit.executeSafePayment(ok, u(1)); assert.equal(r.status, 'rejected'); assert.equal(r.check.error, 'Paused');
  assert.equal(await pc.getTransactionCount({ address: exec.address }), before); await kit.admin('setPaused', [false]);
});
test('simulation catches what precheck cannot (wrong signer => NotExecutor)', async () => {
  const bad = new PolicyClient({ address: pol, publicClient: pc, walletClient: createWalletClient({ account: admin, chain, transport: http(RPC) }) });
  const r = await bad.checkPolicy(ok, u(1)); assert.equal(r.ok, false); assert.equal(r.stage, 'simulation'); assert.equal(r.error, 'NotExecutor');
});
