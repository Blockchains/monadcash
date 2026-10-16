export type Term = {
  id: string;
  phrase: string;
  href: string;
  define: string;
};

/** Longest phrases must be listed before shorter ones that share a prefix. */
export const TERMS: Term[] = [
  { id: 'monad-mainnet', phrase: 'Monad mainnet', href: 'https://monadvision.com', define: 'Chain 143. The public chain this tape reads. Blocks, addresses, and transactions below link to the explorer.' },
  { id: 'gas-limit', phrase: 'gas limit', href: 'https://docs.monad.xyz/developer-essentials/gas-pricing', define: 'The units a signer puts on a transaction. On Monad the bill is this limit times the gas price, not the gas that was used.' },
  { id: 'gas-limit-code', phrase: 'gas_limit', href: 'https://docs.monad.xyz/developer-essentials/gas-pricing', define: 'Same quantity as gas limit, written the way a transaction field spells it.' },
  { id: 'base-fee', phrase: 'base fee', href: 'https://docs.monad.xyz/developer-essentials/gas-pricing', define: 'The protocol gas price. On Monad it does not fall below 100 gwei.' },
  { id: 'uniswap-v4', phrase: 'Uniswap v4', href: 'https://docs.uniswap.org/', define: 'The v4 quoter used here is fee 500, tick spacing 10, hooks unset, native MON against USDC, unless a print says otherwise.' },
  { id: 'uniswap-v3', phrase: 'Uniswap v3', href: 'https://docs.uniswap.org/', define: 'Concentrated-liquidity pools. A single swap of ordinary tokens is about 140,000 gas, about 0.014 MON at the 100 gwei floor.' },
  { id: 'uniswap-v2', phrase: 'Uniswap v2', href: 'https://docs.uniswap.org/', define: 'Constant-product pairs. Factory 0x182a927119d56008d921126764bf884221b10f59. 21,289 pairs, 20,911 solvent, 0 hits.' },
  { id: 'pancake-v2', phrase: 'PancakeSwap v2', href: 'https://docs.pancakeswap.finance/', define: 'Factory 0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e. 13,062 pairs, 13,057 solvent, one mock-token hit.' },
  { id: 'pancake-v3', phrase: 'PancakeSwap v3', href: 'https://docs.pancakeswap.finance/', define: 'Concentrated-liquidity Pancake pools. The 0.05% and 0.01% fee tiers are the ones this tape quotes.' },
  { id: 'pancakeswap', phrase: 'PancakeSwap', href: 'https://docs.pancakeswap.finance/', define: 'PancakeSwap v2 and v3 on Monad, as named in each print.' },
  { id: 'morpho-blue', phrase: 'Morpho Blue', href: 'https://docs.morpho.org/', define: 'The lending contract read for positions under health 1. The underwater balances with a dollar value were cents, and the collateral had no v3 exit.' },
  { id: 'erc-4626', phrase: 'ERC-4626', href: 'https://eips.ethereum.org/EIPS/eip-4626', define: 'The tokenized-vault interface. previewRedeem and redeem are how this tape tested whether a share turns back into the asset in one call.' },
  { id: 'eip-1559', phrase: 'EIP-1559', href: 'https://eips.ethereum.org/EIPS/eip-1559', define: 'The fee shape: base fee plus tip. Monad still bills the gas limit, and the base fee has a 100 gwei floor.' },
  { id: 'best-bid-ask', phrase: 'bestBidAsk', href: 'https://monadvision.com', define: 'The Kuru view this tape called on 100 markets. Four returned a price. None was crossed.' },
  { id: 'preview-redeem', phrase: 'previewRedeem', href: 'https://eips.ethereum.org/EIPS/eip-4626', define: 'A read of how many assets a share would return. It is not a transfer.' },
  { id: 'request-redeem', phrase: 'requestRedeem', href: 'https://eips.ethereum.org/EIPS/eip-4626', define: 'aprMON’s exit. On the fork it credited a request and left claimable at 0.' },
  { id: 'eth-call', phrase: 'eth_call', href: 'https://docs.monad.xyz/', define: 'A read against public state. It does not move tokens and it is not a receipt.' },
  { id: 'dyorswap', phrase: 'DYORSwap', href: 'https://monadvision.com/address/0xE78B9c8F3e9f46CEDC204309E9F387f736d0d278', define: 'Factory of the closest print. 1,037 pairs, 867 solvent, one hit: WMON, USDC, NADXBT, WMON.' },
  { id: 'nadswap', phrase: 'Nadswap', href: 'https://monadvision.com/address/0xa25b13127e63ddae6d0b35570ff3d39dbd621001', define: '3,802 pairs. 67 solvent, 2 insolvent, 0 hits, 0 skims.' },
  { id: 'octoswap', phrase: 'OctoSwap', href: 'https://monadvision.com/address/0xce104732685b9d7b2f07a09d828f6b19786cda32', define: 'OctoSwap Classic. 67 pairs, all solvent, 0 hits.' },
  { id: 'zkswap', phrase: 'zkSwap', href: 'https://monadvision.com/address/0x0ff16867bcac3c5fdc2dc73558e3f8e2ed89eea2', define: 'Eight pairs, all solvent, 0 hits.' },
  { id: 'monday-trade', phrase: 'Monday Trade', href: 'https://monadvision.com', define: 'Named on the WMON/USDC index. This pass did not turn that mid into a settlement.' },
  { id: 'aethonswap', phrase: 'Aethonswap', href: 'https://monadvision.com', define: 'Opened far enough to see a WBTC/WMON pool. Not a settlement in this tape.' },
  { id: 'someswap', phrase: 'SomeSwap', href: 'https://monadvision.com/address/0x00008a3c1077325bb19cd93e5a0f1e95144700fa', define: 'Factory 0x00008a3c1077325bb19cd93e5a0f1e95144700fa. 46 pairs on the uncapped pass. No cycle there cleared the gas limit.' },
  { id: 'capricorn', phrase: 'Capricorn', href: 'https://monadvision.com', define: 'Named on the WMON/USDC index range. The executable quotes are in the pool sections.' },
  { id: 'balancer', phrase: 'Balancer', href: 'https://docs.balancer.fi/', define: 'Balancer v3 appeared on the WMON/USDC index. The index range is labeled as a mid.' },
  { id: 'atlantis', phrase: 'Atlantis', href: 'https://monadvision.com/address/0x32681b2afbeb1a0ad7545cb2cd72236fe5d7919f', define: 'USDC/WETH pool. Algebra. The on-chain price matched the deep book.' },
  { id: 'madness', phrase: 'Madness', href: 'https://monadvision.com/address/0x93d71152a93619c0b10a2efc856ac46120fd01ab', define: '30 pairs. Four quotes sat above 0.005 MON before the balance filter. After it: 22 solvent, 8 insolvent, 0 hits.' },
  { id: 'uniswap', phrase: 'Uniswap', href: 'https://docs.uniswap.org/', define: 'Uniswap v2, v3, and v4, as named in each print.' },
  { id: 'pancake', phrase: 'Pancake', href: 'https://docs.pancakeswap.finance/', define: 'PancakeSwap on Monad, as named in each print.' },
  { id: 'slvmon', phrase: 'sLVMON', href: 'https://monadvision.com/address/0x61b29EfEf2E6f866bA4AaeFDb87d2837C6a22b9c', define: 'A vault over LVMON. About 3.39380 assets per share, and no v3 pool to sell the share.' },
  { id: 'aprmon', phrase: 'aprMON', href: 'https://monadvision.com/address/0x0c65A0BC65a5D819235B71F554D210D3F80E0852', define: 'The share whose previewRedeem peaks near 0.026 MON on 30 MON, and whose requestRedeem left claimable at 0.' },
  { id: 'shmon', phrase: 'shMON', href: 'https://monadvision.com/address/0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c', define: 'Liquid staking share. Unstake fee about 0.680%. The deep pool is about 2.50 basis points under net asset value.' },
  { id: 'strusd', phrase: 'strUSD', href: 'https://monadvision.com/address/0x683fb58ee77172626D5B49087DdAc71eF7825d20', define: 'Staked trUSD. The Curve pool quotes a premium. Vault reads reverted. The minter is role-gated.' },
  { id: 'trusd', phrase: 'trUSD', href: 'https://monadvision.com/address/0x770a579Ea200784723B31b8668b0773ba80393c9', define: 'The asset quoted against strUSD. Against AUSD the index was a tenth of a basis point from one.' },
  { id: 'nadxbt', phrase: 'NADXBT', href: 'https://monadvision.com/address/0x7289A594e116DC99af16ff0db0529A803b68Bfa5', define: '9-decimal token, 11,866 bytes. The closest settled cycle buys it through USDC and sells it into a 0.067 MON pool.' },
  { id: 'usdt0', phrase: 'USDT0', href: 'https://monadvision.com/address/0xe7cd86e13AC4309349F30B3435a9d337750fC82D', define: 'The USDT the v2-to-v3 print trades. Half a MON of gross profit was 0.00812 MON, under one v3 leg.' },
  { id: 'policypilot', phrase: 'PolicyPilot', href: 'https://blockchains.github.io/policypilot-monad/', define: 'The desk that published this tape. The clip and spread senders are unchanged by the page.' },
  { id: 'wmon', phrase: 'WMON', href: 'https://monadvision.com/address/0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', define: 'Wrapped MON. Cycles in the v2 scan start and end here.' },
  { id: 'usdc', phrase: 'USDC', href: 'https://monadvision.com/address/0x754704Bc059F8C67012fEd69BC8A327a5aafb603', define: 'The 6-decimal dollar token used as the bridge in the NADXBT cycle and the stable quotes.' },
  { id: 'swyrl', phrase: 'Swyrl', href: 'https://monadvision.com/address/0xd158cdfec90e9429a290c3144afeb72e8c23603a', define: 'One legacy pair. Solvent. No hit.' },
  { id: 'pinot', phrase: 'Pinot', href: 'https://monadvision.com/address/0x998b563b214f158fce042ca82a8d441343f507d6', define: 'WMON/USDC fee tier 10,000. The in-range ceiling at 2 MON is +0.0033 MON.' },
  { id: 'kuru', phrase: 'Kuru', href: 'https://monadvision.com/address/0x065C9d28E428A0db40191a54d33d5b7c71a9C394', define: 'The order books. Four of 100 markets answered bestBidAsk. The MON/USDC book is the address on this link.' },
  { id: 'curve', phrase: 'Curve', href: 'https://docs.curve.finance/', define: 'Stables, the cbBTC/WBTC/LBTC pool, the strUSD pool, and the LST pool.' },
  { id: 'morpho', phrase: 'Morpho', href: 'https://docs.morpho.org/', define: 'Morpho Blue on Monad. See the liquidation print.' },
  { id: 'monad', phrase: 'Monad', href: 'https://docs.monad.xyz/', define: 'The chain. Gas pricing is the constraint on every print in this tape.' },
  { id: 'smon', phrase: 'sMON', href: 'https://monadvision.com', define: 'A liquid staking share. Mint-and-sell of 1 MON came back short by 0.000422 MON.' },
  { id: 'gmon', phrase: 'gMON', href: 'https://monadvision.com/address/0x1ca0f16a316c3ee0ff3cec5382caad5648ea512d', define: 'A liquid staking share. Its Kuru market reverted MarketStateError. Mint-and-sell of 1 MON was short by 0.001449 MON.' },
  { id: 'trev', phrase: 'TREV', href: 'https://monadvision.com/address/0x0f0e8a691306f2e568c4cd87d42b315742a549d0', define: 'The token an index priced near 1.92 million dollars. The Uniswap v2 pair holds 4.494613 USDC.' },
  { id: 'lfj', phrase: 'LFJ', href: 'https://monadvision.com/address/0xf4443d36ecb9f3ef06eae9b26706aaf591ade5ce', define: 'The WMON/USDC pair whose getSwapOut for 1 WMON is 0.022815 USDC.' },
  { id: 'bean', phrase: 'Bean', href: 'https://monadvision.com', define: 'Named on the index. factory() did not answer on the read this pass made.' },
  { id: 'mon', phrase: 'MON', href: 'https://docs.monad.xyz/', define: 'The native coin. At a 100 gwei floor, 100,000 gas costs 0.010 MON.' },
  { id: 'gas', phrase: 'gas', href: 'https://docs.monad.xyz/developer-essentials/gas-pricing', define: 'The unit Monad bills. The bill is the gas limit times the price, and the price does not fall below 100 gwei.' },
];

