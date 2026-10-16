import type { Metadata } from 'next';
import styles from './tape.module.css';

const BP = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const ORIGIN = 'https://blockchains.github.io';
const CANONICAL = `${ORIGIN}${BP}/research/`;
const SHARE_IMAGE = `${ORIGIN}${BP}/icon-512.png`;
const TITLE = 'Monad desk tape: the gas limit is the trade';
const DESCRIPTION =
  'PolicyPilot desk tape, 16 October 2026. Monad bills the gas limit, not the gas used. The closest atomic gain we executed is 0.05306 MON. The minimum bill is 0.05600 MON.';

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
    modifiedTime: '2026-10-16T01:40:00.000Z',
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
  ],
};

const BILLS = [
  ['21,000', '0.00210', 'A plain MON transfer. Nothing is earned.'],
  ['80,000', '0.00800', 'About the cheapest useful contract call.'],
  ['140,000', '0.01400', 'One Uniswap v3-style swap, by itself.'],
  ['200,000', '0.02000', 'A tight two-hop of ordinary tokens, if the path is kind.'],
  ['420,000', '0.04200', 'The clip limit this desk already signs. It stays there.'],
  ['560,024', '0.05600', 'The closest print, before calldata is added.'],
];

export default function ResearchTape() {
  return (
    <div className={styles.page}>
      <div className={styles.progress} aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article className={styles.wrap}>
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
            We looked for any atomic route on Monad whose settled profit exceeds the gas the chain will bill. Monad bills the gas limit, not the gas used, and the base fee does not fall below 100 gwei. Under that rule the closest print we could settle still finishes short.
          </p>
          <p className={styles.meta}>
            <time dateTime="2026-10-16">16 October 2026</time>
            . Fork block 113,762,539 for the closest print. Earlier prints from blocks around 113,710,444 through 113,762,539. Figures are from <code>eth_call</code> and fork execution. Index mids are labeled as mids.
          </p>
          <nav className={styles.toc} aria-label="Tape sections">
            <a href="#billing">01 Billing</a>
            <a href="#search">02 The search</a>
            <a href="#closest">03 Closest print</a>
            <a href="#prints">04 Other prints</a>
            <a href="#floor">05 The floor</a>
            <a href="#rule">06 Desk rule</a>
            <a href="#book">07 The book</a>
          </nav>
          <div className={styles.stats}>
            <div className={styles.stat}><b className={styles.up}>+0.05306</b><span>MON settled, gross</span></div>
            <div className={styles.stat}><b className={styles.down}>0.05600</b><span>MON minimum gas bill</span></div>
            <div className={styles.stat}><b className={styles.down}>−0.00294</b><span>MON, before calldata</span></div>
          </div>
        </header>

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
            A gain has to clear the limit you would actually sign. A forge <code>gasUsed</code> figure includes the test harness, so it is an upper bound on the work, not a number to put in a wallet. The closest print below was measured on the router call itself.
          </p>
        </section>

        <section id="search">
          <h2><span className={styles.idx}>02</span>How the book was walked</h2>
          <p>
            Quotes were a filter. A route counted only after a call that moved tokens on a fork of mainnet, or after a live receipt the desk had already settled. Pair reserves counted only when both token balances covered them. A pool that reports a reserve and holds nothing cannot pay you, and several of them tried.
          </p>
          <p>
            The venues were Uniswap v2, v3, and v4; PancakeSwap v2 and v3; Curve on stables, wrapped bitcoin, and the LST pool; Kuru; LFJ; Capricorn; Pinot; Atlantis; OctoSwap; zkSwap; Nadswap; DYORSwap; Madness; Swyrl; Balancer v3; and Morpho Blue for anything actually underwater. Share tokens were shMON, sMON, gMON, aprMON, sLVMON, strUSD, and the other wrappers that expose a redeem. Sizes ran from dust up to the point the quote turned down.
          </p>
          <p>
            On the eight v2-style factories that was 35,000 solvent pairs. Two cycles quoted more than 0.005 MON. One of them settles and still loses to the limit. The other is a pair of mock tokens and is smaller than a three-hop bill.
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
          <p>
            On a fork of block 113,762,539, <code>swapExactETHForTokens</code> of 0.01 MON returned 0.063059387 MON of WMON. Gross profit 0.053059387 MON. The router’s own quote was 0.063077226 MON. The 0.000018 MON gap is a small transfer haircut, not a failed swap. The tokens moved.
          </p>
          <div className={styles.grid2}>
            <div className={styles.row}><div>Size in</div><div className={styles.num}>0.010000000 MON</div></div>
            <div className={styles.row}><div>WMON out</div><div className={styles.num}>0.063059387 MON</div></div>
            <div className={styles.row}><div>Gross</div><div className={styles.num}>0.053059387 MON</div></div>
            <div className={styles.row}><div>Gas charged on the call</div><div className={styles.num}>539,024</div></div>
            <div className={styles.row}><div>Plus the 21,000 base</div><div className={styles.num}>560,024</div></div>
            <div className={styles.row}><div>Bill at 100 gwei</div><div className={styles.num}>0.056002400 MON</div></div>
          </div>
          <p>
            That bill is already 0.00294 MON above the gain, and it does not yet include the calldata or a cushion. A cushion is required: if the limit is short, the transaction reverts and the signer pays the whole limit for nothing.
          </p>
          <p>
            We tried to make the same three swaps by hand, sending each output back to the caller instead of straight into the next pair. That path returned the full quoted 0.063077226 MON and burned 962,235 gas. The existing router is the cheaper machine. Deploying a new contract to wrap the same hops would add a deployment, and a deployment of even a small caller costs more than this entire gain.
          </p>
          <p className={styles.note}>
            The transfer of NADXBT is the gas. The router already forwards each hop to the next pair, which is the cheap shape. There is no second trick on this path that pulls the limit under 0.053 MON.
          </p>
        </section>

        <section id="prints">
          <h2><span className={styles.idx}>04</span>Prints that look like money</h2>
          <p>Each of these is a real measurement. Each one loses once the limit is applied, or it cannot be settled in one transaction at all.</p>

          <article className={styles.print}>
            <h3>USDT, Uniswap v2 into Pancake v3</h3>
            <p>Pair <code className={styles.addr}>0xa779C6664d90c6012242C19A02b585F89D2CB203</code>. Half a MON buys USDT0 and sells it back for 0.508121607 MON. Gross profit 0.008121607 MON. The fork test burned 633,255 gas. A single v3 leg is already about 0.014 MON at the floor, which is more than the gain. The size curve peaks there: 0.2 MON is smaller, and 2 MON is a loss.</p>
            <p className={styles.verdict}>Gross 0.00812 MON · one leg already costs more</p>
          </article>

          <article className={styles.print}>
            <h3>aprMON against its own net asset value</h3>
            <p>Buying aprMON on the Pancake 0.01% pool and reading <code>previewRedeem</code> peaks near 0.0262 MON of discount on a 30 MON purchase. The swap leg on a fork used 258,728 gas. <code>requestRedeem</code> then used 280,367 gas by itself, about 0.028 MON, and the request came back with <code>claimable</code> of 0. Redemption waits on a staking epoch. The standard <code>redeem</code> into the vault reverts inside the implementation. A quote of 0.026 MON is not a settled MON.</p>
            <p className={styles.verdict}>Discount is real · the exit is not atomic</p>
          </article>

          <article className={styles.print}>
            <h3>shMON atomic unstake</h3>
            <p><code>getCurrentUnstakeFeeRateRay</code> on <code className={styles.addr}>0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c</code> returned 6.80038386749145018e24, which is 0.680% . The deep shMON/WMON pools sit about 2.5 basis points under net asset value. Buying the share and redeeming it loses the fee. At 1 MON through the 0.01% Uniswap pool the loss is 0.006759 MON. At 100 MON it is 0.676 MON. Minting and selling is also short, by about 2.5 basis points.</p>
            <p className={styles.verdict}>Fee 0.680% · pool discount about 0.025%</p>
          </article>

          <article className={styles.print}>
            <h3>The live spread captures</h3>
            <p>These already have receipts. A 0.6 MON capture left the pool 0.002263 MON richer and the signer paid 0.053004 MON in gas. A later 0.7 MON capture moved the pool from 0.7 to 0.703347 MON, gas used 519,673, fee 0.053007 MON. The pool gained MON. The wallet that signed did not. The clip search, on a fork, found 0.000370 MON of quoted profit on 0.2 MON and used 396,776 gas, about 0.0397 MON at the floor. The clip limit stays 420,000 gas.</p>
            <p className={styles.verdict}>Pool up · signer down by about 0.05 MON</p>
          </article>

          <article className={styles.print}>
            <h3>strUSD at a 3% premium</h3>
            <p>Curve pool <code className={styles.addr}>0xee7a6849982026ded35c2aa510319afe5a0801a8</code>. One thousand strUSD quotes 1,031.09 trUSD. strUSD’s name is Staked trUSD. The contract is a minter token with roles, not a vault whose <code>deposit</code> turns trUSD into strUSD. There is no atomic mint against that premium. trUSD against AUSD on the other Curve pool is a tenth of a basis point from one.</p>
            <p className={styles.verdict}>Premium is the market · no atomic mint</p>
          </article>

          <article className={styles.print}>
            <h3>Index prices that were not the book</h3>
            <p>A pool index showed Uniswap v4 MON/USDC about 1.4% rich to the 0.30% v3 pool. The v4 quoter, pool fee 500 and tick spacing 10, native MON against USDC, sold 10 MON for 0.2292 USDC. The round trip back through Pancake 0.05% lost 0.00663 MON. The same pattern held for WETH, WBTC, and cbBTC: slot0 and the quoters sit on the fees, and the index mid was the thing that was wide. Curve cbBTC/WBTC against the v4 0.01% pool loses a few thousand sats of fee in both directions. v4’s own quoter reports about 50,000 gas inside the swap. That is not a transaction, and it does not create an edge the fees have already closed.</p>
            <p className={styles.verdict}>Executable quotes lose the fee</p>
          </article>

          <article className={styles.print}>
            <h3>A reserve that is not dollars</h3>
            <p>TREV/USDC on Uniswap v2 was indexed near 1.92 million dollars. The pair holds 4.494613 USDC and 20.42 million TREV. The dollar figure is the pool pricing its own token. There is no second deep book to sell into.</p>
            <p className={styles.verdict}>4.49 USDC in the pair</p>
          </article>

          <article className={styles.print}>
            <h3>Reserves with an empty balance</h3>
            <p>A Madness triangle quoted 3.26 MON of profit on a 5.12 MON sale through USDC and WETH. The WMON pairs reported reserves in the hundreds of MON and held zero of the token. <code>swap</code> reverted <code>TRANSFER_FAILED</code>. After the desk dropped every pair whose balance did not cover its reserve, Madness had no remaining cycle above 0.005 MON. Eight of its thirty pairs were insolvent in that sense.</p>
            <p className={styles.verdict}>Quote without inventory</p>
          </article>

          <article className={styles.print}>
            <h3>Pinot, Kuru, and the mock cycle</h3>
            <p>Pinot’s WMON/USDC pool, fee tier 10,000, spots at 0.02319 USDC per MON against a market near 0.02290. The 1% fee eats the gap. An in-range upper bound on a 2 MON round trip is about 0.003 MON, and 10 MON is already a loss. Four Kuru books that answer <code>bestBidAsk</code> are 4 to 20 basis points wide. None is crossed. The Pancake v2 cycle that quoted 0.01897 MON runs through Mock Cake and Mock USDT, on a 0.02 MON size, which is under a three-hop bill.</p>
            <p className={styles.verdict}>Wide enough to see · not enough to clear</p>
          </article>
        </section>

        <section id="floor">
          <h2><span className={styles.idx}>05</span>What would have cleared</h2>
          <p>
            Profit has to exceed <code>gas_limit × 100 gwei</code>, and the limit has to be high enough that the call succeeds. For ordinary tokens a two-venue trip wants about 0.025 MON before a signature is worth considering. A one-cent discrepancy in a deep stable pool would have done that easily: a cent is several tenths of a MON at these prices. The stable books we quoted, Curve against v3 and v4, were inside the fee.
          </p>
          <p>
            Uniswap v2, after the solvent filter, was 20,911 pairs and no cycle above 0.005 MON. No pair held an extra 0.02 MON or an extra 0.02 USDC above its reserve. Pancake v2 was 13,057 solvent pairs and one mock-token cycle. The standard WMON/USDC pools on Pancake v2, DYORSwap, OctoSwap, and zkSwap all sit on the v3 price. Selling into them and buying back loses the fee.
          </p>
          <p>
            The 0.053 MON print is the largest settled gain in the set, and it belongs to a token whose transfer sets the gas. Making the route more clever does not remove that transfer.
          </p>
        </section>

        <section id="rule">
          <h2><span className={styles.idx}>06</span>The rule the desk keeps</h2>
          <p>
            A quote is not a send. The signer sends when the settled gain is larger than the limit the wallet will put on the transaction, checked with <code>eth_call</code> first, because a revert bills that limit in full. The clip gas limit stays 420,000. The rough gas figure on the spread desk stays a half million gas at 100 gwei. The signing wallet keeps 5 MON. Rounds stay ten minutes apart, and a round sends at most 20 clips.
          </p>
          <p>
            Nothing in this tape lowers those numbers so a button can light up. The policy firewall, the owner pause, and the <code>createVault</code> preflight stay where they are. There is no promised rate.
          </p>
        </section>

        <section id="book">
          <h2><span className={styles.idx}>07</span>The book, so it can be checked</h2>
          <ul className={styles.sources}>
            <li>Chain 143. Public execution against <code>https://rpc.monad.xyz</code> and <code>https://rpc-mainnet.monadinfra.com</code>. The NADXBT fork used <code>https://rpc.ankr.com/monad_mainnet</code> at block 113,762,539.</li>
            <li>WMON <code className={styles.addr}>0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A</code>. USDC <code className={styles.addr}>0x754704Bc059F8C67012fEd69BC8A327a5aafb603</code>. USDT0 <code className={styles.addr}>0xe7cd86e13AC4309349F30B3435a9d337750fC82D</code>.</li>
            <li>DYOR pairs: WMON/USDC <code className={styles.addr}>0xBE8345287c5bA716941f50A80020911AC2e07c68</code>, USDC/NADXBT <code className={styles.addr}>0x7789D1E9DC0ddA50DF30e66b9DFf53D862393b1E</code>, WMON/NADXBT <code className={styles.addr}>0xFdcB57E198D123545A9E71FDd0DEA424E13B2720</code>.</li>
            <li>Uniswap v4 quoter <code className={styles.addr}>0xa222dd357a9076d1091ed6aa2e16c9742dd26891</code>. MON/USDC pool id matches fee 500, tick spacing 10, hooks unset, currency0 the native zero address.</li>
            <li>shMON unstake fee read from <code>getCurrentUnstakeFeeRateRay()</code>. aprMON exit read from <code>requestRedeem</code> on a fork: assets were credited to a request, and <code>claimable</code> was 0.</li>
            <li>Spread receipts already on mainnet: <code className={styles.addr}>0xedc5a196e891690fb9681b20eb03a621173c43df8b1747e4259e4d736853fba5</code> and <code className={styles.addr}>0x0b75431aed1b0f4c1d918dc229ff6307af093ca6ca076bcfaece783c32ff4e9a</code>.</li>
          </ul>
        </section>

        <footer className={styles.foot}>
          <p>PolicyPilot desk · Tape 016 · Published 16 October 2026. This note is research. It is not an offer to trade, and it does not quote a rate of return. The product that sends clips and spreads is unchanged by this page.</p>
          <p style={{ marginTop: '0.8rem' }}><a href={`${BP}/`}>Back to PolicyPilot</a></p>
        </footer>
      </article>
    </div>
  );
}
