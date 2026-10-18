// Real-chain test of runner/chain-util.mjs (PolicyPilot showcase agents, operated by the team).
//   TEST_KEY=<key of a wallet NOT used concurrently> node runner/test-chain-util.mjs
// 1. RPC fallback: the first RPC in the list is dead (127.0.0.1:9), reads and sends must still work.
// 2. Stuck tx: a 0-MON self-transfer is first sent with maxFeePerGas far below the base fee (it cannot be included);
//    sendSafe must replace it at the SAME nonce with bumped fees and land it. Costs one tiny tx of gas.
import { createPublicClient, createWalletClient, parseGwei, formatGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { rpcTransport, sendSafe } from './chain-util.mjs';
const urls = ['http://127.0.0.1:9', 'https://rpc.monad.xyz', 'https://rpc1.monad.xyz'];
const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [urls[1]] } } };
const k = process.env.TEST_KEY.trim(); const account = privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`);
const pc = createPublicClient({ chain, transport: rpcTransport(urls) });
const wc = createWalletClient({ account, chain, transport: rpcTransport(urls) });
const log = m => console.log(new Date().toISOString(), m);
log(`fallback read via dead-first list: chainId ${await pc.getChainId()}, block ${await pc.getBlockNumber()}`);
const n0 = await pc.getTransactionCount({ address: account.address });
const fees = { maxFeePerGas: parseGwei('1'), maxPriorityFeePerGas: parseGwei('1') };
log(`test wallet ${account.address}, nonce ${n0}; first attempt maxFee ${formatGwei(fees.maxFeePerGas)} gwei (below base fee)`);
const r = await sendSafe({ pc, wc, tx: { to: account.address, value: 0n, gas: 21000n }, log, waitMs: 15_000, bumps: 4, fees });
const tx = await pc.getTransaction({ hash: r.hash });
log(`landed: ${r.hash} status ${r.receipt.status} block ${r.receipt.blockNumber} nonce ${tx.nonce} (expected ${n0}) attempts ${r.attempts} sent ${r.sent.length}: ${r.sent.join(', ')}`);
log(`effective maxFee ${formatGwei(tx.maxFeePerGas)} gwei`);
process.exit(tx.nonce === n0 && r.receipt.status === 'success' ? 0 : 1);
