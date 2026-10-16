// One creation on the rebalancer gas wallet. Not a vault call.
// The constructor buys UNCLE on Pancake v2 and sells it on Purps, then unwraps.
// It returns no runtime code. A later run refuses to sign unless a fresh
// simulation still clears and the wallet stays at or above 5 MON.
// DRY=1 simulates from the public address and does not sign.
import { createPublicClient, createWalletClient, http, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPCS = ['https://rpc.monad.xyz', 'https://rpc-mainnet.monadinfra.com', 'https://rpc.ankr.com/monad_mainnet'];
const EXPECT = '0xC2cF684A3931143FD877F02222085713842a090E';
const CAKE = '0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9';
const PURPS = '0x22aDf91b491abc7a50895Cd5c5c194EcCC93f5E2';
const UNCLE = '0x483A6a93c352c9666dFE84693E5B957d555D7777';
const AMOUNT = 81_016_337_000_000_000n;
const FLOOR = 5_000_000_000_000_000_000n;
const MIN_NET = 5_000_000_000_000_000n;
const INIT = '0x60806040526040516107053803806107058339810160408190526100229161049c565b6040805160028082526060820183525f92602083019080368337019050509050733bd359c1119da7da1d913d1c4d2b7c461115433a815f81518110610069576100696104f8565b60200260200101906001600160a01b031690816001600160a01b031681525050828160018151811061009d5761009d6104f8565b6001600160a01b0392831660209182029290920101525f908616637ff36ab534600185306100cd426104b061050c565b6040518663ffffffff1660e01b81526004016100ec9493929190610574565b5f6040518083038185885af1158015610107573d5f803e3d5ffd5b50505050506040513d5f823e601f3d908101601f1916820160405261012f91908101906105a8565b9050836001600160a01b031663095ea7b38683600181518110610154576101546104f8565b60200260200101516040518363ffffffff1660e01b815260040161018d9291906001600160a01b03929092168252602082015260400190565b6020604051808303815f875af11580156101a9573d5f803e3d5ffd5b505050506040513d601f19601f820116820180604052508101906101cd9190610660565b506040805160028082526060820183525f9260208301908036833701905050905084815f81518110610201576102016104f8565b60200260200101906001600160a01b031690816001600160a01b031681525050733bd359c1119da7da1d913d1c4d2b7c461115433a81600181518110610249576102496104f8565b60200260200101906001600160a01b031690816001600160a01b031681525050856001600160a01b03166338ed17398360018151811061028b5761028b6104f8565b6020026020010151868430426104b06102a4919061050c565b6040518663ffffffff1660e01b81526004016102c4959493929190610686565b5f604051808303815f875af11580156102df573d5f803e3d5ffd5b505050506040513d5f823e601f3d908101601f1916820160405261030691908101906105a8565b506040516370a0823160e01b81523060048201525f90733bd359c1119da7da1d913d1c4d2b7c461115433a906370a0823190602401602060405180830381865afa158015610356573d5f803e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061037a91906106c1565b90505f733bd359c1119da7da1d913d1c4d2b7c461115433a6001600160a01b0316826040516024016103ae91815260200190565b60408051601f198184030181529181526020820180516001600160e01b0316632e1a7d4d60e01b179052516103e391906106d8565b5f604051808303815f865af19150503d805f811461041c576040519150601f19603f3d011682016040523d82523d5f602084013e610421565b606091505b505090508061042e575f80fd5b604051339047905f81818185875af1925050503d805f811461046b576040519150601f19603f3d011682016040523d82523d5f602084013e610470565b606091505b5050809150508061047f575f80fd5b005b80516001600160a01b0381168114610497575f80fd5b919050565b5f805f80608085870312156104af575f80fd5b6104b885610481565b93506104c660208601610481565b92506104d460408601610481565b6060959095015193969295505050565b634e487b7160e01b5f52604160045260245ffd5b634e487b7160e01b5f52603260045260245ffd5b8082018082111561052b57634e487b7160e01b5f52601160045260245ffd5b92915050565b5f815180845260208085019450602084015f5b838110156105695781516001600160a01b031687529582019590820190600101610544565b509495945050505050565b848152608060208201525f61058c6080830186610531565b6001600160a01b03949094166040830152506060015292915050565b5f60208083850312156105b9575f80fd5b82516001600160401b03808211156105cf575f80fd5b818501915085601f8301126105e2575f80fd5b8151818111156105f4576105f46104e4565b8060051b604051601f19603f83011681018181108582111715610619576106196104e4565b604052918252848201925083810185019188831115610636575f80fd5b938501935b828510156106545784518452938501939285019261063b565b98975050505050505050565b5f60208284031215610670575f80fd5b8151801515811461067f575f80fd5b9392505050565b85815284602082015260a060408201525f6106a460a0830186610531565b6001600160a01b0394909416606083015250608001529392505050565b5f602082840312156106d1575f80fd5b5051919050565b5f82515f5b818110156106f757602081860181015185830152016106dd565b505f92019182525091905056fe';

const chain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
};

