// Live showcase of AgentVault on Monad (testnet or mainnet). Owner = deployer key from env, agent = fresh key saved to
// ~/.policypilot/agent-<chainId>.env (chmod 600). Keys are never printed. Writes a public record (tx hashes only).
// Usage: CHAIN=143|10143 FACTORY=0x... OWNER_KEY_ENV=MONAD_MAINNET_PRIVATE_KEY node vault-showcase.mjs
import fs from 'node:fs'; import os from 'node:os';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, encodeFunctionData, decodeErrorResult, keccak256, toHex, parseAbi, getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const CHAIN = Number(process.env.CHAIN); const MAIN = CHAIN === 143;
const RPC = process.env.RPC || (MAIN ? 'https://rpc.monad.xyz' : 'https://testnet-rpc.monad.xyz');
const EXP = MAIN ? 'https://monadvision.com' : 'https://testnet.monadexplorer.com';
const chain = { id: CHAIN, name: MAIN ? 'Monad' : 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const ownerKey = process.env[process.env.OWNER_KEY_ENV]; if (!ownerKey) throw new Error('owner key env missing');
const owner = privateKeyToAccount(ownerKey);
const agentFile = `${os.homedir()}/.policypilot/agent-${CHAIN}.env`;
let agentKey; if (fs.existsSync(agentFile)) agentKey = fs.readFileSync(agentFile, 'utf8').match(/AGENT_KEY=(0x[0-9a-f]+)/i)[1];
else { agentKey = generatePrivateKey(); fs.writeFileSync(agentFile, `AGENT_KEY=${agentKey}\n`, { mode: 0o600 }); }
const agent = privateKeyToAccount(agentKey);
const pub = createPublicClient({ chain, transport: http(RPC) });
const ow = createWalletClient({ account: owner, chain, transport: http(RPC) });
const ag = createWalletClient({ account: agent, chain, transport: http(RPC) });
const ART = JSON.parse(fs.readFileSync(new URL('../frontend/vault-artifacts.json', import.meta.url)));
const REG = JSON.parse(fs.readFileSync(new URL('../frontend/dapps.json', import.meta.url)))[String(CHAIN)];
const fAbi = ART.factory.abi, vAbi = ART.vault.abi;
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const quoter = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)']);
const routerAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const wmonAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256)']);
const kintsuAbi = parseAbi(['function deposit(uint96 minShares,address receiver) payable returns (uint96)']);
const QUOTER = '0x661e93cca42afacb172121ef892830ca3b70f08d';
const FACTORY = getAddress(process.env.FACTORY);
const out = { chainId: CHAIN, explorer: EXP, factory: FACTORY, owner: owner.address, agent: agent.address, startedAt: new Date().toISOString(), steps: [] };
const outFile = new URL(`../frontend/showcase-${CHAIN}.json`, import.meta.url);
const save = () => fs.writeFileSync(outFile, JSON.stringify(out, (k, v) => typeof v === 'bigint' ? v.toString() : v, 1));
const startBal = await pub.getBalance({ address: owner.address }); out.ownerStartBalance = formatEther(startBal);
console.log('owner', owner.address, 'balance', formatEther(startBal), 'agent', agent.address);
const allErr = [...vAbi.filter(x => x.type === 'error')];
const why = e => { let x = e; while (x) { const d = x.data?.data ?? x.data ?? x.raw; if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) { try { const r = decodeErrorResult({ abi: allErr, data: d }); return `${r.errorName}(${(r.args || []).map(String).join(', ')})`; } catch {} } x = x.cause; } return (e.shortMessage || e.message).split('\n')[0]; };