const BY_PHRASE = new Map(TERMS.map(t => [t.phrase.toLowerCase(), t]));

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

function phraseAlt() {
  return [...TERMS]
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map(t => t.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

const RE = new RegExp(
  `https?:\\/\\/[^\\s<]+|0x[a-fA-F0-9]{64}|0x[a-fA-F0-9]{40}|\\b(?:${phraseAlt()})\\b`,
  'gi',
);

export function linkify(text: string, cls: { term: string; addr: string }): string {
  let out = '';
  let i = 0;
  const src = String(text);
  RE.lastIndex = 0;
  for (const m of src.matchAll(RE)) {
    const start = m.index ?? 0;
    out += esc(src.slice(i, start));
    const raw = m[0];
    if (raw.startsWith('http')) {
      const trimmed = raw.replace(/[),.;]+$/, '');
      const tail = raw.slice(trimmed.length);
      out += `<a class="${cls.term}" href="${esc(trimmed)}">${esc(trimmed)}</a>${esc(tail)}`;
    } else if (/^0x[a-fA-F0-9]{64}$/.test(raw)) {
      out += `<a class="${cls.addr}" href="https://monadvision.com/tx/${raw}">${esc(raw)}</a>`;
    } else if (/^0x[a-fA-F0-9]{40}$/.test(raw)) {
      out += `<a class="${cls.addr}" href="https://monadvision.com/address/${raw}">${esc(raw)}</a>`;
    } else {
      const term = BY_PHRASE.get(raw.toLowerCase());
      if (term) out += `<a class="${cls.term}" href="${esc(term.href)}">${esc(raw)}</a>`;
      else out += esc(raw);
    }
    i = start + raw.length;
  }
  out += esc(src.slice(i));
  return out;
}
