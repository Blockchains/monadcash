// Seeks the two shapes that have cleared for the rebalancer and sends one when a fresh
// Monad simulation still clears. Not a vault call. The showcase clip cap and the 600s
// round are unchanged. This process uses only the rebalancer gas key.
//
// Shape A, the UNCLE shape: buy a token on one v2 router, sell it on another, in one
// creation that unwraps and stores no code.
// Shape B, the NADXBT shape: one router, WMON to USDC to token to WMON, then an unwrap.
//
// A tick sends only when all of these hold:
//   the router quote and the trace agree the tokens move,
//   net after gas_limit * price is at least 0.005 MON,
//   eth_call still succeeds 15,000 gas under the estimate,
//   the gas limit is at most 800,000,
//   the size is at most 2 MON,
//   both pools cover their reserves,
//   the wallet stays at or above 5 MON after the spend,
//   the rebalancer has no transaction already pending.
// A revert ends the process. The next scheduled run starts clean.
//
// Top-up: frequency does not need a larger wallet. One trade locks at most 2 MON plus
// about 0.08 MON of gas, and that MON comes back in the same transaction. The balance
// only has to stay above 5 MON. A 50 MON top-up, taking the rebalancer toward 150 MON,
// is a buffer for showcase gas and one bad revert, not a requirement for the loop.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, http, fallback, defineChain, parseAbi,
  encodeFunctionData, encodeAbiParameters, getAddress, formatUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPCS = ['https://rpc.monad.xyz', 'https://rpc-mainnet.monadinfra.com', 'https://rpc.ankr.com/monad_mainnet'];
const EXPECT = getAddress('0xC2cF684A3931143FD877F02222085713842a090E');
const WMON = getAddress('0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A');
const USDC = getAddress('0x754704Bc059F8C67012fEd69BC8A327a5aafb603');
const FLOOR = 5_000_000_000_000_000_000n;
const MIN_NET = 5_000_000_000_000_000n;
const MAX_SIZE = 2_000_000_000_000_000_000n;
const MAX_GAS = 800_000n;
const SPARE_GAS = 15_000n;
const UNWRAP_GAS = 50_000n;
const MAX_SENDS = 30;
const TICK_MS = Number(process.env.TICK_MS || 4000);
const DURATION_MIN = Number(process.env.DURATION_MIN || 20);
const ONCE = process.env.ONCE === '1';
const DRY = process.env.DRY === '1';
const INIT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'twohop-init.hex'), 'utf8').trim();

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

const DENY = new Set([
  '0xcf05fc31a6b693dd0beb76e958ae4bcd490dc985',
  '0xf05266b1b1759d3a2746cd3b031b802c2496b278',
]);
const SIZES = [6n * 10n ** 15n, 10n ** 16n, 2n * 10n ** 16n, 5n * 10n ** 16n, 81_016_337_000_000_000n, 10n ** 17n, 2n * 10n ** 17n, 5n * 10n ** 17n, 10n ** 18n, 2n * 10n ** 18n];
const NAD = getAddress('0x7289A594e116DC99af16ff0db0529A803b68Bfa5');
const UNCLE = getAddress('0x483A6a93c352c9666dFE84693E5B957d555D7777');
const NAD_SIZE = 6_000_000_000_000_000n;
const UNCLE_SIZE = 81_016_337_000_000_000n;
const DYOR = getAddress('0x26CEb692410c4b3C12D63e01CFc03eEA103fc474');
const CAKE = getAddress('0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9');
const PURPS = getAddress('0x22aDf91b491abc7a50895Cd5c5c194EcCC93f5E2');
const CAKE_PAIR = getAddress('0x90934790DCB95A51156405348ddcdFf5A438A214');
const PURPS_PAIR = getAddress('0xb0923F9D83EAAC35f5C8A2753ba6f13994f05276');
const NAD_PAIRS = [
  '0xBE8345287c5bA716941f50A80020911AC2e07c68',
  '0x7789D1E9DC0ddA50DF30e66b9DFf53D862393b1E',
  '0xFdcB57E198D123545A9E71FDd0DEA424E13B2720',
].map((a) => getAddress(a));
const CHUNK = 32;