async function step(label, kind, wallet, req, { expectRevert = false, gas } = {}) {
  let reason = null;
  try { await pub.call({ account: wallet.account, to: req.to, data: req.data, value: req.value || 0n }); if (expectRevert) throw new Error('expected revert but simulation passed'); }
  catch (e) { if (!expectRevert) throw new Error(`${label}: simulation reverted: ${why(e)}`); reason = why(e); }
  const g = gas || (await pub.estimateGas({ account: wallet.account, ...req })) * 13n / 10n;
  const hash = await wallet.sendTransaction({ ...req, gas: g });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180000 });
  const fee = rc.gasUsed * rc.effectiveGasPrice;
  const s = { label, kind, from: wallet.account.address, tx: hash, block: rc.blockNumber, status: rc.status, gasLimit: g, gasUsed: rc.gasUsed, feeMON: formatEther(fee), revertReason: reason, explorer: `${EXP}/tx/${hash}` };
  out.steps.push(s); save(); console.log(rc.status.padEnd(8), label, reason || '', `${formatEther(fee)} MON`);
  if (!expectRevert && rc.status !== 'success') throw new Error(`${label} failed on-chain`);
  return rc;
}
const vcall = (vault, fn, args, value = 0n) => ({ to: vault, data: encodeFunctionData({ abi: vAbi, functionName: fn, args }), value });
const rid = s => keccak256(toHex(`${s}:${Date.now()}`));
const NONE = { approveToken: '0x0000000000000000000000000000000000000000', approveAmount: 0n, outToken: '0x0000000000000000000000000000000000000000', minOut: 0n };

const CAP = parseEther(process.env.CAP || '0.05'), BUDGET = parseEther(process.env.BUDGET || '0.15'), DEP = parseEther(process.env.DEPOSIT || '0.2');
const rules = [], caps = [];
for (const d of REG.dapps) { for (const r of d.rules) rules.push({ target: d.address, selector: r.selector, recipientWord: r.recipientWord });
  for (const c of d.tokenCaps) caps.push({ token: REG.tokens[c.token].address, cap: BigInt(c.cap) }); }
