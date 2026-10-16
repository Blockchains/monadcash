import type { Address } from 'viem';
import { APP_VAULT_MON, buildCreate } from './vault';

/** A playbook step the agent runs against the vault. `amount` in MON (string) or 'wmon-all' / 'each-payee'. */
export type PlaybookStep = { kind: string; amount: string; label: string };
export type SuperVault = {
  id: 'yield' | 'trader' | 'payments';
  name: string; emoji: string; tagline: string; value: string[];
  services: string[]; cap: number; budget: number; deposit: number; payees?: boolean;
  playbook: PlaybookStep[];
};

/** Curated, one-click vault templates. Each is created (+ deposited) in ONE transaction with
 *  your wallet as the agent, so the playbook below runs for real from the browser, through the vault's policy. */
export const SUPER_VAULTS: SuperVault[] = [
  { id: 'yield', name: 'Yield Super Vault', emoji: '🥩', tagline: 'Diversified liquid staking across Kintsu, aPriori and Magma.',
    value: ['Spreads stake over three live Monad LSTs (sMON, aprMON, gMON) in one tap', 'Receipt tokens land in the vault; only you can pull them out', 'Wrap/unwrap WMON for apps that need the ERC-20'],
    services: ['kintsu', 'apriori', 'magma', 'wmon'], cap: APP_VAULT_MON, budget: APP_VAULT_MON, deposit: 3,
    playbook: [{ kind: 'kintsu', amount: '1', label: 'Stake 1 MON → sMON (Kintsu)' }, { kind: 'apriori', amount: '1', label: 'Stake 1 MON → aprMON (aPriori)' }, { kind: 'magma', amount: '1', label: 'Stake 1 MON → gMON (Magma)' }] },
  { id: 'trader', name: 'Best-Execution Super Vault', emoji: '🎯', tagline: 'Quotes Uniswap v3, PancakeSwap v3 and Kuru, then swaps at the best price.',
    value: ['Every swap is quoted live on all three venues and routed to the best USDC out', 'Slippage guard (minOut = best quote − 3%) enforced by the vault itself', 'USDC/WMON approvals capped; output must come back to the vault'],
    services: ['uniswap', 'pancake', 'kuru', 'wmon'], cap: APP_VAULT_MON, budget: APP_VAULT_MON, deposit: 3,
    playbook: [{ kind: 'bestswap', amount: '1.5', label: 'Swap 1.5 MON → USDC at the best of 3 venues' }, { kind: 'bestswap', amount: '1.5', label: 'Swap another 1.5 MON → USDC (re-quoted)' }, { kind: 'unwrap', amount: 'wmon-all', label: 'Unwrap any WMON back to MON' }] },
  { id: 'payments', name: 'Payments Super Vault', emoji: '💸', tagline: 'Payroll, tips and subscriptions to an allowlist, with a per-payment cap.',
    value: ['Only addresses you approve can ever be paid', `Per-action cap and budget sit at the ${APP_VAULT_MON} MON vault cap`, 'Add or remove payees any time; pause with one signature'],
    services: ['pay'], cap: APP_VAULT_MON, budget: APP_VAULT_MON, deposit: 1, payees: true,
    playbook: [{ kind: 'pay-each', amount: '0.5', label: 'Pay 0.5 MON to every approved payee' }] },
];

export const superById = (id: string) => SUPER_VAULTS.find(s => s.id === id);
/** createVault calldata for a template: executor = owner (your wallet), owner always a payee. */
export const buildSuper = (t: SuperVault, owner: Address, payees: Address[], deposit = t.deposit) =>
  buildCreate(owner, owner, { budgetOn: true, budget: t.budget, capOn: true, cap: t.cap, deposit, gas: 0, services: t.services, payees, startPaused: false });
/** Which template a vault's enabled services correspond to (exact service set match), if any. */
export const matchSuper = (rules: string[]): SuperVault | undefined => {
  const set = [...rules].sort().join(',');
  return SUPER_VAULTS.find(t => [...t.services, ...(t.payees ? ['pay'] : [])].filter((x, i, a) => a.indexOf(x) === i).sort().join(',') === set);
};
