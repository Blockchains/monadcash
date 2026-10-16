// Direct pair-to-pair search. The router creation for a two-hop bills about 0.032 MON.
// Calling the two pairs bills about 0.024 MON, so a smaller gross can clear.
// Signs only the rebalancer. A tick sends only when the fresh trace still returns
// more than the input plus a gas limit that succeeds 15,000 gas lower.
// A revert ends the process.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, http, fallback, defineChain, parseAbi,
  encodeAbiParameters, getAddress, formatUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPCS = ['https://rpc.monad.xyz', 'https://rpc-mainnet.monadinfra.com', 'https://rpc.ankr.com/monad_mainnet'];
const EXPECT = getAddress('0xC2cF684A3931143FD877F02222085713842a090E');
const WMON = getAddress('0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A');
const FLOOR_BAL = 5_000_000_000_000_000_000n;
const MIN_NET = 1n;
const MAX_SIZE = 2_000_000_000_000_000_000n;
const MAX_GAS = 800_000n;
const SPARE = 15_000n;
const SLIP_NUM = 9980n;
const SLIP_DEN = 10_000n;
const MAX_SENDS = 10;
const TICK_MS = Number(process.env.TICK_MS || 4000);
const DURATION_MIN = Number(process.env.DURATION_MIN || 15);
const ONCE = process.env.ONCE === '1';
const DRY = process.env.DRY === '1';
const INIT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'direct-init.hex'), 'utf8').trim();

const VENUES = [
  { name: 'uni', factory: '0x182a927119d56008d921126764bf884221b10f59', router: '0x4B2ab38DBF28D31D467aA8993f6c2585981D6804' },
  { name: 'cake', factory: '0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e', router: '0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9' },
  { name: 'dyor', factory: '0xE78B9c8F3e9f46CEDC204309E9F387f736d0d278', router: '0x26CEb692410c4b3C12D63e01CFc03eEA103fc474' },
  { name: 'purps', factory: '0xafe4d3eb898591ace6285176b26f0f5beb894447', router: '0x22aDf91b491abc7a50895Cd5c5c194EcCC93f5E2' },
  { name: 'some', factory: '0x00008a3c1077325bb19cd93e5a0f1e95144700fa', router: '0x000799B28aE9C3E9ca70B7Ff67b191519ab80fEE' },
  { name: 'lfj', factory: '0xe32d45c2b1c17a0fe0de76f1ebfa7c44b7810034', router: '0x4fAce5B0eF2757cEb9151d14c036a1135931c70e' },
  { name: 'octo', factory: '0xce104732685b9d7b2f07a09d828f6b19786cda32', router: '0x60fd5aa15debd5ffdefb5129fd9fd8a34d80d608' },
  { name: 'zk', factory: '0x0ff16867bcac3c5fdc2dc73558e3f8e2ed89eea2', router: '0x68225b5bA7ce309fD0d3F0c9A74b947c7d7e03dA' },
  { name: 'kansei', factory: '0x6b672532b4347b56236ceed8a2410aec4395fdb2', router: '0x33d4220003a120b07f0a764a6c9a70e6d328c461' },
].map((v) => ({ ...v, factory: getAddress(v.factory), router: getAddress(v.router) }));

const SIZES = [10n ** 16n, 5n * 10n ** 16n, 10n ** 17n, 15n * 10n ** 16n, 2n * 10n ** 17n, 25n * 10n ** 16n, 3n * 10n ** 17n, 5n * 10n ** 17n, 10n ** 18n, 2n * 10n ** 18n];
const WATCH = [{
  name: 'aff',
  mid: getAddress('0xF6Aad8897eA650788e5033Cda6Bf99D5a144238c'),
  buy: 'cake',
  sell: 'uni',
  pairBuy: getAddress('0x454E6EeA8237C4f45e76663fe4DD399D4460e225'),
  pairSell: getAddress('0xAe4623e4423dc7A07139F387574708b742002DDa'),
}];

