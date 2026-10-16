// One clearing swap on the rebalancer gas wallet. Not a vault call.
// The 16 Oct 2026 send already landed. The workflow that called this file was removed.
// A later run still refuses to sign unless a fresh simulation clears and the 5 MON floor holds.
// Aborts unless a fresh simulation still clears gas_limit * base fee,
// and unless the wallet stays at or above 5 MON after the spend.
// DRY=1 simulates from the public address and does not sign.
import { createPublicClient, createWalletClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPCS = ['https://rpc.monad.xyz', 'https://rpc-mainnet.monadinfra.com', 'https://rpc.ankr.com/monad_mainnet'];
const EXPECT = '0xC2cF684A3931143FD877F02222085713842a090E';
const ROUTER = '0x26CEb692410c4b3C12D63e01CFc03eEA103fc474';
const WMON = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const NAD = '0x7289A594e116DC99af16ff0db0529A803b68Bfa5';
const AMOUNT = 6_000_000_000_000_000n;
const FLOOR = 5_000_000_000_000_000_000n;
const MAX_SPEND = 80_000_000_000_000_000n;
const MIN_NET = 5_000_000_000_000_000n;
const PATH = [WMON, USDC, NAD, WMON];
const DEADLINE = 2_000_000_000n;

const chain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
};

const log = (row) => console.log(`TAPE_FILL ${JSON.stringify(row)}`);
const dry = process.env.DRY === '1';

function client(url) {
  return createPublicClient({ chain, transport: http(url, { timeout: 20_000 }) });
}

