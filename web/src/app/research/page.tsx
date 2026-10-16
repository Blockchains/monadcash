import type { Metadata } from 'next';
import { Linked } from '../../components/Linked';
import { LiveTape, type TapeObs } from '../../components/LiveTape';
import { TERMS } from '../../lib/tapeLinks';
import liveDoc from '../../../public/research/live.json';
import styles from './tape.module.css';

const BP = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const ORIGIN = 'https://blockchains.github.io';
const CANONICAL = `${ORIGIN}${BP}/research/`;
const SHARE_IMAGE = `${ORIGIN}${BP}/icon-512.png`;
const TITLE = 'Monad desk tape: the gas limit is the trade';
const DESCRIPTION =
  'PolicyPilot desk tape, 16 October 2026. Monad bills the gas limit. A DYOR NADXBT cycle landed +0.020775385 MON. An uncapped pass then sent 0.081016337 MON of UNCLE, Pancake v2 into Purps, in block 113,798,632. The creation gas limit was 318,301. The wallet’s native balance rose by 0.014139141 MON. A later pass priced 100, 1,000, and 10,000 MON and did not send. The same two shapes were priced again and did not send. Routes that finished short stay on the blotter.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'Monad gas limit',
    'Monad mainnet',
    'PolicyPilot',
    'atomic arbitrage',
    'Uniswap v4 Monad',
    'DYORSwap',
    'PancakeSwap Monad',
    'shMON',
    'aprMON',
  ],
  authors: [{ name: 'PolicyPilot desk', url: 'https://blockchains.github.io/policypilot-monad/' }],
  metadataBase: new URL(ORIGIN),
  alternates: { canonical: CANONICAL },
  robots: { index: true, follow: true, 'max-image-preview': 'large' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    siteName: 'PolicyPilot',
    type: 'article',
    publishedTime: '2026-10-16T01:40:00.000Z',
    modifiedTime: '2026-10-16T11:05:00.000Z',
    locale: 'en_US',
    images: [{ url: SHARE_IMAGE, width: 512, height: 512, alt: 'PolicyPilot' }],
  },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION, images: [SHARE_IMAGE] },
};

const HOME = `${ORIGIN}${BP}/`;
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'TechArticle',
      headline: TITLE,
      alternativeHeadline: 'A Monad mainnet research tape on atomic routes and the gas limit',
      description: DESCRIPTION,
      datePublished: '2026-10-16',
      dateModified: '2026-10-16',
      inLanguage: 'en',
      mainEntityOfPage: CANONICAL,
      url: CANONICAL,
      image: SHARE_IMAGE,
      keywords: 'Monad, gas limit, PolicyPilot, atomic arbitrage, Uniswap v4, DYORSwap, PancakeSwap, shMON, aprMON',
      author: { '@type': 'Organization', name: 'PolicyPilot', url: HOME },
      publisher: {
        '@type': 'Organization',
        name: 'PolicyPilot',
        url: HOME,
        logo: { '@type': 'ImageObject', url: SHARE_IMAGE },
      },
      about: [
        { '@type': 'Thing', name: 'Monad' },
        { '@type': 'Thing', name: 'Gas pricing' },
        { '@type': 'Thing', name: 'Decentralized exchange arbitrage' },
      ],
      isAccessibleForFree: true,
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'PolicyPilot', item: HOME },
        { '@type': 'ListItem', position: 2, name: 'Desk tape', item: CANONICAL },
      ],
    },
    {
      '@type': 'Dataset',
      name: 'PolicyPilot Monad desk tape corpus',
      description: DESCRIPTION,
      url: CANONICAL,
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'PolicyPilot', url: HOME },
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${HOME}research/corpus.json` },
        { '@type': 'DataDownload', encodingFormat: 'application/x-ndjson', contentUrl: `${HOME}research/corpus.jsonl` },
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${HOME}research/live.json` },
      ],
    },
  ],
};

const BILLS = [
  ['21,000', '0.00210', 'A plain MON transfer. Nothing is earned.'],
  ['80,000', '0.00800', 'About the cheapest useful contract call.'],
  ['140,000', '0.01400', 'One Uniswap v3-style swap, by itself.'],
  ['200,000', '0.02000', 'A tight two-hop of ordinary tokens, if the path is kind.'],
  ['420,000', '0.04200', 'The clip limit this desk already signs. It stays there.'],
  ['294,130', '0.02941', 'Access-list limit on the 0.006 MON cycle. The call returns the WMON. Not broadcast.'],
  ['523,536', '0.05235', 'The same swap with no access list, minOut set to the amount received.'],
  ['560,024', '0.05600', 'The earlier fork meter on 0.01 MON, before calldata.'],
];

const VENUES = [
  { name: 'Uniswap v2', pairs: '21,289', solvent: '20,911', insolvent: '0', wmon: '20,778', hits: '0', skims: '0' },
  { name: 'PancakeSwap v2', pairs: '13,062', solvent: '13,057', insolvent: '0', wmon: '13,024', hits: '1', skims: '0' },
  { name: 'Nadswap', pairs: '3,802', solvent: '67', insolvent: '2', wmon: '56', hits: '0', skims: '0' },
  { name: 'DYORSwap', pairs: '1,037', solvent: '867', insolvent: '0', wmon: '555', hits: '1', skims: '0' },
  { name: 'OctoSwap Classic', pairs: '67', solvent: '67', insolvent: '0', wmon: '39', hits: '0', skims: '0' },
  { name: 'Madness', pairs: '30', solvent: '22', insolvent: '8', wmon: '17', hits: '0', skims: '0' },
  { name: 'zkSwap v2', pairs: '8', solvent: '8', insolvent: '0', wmon: '6', hits: '0', skims: '0' },
  { name: 'Swyrl Legacy', pairs: '1', solvent: '1', insolvent: '0', wmon: '1', hits: '0', skims: '0' },
];

