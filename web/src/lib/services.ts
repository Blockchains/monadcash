import type { Address, Hex } from 'viem';

/** Verified token addresses on Monad mainnet (chain 143). Each has an official source. */
export const TOKENS = {
  WMON: { address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' as Address, decimals: 18, source: 'https://docs.monad.xyz/developer-essentials/network-information' },
  USDC: { address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address, decimals: 6, source: 'https://developers.circle.com/stablecoins/usdc-contract-addresses' },
  sMON: { address: '0xA3227C5969757783154C60bF0bC1944180ed81B9' as Address, decimals: 18, source: 'https://docs.kintsu.xyz/the-kintsu-protocol/official-contract-addresses' },
  aprMON: { address: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852' as Address, decimals: 18, source: 'https://apriori-docs.gitbook.io/apriori-docs/aprmon/smart-contract-integration' },
  gMON: { address: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081' as Address, decimals: 18, source: 'https://docs.hydrogenlabs.xyz/magma/developers/contract-address-interface-and-abi' },
} as const;
export type TokenSym = keyof typeof TOKENS;

export type Rule = { fn: string; selector: Hex; recipientWord: number };
export type Service = {
  id: string; name: string; verb: string; category: 'Pay' | 'Swap' | 'Stake' | 'Wrap' | 'Lend' | 'Perps' | 'Bridge' | 'NFT' | 'Stablecoin';
  icon: string; blurb: string; novice: string;
  status: 'live' | 'soon';
  address?: Address; source?: string; rules?: Rule[]; tokenCaps?: { token: TokenSym; cap: bigint }[];
  why?: string; // for coming soon: the honest reason
  forkTest?: string;
};

/** Top Monad mainnet services. "live" = official address from the protocol's own docs AND passing a mainnet fork test
 *  (test/AgentVaultDapps.t.sol: AgentVaultForkTest + AgentVaultForkV3Test). Everything else is honestly "coming soon". */
export const SERVICES: Service[] = [
  { id: 'pay', name: 'Pay people', verb: 'Pay', category: 'Pay', icon: '💸', status: 'live', blurb: 'Send MON to payees you approve.', novice: 'Your agent can pay invoices, but only to addresses you approve.', forkTest: 'unit + fuzz + invariant tests' },
  { id: 'uniswap', name: 'Uniswap v3', verb: 'Swap', category: 'Swap', icon: '🦄', status: 'live', blurb: 'Swap MON ⇄ USDC on the biggest DEX.', novice: 'Turn MON into USDC (a dollar stablecoin), with a slippage guard.',
    address: '0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900', source: 'https://developers.uniswap.org/docs/protocols/v3/deployments/v3-monad-deployments',
    rules: [{ fn: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', selector: '0x04e45aaf', recipientWord: 3 }], tokenCaps: [{ token: 'USDC', cap: 5_000_000n }, { token: 'WMON', cap: 10n ** 18n }], forkTest: 'test_fork_uniswap_mon_to_usdc_and_back' },
  { id: 'pancake', name: 'PancakeSwap v3', verb: 'Swap', category: 'Swap', icon: '🥞', status: 'live', blurb: 'Swap MON ⇄ USDC on PancakeSwap.', novice: 'A second DEX, so your agent can find a better price.',
    address: '0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C', source: 'https://developer.pancakeswap.finance/contracts/v3/addresses',
    rules: [{ fn: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', selector: '0x04e45aaf', recipientWord: 3 }], tokenCaps: [{ token: 'USDC', cap: 5_000_000n }, { token: 'WMON', cap: 10n ** 18n }], forkTest: 'test_fork_pancake_mon_to_usdc_and_back' },
  { id: 'kintsu', name: 'Kintsu', verb: 'Stake', category: 'Stake', icon: '🥩', status: 'live', blurb: 'Liquid-stake MON → sMON.', novice: 'Earn staking yield while staying liquid.',
    address: '0xA3227C5969757783154C60bF0bC1944180ed81B9', source: 'https://docs.kintsu.xyz/the-kintsu-protocol/official-contract-addresses',
    rules: [{ fn: 'deposit(uint96,address)', selector: '0x1c3477dd', recipientWord: 1 }], forkTest: 'test_fork_kintsu_stake' },
  { id: 'apriori', name: 'aPriori', verb: 'Stake', category: 'Stake', icon: '⚡', status: 'live', blurb: 'MEV-boosted liquid staking → aprMON.', novice: 'Staking yield with MEV rewards on top.',
    address: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', source: 'https://apriori-docs.gitbook.io/apriori-docs/aprmon/smart-contract-integration',
    rules: [{ fn: 'deposit(uint256,address)', selector: '0x6e553f65', recipientWord: 1 }], forkTest: 'test_fork_apriori_stake' },
  { id: 'magma', name: 'Magma', verb: 'Stake', category: 'Stake', icon: '🌋', status: 'live', blurb: 'DAO-owned liquid staking → gMON.', novice: 'Community-owned staking; gMON grows in value.',
    address: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081', source: 'https://docs.hydrogenlabs.xyz/magma/developers/contract-address-interface-and-abi',
    rules: [{ fn: 'depositMON(address,uint256)', selector: '0x5f3896d3', recipientWord: 0 }], forkTest: 'test_fork_magma_stake' },
  { id: 'wmon', name: 'Wrapped MON', verb: 'Wrap', category: 'Wrap', icon: '🎁', status: 'live', blurb: 'Wrap / unwrap MON 1:1.', novice: 'The ERC-20 version of MON that many apps need.',
    address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', source: 'https://docs.monad.xyz/developer-essentials/network-information',
    rules: [{ fn: 'deposit()', selector: '0xd0e30db0', recipientWord: 255 }, { fn: 'withdraw(uint256)', selector: '0x2e1a7d4d', recipientWord: 255 }], forkTest: 'test_fork_wmon_wrap_unwrap' },
  { id: 'lend', name: 'Lending (Morpho)', verb: 'Lend', category: 'Lend', icon: '🏦', status: 'soon', blurb: 'Earn interest on USDC / MON.', novice: 'Lend idle funds for interest.',
    why: 'Morpho is deployed on Monad, but none of its Monad vaults are marked "listed" in Morpho’s official API yet. We will enable lending once there is a listed vault and a fork test.' },
  { id: 'usdcpay', name: 'USDC payouts', verb: 'Pay', category: 'Stablecoin', icon: '💵', status: 'soon', blurb: 'Pay invoices in dollars.', novice: 'Pay people in a stablecoin.',
    why: 'The vault blocks ERC-20 transfer() by design so an agent can never move tokens out. Allowlisted USDC payouts need a new vault version, which will be audited first.' },
  { id: 'kuru', name: 'Kuru', verb: 'Swap', category: 'Swap', icon: '📗', status: 'live', blurb: 'Swap MON → USDC on Kuru’s on-chain order book.', novice: 'A Monad-native order-book exchange, as a third place to get a price.',
    address: '0xd651346d7c789536ebf06dc72aE3C8502cd695CC', source: 'https://docs.kuru.io/contracts/Contract-addresses',
    rules: [{ fn: 'anyToAnySwap(address[],bool[],bool[],address,address,uint256,uint256)', selector: '0xffa5210a', recipientWord: 255 }], forkTest: 'test_fork_kuru_mon_to_usdc' },
  { id: 'perps', name: 'Perps', verb: 'Trade', category: 'Perps', icon: '📈', status: 'soon', blurb: 'Leveraged trading.', novice: 'Advanced trading with strict limits.',
    why: 'Kuru (enabled above) is spot only. We have not verified and fork-tested an official perps contract on Monad mainnet yet.' },
  { id: 'bridge', name: 'Bridge', verb: 'Bridge', category: 'Bridge', icon: '🌉', status: 'soon', blurb: 'Move funds to other chains.', novice: 'Move funds between chains.',
    why: 'A bridge sends funds to another chain, so the vault can’t force the output back to itself. This needs a new policy design first.' },
  { id: 'nft', name: 'NFTs (Magic Eden)', verb: 'Mint', category: 'NFT', icon: '🖼️', status: 'soon', blurb: 'Mint or buy NFTs.', novice: 'Let your agent collect for you.',
    why: 'The marketplace contracts are not verified from official docs yet, and NFT outputs need ERC-721 receipt checks.' },
];
export const LIVE = SERVICES.filter(s => s.status === 'live');
export const KURU = { router: '0xd651346d7c789536ebf06dc72aE3C8502cd695CC' as Address, monUsdc: '0x065C9d28E428A0db40191a54d33d5b7c71a9C394' as Address, source: 'https://docs.kuru.io/contracts/Contract-addresses' };
export const QUOTERS = { uniswap: { address: '0x661e93cca42afacb172121ef892830ca3b70f08d' as Address, fee: 3000 }, pancake: { address: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997' as Address, fee: 500 } };