// 1. one-tx harness
const rc0 = await step('Create vault: limits + recipients + dapp rules + deposit (1 tx)', 'owner', ow, { to: FACTORY, value: DEP, data: encodeFunctionData({ abi: fAbi, functionName: 'createVault', args: [agent.address, CAP, BUDGET, [owner.address], rules, caps] }) });
const vaults = await pub.readContract({ address: FACTORY, abi: fAbi, functionName: 'vaultsOf', args: [owner.address] });
const V = vaults[vaults.length - 1]; out.vault = V; save(); console.log('vault', V);
await step('Top up agent key with gas', 'owner', ow, { to: agent.address, value: parseEther(process.env.AGENT_GAS || (MAIN ? '0.3' : '0.1')) });
// 2. allowed actions
await step('Agent pays an allowlisted recipient 0.01 MON', 'allowed', ag, vcall(V, 'execute', [rid('pay1'), owner.address, parseEther('0.01')]));
if (MAIN) {
  const T = REG.tokens, W = T.WMON.address, U = T.USDC.address, S = T.sMON.address;
  const R = REG.dapps.find(d => d.id === 'uniswap').address, K = REG.dapps.find(d => d.id === 'kintsu').address;
  await step('Agent wraps 0.02 MON → WMON', 'allowed', ag, vcall(V, 'executeCall', [rid('wrap'), W, parseEther('0.02'), encodeFunctionData({ abi: wmonAbi, functionName: 'deposit' }), { ...NONE, outToken: W, minOut: parseEther('0.02') }]));
  const amtIn = parseEther('0.03');
  const q = await pub.simulateContract({ address: QUOTER, abi: quoter, functionName: 'quoteExactInputSingle', args: [{ tokenIn: W, tokenOut: U, amountIn: amtIn, fee: 3000, sqrtPriceLimitX96: 0n }] });
  const minU = q.result[0] * 97n / 100n; out.quoteMonToUsdc = { amountIn: amtIn, quotedOut: q.result[0], minOut: minU };
  await step('Agent swaps 0.03 MON → USDC on Uniswap v3 (minOut = quote − 3%)', 'allowed', ag, vcall(V, 'executeCall', [rid('swap1'), R, amtIn, encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: W, tokenOut: U, fee: 3000, recipient: V, amountIn: amtIn, amountOutMinimum: minU, sqrtPriceLimitX96: 0n }] }), { ...NONE, outToken: U, minOut: minU }]));
  const usdc = await pub.readContract({ address: U, abi: erc20, functionName: 'balanceOf', args: [V] });
  const q2 = await pub.simulateContract({ address: QUOTER, abi: quoter, functionName: 'quoteExactInputSingle', args: [{ tokenIn: U, tokenOut: W, amountIn: usdc, fee: 3000, sqrtPriceLimitX96: 0n }] });
  const minW = q2.result[0] * 97n / 100n;
  await step(`Agent swaps ${Number(usdc) / 1e6} USDC → WMON (exact approval, reset to 0 after)`, 'allowed', ag, vcall(V, 'executeCall', [rid('swap2'), R, 0n, encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: U, tokenOut: W, fee: 3000, recipient: V, amountIn: usdc, amountOutMinimum: minW, sqrtPriceLimitX96: 0n }] }), { approveToken: U, approveAmount: usdc, outToken: W, minOut: minW }]));
  const wbal = await pub.readContract({ address: W, abi: erc20, functionName: 'balanceOf', args: [V] });
  await step('Agent unwraps all WMON → MON', 'allowed', ag, vcall(V, 'executeCall', [rid('unwrap'), W, 0n, encodeFunctionData({ abi: wmonAbi, functionName: 'withdraw', args: [wbal] }), { ...NONE, outToken: '0x0000000000000000000000000000000000000000', minOut: wbal }]));
  await step('Agent stakes 0.01 MON with Kintsu → sMON', 'allowed', ag, vcall(V, 'executeCall', [rid('stake'), K, parseEther('0.01'), encodeFunctionData({ abi: kintsuAbi, functionName: 'deposit', args: [1n, V] }), { ...NONE, outToken: S, minOut: 1n }]));
  // blocked
  await step('BLOCKED: agent tries to move USDC out with transfer() (not an allowlisted call)', 'blocked', ag, vcall(V, 'executeCall', [rid('b2'), U, 0n, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [agent.address, 1n] }), NONE]), { expectRevert: true, gas: 120000n });
  await step('BLOCKED: agent tries a swap that pays itself instead of the vault', 'blocked', ag, vcall(V, 'executeCall', [rid('b3'), R, parseEther('0.01'), encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: W, tokenOut: U, fee: 3000, recipient: agent.address, amountIn: parseEther('0.01'), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] }), { ...NONE, outToken: U, minOut: 1n }]), { expectRevert: true, gas: 120000n });
  await step('BLOCKED: agent calls a dapp that is not on the list (sMON transfer)', 'blocked', ag, vcall(V, 'executeCall', [rid('b6'), S, 0n, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [agent.address, 1n] }), NONE]), { expectRevert: true, gas: 120000n });
}
await step('BLOCKED: agent tries to pay 0.08 MON (over the 0.05 per-payment cap)', 'blocked', ag, vcall(V, 'execute', [rid('b1'), owner.address, parseEther('0.08')]), { expectRevert: true, gas: 120000n });
await step('BLOCKED: agent tries to pay a non-allowlisted address', 'blocked', ag, vcall(V, 'execute', [rid('b4'), '0x000000000000000000000000000000000000dEaD', parseEther('0.01')]), { expectRevert: true, gas: 120000n });
await step('Owner pauses the agent', 'owner', ow, vcall(V, 'setPaused', [true]));
await step('BLOCKED: agent tries to pay while paused', 'blocked', ag, vcall(V, 'execute', [rid('b5'), owner.address, parseEther('0.01')]), { expectRevert: true, gas: 120000n });
await step('BLOCKED: agent tries to withdraw the vault (owner only)', 'blocked', ag, vcall(V, 'withdraw', [agent.address, parseEther('0.01')]), { expectRevert: true, gas: 120000n });
// cleanup: owner pulls everything back
await step('Owner emergency-withdraws all MON', 'owner', ow, vcall(V, 'emergencyWithdrawAll', []));
if (MAIN) { const S = REG.tokens.sMON.address; const sb = await pub.readContract({ address: S, abi: erc20, functionName: 'balanceOf', args: [V] }); if (sb > 0n) await step('Owner withdraws sMON to own wallet', 'owner', ow, vcall(V, 'withdrawToken', [S, owner.address, sb])); }
const ab = await pub.getBalance({ address: agent.address }); const gp = await pub.getGasPrice();
const left = ab - 21000n * gp * 2n; if (left > 0n) await step('Agent returns unused gas MON to owner', 'owner', ag, { to: owner.address, value: left }, { gas: 21000n });
const endBal = await pub.getBalance({ address: owner.address });
out.ownerEndBalance = formatEther(endBal); out.netMonSpent = formatEther(startBal - endBal); out.finishedAt = new Date().toISOString(); save();
console.log('done. vault', V, 'net MON spent by owner (incl. sMON held as stake)', formatEther(startBal - endBal));
