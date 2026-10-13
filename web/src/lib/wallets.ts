'use client';
/** EIP-6963 multi-injected-provider discovery + mobile wallet deep links. No WalletConnect: it needs a Reown project id (signup), which we don't use. */
export type Eip1193 = { request: (a: { method: string; params?: unknown[] | object }) => Promise<any>; on?: (e: string, f: (...a: any[]) => void) => void; removeListener?: (e: string, f: (...a: any[]) => void) => void };
export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
export type Discovered = { info: WalletInfo; provider: Eip1193 };

export function discoverWallets(onChange: (list: Discovered[]) => void): () => void {
  const map = new Map<string, Discovered>();
  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent).detail as Discovered; if (!d?.info?.uuid || !d.provider) return;
    if ([...map.values()].some(x => x.info.rdns && x.info.rdns === d.info.rdns)) return;
    map.set(d.info.uuid, d); onChange([...map.values()]);
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  // Legacy single injected provider (older wallets / some in-app browsers) when nothing announces.
  const t = setTimeout(() => {
    const eth = (window as any).ethereum as Eip1193 | undefined;
    if (eth && map.size === 0) {
      const name = (eth as any).isRabby ? 'Rabby' : (eth as any).isPhantom ? 'Phantom' : (eth as any).isCoinbaseWallet ? 'Coinbase Wallet' : (eth as any).isOkxWallet ? 'OKX Wallet' : (eth as any).isMetaMask ? 'MetaMask' : 'Browser wallet';
      map.set('legacy', { info: { uuid: 'legacy', name, icon: '', rdns: 'legacy.injected' }, provider: eth }); onChange([...map.values()]);
    }
  }, 400);
  return () => { window.removeEventListener('eip6963:announceProvider', onAnnounce); clearTimeout(t); };
}

export const isMobile = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/** Official in-app-browser deep links (user must tap them; never auto-redirect). */
export function deepLinks(url: string) {
  const u = new URL(url); const bare = u.host + u.pathname + u.search; const enc = encodeURIComponent(url); const ref = encodeURIComponent(u.origin);
  return [
    { id: 'metamask', name: 'MetaMask', href: `https://link.metamask.io/dapp/${bare}`, doc: 'https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/' },
    { id: 'phantom', name: 'Phantom', href: `https://phantom.com/ul/browse/${enc}?ref=${ref}`, doc: 'https://docs.phantom.com/phantom-deeplinks/other-methods/browse' },
    { id: 'coinbase', name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${enc}`, doc: 'https://docs.cdp.coinbase.com/' },
    { id: 'okx', name: 'OKX Wallet', href: `okx://wallet/dapp/url?dappUrl=${enc}`, doc: 'https://web3.okx.com/build/docs/waas/app-universal-link' },
    { id: 'backpack', name: 'Backpack', href: `https://backpack.app/ul/v1/browse/${enc}?ref=${ref}`, doc: 'https://docs.backpack.app/deeplinks/other-methods/browse' },
    { id: 'trust', name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}`, doc: 'https://developer.trustwallet.com/' },
  ];
}
export const INSTALL = [
  { name: 'MetaMask', href: 'https://metamask.io/download/' }, { name: 'Rabby', href: 'https://rabby.io/' }, { name: 'Phantom', href: 'https://phantom.com/download' },
  { name: 'Backpack', href: 'https://backpack.app/' }, { name: 'OKX Wallet', href: 'https://web3.okx.com/download' }, { name: 'Coinbase Wallet', href: 'https://www.coinbase.com/wallet/downloads' },
];
export const haptic = (ms = 8) => { try { (navigator as any).vibrate?.(ms); } catch { /* not supported */ } };