const factoryAbi = parseAbi(['function allPairsLength() view returns (uint256)', 'function allPairs(uint256) view returns (address)']);
const pairAbi = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)', 'function getReserves() view returns (uint112,uint112,uint32)']);
const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const routerAbi = parseAbi(['function getAmountsOut(uint256,address[]) view returns (uint256[])']);
const swapAbi = parseAbi(['function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])']);
const withdrawAbi = parseAbi(['function withdraw(uint256)']);

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});
const transport = fallback(RPCS.map((url) => http(url, { timeout: 25_000, retryCount: 1, retryDelay: 400 })), { rank: false });
const pc = createPublicClient({ chain: monad, batch: { multicall: { batchSize: CHUNK, wait: 8 } }, transport });

const log = (row) => console.log(`SEEK ${JSON.stringify(row)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lower = (a) => a.toLowerCase();

async function multi(contracts, tag) {
  const rows = [];
  for (let i = 0; i < contracts.length; i += CHUNK) {
    const chunk = contracts.slice(i, i + CHUNK);
    let done = false;
    for (let a = 0; a < 8 && !done; a++) {
      try {
        rows.push(...await pc.multicall({ contracts: chunk, allowFailure: true }));
        done = true;
      } catch (err) {
        log({ ok: false, sent: false, reason: 'retry', tag, at: i, attempt: a, message: String(err?.shortMessage || err?.message || '').slice(0, 140) });
        await sleep(700 * (a + 1));
      }
    }
    if (!done) {
      log({ ok: false, sent: false, reason: 'index_gap', tag, at: i, count: chunk.length });
      rows.push(...chunk.map(() => ({ status: 'failure' })));
    }
    if (i > 0 && i % 2400 === 0) log({ ok: true, sent: false, reason: 'index', tag, at: i, of: contracts.length });
  }
  return rows;
}

function cpOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inn = amountIn * 997n;
  return (inn * reserveOut) / (reserveIn * 1000n + inn);
}

function bestSize(buy, sell) {
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

async function indexVenue(venue) {
  const n = await pc.readContract({ address: venue.factory, abi: factoryAbi, functionName: 'allPairsLength' });
  log({ ok: true, sent: false, reason: 'length', venue: venue.name, pairs: Number(n) });
  const addrRows = await multi(Array.from({ length: Number(n) }, (_, i) => ({
    address: venue.factory, abi: factoryAbi, functionName: 'allPairs', args: [BigInt(i)],
  })), `${venue.name}-pairs`);
  const pairs = addrRows.filter((r) => r.status === 'success').map((r) => getAddress(r.result));
  const tokenCalls = pairs.flatMap((pair) => [
    { address: pair, abi: pairAbi, functionName: 'token0' },
    { address: pair, abi: pairAbi, functionName: 'token1' },
  ]);
  const tokenRows = await multi(tokenCalls, `${venue.name}-tokens`);
  const keep = [];
  for (let i = 0; i < pairs.length; i++) {
    const a = tokenRows[i * 2];
    const b = tokenRows[i * 2 + 1];
    if (!a || !b || a.status !== 'success' || b.status !== 'success') continue;
    const token0 = getAddress(a.result);
    const token1 = getAddress(b.result);
    const w = lower(token0) === lower(WMON) || lower(token1) === lower(WMON);
    const u = lower(token0) === lower(USDC) || lower(token1) === lower(USDC);
    if (w || u) keep.push({ pair: pairs[i], token0, token1 });
  }
  const resRows = await multi(keep.map((row) => ({ address: row.pair, abi: pairAbi, functionName: 'getReserves' })), `${venue.name}-reserves`);
  const books = [];
  keep.forEach((row, i) => {
    if (!resRows[i] || resRows[i].status !== 'success') return;
    books.push({ ...venue, ...row, r0: resRows[i].result[0], r1: resRows[i].result[1] });
  });
  log({ ok: true, sent: false, reason: 'indexed', venue: venue.name, pairs: Number(n), kept: books.length });
  return books;
}

async function indexBook() {
  const books = [];
  for (const venue of VENUES) books.push(...await indexVenue(venue));
  return books;
}

async function refreshBooks(books, wanted) {
  const rows = books.filter((row) => wanted.has(lower(row.pair)));
  if (!rows.length) return 0;
  const res = await multi(rows.map((row) => ({ address: row.pair, abi: pairAbi, functionName: 'getReserves' })), 'refresh');
  let n = 0;
  rows.forEach((row, i) => {
    if (!res[i] || res[i].status !== 'success') return;
    row.r0 = res[i].result[0];
    row.r1 = res[i].result[1];
    n += 1;
  });
  return n;
}

function hotSet(found) {
  const set = new Set([CAKE_PAIR, PURPS_PAIR, ...NAD_PAIRS].map(lower));
  for (const hop of found?.hops || []) {
    set.add(lower(hop.buy.pair));
    set.add(lower(hop.sell.pair));
  }
  for (const tri of found?.tris || []) {
    if (tri.bridge) set.add(lower(tri.bridge));
    if (tri.midPair) set.add(lower(tri.midPair));
    if (tri.backPair) set.add(lower(tri.backPair));
  }
  return set;
}

function orient(row, base) {
  const base0 = lower(row.token0) === lower(base);
  return { ...row, other: base0 ? row.token1 : row.token0, rb: base0 ? row.r0 : row.r1, ro: base0 ? row.r1 : row.r0 };
}

function candidatesFrom(books) {
  const wmon = new Map();
  const usdc = new Map();
  for (const row of books) {
    if (lower(row.token0) === lower(WMON) || lower(row.token1) === lower(WMON)) {
      const o = orient(row, WMON);
      if (o.rb === 0n || o.ro === 0n || DENY.has(lower(o.other))) continue;
      const list = wmon.get(lower(o.other)) || [];
      list.push({ ...o, rw: o.rb, rm: o.ro });
      wmon.set(lower(o.other), list);
    }
    if (lower(row.token0) === lower(USDC) || lower(row.token1) === lower(USDC)) {
      const o = orient(row, USDC);
      if (o.rb === 0n || o.ro === 0n) continue;
      const list = usdc.get(lower(o.other)) || [];
      list.push(o);
      usdc.set(lower(o.other), list);
    }
  }
  const hops = [];
  for (const [mid, legs] of wmon) {
    if (legs.length < 2) continue;
    for (let i = 0; i < legs.length; i++) {
      for (let j = 0; j < legs.length; j++) {
        if (i === j || legs[i].name === legs[j].name) continue;
        const best = bestSize(legs[i], legs[j]);
        if (best.gross <= 0n) continue;
        hops.push({ kind: 'hop', mid: legs[i].other, buy: legs[i], sell: legs[j], size: best.size, gross: best.gross });
      }
    }
  }
  const tris = [];
  for (const venue of VENUES) {
    const bridge = (wmon.get(lower(USDC)) || []).find((leg) => leg.name === venue.name);
    if (!bridge) continue;
    for (const [mid, legs] of wmon) {
      if (mid === lower(USDC)) continue;
      const back = legs.find((leg) => leg.name === venue.name);
      const mids = (usdc.get(mid) || []).filter((leg) => leg.name === venue.name);
      if (!back || mids.length === 0) continue;
      for (const midLeg of mids) {
        let best = { size: 0n, gross: 0n };
        for (const size of SIZES) {
          if (size > MAX_SIZE || size * 3n > bridge.rw) continue;
          const usdcOut = cpOut(size, bridge.rw, bridge.rm);
          const tokenOut = cpOut(usdcOut, midLeg.rb, midLeg.ro);
          const wmonOut = cpOut(tokenOut, back.rm, back.rw);
          const gross = wmonOut - size;
          if (gross > best.gross) best = { size, gross };
        }
        if (best.gross > 0n) tris.push({
          kind: 'tri', venue: venue.name, router: venue.router, mid: back.other, size: best.size, gross: best.gross,
          bridge: bridge.pair, midPair: midLeg.pair, backPair: back.pair,
          stamp: `${bridge.r0}:${bridge.r1}:${midLeg.rb}:${midLeg.ro}:${back.rm}:${back.rw}`,
        });
      }
    }
  }
  hops.sort((a, b) => (a.gross > b.gross ? -1 : 1));
  tris.sort((a, b) => (a.gross > b.gross ? -1 : 1));
  return { hops: hops.slice(0, 40), tris: tris.slice(0, 10), wmonLegs: wmon.size };
}

async function routerOut(router, amount, path) {
  try {
    const amounts = await pc.readContract({ address: router, abi: routerAbi, functionName: 'getAmountsOut', args: [amount, path] });
    return amounts[amounts.length - 1];
  } catch {
    return 0n;
  }
}

async function solvent(pair, token, reserve) {
  try {
    const bal = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [pair] });
    return bal >= reserve;
  } catch {
    return false;
  }
}

function creation(routerBuy, routerSell, mid, minBack) {
  return INIT + encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    [routerBuy, routerSell, mid, minBack],
  ).slice(2);
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

function wmonBack(trace, who) {
  let got = 0n;
  const walk = (node) => {
    const input = node?.input || '';
    const to = (node?.to || '').toLowerCase();
    if (to === lower(WMON) && input.startsWith('0xa9059cbb') && input.length >= 138) {
      const recv = `0x${input.slice(34, 74)}`;
      if (recv.toLowerCase() === who.toLowerCase()) got = BigInt(`0x${input.slice(74, 138)}`);
    }
    for (const call of node?.calls || []) walk(call);
  };
  walk(trace);
  return got;
}

function rawTx(tx) {
  const value = typeof tx.value === 'bigint' ? `0x${tx.value.toString(16)}` : tx.value;
  return { from: EXPECT, data: tx.data, value, ...(tx.to ? { to: tx.to } : {}) };
}

async function priceTx(tx, reader) {
  const block = await pc.getBlock();
  const base = block.baseFeePerGas ?? 0n;
  const price = base > 100_000_000_000n ? base : 100_000_000_000n;
  const raw = rawTx(tx);
  const listed = await pc.request({ method: 'eth_createAccessList', params: [raw, 'latest'] });
  const accessList = (listed.accessList || []).map((row) => ({ address: row.address, storageKeys: row.storageKeys || [] }));
  const estimate = BigInt(await pc.request({ method: 'eth_estimateGas', params: [{ ...raw, accessList }, 'latest'] }));
  const traced = await pc.request({
    method: 'debug_traceCall',
    params: [{ ...raw, gas: `0x${estimate.toString(16)}`, accessList }, 'latest', { tracer: 'callTracer' }],
  });
  const callAt = async (gas) => {
    try {
      await pc.request({
        method: 'eth_call',
        params: [{
          from: EXPECT,
          data: tx.data,
          value: `0x${tx.value.toString(16)}`,
          gas: `0x${gas.toString(16)}`,
          accessList,
          ...(tx.to ? { to: tx.to } : {}),
        }, 'latest'],
      });
      return true;
    } catch (err) {
      return String(err?.shortMessage || err?.message || 'reverted').slice(0, 160);
    }
  };
  let spare = false;
  let spareError = '';
  let failsAt = null;
  if (estimate > SPARE_GAS + 21_000n) {
    const hit = await callAt(estimate - SPARE_GAS);
    spare = hit === true;
    if (hit !== true) spareError = hit;
  }
  if (!spare && ONCE && estimate > SPARE_GAS + 21_000n) {
    let lo = estimate - SPARE_GAS;
    let hi = estimate;
    for (let step = 0; lo + 1n < hi && step < 16; step += 1) {
      const midGas = (lo + hi) / 2n;
      if (await callAt(midGas) === true) hi = midGas;
      else lo = midGas;
    }
    failsAt = lo;
  }
  const received = reader(traced, EXPECT);
  const bill = estimate * price;
  return { block: block.number, price, accessList, estimate, received, bill, spare, spareError, failsAt };
}

async function pairSide(pair, base) {
  const [token0, token1, res] = await Promise.all([
    pc.readContract({ address: pair, abi: pairAbi, functionName: 'token0' }),
    pc.readContract({ address: pair, abi: pairAbi, functionName: 'token1' }),
    pc.readContract({ address: pair, abi: pairAbi, functionName: 'getReserves' }),
  ]);
  const t0 = getAddress(token0);
  const t1 = getAddress(token1);
  const base0 = lower(t0) === lower(base);
  return { pair, token0: t0, token1: t1, rw: base0 ? res[0] : res[1], rm: base0 ? res[1] : res[0] };
}

async function watchGrid() {
  const sizes = [10n ** 15n, 3n * 10n ** 15n, NAD_SIZE, 10n ** 16n, 2n * 10n ** 16n, 4n * 10n ** 16n, UNCLE_SIZE, 10n ** 17n, 2n * 10n ** 17n, 5n * 10n ** 17n, 10n ** 18n, 2n * 10n ** 18n];
  const nad = [];
  const uncle = [];
  for (const size of sizes) {
    const back = await routerOut(DYOR, size, [WMON, USDC, NAD, WMON]);
    nad.push({ sizeWei: size.toString(), backWei: back.toString(), grossWei: (back - size).toString() });
    const bought = await routerOut(CAKE, size, [WMON, UNCLE]);
    const sold = bought > 0n ? await routerOut(PURPS, bought, [UNCLE, WMON]) : 0n;
    uncle.push({ sizeWei: size.toString(), backWei: sold.toString(), grossWei: (sold - size).toString() });
  }
  log({ ok: true, sent: false, reason: 'grid', nad, uncle });
}

async function watchKnown() {
  const notes = [];
  const rows = [];
  const nadBack = await routerOut(DYOR, NAD_SIZE, [WMON, USDC, NAD, WMON]);
  notes.push({ name: 'nadxbt', sizeWei: NAD_SIZE.toString(), backWei: nadBack.toString(), grossWei: (nadBack - NAD_SIZE).toString() });
  if (nadBack > NAD_SIZE) {
    const nad = await verifyTri({ venue: 'dyor', router: DYOR, mid: NAD, size: NAD_SIZE });
    if (nad && !nad.reason) rows.push(nad);
  }
  const bought = await routerOut(CAKE, UNCLE_SIZE, [WMON, UNCLE]);
  const uncleBack = bought > 0n ? await routerOut(PURPS, bought, [UNCLE, WMON]) : 0n;
  notes.push({ name: 'uncle', sizeWei: UNCLE_SIZE.toString(), boughtWei: bought.toString(), backWei: uncleBack.toString(), grossWei: (uncleBack - UNCLE_SIZE).toString() });
  if (uncleBack > UNCLE_SIZE) {
    const buy = await pairSide(CAKE_PAIR, WMON);
    const sell = await pairSide(PURPS_PAIR, WMON);
    const uncle = await verifyHop({
      size: UNCLE_SIZE,
      mid: UNCLE,
      buy: { ...buy, name: 'cake', router: CAKE },
      sell: { ...sell, name: 'purps', router: PURPS },
    });
    if (uncle && !uncle.reason) rows.push(uncle);
  }
  log({ ok: true, sent: false, reason: 'watch', notes });
  return rows;
}

async function verifyHop(hop) {
  const bought = await routerOut(hop.buy.router, hop.size, [WMON, hop.mid]);
  if (bought === 0n) return null;
  const back = await routerOut(hop.sell.router, bought, [hop.mid, WMON]);
  if (back <= hop.size) return null;
  const okBuy = await solvent(hop.buy.pair, WMON, hop.buy.rw) && await solvent(hop.buy.pair, hop.mid, hop.buy.rm);
  const okSell = await solvent(hop.sell.pair, WMON, hop.sell.rw) && await solvent(hop.sell.pair, hop.mid, hop.sell.rm);
  if (!okBuy || !okSell) return { reason: 'insolvent', mid: hop.mid, buy: hop.buy.name, sell: hop.sell.name };
  const data = creation(hop.buy.router, hop.sell.router, hop.mid, 1n);
  const tx = { from: EXPECT, data, value: hop.size };
  const priced = await priceTx(tx, valueBack);
  const net = priced.received - hop.size - priced.bill;
  return {
    kind: 'hop', size: hop.size, gross: back - hop.size, net, priced, spare: priced.spare,
    mid: hop.mid, buy: hop.buy.name, sell: hop.sell.name,
    routerBuy: hop.buy.router, routerSell: hop.sell.router,
    pairBuy: hop.buy.pair, pairSell: hop.sell.pair,
  };
}

async function verifyTri(tri) {
  const path = [WMON, USDC, tri.mid, WMON];
  const back = await routerOut(tri.router, tri.size, path);
  if (back <= tri.size) return null;
  const data = encodeFunctionData({
    abi: swapAbi,
    functionName: 'swapExactETHForTokens',
    args: [1n, path, EXPECT, 2_000_000_000n],
  });
  const tx = { from: EXPECT, to: tri.router, data, value: tri.size };
  const priced = await priceTx(tx, wmonBack);
  const unwrapBill = UNWRAP_GAS * priced.price;
  const net = priced.received - tri.size - priced.bill - unwrapBill;
  return {
    kind: 'tri', size: tri.size, gross: back - tri.size, net, priced, spare: priced.spare,
    mid: tri.mid, router: tri.router, venue: tri.venue, path,
  };
}

function passes(row) {
  if (!row || row.reason) return false;
  if (row.size > MAX_SIZE || row.priced.estimate > MAX_GAS) return false;
  if (!row.spare) return false;
  if (row.net < MIN_NET) return false;
  if (row.priced.received < row.size + row.priced.bill) return false;
  return true;
}

async function sendRow(account, row) {
  const latest = await pc.getTransactionCount({ address: EXPECT, blockTag: 'latest' });
  const pending = await pc.getTransactionCount({ address: EXPECT, blockTag: 'pending' });
  if (pending !== latest) return { ok: false, sent: false, reason: 'in_flight', pending: pending.toString(), latest: latest.toString() };
  const before = await pc.getBalance({ address: EXPECT });
  const bill = row.priced.estimate * row.priced.price;
  const spend = row.size + bill + (row.kind === 'tri' ? UNWRAP_GAS * row.priced.price : 0n);
  if (before < FLOOR + spend) return { ok: false, sent: false, reason: 'reserve', balanceWei: before.toString(), spendWei: spend.toString() };
  const wallet = createWalletClient({ account, chain: monad, transport: http(RPCS[0], { timeout: 25_000 }) });
  let hash;
  let gasLimit = row.priced.estimate;
  if (row.kind === 'hop') {
    const minBack = row.size + bill;
    const again = await priceTx({ data: creation(row.routerBuy, row.routerSell, row.mid, minBack), value: row.size }, valueBack);
    const net = again.received - row.size - again.bill;
    if (again.received < minBack || net < MIN_NET || !again.spare || again.estimate > MAX_GAS) return { ok: false, sent: false, reason: 'moved', netWei: net.toString(), spare: again.spare };
    gasLimit = again.estimate;
    hash = await wallet.sendTransaction({
      account, chain: monad, data: creation(row.routerBuy, row.routerSell, row.mid, minBack),
      value: row.size, gas: again.estimate, maxFeePerGas: again.price, maxPriorityFeePerGas: 0n, accessList: again.accessList,
    });
  } else {
    const minOut = row.size + bill + UNWRAP_GAS * row.priced.price;
    const data = encodeFunctionData({ abi: swapAbi, functionName: 'swapExactETHForTokens', args: [minOut, row.path, EXPECT, 2_000_000_000n] });
    const again = await priceTx({ to: row.router, data, value: row.size }, wmonBack);
    const net = again.received - row.size - again.bill - UNWRAP_GAS * again.price;
    if (again.received < minOut || net < MIN_NET || !again.spare || again.estimate > MAX_GAS) return { ok: false, sent: false, reason: 'moved', netWei: net.toString(), spare: again.spare };
    gasLimit = again.estimate;
    hash = await wallet.sendTransaction({
      account, chain: monad, to: row.router, data, value: row.size, gas: again.estimate,
      maxFeePerGas: again.price, maxPriorityFeePerGas: 0n, accessList: again.accessList,
    });
  }
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') return { ok: false, sent: true, reason: 'revert', hash, gasLimit: gasLimit.toString() };
  if (row.kind === 'tri') {
    const wbal = await pc.readContract({ address: WMON, abi: erc20Abi, functionName: 'balanceOf', args: [EXPECT] });
    if (wbal > 0n) {
      const data = encodeFunctionData({ abi: withdrawAbi, functionName: 'withdraw', args: [wbal] });
      const gas = await pc.estimateGas({ account: EXPECT, to: WMON, data });
      const unwrapHash = await wallet.sendTransaction({
        account, chain: monad, to: WMON, data, gas, maxFeePerGas: row.priced.price, maxPriorityFeePerGas: 0n,
      });
      const unwrapReceipt = await pc.waitForTransactionReceipt({ hash: unwrapHash, timeout: 60_000 });
      if (unwrapReceipt.status !== 'success') return { ok: false, sent: true, reason: 'revert', hash: unwrapHash, gasLimit: gas.toString() };
    }
  }
  const end = await pc.getBalance({ address: EXPECT });
  return {
    ok: true, sent: true, reason: 'success', hash, block: receipt.blockNumber.toString(),
    kind: row.kind, mid: row.mid, sizeWei: row.size.toString(), gasLimit: gasLimit.toString(),
    balanceBeforeWei: before.toString(), balanceEndWei: end.toString(), nativeDeltaWei: (end - before).toString(),
  };
}

function pack(row) {
  return {
    kind: row.kind, mid: row.mid, buy: row.buy, sell: row.sell, venue: row.venue,
    sizeWei: row.size.toString(), grossWei: row.gross?.toString?.() || String(row.gross),
    netWei: row.net.toString(), gas: row.priced.estimate.toString(), spare: row.spare,
    spareError: row.priced.spareError || undefined,
    failsAt: row.priced.failsAt?.toString?.(),
    billWei: row.priced.bill.toString(), block: row.priced.block?.toString?.(),
  };
}

function memoKey(row) {
  if (row.kind === 'hop') return `h:${lower(row.mid)}:${row.buy.name}:${row.sell.name}:${row.size}:${row.buy.r0}:${row.buy.r1}:${row.sell.r0}:${row.sell.r1}`;
  return `t:${row.venue}:${lower(row.mid)}:${row.size}:${row.stamp || ''}`;
}

async function evaluate(found, { sims = 4, walk = 24, minGross = 25_000_000_000_000_000n, memo } = {}) {
  const ranked = [...found.hops, ...found.tris].sort((a, b) => (a.gross > b.gross ? -1 : 1));
  const head = ranked.slice(0, 5).map((row) => ({
    kind: row.kind, mid: row.mid, buy: row.buy?.name, sell: row.sell?.name, venue: row.venue,
    sizeWei: row.size.toString(), grossWei: row.gross.toString(),
  }));
  log({ ok: true, sent: false, reason: 'ranked', count: ranked.length, head });
  const verified = [];
  let priced = 0;
  for (const row of ranked.slice(0, walk)) {
    if (priced >= sims) break;
    if (row.gross < minGross) break;
    const key = memoKey(row);
    if (memo?.has(key)) continue;
    try {
      const got = row.kind === 'hop' ? await verifyHop(row) : await verifyTri(row);
      if (memo && !(got && !got.reason && passes(got))) memo.set(key, 1);
      if (!got) continue;
      if (got.reason) {
        log({ ok: false, sent: false, reason: got.reason, kind: row.kind, mid: row.mid });
        continue;
      }
      priced += 1;
      verified.push(got);
      log({ ok: true, sent: false, reason: 'sim', ...pack(got) });
    } catch (err) {
      log({ ok: false, sent: false, reason: 'verify_error', kind: row.kind, mid: row.mid, message: String(err?.shortMessage || err?.message || '').slice(0, 180) });
    }
  }
  verified.sort((a, b) => (a.net > b.net ? -1 : 1));
  return verified;
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
  const block = await pc.getBlockNumber();
  log({ ok: true, sent: false, reason: 'start', block: block.toString(), balanceWei: bal.toString(), balance: formatUnits(bal, 18), signer: Boolean(account), once: ONCE, dry: DRY });
  await watchGrid();
  const watched = await watchKnown();
  const books = await indexBook();
  const found = candidatesFrom(books);
  log({
    ok: true, sent: false, reason: 'scan', pairs: books.length, wmonLegs: found.wmonLegs,
    hops: found.hops.length, tris: found.tris.length,
    bestHop: found.hops[0] ? { mid: found.hops[0].mid, buy: found.hops[0].buy.name, sell: found.hops[0].sell.name, size: found.hops[0].size.toString(), gross: found.hops[0].gross.toString() } : null,
    bestTri: found.tris[0] ? { mid: found.tris[0].mid, venue: found.tris[0].venue, size: found.tris[0].size.toString(), gross: found.tris[0].gross.toString() } : null,
  });
  const first = await evaluate(found, { sims: 6, walk: 30, minGross: 20_000_000_000_000_000n });
  const ready = [...first, ...watched].filter(passes).sort((a, b) => (a.net > b.net ? -1 : 1));
  log({ ok: true, sent: false, reason: 'verified', checked: first.length + watched.length, ready: ready.length, top: [...first, ...watched].slice(0, 5).map(pack) });
  let sends = 0;
  if (!ready.length && ONCE) { log({ ok: true, sent: false, reason: 'none' }); return; }
  if (ready.length && (DRY || !account)) {
    log({ ok: false, sent: false, reason: account ? 'dry' : 'no_signer', candidate: pack(ready[0]) });
    if (ONCE) return;
  } else if (ready.length) {
    const sent = await sendRow(account, ready[0]);
    log(sent);
    if (sent.sent && !sent.ok) return;
    if (sent.ok) sends += 1;
    if (ONCE) return;
  }
  const end = Date.now() + DURATION_MIN * 60_000;
  let tick = 0;
  let hot = hotSet(found);
  const memo = new Map();
  while (Date.now() < end && sends < MAX_SENDS) {
    tick += 1;
    if (memo.size > 400) memo.clear();
    await refreshBooks(books, hot);
    const again = candidatesFrom(books);
    hot = hotSet(again);
    const rows = await evaluate(again, { sims: 1, walk: 12, minGross: 25_000_000_000_000_000n, memo });
    const live = await watchKnown();
    const hit = [...rows, ...live].filter(passes).sort((a, b) => (a.net > b.net ? -1 : 1))[0];
    if (!hit) {
      if (tick % 5 === 0) {
        const best = again.hops[0] || again.tris[0];
        log({ ok: true, sent: false, reason: 'idle', tick, bestGross: best ? best.gross.toString() : '0', kind: best?.kind || null });
      }
      await sleep(TICK_MS);
      continue;
    }
    if (DRY || !account) { log({ ok: false, sent: false, reason: account ? 'dry' : 'no_signer', candidate: pack(hit) }); return; }
    const sent = await sendRow(account, hit);
    log(sent);
    if (sent.sent && !sent.ok) return;
    if (sent.ok) sends += 1;
    await sleep(TICK_MS);
  }
  log({ ok: true, sent: false, reason: 'loop_end', tick, sends });
}

main().catch((err) => {
  log({ ok: false, sent: false, reason: 'error', message: String(err?.shortMessage || err?.message || err).slice(0, 400) });
  process.exit(1);
});
