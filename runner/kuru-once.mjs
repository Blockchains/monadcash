// One tiny real Kuru swap through the team's Staker showcase vault (owner adds the Kuru rule first).
import fs from 'node:fs'; import os from 'node:os';
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { VaultAgent, agentVaultAbi } from '../packages/agent-kit/dist/index.js';
const RPC = 'https://rpc.monad.xyz'; const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const env = Object.fromEntries(fs.readFileSync(os.homedir() + '/.policypilot/mainnet-wallet.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0, 2).map(s => s.trim())));
const st = JSON.parse(fs.readFileSync(os.homedir() + '/.policypilot/showcase-agents-143.json', 'utf8'));
const pc = createPublicClient({ chain, transport: http(RPC) });
const owner = createWalletClient({ account: privateKeyToAccount(env.MONAD_MAINNET_PRIVATE_KEY), chain, transport: http(RPC) });
const agent = createWalletClient({ account: privateKeyToAccount(st.agents.staker.key), chain, transport: http(RPC) });
const V = st.agents.staker.vault; const ROUTER = '0xd651346d7c789536ebf06dc72aE3C8502cd695CC', MKT = '0x065C9d28E428A0db40191a54d33d5b7c71a9C394', USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', Z = '0x0000000000000000000000000000000000000000';
const SEL = '0xffa5210a'; const kuru = parseAbi(['function anyToAnySwap(address[],bool[],bool[],address,address,uint256,uint256) payable returns (uint256)']); const erc = parseAbi(['function balanceOf(address) view returns (uint256)']);
const out = { vault: V };
const [ok] = await pc.readContract({ address: V, abi: agentVaultAbi, functionName: 'callRule', args: [ROUTER, SEL] });
if (!ok) { const data = encodeFunctionData({ abi: agentVaultAbi, functionName: 'setCallRule', args: [ROUTER, SEL, true, 255] }); const gas = (await pc.estimateGas({ account: owner.account.address, to: V, data }) * 115n) / 100n; const h = await owner.sendTransaction({ to: V, data, gas }); const r = await pc.waitForTransactionReceipt({ hash: h }); out.ruleTx = h; out.ruleStatus = r.status; }
const amt = parseEther('0.01');
const sim = await pc.simulateContract({ account: V, address: ROUTER, abi: kuru, functionName: 'anyToAnySwap', args: [[MKT], [false], [true], Z, USDC, amt, 1n], value: amt });
const minOut = (sim.result * 97n) / 100n; out.quotedUSDC = String(sim.result);
const before = await pc.readContract({ address: USDC, abi: erc, functionName: 'balanceOf', args: [V] });
const res = await new VaultAgent(V, pc, agent).run({ kind: 'call', target: ROUTER, value: amt, data: encodeFunctionData({ abi: kuru, functionName: 'anyToAnySwap', args: [[MKT], [false], [true], Z, USDC, amt, minOut] }), opts: { outToken: USDC, minOut } }, { gasBuffer: 1.15 });
const after = await pc.readContract({ address: USDC, abi: erc, functionName: 'balanceOf', args: [V] });
Object.assign(out, { status: res.status, tx: res.hash, reason: res.reason, gasUsed: String(res.gasUsed), feeMON: res.feeWei ? Number(res.feeWei) / 1e18 : null, usdcReceived: String(after - before), explorer: res.hash ? `https://monadvision.com/tx/${res.hash}` : null });
fs.appendFileSync('/workspace/policypilot/evidence/showcase-ledger-143.jsonl', JSON.stringify({ ts: new Date().toISOString(), persona: 'staker', actor: 'agent', label: 'Staker swaps 0.01 MON → USDC on Kuru (order book)', status: res.status, tx: res.hash, fee: String(res.feeWei ?? 0) }) + '\n');
if (out.ruleTx) fs.appendFileSync('/workspace/policypilot/evidence/showcase-ledger-143.jsonl', JSON.stringify({ ts: new Date().toISOString(), persona: 'staker', actor: 'owner', label: 'Owner allowlists Kuru Router.anyToAnySwap on the Staker vault', status: 'owner', tx: out.ruleTx }) + '\n');
console.log(JSON.stringify(out, null, 1)); fs.writeFileSync('/workspace/policypilot/evidence/kuru-mainnet-tx.json', JSON.stringify(out, null, 1));