async function withRpc(fn) {
  let last;
  for (const url of RPCS) {
    try {
      return await fn(client(url), url);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

const swapData = (minOut) => encodeFunctionData({
  abi: [{
    type: 'function',
    name: 'swapExactETHForTokens',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256[]' }],
  }],
  functionName: 'swapExactETHForTokens',
  args: [minOut, PATH, EXPECT, DEADLINE],
});

function receivedFromTrace(trace, who) {
  let got = 0n;
  const walk = (node) => {
    const input = node?.input || '';
    const to = (node?.to || '').toLowerCase();
    if (to === WMON.toLowerCase() && input.startsWith('0xa9059cbb') && input.length >= 138) {
      const recv = `0x${input.slice(34, 74)}`;
      if (recv.toLowerCase() === who.toLowerCase()) got = BigInt(`0x${input.slice(74, 138)}`);
    }
    for (const call of node?.calls || []) walk(call);
  };
  walk(trace);
  return got;
}

async function priceSwap(pc, from) {
  const block = await pc.getBlock();
  const base = block.baseFeePerGas ?? 0n;
  const price = base > 100_000_000_000n ? base : 100_000_000_000n;
  const tx = { from, to: ROUTER, data: swapData(1n), value: `0x${AMOUNT.toString(16)}` };
  const listed = await pc.request({ method: 'eth_createAccessList', params: [tx, 'latest'] });
  const accessList = (listed.accessList || []).map((row) => ({
    address: row.address,
    storageKeys: row.storageKeys || [],
  }));
  const estimate = BigInt(await pc.request({
    method: 'eth_estimateGas',
    params: [{ ...tx, accessList }, 'latest'],
  }));
  const traced = await pc.request({
    method: 'debug_traceCall',
    params: [{ ...tx, gas: `0x${estimate.toString(16)}`, accessList }, 'latest', { tracer: 'callTracer' }],
  });
  const received = receivedFromTrace(traced, from);
  const bill = estimate * price;
  return { block: block.number, base, price, accessList, entries: accessList.length, estimate, received, bill, net: received - AMOUNT - bill };
}

async function main() {
  const key = process.env.AGENT_KEY_REBALANCER || '';
  if (!dry && !key) {
    log({ ok: false, sent: false, reason: 'no_signer' });
    return;
  }
  let account;
  if (!dry) {
    const hex = key.startsWith('0x') ? key : `0x${key}`;
    account = privateKeyToAccount(hex);
    if (account.address.toLowerCase() !== EXPECT.toLowerCase()) {
      log({ ok: false, sent: false, reason: 'signer_mismatch' });
      return;
    }
  }

  const priced = await withRpc((pc) => priceSwap(pc, EXPECT));
  const preview = {
    ok: priced.net > MIN_NET,
    sent: false,
    dry,
    block: priced.block.toString(),
    baseFeeWei: priced.base.toString(),
    estimate: priced.estimate.toString(),
    accessListEntries: priced.entries,
    receivedWei: priced.received.toString(),
    billWei: priced.bill.toString(),
    netWei: priced.net.toString(),
  };
  if (priced.received === 0n) {
    log({ ...preview, ok: false, reason: 'no_fill' });
    return;
  }
  if (priced.net <= MIN_NET) {
    log({ ...preview, ok: false, reason: 'net_below_floor' });
    return;
  }
  if (dry) {
    log({ ...preview, ok: true, reason: 'dry' });
    return;
  }

  const pc = client(RPCS[0]);
  const wallet = createWalletClient({ account, chain, transport: http(RPCS[0], { timeout: 20_000 }) });
  const before = await pc.getBalance({ address: EXPECT });
  const minOut = AMOUNT + priced.bill;
  const data = swapData(minOut);
  const fresh = await priceSwap(pc, EXPECT);
  if (fresh.received < minOut || fresh.net <= MIN_NET) {
    log({ ...preview, ok: false, reason: 'moved', freshNetWei: fresh.net.toString(), freshReceivedWei: fresh.received.toString() });
    return;
  }
  const gas = fresh.estimate;
  const spend = AMOUNT + gas * fresh.price;
  if (before < FLOOR + spend || spend > MAX_SPEND) {
    log({ ...preview, ok: false, reason: 'reserve', balanceWei: before.toString(), spendWei: spend.toString() });
    return;
  }

  const hash = await wallet.sendTransaction({
    account,
    chain,
    to: ROUTER,
    data: swapData(AMOUNT + gas * fresh.price),
    value: AMOUNT,
    gas,
    maxFeePerGas: fresh.price,
    maxPriorityFeePerGas: 0n,
    accessList: fresh.accessList,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  const after = await pc.getBalance({ address: EXPECT });
  let unwrapped = null;
  if (receipt.status === 'success') {
    const wmonBal = await pc.readContract({
      address: WMON,
      abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [EXPECT],
    });
    if (wmonBal > 0n) {
      const withdrawGas = await pc.estimateGas({
        account: EXPECT,
        to: WMON,
        data: encodeFunctionData({
          abi: [{ type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] }],
          functionName: 'withdraw',
          args: [wmonBal],
        }),
      });
      const feeNow = (await pc.getBlock()).baseFeePerGas ?? fresh.price;
      const unwrapSpend = withdrawGas * feeNow;
      if (after >= FLOOR + unwrapSpend && unwrapSpend < MAX_SPEND) {
        const unwrapHash = await wallet.sendTransaction({
          account,
          chain,
          to: WMON,
          data: encodeFunctionData({
            abi: [{ type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] }],
            functionName: 'withdraw',
            args: [wmonBal],
          }),
          gas: withdrawGas,
          maxFeePerGas: feeNow,
          maxPriorityFeePerGas: 0n,
        });
        const unwrapReceipt = await pc.waitForTransactionReceipt({ hash: unwrapHash, timeout: 60_000 });
        unwrapped = { hash: unwrapHash, status: unwrapReceipt.status, gas: withdrawGas.toString() };
      }
    }
  }
  const end = await pc.getBalance({ address: EXPECT });
  log({
    ok: receipt.status === 'success',
    sent: true,
    reason: receipt.status,
    hash,
    block: receipt.blockNumber.toString(),
    gasLimit: gas.toString(),
    billWei: (gas * fresh.price).toString(),
    balanceBeforeWei: before.toString(),
    balanceAfterSwapWei: after.toString(),
    balanceEndWei: end.toString(),
    nativeDeltaWei: (end - before).toString(),
    unwrap: unwrapped,
    receivedWei: fresh.received.toString(),
    netWei: fresh.net.toString(),
  });
}

main().catch((err) => {
  log({ ok: false, sent: false, reason: 'error', message: String(err?.shortMessage || err?.message || err).slice(0, 400) });
  process.exit(1);
});