const log = (row) => console.log(`TAPE_FILL ${JSON.stringify(row)}`);
const dry = process.env.DRY === '1';
const client = (url) => createPublicClient({ chain, transport: http(url, { timeout: 25_000 }) });

async function withRpc(fn) {
  let last;
  for (const url of RPCS) {
    try { return await fn(client(url)); }
    catch (err) { last = err; }
  }
  throw last;
}

const creation = (minBack) => INIT + encodeAbiParameters(
  [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
  [CAKE, PURPS, UNCLE, minBack],
).slice(2);

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

async function price(pc, from, minBack) {
  const block = await pc.getBlock();
  const base = block.baseFeePerGas ?? 0n;
  const priceWei = base > 100_000_000_000n ? base : 100_000_000_000n;
  const data = creation(minBack);
  const tx = { from, data, value: `0x${AMOUNT.toString(16)}` };
  const listed = await pc.request({ method: 'eth_createAccessList', params: [tx, 'latest'] });
  const accessList = (listed.accessList || []).map((row) => ({ address: row.address, storageKeys: row.storageKeys || [] }));
  const estimate = BigInt(await pc.request({ method: 'eth_estimateGas', params: [{ ...tx, accessList }, 'latest'] }));
  const traced = await pc.request({
    method: 'debug_traceCall',
    params: [{ ...tx, gas: `0x${estimate.toString(16)}`, accessList }, 'latest', { tracer: 'callTracer' }],
  });
  const received = valueBack(traced, from);
  const bill = estimate * priceWei;
  return { block: block.number, base, priceWei, accessList, entries: accessList.length, estimate, received, bill, net: received - AMOUNT - bill, data };
}

async function main() {
  const key = process.env.AGENT_KEY_REBALANCER || '';
  if (!dry && !key) { log({ ok: false, sent: false, reason: 'no_signer' }); return; }
  let account;
  if (!dry) {
    const hex = key.startsWith('0x') ? key : `0x${key}`;
    account = privateKeyToAccount(hex);
    if (account.address.toLowerCase() !== EXPECT.toLowerCase()) { log({ ok: false, sent: false, reason: 'signer_mismatch' }); return; }
  }
  const first = await withRpc((pc) => price(pc, EXPECT, 1n));
  const minBack = AMOUNT + first.bill;
  const priced = await withRpc((pc) => price(pc, EXPECT, minBack));
  const preview = {
    ok: priced.net > MIN_NET && priced.received >= minBack,
    sent: false,
    dry,
    block: priced.block.toString(),
    baseFeeWei: priced.base.toString(),
    estimate: priced.estimate.toString(),
    accessListEntries: priced.entries,
    receivedWei: priced.received.toString(),
    billWei: priced.bill.toString(),
    netWei: priced.net.toString(),
    minBackWei: minBack.toString(),
  };
  if (priced.received === 0n) { log({ ...preview, ok: false, reason: 'no_fill' }); return; }
  if (priced.received < minBack || priced.net <= MIN_NET) { log({ ...preview, ok: false, reason: 'net_below_floor' }); return; }
  if (dry) { log({ ...preview, ok: true, reason: 'dry' }); return; }

  const pc = client(RPCS[0]);
  const wallet = createWalletClient({ account, chain, transport: http(RPCS[0], { timeout: 25_000 }) });
  const before = await pc.getBalance({ address: EXPECT });
  const fresh = await price(pc, EXPECT, AMOUNT + priced.bill);
  const gas = fresh.estimate;
  const bill = gas * fresh.priceWei;
  const spend = AMOUNT + bill;
  if (fresh.received < AMOUNT + bill || fresh.net <= MIN_NET) {
    log({ ...preview, ok: false, reason: 'moved', freshNetWei: fresh.net.toString(), freshReceivedWei: fresh.received.toString() });
    return;
  }
  if (before < FLOOR + spend) {
    log({ ...preview, ok: false, reason: 'reserve', balanceWei: before.toString(), spendWei: spend.toString() });
    return;
  }
  const hash = await wallet.sendTransaction({
    account,
    chain,
    data: creation(AMOUNT + bill),
    value: AMOUNT,
    gas,
    maxFeePerGas: fresh.priceWei,
    maxPriorityFeePerGas: 0n,
    accessList: fresh.accessList,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
  const end = await pc.getBalance({ address: EXPECT });
  log({
    ok: receipt.status === 'success',
    sent: true,
    reason: receipt.status,
    hash,
    block: receipt.blockNumber.toString(),
    gasLimit: gas.toString(),
    billWei: bill.toString(),
    balanceBeforeWei: before.toString(),
    balanceEndWei: end.toString(),
    nativeDeltaWei: (end - before).toString(),
    receivedWei: fresh.received.toString(),
    netWei: fresh.net.toString(),
    contractAddress: receipt.contractAddress,
  });
}

main().catch((err) => {
  log({ ok: false, sent: false, reason: 'error', message: String(err?.shortMessage || err?.message || err).slice(0, 400) });
  process.exit(1);
});