export default function ResearchTape() {
  return (
    <div className={styles.page}>
      <div className={styles.progress} aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Linked><article className={styles.wrap}>
        <header>
          <p className={styles.kicker}>
            <a href={`${BP}/`}>PolicyPilot</a>
            <span>Desk tape 016</span>
            <span>Monad mainnet</span>
            <span>Chain 143</span>
          </p>
          <hr className={styles.rule} />
          <h1>The gas limit is the trade.</h1>
          <p className={styles.dek}>
            This is the whole pass, including every route that finished short. Monad bills the gas limit, the base fee does not fall below 100 gwei, and the chain is public, so the calls are public. A settlement moved tokens. A quote is an <code>eth_call</code>. An index mid is someone else’s price, and it is labeled as a mid. Two cycles were sent. The receipts are below. The second one had no size cap. A later pass treated 1,000 MON as an ordinary size and did not send. The same two shapes were priced again, from 0.001 MON to 2 MON, and did not send.
          </p>
          <p className={styles.meta}>
            <time dateTime="2026-10-16">16 October 2026</time>
            . Base fee read at block 113,745,594, and again at 113,787,261, both 100 gwei. The aprMON redeem is a fork of block 113,747,559. The first NADXBT settlement is a fork of public Ankr state. The clearing numbers are a fork of block 113,785,475 for the tokens, and the live node at block 113,787,261 for the gas. Live spread receipts are already on mainnet.
          </p>
          <nav className={styles.toc} aria-label="Tape sections">
            <a href="#live">Live</a>
            <a href="#billing">01 Billing</a>
            <a href="#universe">02 The universe</a>
            <a href="#closest">03 Closest print</a>
            <a href="#clears">04 The floor clears</a>
            <a href="#fill">05 The fill</a>
            <a href="#uncapped">13 No size cap</a>
            <a href="#thousand">14 A thousand MON</a>
            <a href="#shapes">15 The same shapes</a>
            <a href="#settled">06 Settled, and short</a>
            <a href="#shares">07 Share tokens</a>
            <a href="#books">08 Pools and books</a>
            <a href="#fiction">09 Empty and indexed</a>
            <a href="#rule">10 The rule</a>
            <a href="#book">11 The open book</a>
            <a href="#glossary">12 Keywords</a>
          </nav>
          <div className={styles.stats}>
            <div className={styles.stat}><b className={styles.up}>+0.02078</b><span>MON landed, after gas</span></div>
            <div className={styles.stat}><b className={styles.down}>294,057</b><span>gas on the swap receipt</span></div>
            <div className={styles.stat}><b className={styles.up}>97.38</b><span>MON left on the wallet</span></div>
          </div>
          <p className={styles.meta}>39,296 v2 pairs read · 35,000 solvent · 2 cycles above 0.005 MON · 0 skims. Uncapped pass: 39,369 pairs, 0 same-block excess, one UNCLE fill. Thousand-MON pass: no send. Closest net +0.000784632 MON, and it reverts one gas lower. Same-shape pass: no send. Best net −0.005548824 MON.</p>
          <p className={styles.meta}>
            Training set for agents: <a href={`${BP}/research/corpus.json`}>corpus.json</a>, <a href={`${BP}/research/corpus.jsonl`}>corpus.jsonl</a>, hourly <a href={`${BP}/research/live.json`}>live.json</a>, and <a href={`${BP}/llms.txt`}>llms.txt</a>.
          </p>
        </header>

        <section id="live">
          <h2><span className={styles.idx}>Live</span>The running read</h2>
          <p>
            Once an hour a public script reads the chain and appends a line. It records the block, the base fee, and the shMON unstake fee. It does not search for a route and it does not send a transaction. The prints in the rest of this tape stay the 16 October pass.
          </p>
          <LiveTape initial={(liveDoc.observations ?? []) as TapeObs[]} localUrl={`${BP}/research/live.json`} />
        </section>

        <section id="billing">
          <h2><span className={styles.idx}>01</span>What Monad actually charges</h2>
          <p>
            A transaction pays <code>gas_limit × price</code>. The price is at least 100 gwei. Gas left unused is not refunded against that bill, and a revert pays the whole limit. Shrinking a quote, or hoping the chain will charge only the gas that was consumed, does not change the number a signer has to put on the transaction.
          </p>
          <p>
            The table is the floor with no tip: limit times 100 gwei. A tip, a cushion so the transaction does not revert, and the calldata all sit on top.
          </p>
          <div className={styles.grid2}>
            {BILLS.map(([limit, mon, note]) => (
              <div className={styles.row} key={limit}>
                <div><b className={styles.num}>{limit}</b> gas<span style={{ display: 'block', color: '#a8a29e' }}>{note}</span></div>
                <div className={styles.num}>{mon} MON</div>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            A gain has to clear the limit you would actually sign. A forge <code>gasUsed</code> figure includes the test harness, so it is an upper bound on the work, not a number to put in a wallet. The wallet number is what <code>eth_estimateGas</code> returns on a Monad node, checked by an <code>eth_call</code> one gas lower that reverts. The closest print below is the harness. The section after it is the node.
          </p>
        </section>

        <section id="universe">
          <h2><span className={styles.idx}>02</span>The universe, counted</h2>
          <p>
            A pair counted as solvent when both token balances covered the reserves. A cycle had to start and end in WMON. The fee in the constant-product math was 997. A hit was a cycle whose quoted profit was above 0.005 MON. A skim was spare inventory above 0.02 MON or 0.02 USDC. The public RPCs were <code>rpc.monad.xyz</code>, <code>rpc-mainnet.monadinfra.com</code>, and <code>rpc.ankr.com/monad_mainnet</code>.
          </p>
          <p>
            Eight v2-style factories. 39,296 pairs. 35,000 of them solvent. Two hits. Zero skims.
          </p>
          <div>
            {VENUES.map(v => (
              <div className={styles.venue} key={v.name}>
                <b>{v.name}</b>
                <span>{v.pairs} pairs · {v.solvent} solvent · {v.insolvent} insolvent · {v.wmon} with WMON · {v.hits} hits · {v.skims} skims</span>
              </div>
            ))}
          </div>
          <p>
            Beside that book, 210 Uniswap v3 and Pancake v3 pools were opened, 74 of them live, 36 with liquidity. Curve was read on stables, on cbBTC/WBTC/LBTC, and on the LST pool. Uniswap v4 was quoted, not indexed. Kuru was asked <code>bestBidAsk</code> on 100 markets. LFJ, Pinot, Atlantis, Capricorn, Monday Trade, Bean, Aethonswap, Balancer v3, and SomeSwap were opened where a contract answered. Morpho Blue was read for positions that were actually underwater. Share tokens were shMON, sMON, gMON, aprMON, sLVMON, strUSD, and the other wrappers that expose a redeem.
          </p>
          <p className={styles.note}>
            The two hits are below. On the forge harness the real one still loses to the limit the test signed. Priced later on the Monad node, the same path clears, and that print is the next section. The other hit is a pair of mock tokens and is smaller than a three-hop bill. Everything else in this tape is a route we measured because it looked like money, and it did not clear.
          </p>
        </section>

        <section id="closest">
          <h2><span className={styles.idx}>03</span>The closest print</h2>
          <p>
            DYORSwap, factory <code className={styles.addr}>0xE78B9c8F3e9f46CEDC204309E9F387f736d0d278</code>, router <code className={styles.addr}>0x26CEb692410c4b3C12D63e01CFc03eEA103fc474</code>. The path is WMON, USDC, NADXBT, WMON. NADXBT is a 9-decimal token, 11,866 bytes of code, at <code className={styles.addr}>0x7289A594e116DC99af16ff0db0529A803b68Bfa5</code>.
          </p>
          <p>
            The WMON/USDC pool is ordinary: about 1,500 MON and 34.66 USDC, near the market. The USDC/NADXBT pool holds 0.240 USDC. The WMON/NADXBT pool holds 0.06745 MON. NADXBT is far cheaper through USDC than it is against that last pool, so a small MON sale buys the token cheaply and sells it into the 0.067 MON inventory.
          </p>
          <p className={styles.tag}>Settled on a fork</p>
          <p>
            <code>swapExactETHForTokens</code> of 0.01 MON returned 0.063059387 MON of WMON. Gross profit 0.053059387 MON. The router’s own quote was 0.063077226 MON, and the constant-product scan quoted 0.053077226 MON of profit on the same size. The 0.000018 MON gap is a small transfer haircut. The tokens moved.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>Size in</div><div className={styles.num}>0.010000000 MON</div></div>
            <div className={styles.row}><div>WMON out</div><div className={styles.num}>0.063059387 MON</div></div>
            <div className={styles.row}><div>Gross</div><div className={styles.num}>0.053059387 MON</div></div>
            <div className={styles.row}><div>Gas on the router call</div><div className={styles.num}>539,024</div></div>
            <div className={styles.row}><div>Plus the 21,000 base</div><div className={styles.num}>560,024</div></div>
            <div className={styles.row}><div>Floor at 100 gwei</div><div className={styles.num}>0.056002400 MON</div></div>
            <div className={styles.row}><div>Limit the test signed</div><div className={styles.num}>579,384</div></div>
            <div className={styles.row}><div>Bill on that limit</div><div className={styles.num}>0.057938400 MON</div></div>
            <div className={styles.row}><div>Net on that bill</div><div className={styles.num}>−0.004879013 MON</div></div>
          </div>
          <p>
            The floor is already 0.00294 MON above the gain, before calldata and before a cushion. The limit the fork test actually attached is the honest signature: 579,384 gas, 0.0579384 MON, net −0.004879 MON. A short limit reverts, and a revert bills the whole limit.
          </p>
          <p>
            The same three swaps by hand, each output sent back to the caller, returned the full quoted 0.063077226 MON and burned 962,235 gas. That bare bill was 0.0985735 MON, and the net was −0.045496 MON. The existing router is the cheaper machine. A new contract around the same hops would add a deployment, and a deployment costs more than this entire gain.
          </p>
          <p className={styles.note}>
            That note was the harness at size 0.01. The router call on a Monad node, at size 0.006, with the node’s own access list, comes in under the gain. The next section is that measurement. The harness number stays here so the miss is not rewritten.
          </p>
        </section>

        <section id="clears">
          <h2><span className={styles.idx}>04</span>The floor clears</h2>
          <p>
            Same router, same three pools, smaller size. <code>swapExactETHForTokens</code> of 0.006 MON. The path is still WMON, USDC, NADXBT, WMON. The three pools were solvent on the fork: token balance equaled reserve on both sides of each pair. The WMON/NADXBT pool still holds about 0.067 MON, so this size is most of the mispricing, and the next person to trade it takes it.
          </p>
          <p className={styles.tag}>Fork balance, live gas. Not broadcast</p>
          <p>
            The router’s return value is the quote, 0.060465831 MON. The WMON that arrives is less. On a fork of block 113,785,475 the recipient’s WMON balance rose by 0.060420185 MON. A live trace at block 113,787,261 shows the same transfer, 60,420,185,260,805,938 wei, to the published team owner <code className={styles.addr}>0xc0c4E411e41bECAD6DA860F67063C2D6363a6113</code>. That address was the <code>from</code> of a simulation. Nothing was signed.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>Size in</div><div className={styles.num}>0.006000000 MON</div></div>
            <div className={styles.row}><div>Router return</div><div className={styles.num}>0.060465831 MON</div></div>
            <div className={styles.row}><div>WMON received</div><div className={styles.num}>0.060420185 MON</div></div>
            <div className={styles.row}><div>Haircut</div><div className={styles.num}>0.000045646 MON</div></div>
            <div className={styles.row}><div>Gross</div><div className={styles.num}>0.054420185 MON</div></div>
          </div>
          <p>
            Setting <code>minOut</code> to the quote reverts with <code>DyorRouterV2: INSUFFICIENT_OUTPUT_AMOUNT</code>. Setting it to the received amount, 60,420,185,260,805,938 wei, is accepted. The return array is not the fill.
          </p>
          <p>
            Gas, from the live node, base fee 100 gwei. With no access list, <code>eth_estimateGas</code> at that <code>minOut</code> is 523,536. The bill is 0.052353600 MON. Net 0.002066585 MON. With <code>minOut</code> of 1 and no list, an <code>eth_call</code> succeeds at 519,452 gas and reverts at 519,451. There are 20,665 gas of room before the 523,536 bill meets the gain. A fat cushion spends it.
          </p>
          <p>
            The node’s access list is 12 entries. With that list, and <code>minOut</code> equal to the received amount, <code>eth_estimateGas</code> is 294,130. The bill is 0.029413000 MON. Net 0.025007185 MON. The same list on an Ethereum-schedule fork used 290,584 gas for a successful swap, against 518,184 with no list, so the cut shows up on both meters. One gas under 291,725 the live <code>eth_call</code> fails. At 291,725 it returns. There are 250,071 gas of room before the access-list bill meets the gain. The price can rise from 100 gwei to 185 gwei and the bill still sits under the gain. At 186 gwei it does not.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>No list, estimate</div><div className={styles.num}>523,536</div></div>
            <div className={styles.row}><div>Bill, no list</div><div className={styles.num}>0.052353600 MON</div></div>
            <div className={styles.row}><div>Net, no list</div><div className={styles.num}>+0.002066585 MON</div></div>
            <div className={styles.row}><div>With the list, estimate</div><div className={styles.num}>294,130</div></div>
            <div className={styles.row}><div>Bill, with the list</div><div className={styles.num}>0.029413000 MON</div></div>
            <div className={styles.row}><div>Net, with the list</div><div className={styles.num}>+0.025007185 MON</div></div>
            <div className={styles.row}><div>Fork gas, no list</div><div className={styles.num}>518,184</div></div>
            <div className={styles.row}><div>Fork gas, with the list</div><div className={styles.num}>290,584</div></div>
          </div>
          <p>
            The list is the router, WMON, USDC, NADXBT, the factory, the three pairs, the USDC delegatecall target <code className={styles.addr}>0xbd520ea8cbb4f81b62aff3c3ffe7affd69800b6d</code>, a 23,329-byte contract the router calls with empty calldata at <code className={styles.addr}>0xe18cec5cab64b54357fb1d9cb317ccabbaeae648</code>, and two accounts with no code, <code className={styles.addr}>0x30c4ee621d3c2e9b75528a11843797e1738d8e4b</code> and <code className={styles.addr}>0xdf25f88aa6cde9937fdcfcf10fa349528c79dbf9</code>. Anyone can rebuild it with <code>eth_createAccessList</code>.
          </p>
          <p>
            A revert still pays the whole limit. One failed attempt at that gas costs more than the net. The pool is thin. The next section is the receipt from the one send that used this simulation. The clip limit, the round, and the 5 MON reserve are unchanged.
          </p>
          <p>
            The same hour, v3 round trips of 1 MON were quoted and not settled. WETH came back +0.003455 through Uniswap fee 500 into Pancake fee 500. AUSD came back +0.008570 through Uniswap fee 100 into Pancake fee 500. USDC was −0.001325, USDT −0.002571, WBTC −0.144079. A two-leg v3 bill is about 0.028 MON before any list. Neither positive quote clears that, so they stay quotes. The skim book under 0.02 MON was not walked again. The earlier zero above 0.02 still stands.
          </p>
          <p className={styles.note}>
            Gross 0.054420185 MON. Signed limit 294,130. Bill 0.029413 MON. Net +0.025007185 MON at the 100 gwei floor. Not a receipt.
          </p>
        </section>

        <section id="fill">
          <h2><span className={styles.idx}>05</span>The fill</h2>
          <p className={styles.tag}>Mainnet receipt</p>
          <p>
            The same path was still there at block 113,790,995. A dry call from the rebalancer gas wallet <code className={styles.addr}>0xC2cF684A3931143FD877F02222085713842a090E</code> received 0.060420185 WMON, the access-list estimate was 294,057, and the net at 100 gwei was 0.025014485 MON. The eight v2 factories had the same pair counts as the blotter: 21,289, 13,062, 3,802, 1,037, 67, 30, 8, and 1. No new pair had appeared.
          </p>
          <p>
            The send used that wallet, not a vault. The balance before the swap was 97.358921519 MON. The script refused to sign unless the fresh net was above 0.005 MON and the balance after the spend would stay at or above 5 MON. <code>minOut</code> was the 0.006 MON input plus the gas bill. The tip was 0. The max fee was 100 gwei.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>Swap</div><div className={styles.addr}>0xeb3e75d70f43b979cd5f942eb9febbd06712ae9eab008030ef07caf972002b50</div></div>
            <div className={styles.row}><div>Block</div><div className={styles.num}>113,791,208</div></div>
            <div className={styles.row}><div>Status</div><div className={styles.num}>success</div></div>
            <div className={styles.row}><div>Value in</div><div className={styles.num}>0.006000000 MON</div></div>
            <div className={styles.row}><div>Gas limit, and gas used</div><div className={styles.num}>294,057</div></div>
            <div className={styles.row}><div>Swap bill</div><div className={styles.num}>0.029405700 MON</div></div>
            <div className={styles.row}><div>WMON received</div><div className={styles.num}>0.060420185 MON</div></div>
            <div className={styles.row}><div>Unwrap</div><div className={styles.addr}>0x40dbbe260991fcadc9b74bedde130aab2dc15d7409554cf6553bb4d109d3bc63</div></div>
            <div className={styles.row}><div>Unwrap block</div><div className={styles.num}>113,791,211</div></div>
            <div className={styles.row}><div>Unwrap gas</div><div className={styles.num}>42,391</div></div>
            <div className={styles.row}><div>Unwrap bill</div><div className={styles.num}>0.004239100 MON</div></div>
            <div className={styles.row}><div>Native balance after</div><div className={styles.num}>97.379696904 MON</div></div>
            <div className={styles.row}><div>Native delta</div><div className={styles.num}>+0.020775385 MON</div></div>
          </div>
          <p>
            The chain agrees. Both receipts are status success, both gas-used figures equal the limits, and the wallet balance read after the unwrap is 97.379696904 MON. The landed gain is smaller than the swap-only simulation because the unwrap paid 42,391 gas to turn the WMON back into MON.
          </p>
          <p>
            A second call of the same path at block 113,791,497 returned 0.003315408 MON on a 0.006 MON input. The access-list bill was still 0.029405700 MON. The net was −0.032090292 MON. The inventory in the 0.067 MON pool is gone. The same script now refuses to sign.
          </p>
          <p>
            The rest of the book, read in the same pass, did not clear. The four Kuru books that answered before still are not crossed: cbBTC/USDC bid over ask 0.99960, WETH/USDC 0.99955, the third USDC book 0.99940, MON/USDC 0.99822. The gMON market <code className={styles.addr}>0x1ca0f16a316c3ee0ff3cec5382caad5648ea512d</code> now answers <code>bestBidAsk</code> instead of reverting, at 0.99900, and it is not crossed. The shMON unstake fee is 0.680874% of the ray. That is still the fee, not a discount. The clip gas, the ten minute round, and the 5 MON reserve are unchanged.
          </p>
          <p className={styles.note}>
            Landed +0.020775385 MON. Swap 294,057 gas. Unwrap 42,391 gas. Wallet left at 97.379696904 MON.
          </p>
        </section>

        <section id="settled">
          <h2><span className={styles.idx}>06</span>Settled, and still short</h2>
          <p>These moved tokens on a fork, or they already have a mainnet receipt. The gain is real. The bill is larger.</p>

          <article className={styles.print}>
            <p className={styles.tag}>Settled on a fork</p>
            <h3>USDT0, Uniswap v2 into Pancake v3</h3>
            <p>Pair <code className={styles.addr}>0xa779C6664d90c6012242C19A02b585F89D2CB203</code>. Half a MON buys USDT0 and sells it back for 0.508121607 MON. Gross profit 0.008121607 MON. The fork test burned 633,255 gas. One v3 leg is already about 0.014 MON at the floor.</p>
            <p>The quote curve, same pair, before that settlement: 0.2 MON is +0.005331, 0.5 is +0.008122, 1 is +0.007936, 1.2 is +0.005598, 2 is −0.016523, 5 is −0.269662, 10 is −1.213634, 20 is −4.620006. The peak is the size we settled, and it still loses to one leg.</p>
            <p className={styles.verdict}>Gross 0.00812 MON · the curve peaks there and still loses</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Mainnet receipts</p>
            <h3>The live spread captures, and the clip search</h3>
            <p>A 0.6 MON capture left the pool 0.002263 MON richer and the signer paid 0.053004 MON in gas. A later 0.7 MON capture moved the pool from 0.7 to 0.703347 MON, gas used 519,673, fee 0.053007 MON. The pool gained MON. The wallet that signed paid the gas.</p>
            <p>The clip search, on a fork, found 0.000370 MON of quoted profit on 0.2 MON and used 396,776 gas, about 0.0397 MON at the floor. The clip limit stays 420,000 gas.</p>
            <p className={styles.verdict}>Pool up · signer down by about 0.05 MON</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Settled on a fork</p>
            <h3>Kuru into Pancake 0.05%, and the other way</h3>
            <p>Market <code className={styles.addr}>0x065C9d28E428A0db40191a54d33d5b7c71a9C394</code>, native MON against USDC. Selling MON into Kuru and buying WMON back on Pancake lost at every size we ran. At 1 MON the profit was −0.001221 MON. At 1,000 MON it was −1.251706 MON.</p>
            <p>The other direction, 10 MON through Pancake first, quoted 0.229364 USDC and came back 9.638763 MON. Three other legs of that test reverted. A book that is 20 basis points wide does not pay a round trip.</p>
            <p className={styles.verdict}>Every size from 1 MON to 1,000 MON finished short</p>
          </article>
        </section>

        <section id="shares">
          <h2><span className={styles.idx}>07</span>Share tokens</h2>
          <p>A discount to net asset value is a print only when the share can be turned back into MON in the same transaction. These could not.</p>

          <article className={styles.print}>
            <p className={styles.tag}>Quote, then a fork</p>
            <h3>aprMON</h3>
            <p>Pancake 0.01% pool <code className={styles.addr}>0x40C4fd3390956FbE99A70B4C5C80EFD9c22c9aC6</code>, token <code className={styles.addr}>0x0c65A0BC65a5D819235B71F554D210D3F80E0852</code>. <code>previewRedeem</code> after a buy on that pool peaks at 0.025978 MON on 30 MON. At 20 MON the quote is 0.022564. At 40 MON it is already 0.024153 and falling. Uniswap 0.01% and Pancake 0.05% reverted on the quote.</p>
            <p>On a fork of block 113,747,559 the swap leg used 258,728 gas and <code>requestRedeem</code> used 280,367 gas. The request credited 0.026189 MON of assets above the MON that went in, <code>claimable</code> was 0, and <code>unlockEpoch</code> was 0. Instant <code>redeem</code> reverted inside the implementation. <code>maxRedeem</code> of a fresh vault was 0. The discount sits in a staking epoch. It is not MON.</p>
            <p className={styles.verdict}>Quote 0.025978 MON · claimable 0</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Settled on a quote of the fee</p>
            <h3>shMON</h3>
            <p><code>getCurrentUnstakeFeeRateRay</code> on <code className={styles.addr}>0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c</code> returned 6.80038386749145018e24, which is 0.680038%. The 0.01% Uniswap pool priced shMON at 1.636666 WMON against a net asset value of 1.637076, a discount of 2.504 basis points.</p>
            <p>Buying the share and redeeming it loses the fee. At 1 MON the loss is 0.006759 MON. At 5 MON, 0.033796. At 20 MON, 0.135188. At 50 MON, 0.337998. At 100 MON, 0.676090. The fee is about 27 times the discount.</p>
            <p className={styles.verdict}>Fee 0.680% · pool discount 0.025%</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>Mint the share, then sell it</h3>
            <p>Per 1 MON deposited and sold straight back: sMON came back short by 0.000422 MON, gMON by 0.001449, shMON by 0.000253, aprMON by 0.001878. At 10 MON the same four were short by 0.006423, 0.014491, 0.002529, and 0.021131. gMON <code>previewRedeem</code> reverted from 15 MON up. The Curve LST pool <code className={styles.addr}>0x74d80ee400d3026fdd2520265cc98300710b25d4</code>, coins WMON, shMON, sMON, and gMON, was sold into the same v3 pools from 1 MON to 100 MON. Every one of those came back under the size that went in.</p>
            <p className={styles.verdict}>Mint and sell is short on all four shares</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Read, then no pool</p>
            <h3>The other wrappers</h3>
            <p>sLVMON <code className={styles.addr}>0x61b29EfEf2E6f866bA4AaeFDb87d2837C6a22b9c</code> answered the vault: about 0.29455 shares per asset, and 3.39380 assets per share. It had no Uniswap or Pancake v3 pool to sell into. LVMON itself is not an ERC-4626. The asset and redeem calls revert.</p>
            <p>No v3 pool at all: strUSD, sUSDe, sfrxUSD, sAUSD, syrupUSDC, wsrUSD. earnMON’s rate selectors reverted. wstETH had Uniswap 0.01%, 0.05%, and 0.30% pools and a Pancake 0.01% pool, and the quoter returned nothing at 0.01, 0.05, and 0.2. earnAUSD had a Pancake 0.01% pool and no quote at 100 or 1,000. A wrapper with no exit is not a round trip.</p>
            <p className={styles.verdict}>The rate was readable · the exit was not</p>
          </article>
        </section>

        <section id="books">
          <h2><span className={styles.idx}>08</span>Pools and books that were actually there</h2>
          <p>These quotes executed against contracts that hold the tokens. The edge, where there was one, was smaller than the fee or smaller than the gas.</p>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>The small v3 crosses</h3>
            <p>The best USDC round trip was +0.001814 MON at 0.2 MON, Uniswap 0.01% into Pancake 0.05%. The best WETH/WMON edge was +0.002941 MON at 1 MON, Uniswap 0.05% into Pancake 0.05%. The best sMON quote was +0.000179 MON at 0.05 MON. The best gMON quote was +0.000035 MON at 0.1 MON. A two-hop of ordinary tokens wants about 0.025 MON before a signature is worth considering. These are a tenth of that, or less.</p>
            <p className={styles.verdict}>Real, and under the bill</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>WMON/USDC on v2 against v3</h3>
            <p>Best of the size grid, all at 0.5 MON. Pancake v2, 16.01 MON and 0.37 USDC in the pool, −0.014900. DYORSwap, 1,500.13 MON and 34.66 USDC, −0.000613. OctoSwap, 1,894.11 MON and 43.62 USDC, −0.001154. zkSwap, 21.00 MON and 0.48 USDC, −0.010488. The deep pools sit on the v3 price. The thin ones are worse.</p>
            <p className={styles.verdict}>Selling across and buying back loses the fee</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>Uniswap v4 against Pancake 0.05%</h3>
            <p>Quoter <code className={styles.addr}>0xa222dd357a9076d1091ed6aa2e16c9742dd26891</code>. Native MON, USDC, fee 500, tick spacing 10, hooks unset. Selling MON on v4 and buying it back on Pancake: 1 MON is −0.000846, 5 is −0.004142, 10 is −0.006630, 50 is −0.029422, 100 is −0.101551, 300 is −0.308693. The other direction at 10 MON is −0.009959, and it stays negative out to 300 MON. The quoter reports about 49,500 to 49,800 gas inside the swap. That figure is not a transaction.</p>
            <p>An index had shown v4 MON/USDC rich to a v3 pool, WBTC/USDC about 2% wide to a thin Pancake pool, and cbBTC/USDC about 2% wide the other way. The quoters closed those gaps. Curve cbBTC/WBTC/LBTC <code className={styles.addr}>0xd2634e05ebed90bd0a6c0e93d48d7bd8036653b1</code> holds 7.235 cbBTC, 11.358 WBTC, and 23.732 LBTC. A round trip of 0.01 coin against the v4 0.01% pool loses a few millionths. At 1 coin the loss is 0.000814 cbBTC one way and 0.000928 WBTC the other. USDT/USDC had no matching v4 pool.</p>
            <p className={styles.verdict}>The index was wide · the quote paid the fee</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>Curve stables</h3>
            <p>USDC out through Curve into USDT and back through v3, at 10 units, lost 0.0015. The reverse lost 0.0017. At 1,000 the reverse lost 0.2597. USDC through AUSD and back lost 0.0031 at 10. The AUSD pool on the index was a tenth of a basis point from one, with a couple of million units in it. A one-cent discrepancy in a pool that deep would have cleared the gas. The book was inside the fee.</p>
            <p className={styles.verdict}>Deep, and inside the fee</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>In-range upper bound</p>
            <h3>Pinot</h3>
            <p>Pool <code className={styles.addr}>0x998b563b214f158fce042ca82a8d441343f507d6</code>, fee tier 10,000, spot 0.023190 USDC per MON, liquidity 360,880,466,579,480. The bound ignores impact on the way back, so it is a ceiling, not a settlement. At 0.5 MON the ceiling is +0.0011. At 2 MON it is +0.0033. At 5 MON it is +0.0019. At 10 MON it is −0.0169. At 50 MON it is −0.9014. The 1% fee eats the gap before gas is added.</p>
            <p className={styles.verdict}>Ceiling +0.0033 MON · still under a swap</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>Kuru, the four books that answered</h3>
            <p>One hundred markets were asked <code>bestBidAsk</code>. Four returned a price. None was crossed. Bid over ask, fee 0:</p>
            <div className={styles.grid2}>
              <div className={styles.row}><div>cbBTC / USDC</div><div className={styles.num}>0.99960</div></div>
              <div className={styles.row}><div>WETH / USDC</div><div className={styles.num}>0.99941</div></div>
              <div className={styles.row}><div><code className={styles.addr}>0x8511…f07</code> / USDC</div><div className={styles.num}>0.99940</div></div>
              <div className={styles.row}><div>MON / USDC</div><div className={styles.num}>0.99796</div></div>
            </div>
            <p>That is about 4 to 20 basis points of width. The gMON market <code className={styles.addr}>0x1ca0f16a316c3ee0ff3cec5382caad5648ea512d</code> reverted <code>MarketStateError</code> on buys at 1, 50, 250, and 400 MON. Shares received were 0.</p>
            <p className={styles.verdict}>Four quotes · zero crossed · one market reverted</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>LFJ and Atlantis</h3>
            <p>LFJ pair <code className={styles.addr}>0xf4443d36ecb9f3ef06eae9b26706aaf591ade5ce</code>. Reserves about 42,225 MON and 1,281 USDC. <code>getSwapOut</code> for 1 WMON returns 0.022815 USDC, at or under the v3 market near 0.0229. Selling USDC the other way does not open a gap a second venue would pay.</p>
            <p>Atlantis USDC/WETH <code className={styles.addr}>0x32681b2afbeb1a0ad7545cb2cd72236fe5d7919f</code> is Algebra. On-chain, one USDC is about 0.00040966 WETH. The v4 quote of the same pair sat on that price. An index gap of a couple of percent did not survive the call.</p>
            <p className={styles.verdict}>The on-chain price matched the deep book</p>
          </article>
        </section>

        <section id="fiction">
          <h2><span className={styles.idx}>09</span>Numbers that were not inventory</h2>
          <p>These are in the tape because they looked like the largest numbers on the desk. The chain did not hold the tokens the index was pricing.</p>

          <article className={styles.print}>
            <p className={styles.tag}>Index mid</p>
            <h3>TREV, priced by its own pool</h3>
            <p>Pair <code className={styles.addr}>0xa8533078ccba30c1ab69618d50260bc4f83b80cb</code>. An index called it about 1.92 million dollars. The pair holds 4.494613 USDC and 20.42 million TREV, and the token balances match those reserves. Supply is 1,000,000,000. The dollar figure is the pool pricing its own token. The indexed v4 TREV pools were a few dollars of liquidity. There is no second book.</p>
            <p className={styles.verdict}>4.494613 USDC in the pair</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote, then the balance filter</p>
            <h3>Madness</h3>
            <p>Before the balance filter, Madness quoted four WMON cycles above 0.005 MON. The largest was +3.259 MON on a 5.12 MON size through USDC and WETH. The companions were +0.679 MON on gMON, +0.645 MON on sMON, and +0.482 MON on shMON. After the filter, eight of the thirty pairs were insolvent: the token balance did not cover the reserve. The remaining 22 pairs produced zero hits and zero skims.</p>
            <p className={styles.verdict}>The quote was larger than the inventory</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>Mock Cake and Mock USDT</h3>
            <p>The only Pancake v2 hit. Size 0.02 MON, quoted profit 0.018972 MON, through Mock Cake <code className={styles.addr}>0xcf05fc31a6b693dd0beb76e958ae4bcd490dc985</code> and Mock USDT <code className={styles.addr}>0xf05266b1b1759d3a2746cd3b031b802c2496b278</code>. It was not fork-settled. A three-hop of ordinary gas is already more than 0.019 MON, and the tokens are mocks.</p>
            <p className={styles.verdict}>0.01897 MON quoted · under a three-hop bill</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Quote</p>
            <h3>strUSD at a premium</h3>
            <p>Curve pool <code className={styles.addr}>0xee7a6849982026ded35c2aa510319afe5a0801a8</code>. One thousand strUSD quotes 1,031.093 trUSD. One hundred thousand quotes 102,915.75. The reverse, one thousand trUSD, quotes 969.618 strUSD. The pool holds about 292,638 strUSD and 304,912 trUSD. strUSD’s name is Staked trUSD. <code>asset</code>, <code>previewDeposit</code>, and <code>previewRedeem</code> reverted. The token is a role-gated minter, and this pass found no atomic deposit against the premium. trUSD against AUSD on the other Curve pool was indexed at 0.999911.</p>
            <p className={styles.verdict}>The premium is the market · the mint is not open</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Read</p>
            <h3>Morpho Blue</h3>
            <p>Morpho <code className={styles.addr}>0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee</code> was read for positions under health 1. The ones with a dollar value were cents of wsrUSD. wsrUSD had no Uniswap or Pancake v3 pool against AUSD, USDC, or WMON, so the collateral could not be sold in the same transaction. Test-token positions were left alone. Dust with no exit is not a liquidation.</p>
            <p className={styles.verdict}>Underwater, and unsellable in one transaction</p>
          </article>

          <article className={styles.print}>
            <p className={styles.tag}>Index mid</p>
            <h3>What the index showed, and what we left as a mid</h3>
            <p>Across WMON/USDC the index ran from 0.022827 to 0.023630, about 352 basis points, over Uniswap v3, Pancake v3, Balancer v3, Capricorn, Monday Trade, Atlantis, LFJ, Bean, and Uniswap v2. The executable quotes above are what that range became once a quoter was called. GHO/USDC on a v4 index sat near 0.9546 with a large reserve figure, and this pass did not complete an on-chain quote, so it stays an index mid. SomeSwap returned no pools. Bean did not answer <code>factory()</code>. Aethonswap had a WBTC/WMON pool. None of those became a settlement.</p>
            <p className={styles.verdict}>A mid is a mid until a call moves tokens</p>
          </article>
        </section>

        <section id="uncapped">
          <h2><span className={styles.idx}>13</span>No size cap</h2>
          <p>
            The earlier hit line was 0.005 MON and the earlier skim line was 0.02. This pass drops both. A constant-product cycle is kept when the optimal size, anywhere inside the reserve, quotes a profit above zero. A skim is a same-block balance above the reserve, of any size. The eight factories still had the same lengths: 21,289, 13,062, 3,802, 1,037, 67, 30, 8, and 1, read at block 113,795,144. Three more v2 books answered <code>allPairsLength</code>: LFJ v1 16, Purps 11, SomeSwap 46. The constant-product graph held 35,083 pairs with both reserves above zero. It examined 6,209 cycles and found 138 quotes above zero.
          </p>
          <p>
            The largest quote was 0.139697384 MON on 2.542 MON of shMON, Madness into Purps. The Madness pair <code className={styles.addr}>0xCd7A88b15CE3D693F4883BF58490125e32CB3416</code> reported a reserve and a token balance of zero. That quote has no inventory. The Nad router <code className={styles.addr}>0x8986c8fd44eb85294a725a7e61af35e76ba26f91</code> reverted <code>getAmountsOut</code> on the CHOG and NPC cycles, so those stay on the constant-product screen. The mock Cake cycle is the same one already on the blotter, about 0.018972 MON, still under a three-hop bill.
          </p>
          <p className={styles.tag}>Mainnet receipt</p>
          <p>
            UNCLE, <code className={styles.addr}>0x483A6a93c352c9666dFE84693E5B957d555D7777</code>, was solvent on both sides. Pancake v2 pair <code className={styles.addr}>0x90934790DCB95A51156405348ddcdFf5A438A214</code>. Purps pair <code className={styles.addr}>0xb0923F9D83EAAC35f5C8A2753ba6f13994f05276</code>. The optimal size was 0.081016337 MON. Both routers returned 0.126985578 WMON. Gross 0.045969241 MON. A fork of the two swaps moved that amount. One creation does both swaps and unwraps, and it returns no runtime code. At block 113,798,387 the access list had 8 entries, <code>eth_estimateGas</code> was 318,301, the bill at 100 gwei was 0.031830100 MON, and the net was 0.014139141 MON.
          </p>
          <p>
            The send used the rebalancer gas wallet again. The balance before it was 97.161076832 MON. <code>minOut</code> on the second swap was the input plus the gas bill. The tip was 0. The max fee was 100 gwei. The script signed because the fresh net was above 0.005 MON and the balance after the spend stayed above 5 MON.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>Creation</div><div className={styles.addr}>0xca88170e3f920d5e3a9d32e2737254788c2a0cf3b60720953d6c79a41faac218</div></div>
            <div className={styles.row}><div>Block</div><div className={styles.num}>113,798,632</div></div>
            <div className={styles.row}><div>Status</div><div className={styles.num}>success</div></div>
            <div className={styles.row}><div>Value in</div><div className={styles.num}>0.081016337 MON</div></div>
            <div className={styles.row}><div>Gas limit, and gas used</div><div className={styles.num}>318,301</div></div>
            <div className={styles.row}><div>Bill</div><div className={styles.num}>0.031830100 MON</div></div>
            <div className={styles.row}><div>MON returned</div><div className={styles.num}>0.126985578 MON</div></div>
            <div className={styles.row}><div>Runtime code</div><div className={styles.num}>0 bytes</div></div>
            <div className={styles.row}><div>Native balance after</div><div className={styles.num}>97.175215973 MON</div></div>
            <div className={styles.row}><div>Native delta</div><div className={styles.num}>+0.014139141 MON</div></div>
          </div>
          <p>
            The receipt is status success. Gas used equals the limit. The created address <code className={styles.addr}>0x274ebd04e252c14d9cbc23e3ef1538b4b0d0ea46</code> has no code. The wallet balance read after the transaction is 97.175215973 MON.
          </p>
          <p>
            The same size after that block buys 851.966591326 UNCLE and sells it for 0.059445328 MON. That is 0.021571009 MON under the input, before gas. The script refuses to sign.
          </p>
          <h3>The skim, read in one block</h3>
          <p>
            39,369 pairs, reserves and balances taken at block 113,796,243. Zero pairs held extra WMON or extra USDC. A split read a few blocks earlier had shown 206.743794619 WMON on Nad pair <code className={styles.addr}>0x97199B34564911936bC850aC45eDe785892B5AAD</code>, plus USDC gaps of 5.576478, 3.071158, 0.680964, and 0.348831. The same pairs, read together, had balance equal to reserve. <code>skim</code> transferred 0. The gap was the pool moving between two calls. It was not inventory.
          </p>
          <h3>The deep books, any size the quoter still answered</h3>
          <p>
            Eight QuoterV2 contracts, fees 100, 500, 2,500, 3,000, and 10,000, sizes from 0.05 MON through 50,000 MON where the quote still returned. 46 legs were live. The best round trip was WMON/AUSD at 0.5 MON, Uniswap fee 100 into Pancake fee 2,500, +0.018544795 MON. WMON/USDC at 50 MON, Pancake fee 500 into fee 2,500, was +0.005433631 MON. WMON/WETH at 0.5 MON was +0.003275493 MON. WMON/USDT at 0.05 MON was +0.001455614 MON. USDC/USDT and USDC/AUSD were negative at 0.05. A two-leg v3 bill is about 0.028 MON. None of those quotes clears it.
          </p>
          <p>
            Uniswap v4, 1 MON into USDC, fee 500, tick spacing 10, returned 0.022973 USDC. GHO/USDC, fee 100, tick spacing 1, returned 0.998899 USDC for 1 GHO. The index mid near 0.9546 does not survive that call. No v3 leg answered for GHO or for cbBTC. Curve’s factory listed 34 pools. Every completed round trip, from a thousandth of the balance up to half of it, came back under the amount that went in. Kuru bid over ask: cbBTC/USDC 0.99960, WETH/USDC 0.99945, the third USDC book 0.99940, MON/USDC 0.99809, gMON 0.99900. None crossed. The NADXBT path returned 0.003302582 MON on 0.006 MON. The shMON unstake fee was 0.680782% of the ray.
          </p>
          <p>
            LFJ’s LB factory holds 78 pairs and Bean’s holds 80. The LB quoter for 1 WMON returned 0.022906 USDC, in line with the v4 price. Joe v1’s 16 pairs are inside the constant-product count above. The clip gas, the ten minute round, and the 5 MON reserve are unchanged.
          </p>
          <p className={styles.note}>
            Landed +0.014139141 MON. Creation gas 318,301. Wallet left at 97.175215973 MON. The same size now comes back 0.059445328 MON.
          </p>
        </section>

        <section id="thousand">
          <h2><span className={styles.idx}>14</span>A thousand MON</h2>
          <p>
            This pass keeps a trade that spends 100, 1,000, or 10,000 MON when the settled gain after the gas limit is above zero, including a gain that is only a fraction of a MON. Factory lengths were read at block 113,822,808 and had not moved: Uniswap v2 21,289, Pancake v2 13,062, Nadswap 3,802, DYORSwap 1,037, OctoSwap 67, Madness 30, zkSwap 8, Swyrl 1, LFJ v1 16, Purps 11, SomeSwap 46. Kansei’s v2 factory had 2 pairs. Curve’s twocrypto factory had 13 pools and its tricrypto factory had 0. Bean’s LB factory still had 80 pairs. LFJ’s LB factory still had 78.
          </p>
          <p>
            The router grid, at block 113,823,585, asked ten v2 routers for round trips at 100 and 1,000 MON, and at 23, 230, and 1,000 units of the 6-decimal stables. 172 first legs returned an amount. Zero came back above the input. Curve’s 13 twocrypto pools were round-tripped from a thousandth of the balance up to half of it. Every completed trip was negative. Eight QuoterV2 contracts were asked for WMON round trips and three-hop paths through USDC, USDT, AUSD, and WETH. 1,164 two-leg trips and 411 triangles came back. Zero were positive. The least bad two-leg print was −0.020381 MON at 100 MON of shMON, Uniswap fee 100 both ways. At 1,000 MON the least bad was −0.238771 MON, same pair. The least bad triangle was −0.095601 MON at 100 MON, WMON to AUSD to USDC to WMON.
          </p>
          <p>
            Uniswap v4, fee 500, tick spacing 10, returned 2.332681 USDC for 100 MON, 23.326564 USDC for 1,000 MON, and 233.240849 USDC for 10,000 MON. That is the deep book, not a gap. Atlantis, Aethon, and zkSwap returned no WMON to USDC quote at 1,000 MON on fees 100, 500, 2,500, 3,000, and 10,000. iZiSwap has WMON/USDC pools at fees 500, 3,000, and 10,000. <code>swapX2Y</code> reverted with <code>PR</code>. WooFi quoted 23.271756 USDC for 1,000 WMON, and 983.791127 WMON for 23 USDC.
          </p>
          <p>
            A 1,000 MON deposit quotes 904.185759 gMON, 911.123491 aprMON, and 610.773751 shMON. Selling those shares back to WMON on OctoSwap returned 31.950095, 30.087284, and 26.090124 MON. The shMON unstake ray on this pass was 6,742,276,241,333,382,050,000,000, which is 0.674228%. Earlier prints near 0.680% stay where they were written.
          </p>
          <h3>The one net above zero</h3>
          <p>
            Bean pair <code className={styles.addr}>0xa292bbDaCF094C9E224628708e23f66Ac103Ff7c</code> buys shramp, <code className={styles.addr}>0x42a4aA89864A794dE135B23C6a8D2E05513d7777</code>, and Uniswap v2 sells it. The pair and the Uniswap pool both hold the tokens. Size 0.000123236 MON. A fork of the two swaps and a Monad trace both returned 0.054652568 MON. Gross 0.054529332 MON. The access list had the node’s entries. <code>eth_estimateGas</code> was 537,447. The same call fails at 537,446. At 100 gwei the bill is 0.053744700 MON and the net is +0.000784632 MON. There is no spare gas under that limit. A revert would bill 0.053744700 MON. It was not sent.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>Size</div><div className={styles.num}>0.000123236 MON</div></div>
            <div className={styles.row}><div>Returned</div><div className={styles.num}>0.054652568 MON</div></div>
            <div className={styles.row}><div>Gross</div><div className={styles.num}>0.054529332 MON</div></div>
            <div className={styles.row}><div>Gas floor</div><div className={styles.num}>537,447</div></div>
            <div className={styles.row}><div>Bill</div><div className={styles.num}>0.053744700 MON</div></div>
            <div className={styles.row}><div>Net</div><div className={styles.num}>+0.000784632 MON</div></div>
            <div className={styles.row}><div>One gas lower</div><div className={styles.num}>reverts</div></div>
            <div className={styles.row}><div>Sent</div><div className={styles.num}>no</div></div>
          </div>
          <p>
            The larger shramp book, Bean pair <code className={styles.addr}>0x46D9179949539ac00B0972BfEdc4f7aC4e5B19C9</code>, quotes a bigger gross and loses it to gas. Size 0.390716529 MON. Gross 0.135644023 MON. Monad estimate 2,157,718 gas, bill 0.215771800 MON, net −0.080127777 MON. The emo book quoted +0.022934995 MON and the creation estimate was 6,616,287 gas, a bill of 0.661628700 MON. The wallet was left at 96.985938010 MON. The clip gas, the ten minute round, and the 5 MON reserve are unchanged.
          </p>
          <p className={styles.note}>
            No send. The only Monad net above zero was +0.000784632 MON, and 537,446 gas reverts.
          </p>
        </section>

        <section id="shapes">
          <h2><span className={styles.idx}>15</span>The same shapes</h2>
          <p>
            The two fills were small. NADXBT was 0.006 MON on one DYORSwap router, WMON to USDC to NADXBT to WMON. UNCLE was 0.081016337 MON, PancakeSwap v2 into Purps, in one creation. Both were signed by the rebalancer <code className={styles.addr}>0xC2cF684A3931143FD877F02222085713842a090E</code>. This pass priced those two paths again, then every WMON and USDC pair on nine v2 routers, and kept a route only when a fresh Monad simulation still cleared 0.005 MON after the gas limit, with 15,000 gas to spare, a limit of at most 800,000, and a size of at most 2 MON.
          </p>
          <p>
            At block 113,877,222 the rebalancer held 96.456732959 MON. The NADXBT path at the fill size returned 0.003340795 MON. The UNCLE path returned 0.059445328 MON. A grid from 0.001 MON to 2 MON, read at block 113,877,436, was negative on every size. The least bad NADXBT print was −0.000083576 MON at 0.001 MON. The least bad UNCLE print was −0.000005407 MON at 0.001 MON.
          </p>
          <p>
            Factory lengths were unchanged: Uniswap v2 21,289, PancakeSwap v2 13,062, DYORSwap 1,037, Purps 11, SomeSwap 46, LFJ v1 16, OctoSwap 67, zkSwap 8, Kansei 2. The index kept 35,401 pairs that hold WMON or USDC, and 34,355 of those legs touch WMON. Constant-product search kept the top 20 cross-router hops and found 5 same-router triangles above zero before gas.
          </p>
          <h3>The closest hop</h3>
          <p>
            AFF, <code className={styles.addr}>0xF6Aad8897eA650788e5033Cda6Bf99D5a144238c</code>, bought on PancakeSwap v2 and sold on Uniswap v2. Size 0.2 MON. At block 113,878,240 the router and the creation trace both returned 0.226527576 MON. Gross 0.026527576 MON. The access list had 7 entries. <code>eth_estimateGas</code> was 320,764. At 100 gwei the bill is 0.032076400 MON and the net is −0.005548824 MON. A later call at block 113,878,764, same estimate, succeeds at 319,304 gas and fails at 319,303. That is 1,460 gas of room under the limit. The gate wants 15,000. It was not sent.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>Size</div><div className={styles.num}>0.200000000 MON</div></div>
            <div className={styles.row}><div>Returned</div><div className={styles.num}>0.226527576 MON</div></div>
            <div className={styles.row}><div>Gross</div><div className={styles.num}>0.026527576 MON</div></div>
            <div className={styles.row}><div>Gas estimate</div><div className={styles.num}>320,764</div></div>
            <div className={styles.row}><div>Bill</div><div className={styles.num}>0.032076400 MON</div></div>
            <div className={styles.row}><div>Net</div><div className={styles.num}>−0.005548824 MON</div></div>
            <div className={styles.row}><div>Succeeds at</div><div className={styles.num}>319,304</div></div>
            <div className={styles.row}><div>Sent</div><div className={styles.num}>no</div></div>
          </div>
          <p>
            The next router quotes, at block 113,878,764, were smaller. CHOG on OctoSwap into Uniswap v2, 0.5 MON, gross +0.011681677 MON. BTCBR on DYORSwap into Uniswap v2, 0.1 MON, gross +0.010054049 MON. A Uniswap v2 DUST triangle, 0.02 MON, gross +0.001255914 MON. SomeSwap’s router reverted on the CHOG hop, and LFJ’s router reverted on a 2 MON USDC hop into SomeSwap. Those grosses sit under the 0.029 MON bill of the NADXBT swap. They were not estimated and they were not sent.
          </p>
          <h3>What keeps looking</h3>
          <p>
            <code>runner/rebalancer-seek.mjs</code> reads the same nine routers, refreshes the hot pairs, and signs with the rebalancer key only when a fresh simulation still clears the gates above. The balance has to stay at or above 5 MON. If the showcase round already has a rebalancer transaction pending, the tick waits. A revert ends the process. The schedule is minute 15 of each hour. After the index, the job checks about every 4 seconds for 35 minutes, and it skips a path it has already priced until the reserves move. One trade locks at most 2 MON plus about 0.08 MON of gas, and that MON comes back in the same transaction.
          </p>
          <p>
            The rebalancer already holds 96.456732959 MON. No top-up is required for that loop. A 50 MON top-up, taking the wallet toward 150 MON, is a buffer for showcase gas and for one reverted limit. The buffer was not sent.
          </p>
          <p className={styles.note}>
            No send. NADXBT at 0.006 MON came back 0.003340795. UNCLE at 0.081016337 MON came back 0.059445328. The closest new hop netted −0.005548824 MON.
          </p>
        </section>

        <section id="rule">
          <h2><span className={styles.idx}>10</span>The rule the desk keeps</h2>
          <p>
            Profit has to exceed <code>gas_limit × price</code>, and the limit has to be high enough that the call succeeds. The 0.006 MON cycle did that once. The receipt is +0.020775385 MON after the swap limit and the unwrap. The same call after that receipt loses 0.032090292 MON. The 0.081016337 MON UNCLE cycle did it once. The receipt is +0.014139141 MON. The same size after that receipt comes back 0.059445328 MON. The solvent Uniswap v2 book was 20,911 pairs and zero hits. Pancake v2 was 13,057 solvent pairs and one mock-token cycle. A same-block read of 39,369 pairs found no extra WMON and no extra USDC above the reserve. The thousand-MON pass had one Monad net above zero, +0.000784632 MON, and that call reverts one gas below the limit. It was not sent. The same-shape pass priced both fill sizes from 0.001 MON to 2 MON and priced the best new hop, AFF at 0.2 MON. The net was −0.005548824 MON, with 1,460 gas of room. It was not sent.
          </p>
          <p>
            A quote is not a send. The signer sends when the settled gain is larger than the limit the wallet will put on the transaction, checked with <code>eth_call</code> first, because a revert bills that limit in full. The clip gas limit stays 420,000. The rough gas figure on the spread desk stays a half million gas at 100 gwei. The signing wallet keeps 5 MON. Rounds stay ten minutes apart, and a round sends at most 20 clips.
          </p>
          <p>
            Nothing in this tape lowers those numbers so a button can light up. The policy firewall, the owner pause, and the <code>createVault</code> preflight stay where they are. There is no promised rate.
          </p>
        </section>

        <section id="book">
          <h2><span className={styles.idx}>11</span>The open book</h2>
          <p>Anyone can re-read these calls. The chain is the record.</p>
          <ul className={styles.sources}>
            <li>Chain 143. <code>https://rpc.monad.xyz</code>, <code>https://rpc-mainnet.monadinfra.com</code>, and <code>https://rpc.ankr.com/monad_mainnet</code>. Base fee 100 gwei at block 113,745,594. aprMON fork block 113,747,559. The NADXBT fork was public Ankr state in this same pass.</li>
            <li>Factories: Uniswap v2 <code className={styles.addr}>0x182a927119d56008d921126764bf884221b10f59</code>, Pancake v2 <code className={styles.addr}>0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e</code>, Nadswap <code className={styles.addr}>0xa25b13127e63ddae6d0b35570ff3d39dbd621001</code>, DYORSwap <code className={styles.addr}>0xE78B9c8F3e9f46CEDC204309E9F387f736d0d278</code>, OctoSwap <code className={styles.addr}>0xce104732685b9d7b2f07a09d828f6b19786cda32</code>, Madness <code className={styles.addr}>0x93d71152a93619c0b10a2efc856ac46120fd01ab</code>, zkSwap <code className={styles.addr}>0x0ff16867bcac3c5fdc2dc73558e3f8e2ed89eea2</code>, Swyrl <code className={styles.addr}>0xd158cdfec90e9429a290c3144afeb72e8c23603a</code>.</li>
            <li>WMON <code className={styles.addr}>0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A</code>. USDC <code className={styles.addr}>0x754704Bc059F8C67012fEd69BC8A327a5aafb603</code>. USDT0 <code className={styles.addr}>0xe7cd86e13AC4309349F30B3435a9d337750fC82D</code>. NADXBT <code className={styles.addr}>0x7289A594e116DC99af16ff0db0529A803b68Bfa5</code>.</li>
            <li>DYOR pairs: WMON/USDC <code className={styles.addr}>0xBE8345287c5bA716941f50A80020911AC2e07c68</code>, USDC/NADXBT <code className={styles.addr}>0x7789D1E9DC0ddA50DF30e66b9DFf53D862393b1E</code>, WMON/NADXBT <code className={styles.addr}>0xFdcB57E198D123545A9E71FDd0DEA424E13B2720</code>. Router <code className={styles.addr}>0x26CEb692410c4b3C12D63e01CFc03eEA103fc474</code>. The clearing simulation is a fork of block 113,785,475 and a live estimate at block 113,787,261. Rebuild the list with <code>eth_createAccessList</code>.</li>
            <li>Kuru books that answered: <code className={styles.addr}>0x40c49f171202f91ff5d2fae34c22dd2bfdd22af0</code>, <code className={styles.addr}>0xa6afd386135b7d41a6c40c525abc4a1019b0d132</code>, <code className={styles.addr}>0x851145eaefdc37956b08da829fa31722199f3f07</code>, <code className={styles.addr}>0x065c9d28e428a0db40191a54d33d5b7c71a9c394</code>.</li>
            <li>The fill, from the rebalancer gas wallet <code className={styles.addr}>0xC2cF684A3931143FD877F02222085713842a090E</code>: swap <code className={styles.addr}>0xeb3e75d70f43b979cd5f942eb9febbd06712ae9eab008030ef07caf972002b50</code> in block 113,791,208, unwrap <code className={styles.addr}>0x40dbbe260991fcadc9b74bedde130aab2dc15d7409554cf6553bb4d109d3bc63</code> in block 113,791,211.</li>
            <li>The uncapped fill, same wallet: creation <code className={styles.addr}>0xca88170e3f920d5e3a9d32e2737254788c2a0cf3b60720953d6c79a41faac218</code> in block 113,798,632. UNCLE <code className={styles.addr}>0x483A6a93c352c9666dFE84693E5B957d555D7777</code>. Pancake router <code className={styles.addr}>0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9</code>. Purps router <code className={styles.addr}>0x22aDf91b491abc7a50895Cd5c5c194EcCC93f5E2</code>.</li>
            <li>The thousand-MON pass, quoted at block 113,823,585. Bean shramp pair <code className={styles.addr}>0xa292bbDaCF094C9E224628708e23f66Ac103Ff7c</code>. shramp <code className={styles.addr}>0x42a4aA89864A794dE135B23C6a8D2E05513d7777</code>. Uniswap v2 pair <code className={styles.addr}>0x451766F50b7eAf76F976cd3e779C64DbA8b8aA3D</code>. The larger book is <code className={styles.addr}>0x46D9179949539ac00B0972BfEdc4f7aC4e5B19C9</code>. Curve twocrypto factory <code className={styles.addr}>0xe7fbd704b938cb8fe26313c3464d4b7b7348c88c</code>. Not sent.</li>
            <li>The same-shape pass. Balance at block 113,877,222. Size grid at block 113,877,436. AFF creation estimate at block 113,878,240, gas floor at block 113,878,764. AFF <code className={styles.addr}>0xF6Aad8897eA650788e5033Cda6Bf99D5a144238c</code>. Rebalancer <code className={styles.addr}>0xC2cF684A3931143FD877F02222085713842a090E</code>. Not sent.</li>
            <li>Spread receipts on mainnet: <code className={styles.addr}>0xedc5a196e891690fb9681b20eb03a621173c43df8b1747e4259e4d736853fba5</code> and <code className={styles.addr}>0x0b75431aed1b0f4c1d918dc229ff6307af093ca6ca076bcfaece783c32ff4e9a</code>.</li>
          </ul>
        </section>

        <section id="glossary">
          <h2><span className={styles.idx}>12</span>Keywords, linked</h2>
          <p>Each name in the tape points at a document or a contract. The line under it is the sense used in these prints.</p>
          <div className={styles.glossary}>
            {TERMS.map(term => (
              <div key={term.id} id={`term-${term.id}`}>
                <b><a href={term.href}>{term.phrase}</a></b>
                <p>{term.define}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className={styles.foot}>
          <p>PolicyPilot desk · Tape 016 · Published 16 October 2026. Both fills are mainnet receipts. The thousand-MON pass did not send. The same-shape pass did not send. They are not an offer to trade, and they do not quote a rate of return. The product that sends clips and spreads is unchanged by this page.</p>
          <p style={{ marginTop: '0.8rem' }}><a href={`${BP}/`}>Back to PolicyPilot</a></p>
        </footer>
      </article></Linked>
    </div>
  );
}