const factoryAbi = parseAbi(['function allPairsLength() view returns (uint256)', 'function allPairs(uint256) view returns (address)']);
const pairAbi = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)', 'function getReserves() view returns (uint112,uint112,uint32)']);
const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const routerAbi = parseAbi(['function getAmountsOut(uint256,address[]) view returns (uint256[])']);

const monad = defineChain({
  id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});
const pc = createPublicClient({
  chain: monad,
  batch: { multicall: { batchSize: 32, wait: 8 } },
  transport: fallback(RPCS.map((url) => http(url, { timeout: 25_000, retryCount: 1, retryDelay: 400 })), { rank: false }),
});
const log = (row) => console.log(`DIRECT ${JSON.stringify(row)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lower = (a) => a.toLowerCase();
const venue = (name) => VENUES.find((v) => v.name === name);

async function multi(contracts, tag) {
  const rows = [];
  for (let i = 0; i < contracts.length; i += 32) {
    const chunk = contracts.slice(i, i + 32);
    let done = false;
    for (let a = 0; a < 6 && !done; a++) {
      try {
        rows.push(...await pc.multicall({ contracts: chunk, allowFailure: true }));
        done = true;
      } catch (err) {
        log({ ok: false, sent: false, reason: 'retry', tag, at: i, attempt: a, message: String(err?.shortMessage || err?.message || '').slice(0, 120) });
        await sleep(500 * (a + 1));
      }
    }
    if (!done) rows.push(...chunk.map(() => ({ status: 'failure' })));
    if (i > 0 && i % 3200 === 0) log({ ok: true, sent: false, reason: 'index', tag, at: i, of: contracts.length });
  }
  return rows;
}

function cpOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inn = amountIn * 997n;
  return (inn * reserveOut) / (reserveIn * 1000n + inn);
}

async function routerOut(router, amount, path) {
  try {
    const amounts = await pc.readContract({ address: router, abi: routerAbi, functionName: 'getAmountsOut', args: [amount, path] });
    return amounts[amounts.length - 1];
  } catch {
    return 0n;
  }
}

function valueBack(trace, who) {
  let got = 0n;
  const walk = (node) => {
    const to = (node?.to || '').toLowerCase();
    const value = BigInt(node?.value || '0x0');
    if (to === who.toLowerCase() && value > got) got = value;
    for (const call of node?.calls || []) walk(call);
  };
  walk(trace);
  return got;
}

async function rpc(method, params) {
  return pc.request({ method, params });
}

async function priceDirect(spec) {
  const block = await pc.getBlock();
  const base = block.baseFeePerGas ?? 0n;
  const price = base > 100_000_000_000n ? base : 100_000_000_000n;
  const quotedMid = await routerOut(spec.routerBuy, spec.size, [WMON, spec.mid]);
  if (quotedMid === 0n) return null;
  const mid = quotedMid * SLIP_NUM / SLIP_DEN;
  const quotedBack = await routerOut(spec.routerSell, mid, [spec.mid, WMON]);
  if (quotedBack <= spec.size) return { reason: 'short', size: spec.size, back: quotedBack, mid: spec.mid };
  const back = quotedBack * SLIP_NUM / SLIP_DEN;
  if (back <= spec.size + 24_000_000_000_000_000n) return { reason: 'under_bill', size: spec.size, back, mid: spec.mid };
  const [buyT0, sellT0] = await Promise.all([
    pc.readContract({ address: spec.pairBuy, abi: pairAbi, functionName: 'token0' }),
    pc.readContract({ address: spec.pairSell, abi: pairAbi, functionName: 'token0' }),
  ]);
  const buy0 = lower(buyT0) === lower(WMON) ? 0n : mid;
  const buy1 = lower(buyT0) === lower(WMON) ? mid : 0n;
  const sell0 = lower(sellT0) === lower(spec.mid) ? 0n : back;
  const sell1 = lower(sellT0) === lower(spec.mid) ? back : 0n;
  const data = INIT + encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [spec.pairBuy, spec.pairSell, spec.mid, buy0, buy1, sell0, sell1],
  ).slice(2);
  const raw = { from: EXPECT, data, value: `0x${spec.size.toString(16)}` };
  const listed = await rpc('eth_createAccessList', [raw, 'latest']);
  const accessList = (listed.accessList || []).map((row) => ({ address: row.address, storageKeys: row.storageKeys || [] }));
  const estimate = BigInt(await rpc('eth_estimateGas', [{ ...raw, accessList }, 'latest']));
  const traced = await rpc('debug_traceCall', [{ ...raw, gas: `0x${estimate.toString(16)}`, accessList }, 'latest', { tracer: 'callTracer' }]);
  const received = valueBack(traced, EXPECT);
  let lo = estimate > 40_000n ? estimate - 40_000n : 21_000n;
  let hi = estimate;
  for (let step = 0; lo + 1n < hi && step < 18; step += 1) {
    const gas = (lo + hi) / 2n;
    try {
      await rpc('eth_call', [{ ...raw, accessList, gas: `0x${gas.toString(16)}` }, 'latest']);
      hi = gas;
    } catch {
      lo = gas;
    }
  }
  const signed = hi + SPARE;
  let spare = false;
  try {
    await rpc('eth_call', [{ ...raw, accessList, gas: `0x${(signed - SPARE).toString(16)}` }, 'latest']);
    spare = true;
  } catch {
    spare = false;
  }
  const bill = signed * price;
  const net = received - spec.size - bill;
  return {
    kind: 'direct', name: spec.name, mid: spec.mid, buy: spec.buyName, sell: spec.sellName,
    pairBuy: spec.pairBuy, pairSell: spec.pairSell, routerBuy: spec.routerBuy, routerSell: spec.routerSell,
    size: spec.size, data, accessList, received, bill, net, spare, price,
    estimate, floor: hi, signed, block: block.number,
  };
}

function passes(row) {
  if (!row || row.reason) return false;
  if (row.size > MAX_SIZE || row.signed > MAX_GAS) return false;
  if (!row.spare) return false;
  if (row.net < MIN_NET) return false;
  if (row.received < row.size + row.bill) return false;
  return true;
}

async function bestWatch(row) {
  const buy = venue(row.buy);
  const sell = venue(row.sell);
  const ready = [];
  for (const size of SIZES) {
    try {
      const priced = await priceDirect({
        name: row.name, mid: row.mid, size,
        pairBuy: row.pairBuy, pairSell: row.pairSell,
        routerBuy: buy.router, routerSell: sell.router,
        buyName: buy.name, sellName: sell.name,
      });
      if (!priced) continue;
      if (priced.reason) {
        log({ ok: true, sent: false, reason: priced.reason, name: row.name, sizeWei: size.toString(), backWei: priced.back?.toString?.() });
        continue;
      }
      log({
        ok: true, sent: false, reason: 'sim', name: row.name, sizeWei: size.toString(),
        netWei: priced.net.toString(), gas: priced.signed.toString(), floor: priced.floor.toString(),
        spare: priced.spare, block: priced.block.toString(),
      });
      if (passes(priced)) ready.push(priced);
    } catch (err) {
      log({ ok: false, sent: false, reason: 'sim_error', name: row.name, sizeWei: size.toString(), message: String(err?.shortMessage || err?.message || '').slice(0, 180) });
    }
  }
  ready.sort((a, b) => (a.net > b.net ? -1 : 1));
  return ready;
}

async function sendRow(account, row) {
  const latest = await pc.getTransactionCount({ address: EXPECT, blockTag: 'latest' });
  const pending = await pc.getTransactionCount({ address: EXPECT, blockTag: 'pending' });
  if (pending !== latest) return { ok: false, sent: false, reason: 'in_flight' };
  const again = await priceDirect({
    name: row.name, mid: row.mid, size: row.size,
    pairBuy: row.pairBuy, pairSell: row.pairSell,
    routerBuy: row.routerBuy, routerSell: row.routerSell,
    buyName: row.buy, sellName: row.sell,
  });
  if (!passes(again)) return { ok: false, sent: false, reason: 'moved', netWei: again?.net?.toString?.() || '0' };
  const before = await pc.getBalance({ address: EXPECT });
  if (before < FLOOR_BAL + again.size + again.bill) return { ok: false, sent: false, reason: 'reserve', balanceWei: before.toString() };
  const wallet = createWalletClient({ account, chain: monad, transport: http(RPCS[0], { timeout: 25_000 }) });
  const hash = await wallet.sendTransaction({
    account, chain: monad, data: again.data, value: again.size, gas: again.signed,
    maxFeePerGas: again.price, maxPriorityFeePerGas: 0n, accessList: again.accessList,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') return { ok: false, sent: true, reason: 'revert', hash, gasLimit: again.signed.toString() };
  const end = await pc.getBalance({ address: EXPECT });
  return {
    ok: true, sent: true, reason: 'success', hash, block: receipt.blockNumber.toString(),
    name: again.name, mid: again.mid, sizeWei: again.size.toString(), gasLimit: again.signed.toString(),
    floor: again.floor.toString(), balanceBeforeWei: before.toString(), balanceEndWei: end.toString(),
    nativeDeltaWei: (end - before).toString(),
  };
}

function cpBest(buy, sell) {
  let best = { size: 0n, gross: 0n };
  const cap = buy.rw < sell.rw ? buy.rw : sell.rw;
  for (const size of SIZES) {
    if (size > MAX_SIZE || size * 3n > cap) continue;
    const mid = cpOut(size, buy.rw, buy.rm);
    const back = cpOut(mid, sell.rm, sell.rw);
    const gross = back - size;
    if (gross > best.gross) best = { size, gross };
  }
  return best;
}

async function indexBook() {
  const books = [];
  for (const v of VENUES) {
    const n = await pc.readContract({ address: v.factory, abi: factoryAbi, functionName: 'allPairsLength' });
    log({ ok: true, sent: false, reason: 'length', venue: v.name, pairs: Number(n) });
    const addrRows = await multi(Array.from({ length: Number(n) }, (_, i) => ({
      address: v.factory, abi: factoryAbi, functionName: 'allPairs', args: [BigInt(i)],
    })), `${v.name}-pairs`);
    const pairs = addrRows.filter((r) => r.status === 'success').map((r) => getAddress(r.result));
    const tokenRows = await multi(pairs.flatMap((pair) => [
      { address: pair, abi: pairAbi, functionName: 'token0' },
      { address: pair, abi: pairAbi, functionName: 'token1' },
    ]), `${v.name}-tokens`);
    const keep = [];
    for (let i = 0; i < pairs.length; i++) {
      const a = tokenRows[i * 2];
      const b = tokenRows[i * 2 + 1];
      if (!a || !b || a.status !== 'success' || b.status !== 'success') continue;
      const token0 = getAddress(a.result);
      const token1 = getAddress(b.result);
      if (lower(token0) === lower(WMON) || lower(token1) === lower(WMON)) keep.push({ pair: pairs[i], token0, token1 });
    }
    const resRows = await multi(keep.map((row) => ({ address: row.pair, abi: pairAbi, functionName: 'getReserves' })), `${v.name}-reserves`);
    keep.forEach((row, i) => {
      if (!resRows[i] || resRows[i].status !== 'success') return;
      const base0 = lower(row.token0) === lower(WMON);
      books.push({
        ...v, ...row, r0: resRows[i].result[0], r1: resRows[i].result[1],
        other: base0 ? row.token1 : row.token0,
        rw: base0 ? resRows[i].result[0] : resRows[i].result[1],
        rm: base0 ? resRows[i].result[1] : resRows[i].result[0],
      });
    });
    log({ ok: true, sent: false, reason: 'indexed', venue: v.name, pairs: Number(n), kept: keep.length });
  }
  return books;
}

function topHops(books) {
  const byMid = new Map();
  for (const row of books) {
    if (row.rw === 0n || row.rm === 0n) continue;
    const list = byMid.get(lower(row.other)) || [];
    list.push(row);
    byMid.set(lower(row.other), list);
  }
  const hops = [];
  for (const legs of byMid.values()) {
    if (legs.length < 2) continue;
    for (let i = 0; i < legs.length; i++) {
      for (let j = 0; j < legs.length; j++) {
        if (i === j || legs[i].name === legs[j].name) continue;
        const best = cpBest(legs[i], legs[j]);
        if (best.gross < 20_000_000_000_000_000n) continue;
        hops.push({ mid: legs[i].other, buy: legs[i], sell: legs[j], size: best.size, gross: best.gross });
      }
    }
  }
  hops.sort((a, b) => (a.gross > b.gross ? -1 : 1));
  return hops.slice(0, 12);
}

async function main() {
  const key = process.env.AGENT_KEY_REBALANCER || '';
  let account;
  if (key) {
    account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
    if (lower(account.address) !== lower(EXPECT)) {
      log({ ok: false, sent: false, reason: 'signer_mismatch' });
      return;
    }
  }
  const bal = await pc.getBalance({ address: EXPECT });
  log({ ok: true, sent: false, reason: 'start', block: (await pc.getBlockNumber()).toString(), balance: formatUnits(bal, 18), signer: Boolean(account) });
  let sends = 0;
  for (const row of WATCH) {
    const ready = await bestWatch(row);
    if (!ready.length) {
      log({ ok: true, sent: false, reason: 'watch_short', name: row.name });
      continue;
    }
    if (DRY || !account) {
      log({ ok: false, sent: false, reason: account ? 'dry' : 'no_signer', name: row.name, netWei: ready[0].net.toString(), gas: ready[0].signed.toString(), sizeWei: ready[0].size.toString() });
      continue;
    }
    for (const candidate of ready) {
      const sent = await sendRow(account, candidate);
      log(sent);
      if (sent.sent && !sent.ok) return;
      if (sent.ok) { sends += 1; break; }
    }
  }
  if (ONCE) {
    log({ ok: true, sent: false, reason: 'once_done', sends });
    return;
  }
  const books = await indexBook();
  const hops = topHops(books);
  log({
    ok: true, sent: false, reason: 'scan', pairs: books.length, hops: hops.length,
    best: hops[0] ? { mid: hops[0].mid, buy: hops[0].buy.name, sell: hops[0].sell.name, size: hops[0].size.toString(), gross: hops[0].gross.toString() } : null,
  });
  for (const hop of hops) {
    if (sends >= MAX_SENDS) break;
    try {
      const priced = await priceDirect({
        name: 'scan', mid: hop.mid, size: hop.size,
        pairBuy: hop.buy.pair, pairSell: hop.sell.pair,
        routerBuy: hop.buy.router, routerSell: hop.sell.router,
        buyName: hop.buy.name, sellName: hop.sell.name,
      });
      if (!priced || priced.reason) continue;
      log({ ok: true, sent: false, reason: 'sim', mid: hop.mid, buy: hop.buy.name, sell: hop.sell.name, sizeWei: hop.size.toString(), netWei: priced.net.toString(), gas: priced.signed.toString(), spare: priced.spare });
      if (!passes(priced) || DRY || !account) continue;
      const sent = await sendRow(account, priced);
      log(sent);
      if (sent.sent && !sent.ok) return;
      if (sent.ok) sends += 1;
    } catch (err) {
      log({ ok: false, sent: false, reason: 'sim_error', mid: hop.mid, message: String(err?.shortMessage || err?.message || '').slice(0, 160) });
    }
  }
  const end = Date.now() + DURATION_MIN * 60_000;
  let tick = 0;
  while (Date.now() < end && sends < MAX_SENDS) {
    tick += 1;
    for (const row of WATCH) {
      const ready = await bestWatch(row);
      if (!ready.length || DRY || !account) continue;
      for (const candidate of ready) {
        const sent = await sendRow(account, candidate);
        log(sent);
        if (sent.sent && !sent.ok) return;
        if (sent.ok) { sends += 1; break; }
      }
    }
    if (tick % 5 === 0) log({ ok: true, sent: false, reason: 'idle', tick, sends });
    await sleep(TICK_MS);
  }
  log({ ok: true, sent: false, reason: 'loop_end', tick, sends });
}

main().catch((err) => {
  log({ ok: false, sent: false, reason: 'error', message: String(err?.shortMessage || err?.message || err).slice(0, 400) });
  process.exit(1);
});
