'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWalletClient, custom, formatEther, formatUnits, getAddress, http, isAddress, parseEther, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Activity, Bot, Check, ChevronRight, Copy, ExternalLink, Home, KeyRound, LayoutGrid, Pause, Play, Rocket, ShieldCheck, ShieldAlert, Sparkles, Wallet, Gauge, Siren, Coins } from 'lucide-react';
import { Btn, Card, Pill, Sheet, Slider, Switch, useToasts } from './ui';
import PolicyDashboard from './Dashboard';
import ShowcaseAgents from './ShowcaseAgents';
import { discoverWallets, deepLinks, INSTALL, isMobile, haptic, type Discovered, type Eip1193 } from '@/lib/wallets';
import { addLocal, buildAction, buildCreate, chainOf, decodeInput, factoryAbi, loadHistory, mon, plain, pubOf, readVault, reasonOf, resolveNet, services, short, vcall, type Ev, type Net, type Policy, type VaultState } from '@/lib/vault';
import { TOKENS, type TokenSym } from '@/lib/services';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
type Tab = 'launch' | 'activity' | 'agents' | 'services' | 'policy';
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'launch', label: 'Launch', icon: Rocket }, { id: 'activity', label: 'Activity', icon: Activity }, { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'services', label: 'Services', icon: LayoutGrid }, { id: 'policy', label: 'Policy', icon: Gauge },
];

export default function App() {
  const [net, setNet] = useState<Net | null>(null);
  const pub = useMemo(() => (net ? pubOf(net) : null), [net]);
  const [tab, setTabState] = useState<Tab>('launch');
  const { push: toast, view: toasts } = useToasts();
  const [wallets, setWallets] = useState<Discovered[]>([]);
  const [prov, setProv] = useState<Eip1193 | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [block, setBlock] = useState<bigint | null>(null);
  const [vaults, setVaults] = useState<VaultState[] | null>(null);
  const [hist, setHist] = useState<{ events: Ev[]; showcase: any } | null>(null);
  const [kpi, setKpi] = useState<{ vaults: number; tvl: bigint; note: string } | null>(null);

  useEffect(() => {
    const n = resolveNet(); setNet(n);
    const h = (location.hash.slice(1) as Tab); if (TABS.some(t => t.id === h)) setTabState(h);
    const off = discoverWallets(setWallets);
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${BASE}/sw.js`).catch(() => {});
    return off;
  }, []);
  const setTab = (t: Tab) => { haptic(6); setTabState(t); history.replaceState(null, '', `${location.pathname}${location.search}#${t}`); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const switchNet = (key: 'mainnet' | 'testnet') => { localStorage.setItem('pp.netkey', key); const u = new URL(location.href); u.searchParams.set('net', key); u.searchParams.delete('rpc'); u.searchParams.delete('factory'); location.href = u.toString(); };

  // live block
  useEffect(() => { if (!pub) return; let on = true; const tick = () => pub.getBlockNumber().then(b => on && setBlock(b)).catch(() => {}); tick(); const t = setInterval(tick, 6000); return () => { on = false; clearInterval(t); }; }, [pub]);

  const refreshHist = useCallback(async () => {
    if (!pub || !net) return;
    try { setHist(await loadHistory(pub, net, BASE)); } catch (e) { console.warn(e); }
    try {
      const n = Number(await pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'vaultCount' }));
      const idx = [...Array(Math.min(n, 40)).keys()];
      const addrs = await Promise.all(idx.map(i => pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'allVaults', args: [BigInt(i)] }) as Promise<Address>));
      const bals = await Promise.all(addrs.map(a => pub.getBalance({ address: a })));
      setKpi({ vaults: n, tvl: bals.reduce((s, x) => s + x, 0n), note: n > 40 ? 'MON-in-vaults covers the first 40 vaults' : '' });
    } catch { setKpi(null); }
  }, [pub, net]);
  useEffect(() => { refreshHist(); const t = setInterval(refreshHist, 45000); return () => clearInterval(t); }, [refreshHist]);

  const loadVaults = useCallback(async (acc = account) => {
    if (!pub || !net || !acc) return;
    try {
      const list = await pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'vaultsOf', args: [acc] }) as Address[];
      const out: VaultState[] = []; for (const v of [...list].reverse()) out.push(await readVault(pub, net, v));
      setVaults(out);
    } catch (e: any) { toast(`Couldn't load your agents: ${e.shortMessage ?? e.message}`, 'bad'); }
  }, [pub, net, account]);

  // ---------- wallet ----------
  const ensureChain = async (p: Eip1193) => {
    if (!net) return; const cid = parseInt(await p.request({ method: 'eth_chainId' }), 16); if (cid === net.id) return;
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: net.hex }] }); }
    catch (e: any) {
      if (e?.code === 4902 || /Unrecognized|not added|unknown chain/i.test(e?.message ?? '')) await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: net.hex, chainName: `Monad${net.id === 143 ? '' : ' Testnet'}`, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: [net.publicRpc], blockExplorerUrls: [net.exp] }] });
      else throw e;
    }
    if (parseInt(await p.request({ method: 'eth_chainId' }), 16) !== net.id) throw new Error(`Switch your wallet to Monad ${net.name}.`);
  };
  const connectWith = async (d: Discovered, silent = false) => {
    if (!net || !pub) return false;
    try {
      const accs: string[] = await d.provider.request({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' }); if (!accs?.length) return false;
      await ensureChain(d.provider); const a = getAddress(accs[0]);
      setProv(d.provider); setAccount(a); setWallet(createWalletClient({ account: a, chain: chainOf(net), transport: custom(d.provider) }));
      localStorage.setItem('pp.wallet', d.info.rdns); setConnectOpen(false);
      const b = await pub.getBalance({ address: a }); setBal(b);
      if (!silent) toast(<>Connected <b>{d.info.name}</b> · {short(a)}</>, 'ok');
      if (b === 0n && !silent) toast(net.faucet ? <>0 MON. Get test MON at the <a className="underline" href={net.faucet} target="_blank" rel="noreferrer">faucet</a>.</> : 'Your wallet has 0 MON on Monad.', 'bad');
      d.provider.on?.('accountsChanged', () => location.reload()); d.provider.on?.('chainChanged', () => location.reload());
      loadVaults(a); return true;
    } catch (e) { if (!silent) toast(plain(reasonOf(e)), 'bad'); return false; }
  };
  const autoTried = useRef(false);
  useEffect(() => { if (autoTried.current || !net || !wallets.length) return; const r = localStorage.getItem('pp.wallet'); const d = wallets.find(w => w.info.rdns === r); if (d) { autoTried.current = true; connectWith(d, true); } }, [wallets, net]); // eslint-disable-line
  const need = async () => { if (account && wallet && prov) { await ensureChain(prov); return true; } setConnectOpen(true); return false; };
  const send = async (w: WalletClient, req: { to: Address; data?: Hex; value?: bigint; gas?: bigint }) => {
    const hash = await w.sendTransaction({ ...req, account: w.account!, chain: chainOf(net!) } as any);
    const rc = await pub!.waitForTransactionReceipt({ hash, timeout: 180_000 }); if (rc.status !== 'success') throw Object.assign(new Error('Transaction reverted'), { hash }); return rc;
  };
  const refreshBal = () => account && pub?.getBalance({ address: account }).then(setBal).catch(() => {});

  // ---------- agent actions ----------
  const agentWallet = (s: VaultState) => (s.key ? createWalletClient({ account: privateKeyToAccount(s.key as Hex), chain: chainOf(net!), transport: http(net!.rpc) }) : s.executor === account ? wallet : null);
  const runAgent = async (s: VaultState, kind: string, amount: bigint): Promise<{ ok: boolean; msg: React.ReactNode }> => {
    const a = await buildAction(pub!, kind, s.v, s.owner, s.executor, amount, s.cap);
    try { await pub!.call({ account: s.executor, ...a.req }); }
    catch (e) {
      const r = reasonOf(e); addLocal(net!, { label: `Blocked: ${a.label}`, kind: 'blocked', dapp: a.dapp, icon: a.icon, revertReason: r.name ? `${r.name}(${(r.args ?? []).map(String).join(', ')})` : r.raw, simulated: true, value: a.value });
      refreshHist(); return { ok: false, msg: <>🛡️ <b>Blocked by the vault:</b> {plain(r)} Nothing was sent and no gas was spent.</> };
    }
    const w = agentWallet(s);
    if (!w) return { ok: true, msg: <>✅ This passes the policy. Your agent {short(s.executor)} signs it with its own key (not in this browser).</> };
    const gas = ((await pub!.estimateGas({ account: w.account!, ...a.req })) * 13n) / 10n;
    const rc = await send(w, { ...a.req, gas }); addLocal(net!, { label: a.label, kind: 'allowed', tx: rc.transactionHash, from: w.account!.address });
    refreshHist(); loadVaults();
    return { ok: true, msg: <>✅ <b>Done:</b> {a.label}. <a className="underline" href={`${net!.exp}/tx/${rc.transactionHash}`} target="_blank" rel="noreferrer">View tx ↗</a></> };
  };
  const ownerTx = async (label: string, req: { to: Address; data: Hex; value?: bigint }) => {
    if (!(await need())) throw new Error('Connect your wallet first');
    const rc = await send(wallet!, req); addLocal(net!, { label, kind: 'owner', tx: rc.transactionHash, from: account }); refreshHist(); loadVaults(); refreshBal();
    return { ok: true, msg: <>✅ {label}. <a className="underline" href={`${net!.exp}/tx/${rc.transactionHash}`} target="_blank" rel="noreferrer">View tx ↗</a></> };
  };

  if (!net) return <div className="grid min-h-dvh place-items-center text-zinc-500">Loading…</div>;
  const conn = account ? <><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" /><span className="font-mono">{short(account)}</span>{bal != null && <span className="hidden font-mono tabular-nums text-zinc-400 sm:inline">{Number(formatEther(bal)).toFixed(3)}</span>}</> : <><Wallet className="h-4 w-4 shrink-0" /><span>Connect</span></>;

  return (
    <div className="min-h-dvh overflow-x-clip pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10">
      {toasts}
      <div className="bg-amber-500/10 px-[max(1rem,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] text-center text-[11px] leading-5 text-amber-200" data-testid="alpha">⚠️ <b>Alpha · unaudited contract · only deposit what you&apos;re happy to lose.</b> Max 1 MON per vault.{net.id === 143 ? ' Monad mainnet = real MON.' : ' Testnet = free test MON.'}</div>
      <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-[max(1rem,env(safe-area-inset-left))]">
          <button onClick={() => setTab('launch')} className="flex min-h-11 min-w-0 items-center gap-2" aria-label="PolicyPilot home"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-monad/20"><ShieldCheck className="h-5 w-5 text-monad" /></span><span className="truncate text-base font-semibold text-zinc-50">PolicyPilot</span></button>
          <nav className="ml-4 hidden items-center gap-1 lg:flex">{TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={`min-h-11 rounded-xl px-3 text-sm transition ${tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white'}`}>{t.label}</button>)}</nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <button data-testid="net" aria-label={`Network: Monad ${net.name}. Tap to switch.`} onClick={() => switchNet(net.id === 143 ? 'testnet' : 'mainnet')} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-white/10 px-2 text-xs text-zinc-300 sm:px-3" title="Switch network"><span className={`h-2.5 w-2.5 rounded-full ${block ? (net.id === 143 ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-zinc-600'}`} /><span className="hidden sm:inline">{net.id === 143 ? 'Mainnet' : 'Testnet'}</span></button>
            <Btn kind={account ? 'ghost' : 'pri'} data-testid="connect" className="shrink-0 px-3" onClick={() => setConnectOpen(true)}>{conn}</Btn>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-[max(1rem,env(safe-area-inset-left))] pt-4">
        {tab === 'launch' && <Launch {...{ net, pub: pub!, account, wallet, need, send, toast, refreshHist, loadVaults, setTab, block, kpi, hist }} />}
        {tab === 'activity' && <ActivityView {...{ net, pub, hist, kpi, block, vaults, account, runAgent, setTab, refresh: refreshHist }} />}
        {tab === 'agents' && <Agents {...{ net, account, vaults, loadVaults, runAgent, ownerTx, setConnectOpen, setTab, toast }} />}
        {tab === 'services' && <ServicesView net={net} />}
        {tab === 'policy' && <PolicyDashboard embedded />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" data-testid="tabbar">
        <div className="mx-auto grid max-w-lg grid-cols-5 px-[env(safe-area-inset-left)]">
          {TABS.map(t => { const I = t.icon; const on = tab === t.id; return (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={on ? 'page' : undefined} className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-[11px] transition active:scale-90 ${on ? 'text-white' : 'text-zinc-500'}`}>
              <span className={`grid h-8 w-12 place-items-center rounded-full transition ${on ? 'bg-monad/25' : ''}`}><I className={`h-5 w-5 ${on ? 'text-violet-300' : ''}`} /></span>{t.label}
            </button>); })}
        </div>
      </nav>

      <ConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} wallets={wallets} onPick={d => connectWith(d)} account={account} onDisconnect={() => { localStorage.removeItem('pp.wallet'); location.reload(); }} />
    </div>
  );
}

// ---------------- Connect wallet ----------------
function ConnectSheet({ open, onClose, wallets, onPick, account, onDisconnect }: { open: boolean; onClose: () => void; wallets: Discovered[]; onPick: (d: Discovered) => void; account: Address | null; onDisconnect: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const links = typeof window !== 'undefined' ? deepLinks(location.href) : [];
  const mobile = isMobile();
  return (
    <Sheet open={open} onClose={onClose} title={account ? 'Wallet' : 'Connect a wallet'}>
      {account && <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white/5 p-3"><span className="min-w-0 flex-1 truncate font-mono text-sm">{account}</span><Btn kind="ghost" onClick={onDisconnect}>Disconnect</Btn></div>}
      <p className="mb-3 text-sm text-zinc-400">Wallets found in this browser (EIP-6963):</p>
      <div className="grid gap-2" data-testid="wallet-list">
        {wallets.map(w => (
          <button key={w.info.uuid} data-testid="wallet-option" onClick={async () => { setBusy(w.info.uuid); await onPick(w); setBusy(null); }} className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 text-left transition hover:border-monad/60 active:scale-[0.99]">
            {w.info.icon ? <img src={w.info.icon} alt="" className="h-9 w-9 shrink-0 rounded-xl" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-monad/20"><Wallet className="h-5 w-5 text-monad" /></span>}
            <span className="min-w-0 flex-1 truncate font-medium">{w.info.name}</span>
            {busy === w.info.uuid ? <span className="text-xs text-zinc-400">Check your wallet…</span> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />}
          </button>
        ))}
        {!wallets.length && <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-zinc-400">No wallet detected here.{mobile ? ' Open this app inside your wallet’s browser:' : ' Install one (MetaMask, Rabby, Phantom, Backpack, OKX, Coinbase), then reload.'}</div>}
      </div>
      <p className="mb-2 mt-5 text-sm text-zinc-400">{mobile ? 'On your phone? Open in your wallet app:' : 'On mobile, these open this page in your wallet’s browser:'}</p>
      <div className="grid grid-cols-2 gap-2" data-testid="deeplinks">
        {links.map(l => <a key={l.id} href={l.href} rel="noopener noreferrer" className="flex min-h-11 min-w-0 items-center justify-center gap-1 truncate rounded-2xl border border-white/10 bg-white/[0.03] px-2 text-sm hover:border-monad/60">{l.name}<ExternalLink className="h-3 w-3 shrink-0 opacity-60" /></a>)}
      </div>
      {!mobile && !wallets.length && <div className="mt-4 flex flex-wrap gap-2">{INSTALL.map(i => <a key={i.name} className="text-xs text-violet-300 underline" href={i.href} target="_blank" rel="noreferrer">Get {i.name}</a>)}</div>}
      <p className="mt-4 text-xs text-zinc-500">No WalletConnect QR: it needs a project ID from a third-party signup, so we left it out. The deep links above cover mobile.</p>
    </Sheet>
  );
}

// ---------------- Launch (novice flow) ----------------
function Step({ n, title, done, active, children, testid }: { n: number; title: string; done?: boolean; active?: boolean; children: React.ReactNode; testid?: string }) {
  return (
    <Card data-testid={testid} className={`transition ${active ? 'ring-1 ring-monad/60' : ''}`}>
      <div className="mb-3 flex items-center gap-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${done ? 'bg-emerald-500 text-white' : active ? 'bg-monad text-white' : 'bg-white/10 text-zinc-400'}`}>{done ? <Check className="h-4 w-4" /> : n}</span><h2 className="min-w-0 flex-1 truncate font-semibold text-zinc-50">{title}</h2></div>
      {children}
    </Card>
  );
}
function Launch({ net, pub, account, wallet, need, send, toast, refreshHist, loadVaults, setTab, kpi, hist, block }: any) {
  const live = services(net).filter(s => s.status === 'live');
  const [agentMode, setAgentMode] = useState<'new' | 'external'>('new');
  const [ext, setExt] = useState('');
  const [p, setP] = useState<Policy>({ budgetOn: true, budget: 0.2, capOn: true, cap: 0.05, deposit: 0.25, gas: 0.2, services: live.map(s => s.id), payees: [], startPaused: false });
  const [payeesTxt, setPayeesTxt] = useState('');
  const [prog, setProg] = useState<{ t: string; s: 'run' | 'ok' | 'err'; h?: string }[]>([]);
  const [busy, setBusy] = useState(false); const [doneVault, setDoneVault] = useState<string | null>(null);
  const up = (o: Partial<Policy>) => setP(x => { const n = { ...x, ...o }; if (n.cap > n.budget) n.cap = n.budget; if (n.budget > 1) n.budget = 1; return n; });
  const extOk = agentMode === 'new' || isAddress(ext.trim());
  const step = !account ? 1 : !extOk ? 2 : 3;
  const allowed = live.filter(s => p.services.includes(s.id));
  const summary = `Your agent can spend ${p.capOn ? `at most ${p.cap.toFixed(3)} MON per action` : 'any amount per action'}${p.budgetOn ? ` and ${p.budget.toFixed(3)} MON in total` : ' (bounded only by the 1 MON vault cap)'}, only on ${allowed.length ? allowed.map(s => s.name).join(', ') : 'nothing yet'}. Every output comes back to the vault. You can pause it or pull everything back in one tap.`;

  const launch = async () => {
    if (!(await need())) return; setBusy(true); setProg([]); setDoneVault(null);
    const add = (t: string) => { setProg(l => [...l, { t, s: 'run' }]); return { ok: (h?: string) => setProg(l => l.map((x, i) => (i === l.length - 1 ? { ...x, s: 'ok', h } : x))), err: (m: string) => setProg(l => l.map((x, i) => (i === l.length - 1 ? { ...x, s: 'err', t: `${x.t} – ${m}` } : x))) }; };
    let cur: any;
    try {
      let exec: Address = account; let key: Hex | null = null;
      if (agentMode === 'new') { key = generatePrivateKey(); exec = privateKeyToAccount(key).address; localStorage.setItem(`pp.agentkey.${exec.toLowerCase()}`, key); }
      else exec = getAddress(ext.trim());
      const payees = payeesTxt.split(/[\s,]+/).filter(Boolean).map(a => { if (!isAddress(a)) throw new Error(`Bad payee address ${a}`); return getAddress(a); });
      const c = buildCreate(exec, account, { ...p, payees });
      cur = add('Creating your vault with every rule baked in (1 signature)');
      await pub.call({ account, to: net.factory, data: c.data, value: c.value });
      const rc = await send(wallet, { to: net.factory, data: c.data, value: c.value }); cur.ok(rc.transactionHash);
      addLocal(net, { label: 'Harness on: vault created with limits + services', kind: 'owner', tx: rc.transactionHash, from: account });
      const list = await pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'vaultsOf', args: [account] }) as Address[]; const v = list[list.length - 1];
      if (p.startPaused) { cur = add('Starting paused'); const r = await send(wallet, vcall(v, 'setPaused', [true])); cur.ok(r.transactionHash); addLocal(net, { label: 'Owner pauses the agent', kind: 'owner', tx: r.transactionHash, from: account }); }
      if (key && p.gas > 0) { cur = add(`Sending ${p.gas} MON of gas to your agent`); const r = await send(wallet, { to: exec, value: parseEther(String(p.gas)) }); cur.ok(r.transactionHash); addLocal(net, { label: 'Gas sent to agent key', kind: 'owner', tx: r.transactionHash, from: account }); }
      setDoneVault(v); haptic([10, 40, 10] as any); toast('🚀 Your agent is out in the wild, with a harness on.', 'ok'); loadVaults(); refreshHist();
    } catch (e) { const m = plain(reasonOf(e)); cur ? cur.err(m) : toast(m, 'bad'); }
    setBusy(false);
  };

  return (
    <div className="grid gap-4">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(131,110,249,.35),transparent_55%),radial-gradient(90%_90%_at_100%_100%,rgba(34,211,238,.12),transparent_60%)] p-5 sm:p-8">
        <Pill tone="monad"><Sparkles className="h-3 w-3" /> Monad {net.name} · block {block ? block.toLocaleString() : '…'}</Pill>
        <h1 className="mt-3 text-[clamp(1.75rem,7vw,3.25rem)] font-bold leading-[1.05] tracking-tight text-white" data-testid="tagline">Love agents.<br />Love control.<br /><span className="bg-gradient-to-r from-violet-300 to-cyan-300 bg-clip-text text-transparent">PolicyPilot.</span></h1>
        <p className="mt-3 max-w-xl text-sm text-zinc-300 sm:text-base">Give your AI agent a wallet with a harness: a budget, a per-action cap and only the services you switch on. It’s all enforced on-chain, so you can pull everything back any time.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[['Vaults', kpi ? String(kpi.vaults) : '–'], ['MON in vaults', kpi ? Number(formatEther(kpi.tvl)).toFixed(3) : '–'], ['Allowed', hist ? String(hist.events.filter((e: Ev) => e.status === 'allowed').length) : '–'], ['Blocked', hist ? String(hist.events.filter((e: Ev) => e.status === 'blocked').length) : '–']].map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-2xl bg-black/30 p-3"><div className="truncate font-mono text-xl tabular-nums text-white">{v}</div><div className="truncate text-[11px] text-zinc-400">{k}</div></div>))}
        </div>
      </section>

      <Step n={1} title="Connect your wallet" done={!!account} active={step === 1} testid="step1">
        {account ? <p className="text-sm text-zinc-300">Connected as <span className="font-mono">{short(account)}</span>. You stay the owner, and only you can withdraw.</p>
          : <Btn kind="pri" className="w-full sm:w-auto" onClick={() => need()}><Wallet className="h-4 w-4" />Connect wallet</Btn>}
      </Step>

      <Step n={2} title="Connect your agent" done={!!account && extOk} active={step === 2} testid="step2">
        <div className="grid gap-2 sm:grid-cols-2">
          {([['new', KeyRound, 'Create an agent key', 'Generated in this browser. Great for trying it out.'], ['external', Bot, 'I have an agent', 'Paste its address (ElizaOS, a script, a bot…).']] as const).map(([id, I, t, s]) => (
            <button key={id} data-testid={`agent-${id}`} onClick={() => { haptic(); setAgentMode(id); }} className={`flex min-h-16 min-w-0 items-start gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${agentMode === id ? 'border-monad bg-monad/10' : 'border-white/10 bg-white/[0.02]'}`}>
              <I className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" /><span className="min-w-0"><span className="block font-medium text-zinc-50">{t}</span><span className="block text-xs text-zinc-400">{s}</span></span>
            </button>))}
        </div>
        {agentMode === 'external' && <div className="mt-3 grid gap-2">
          <input data-testid="agent-addr" value={ext} onChange={e => setExt(e.target.value)} placeholder="0x… your agent's address" className="min-h-11 w-full min-w-0 rounded-2xl border border-white/10 bg-black/40 px-3 font-mono text-sm outline-none focus:border-monad" />
          <details className="rounded-2xl bg-black/30 p-3 text-xs text-zinc-400"><summary className="flex min-h-11 cursor-pointer items-center text-zinc-300">How does my ElizaOS / custom agent use it?</summary>
            <p className="mt-2">Your agent signs with its own key and calls the vault, never your wallet:</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre rounded-xl bg-black/50 p-2 font-mono text-[11px] text-zinc-300">{`vault.execute(requestId, payee, amountWei)\nvault.executeCall(requestId, service, valueWei, calldata, opts)`}</pre>
            <p className="mt-2">If it goes over a limit or calls a service you didn’t switch on, the vault reverts with the exact reason. Our <code>plugin-eliza</code> ships the <code>EXECUTE_POLICY_PAYMENT</code> action for the PolicyPilot contract; vault support for the plugin is next.</p></details>
        </div>}
        {agentMode === 'new' && <p className="mt-3 text-xs text-zinc-400"><KeyRound className="mr-1 inline h-3 w-3" />The agent key is stored only in this browser (alpha). Even with the key, the agent can only act inside your rules.</p>}
      </Step>

      <Step n={3} title="Set the rules" active={step === 3} testid="step3">
        <div className="grid gap-1 lg:grid-cols-2 lg:gap-x-6">
          <div className="min-w-0">
            <Switch testid="sw-budget" on={p.budgetOn} onChange={v => up({ budgetOn: v })} label={<>Total budget {p.budgetOn && <span className="font-mono text-violet-300">{p.budget.toFixed(3)} MON</span>}</>} sub="The most it can ever spend" />
            {p.budgetOn && <div className="px-3"><Slider label="Budget" testid="sl-budget" value={p.budget} min={0.001} max={1} step={0.001} onChange={v => up({ budget: v })} /></div>}
            <Switch testid="sw-cap" on={p.capOn} onChange={v => up({ capOn: v })} label={<>Per-action cap {p.capOn && <span className="font-mono text-violet-300">{p.cap.toFixed(3)} MON</span>}</>} sub="Max for any single action" />
            {p.capOn && <div className="px-3"><Slider label="Per-action cap" testid="sl-cap" value={p.cap} min={0.001} max={p.budgetOn ? p.budget : 1} step={0.001} onChange={v => up({ cap: v })} /></div>}
            <div className="px-3 pt-2 text-sm text-zinc-100">Deposit now <span className="font-mono text-violet-300">{p.deposit.toFixed(2)} MON</span></div>
            <div className="px-3"><Slider label="Deposit" testid="sl-deposit" value={p.deposit} min={0} max={1} step={0.01} onChange={v => up({ deposit: v })} /></div>
            {agentMode === 'new' && <><div className="px-3 pt-1 text-sm text-zinc-100">Gas for the agent <span className="font-mono text-violet-300">{p.gas.toFixed(2)} MON</span></div><div className="px-3"><Slider label="Agent gas" testid="sl-gas" value={p.gas} min={0} max={0.5} step={0.01} onChange={v => up({ gas: v })} /></div></>}
            <Switch testid="sw-paused" on={p.startPaused} onChange={v => up({ startPaused: v })} label="Start paused" sub="Flip it on later from Agents" />
          </div>
          <div className="min-w-0">
            <div className="px-3 pb-1 pt-3 text-xs uppercase tracking-wider text-zinc-500 lg:pt-0">Allowed services</div>
            {live.map(s => <Switch key={s.id} testid={`sw-svc-${s.id}`} on={p.services.includes(s.id)} onChange={v => up({ services: v ? [...p.services, s.id] : p.services.filter(x => x !== s.id) })} label={<>{s.icon} {s.name}</>} sub={s.novice} />)}
            {p.services.includes('pay') && <input value={payeesTxt} onChange={e => setPayeesTxt(e.target.value)} placeholder="Extra payees 0x…, 0x… (you're added automatically)" className="mx-3 mt-1 min-h-11 w-[calc(100%-1.5rem)] min-w-0 rounded-2xl border border-white/10 bg-black/40 px-3 font-mono text-xs outline-none focus:border-monad" />}
            <button onClick={() => setTab('services')} className="mt-2 min-h-11 px-3 text-left text-xs text-violet-300">+ {services(net).filter(s => s.status === 'soon').length} more services coming soon →</button>
          </div>
        </div>
        <p className="mt-3 rounded-2xl bg-monad/10 p-3 text-sm text-violet-100" data-testid="summary">{summary}</p>
      </Step>

      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 lg:bottom-4">
        <Btn kind="pri" data-testid="launch" disabled={busy || !extOk} onClick={launch} className="h-14 w-full rounded-3xl text-base">{busy ? 'Launching…' : <><Rocket className="h-5 w-5" />Let it go into the wild</>}</Btn>
      </div>
      {prog.length > 0 && <Card data-testid="progress"><ol className="grid gap-2 text-sm">{prog.map((x, i) => <li key={i} className={`flex min-w-0 items-start gap-2 ${x.s === 'err' ? 'text-red-300' : x.s === 'ok' ? 'text-emerald-300' : 'text-zinc-300'}`}><span className="shrink-0">{x.s === 'ok' ? '✅' : x.s === 'err' ? '⛔' : '⏳'}</span><span className="min-w-0 break-words">{x.t}{x.h && <> · <a className="underline" href={`${net.exp}/tx/${x.h}`} target="_blank" rel="noreferrer">tx ↗</a></>}</span></li>)}</ol>
        {doneVault && <div className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="launched"><Btn kind="pri" onClick={() => setTab('activity')}><Activity className="h-4 w-4" />Watch it live</Btn><Btn onClick={() => setTab('agents')}><Bot className="h-4 w-4" />Manage my agent</Btn></div>}
      </Card>}
    </div>
  );
}

// ---------------- Activity ----------------
function ActivityView({ net, pub, hist, kpi, vaults, account, runAgent, setTab, refresh }: any) {
  const [f, setF] = useState('all'); const [open, setOpen] = useState<number | null>(null);
  const events: Ev[] = hist?.events ?? [];
  const dapps = [...new Set(events.filter(e => e.status !== 'owner').map(e => e.dapp))];
  const list = events.filter(e => f === 'all' || (f.startsWith('d:') ? e.dapp === f.slice(2) : e.status === f)).slice().reverse();
  const mine: VaultState[] = (vaults ?? []).filter((v: VaultState) => v.key || v.executor === account);
  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 items-end gap-3"><div className="min-w-0 flex-1"><h1 className="text-2xl font-bold text-white">Live activity</h1><p className="truncate text-xs text-zinc-400">{hist?.showcase ? `Feed: team demo vault ${short(hist.showcase.vault)} (operated by the team) + your own agents. Read from chain.` : 'Your actions + on-chain reads'}</p></div><Btn onClick={refresh} className="shrink-0">Refresh</Btn></div>
      {mine.length > 0 && <QuickAgent s={mine[0]} net={net} runAgent={runAgent} />}
      {!mine.length && account && <Card className="flex flex-wrap items-center gap-3"><span className="min-w-0 flex-1 text-sm text-zinc-300">No agent with a key in this browser yet.</span><Btn kind="pri" onClick={() => setTab('launch')}><Rocket className="h-4 w-4" />Launch one</Btn></Card>}
      <ShowcaseAgents net={net} pub={pub} base={BASE} totalVaults={kpi ? Number(kpi.vaults) : undefined} extraTeamVaults={hist?.showcase ? 1 : 0} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Vaults created (all)', kpi ? String(kpi.vaults) : '–'], ['MON in vaults', kpi ? Number(formatEther(kpi.tvl)).toFixed(4) : '–'], ['✅ Allowed', String(events.filter(e => e.status === 'allowed').length)], ['⛔ Blocked', String(events.filter(e => e.status === 'blocked').length)]].map(([k, v]) => <Card key={k} className="p-3 sm:p-4"><div className="font-mono text-xl tabular-nums text-white">{v}</div><div className="truncate text-[11px] text-zinc-400">{k}</div></Card>)}
      </div>
      <Card><h3 className="mb-2 text-sm font-medium text-zinc-300">MON the agents spent, by block</h3><Chart events={events} /></Card>
      <div className="-mx-1 flex min-w-0 flex-wrap gap-2 px-1" data-testid="filters">
        {[['all', 'All'], ['allowed', '✅ Allowed'], ['blocked', '⛔ Blocked'], ['owner', '👤 Owner'], ...dapps.map(d => ['d:' + d, d])].map(([v, l]) => <button key={v} onClick={() => { haptic(); setF(v); }} className={`min-h-11 max-w-full truncate rounded-full px-4 text-sm transition active:scale-95 ${f === v ? 'bg-monad text-white' : 'border border-white/10 text-zinc-300'}`}>{l}</button>)}
      </div>
      <ol className="relative grid gap-2 border-l border-white/10 pl-4" data-testid="feed">
        {!hist && <li className="text-sm text-zinc-500">Loading real transactions from the chain…</li>}
        {hist && !list.length && <li className="text-sm text-zinc-500">Nothing here yet.</li>}
        {list.map((e, i) => {
          const tone = e.status === 'allowed' ? 'ok' : e.status === 'blocked' ? 'bad' : 'zinc';
          return (
            <li key={`${e.tx ?? 'sim'}-${i}`} data-testid="ev" data-status={e.status} className="relative animate-[pop_.25s_ease-out]" style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}>
              <span className={`absolute -left-[22px] top-4 h-3 w-3 rounded-full ring-4 ring-ink ${e.status === 'allowed' ? 'bg-emerald-400' : e.status === 'blocked' ? 'bg-red-500' : 'bg-zinc-500'}`} />
              <button onClick={() => setOpen(open === i ? null : i)} className={`w-full min-w-0 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${e.status === 'blocked' ? 'border-red-500/25 bg-red-500/[0.06]' : e.status === 'allowed' ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="flex min-w-0 items-start gap-2"><span className="shrink-0 text-lg leading-6">{e.icon}</span><span className="min-w-0 flex-1 break-words text-sm font-medium text-zinc-100">{e.label}</span><Pill tone={tone as any}>{e.simulated ? 'blocked · simulated' : e.status === 'allowed' ? 'allowed' : e.status === 'blocked' ? 'blocked' : 'owner'}</Pill></div>
                <div className="mt-1 truncate pl-7 text-xs text-zinc-400">{e.dapp}{e.value ? ` · ${mon(e.value)}` : ''}{e.block ? ` · block ${e.block}` : ''}{e.src === 'you' ? ' · you' : ''}</div>
                {e.status === 'blocked' && <div className="mt-1 break-words pl-7 text-xs text-red-200">🛡️ {plain(e.reason)}</div>}
                {open === i && <div className="mt-2 grid gap-1 break-all pl-7 font-mono text-[11px] text-zinc-400">
                  {e.tx && <a className="text-violet-300 underline" href={`${net.exp}/tx/${e.tx}`} target="_blank" rel="noreferrer" onClick={x => x.stopPropagation()}>{e.tx} ↗</a>}
                  {e.from && <div>signed by {e.from}</div>}{decodeInput(e.input) && <div>{decodeInput(e.input)}</div>}
                  {e.fee !== undefined && <div>gas {String(e.gasUsed)} · fee {mon(e.fee!, 6)}</div>}
                  {e.simulated && <div>Simulated with eth_call. Rejected before sending, so no tx exists.</div>}
                </div>}
              </button>
            </li>);
        })}
      </ol>
    </div>
  );
}
function Chart({ events }: { events: Ev[] }) {
  const pts = events.filter(e => e.block && e.status === 'allowed'); const blocked = events.filter(e => e.block && e.status === 'blocked');
  if (!pts.length) return <div className="grid h-32 place-items-center text-sm text-zinc-500">No spend yet</div>;
  let cum = 0n; const s = pts.map(e => { cum += e.value; return { b: Number(e.block), v: Number(formatEther(cum)) }; });
  const all = events.filter(e => e.block).map(e => Number(e.block)); const b0 = Math.min(...all), b1 = Math.max(...all), vm = Math.max(...s.map(x => x.v)) || 1;
  const X = (b: number) => 8 + (b1 === b0 ? 292 : ((b - b0) / (b1 - b0)) * 584), Y = (v: number) => 150 - (v / vm) * 130;
  let d = `M${X(b0)},150`; for (const x of s) d += ` L${X(x.b)},${Y(x.v)}`;
  return (
    <svg viewBox="0 0 600 170" className="h-auto w-full" role="img" aria-label="Cumulative spend">
      <defs><linearGradient id="g1" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#836EF9" stopOpacity=".45" /><stop offset="1" stopColor="#836EF9" stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${X(s[s.length - 1].b)},150 Z`} fill="url(#g1)" /><path d={d} fill="none" stroke="#836EF9" strokeWidth="3" strokeLinejoin="round" />
      {s.map((x, i) => <circle key={i} cx={X(x.b)} cy={Y(x.v)} r="4.5" fill="#34d399" />)}
      {blocked.map((e, i) => <circle key={'b' + i} cx={X(Number(e.block))} cy="150" r="4.5" fill="#ef4444" />)}
      <text x="10" y="14" fill="#a1a1aa" fontSize="14">{vm.toFixed(3)} MON</text>
    </svg>
  );
}

// ---------------- Agents ----------------
const ACTIONS: { kind: string; label: string; svc: string; amt: string }[] = [
  { kind: 'pay', label: '💸 Pay', svc: 'pay', amt: '0.01' }, { kind: 'uniswap', label: '🦄 Swap', svc: 'uniswap', amt: '0.02' }, { kind: 'pancake', label: '🥞 Swap', svc: 'pancake', amt: '0.02' }, { kind: 'kuru', label: '📗 Kuru', svc: 'kuru', amt: '0.02' },
  { kind: 'kintsu', label: '🥩 Kintsu', svc: 'kintsu', amt: '0.01' }, { kind: 'apriori', label: '⚡ aPriori', svc: 'apriori', amt: '0.01' }, { kind: 'magma', label: '🌋 Magma', svc: 'magma', amt: '0.01' }, { kind: 'wmon', label: '🎁 Wrap', svc: 'wmon', amt: '0.01' },
];
const ATTACKS = [['x-cap', 'Spend 2× the cap'], ['x-stranger', 'Pay a stranger'], ['x-drain', 'Move USDC out with transfer()'], ['x-self', 'Swap but send output to itself'], ['x-withdraw', 'Withdraw the vault']] as const;
function ActionSheet({ s, kind, onClose, runAgent, net }: { s: VaultState; kind: string | null; onClose: () => void; runAgent: any; net: Net }) {
  const a = ACTIONS.find(x => x.kind === kind); const [amt, setAmt] = useState(a?.amt ?? '0.01'); const [atk, setAtk] = useState<string>('x-cap');
  const [res, setRes] = useState<{ ok: boolean; msg: React.ReactNode } | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setRes(null); setAmt(a?.amt ?? '0.01'); }, [kind]); // eslint-disable-line
  const go = async () => { setBusy(true); setRes(null); try { setRes(await runAgent(s, kind === 'break' ? atk : kind, kind === 'break' ? 0n : parseEther(amt || '0'))); } catch (e) { setRes({ ok: false, msg: plain(reasonOf(e)) }); } setBusy(false); };
  return (
    <Sheet open={!!kind} onClose={onClose} title={kind === 'break' ? '😈 Try to break the harness' : `Agent: ${a?.label ?? ''}`}>
      {kind === 'break' ? <div className="grid gap-2" data-testid="attacks">{ATTACKS.filter(([k]) => net.id === 143 || !['x-drain', 'x-self'].includes(k)).map(([k, l]) => <button key={k} data-testid={`atk-${k}`} onClick={() => setAtk(k)} className={`min-h-12 rounded-2xl border px-3 text-left text-sm ${atk === k ? 'border-red-400 bg-red-500/10' : 'border-white/10'}`}>{l}</button>)}<p className="text-xs text-zinc-400">Runs as a free eth_call, so no gas is spent and nothing moves.</p></div>
        : <label className="grid gap-1 text-sm text-zinc-300">Amount (MON)<input data-testid="amt" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} className="min-h-12 rounded-2xl border border-white/10 bg-black/40 px-3 font-mono text-base outline-none focus:border-monad" /></label>}
      {(kind === 'uniswap' || kind === 'pancake') && <p className="mt-2 text-xs text-zinc-400">Live quote from the official QuoterV2; minOut = quote − 3%. USDC comes back to the vault.</p>}
      <Btn kind={kind === 'break' ? 'danger' : 'pri'} data-testid="go" disabled={busy} onClick={go} className="mt-4 w-full">{busy ? 'Working…' : kind === 'break' ? 'Attack!' : 'Run'}</Btn>
      {res && <div data-testid="result" data-ok={res.ok ? '1' : '0'} className={`mt-3 break-words rounded-2xl border p-3 text-sm ${res.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-red-500/40 bg-red-500/10 text-red-100'}`}>{res.msg}</div>}
    </Sheet>
  );
}
function QuickAgent({ s, net, runAgent }: { s: VaultState; net: Net; runAgent: any }) {
  const [k, setK] = useState<string | null>(null); const pct = s.budget > 0n ? Number((s.spent * 1000n) / s.budget) / 10 : 0;
  return (
    <Card data-testid="quick-agent">
      <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-monad/20"><Bot className="h-5 w-5 text-violet-300" /></span><div className="min-w-0 flex-1"><div className="truncate font-medium text-white">Your agent {short(s.executor)}</div><div className="truncate text-xs text-zinc-400">{mon(s.spent)} of {mon(s.budget)} used · {s.paused ? 'paused' : 'active'}</div></div><Pill tone={s.paused ? 'warn' : 'ok'}>{s.paused ? 'Paused' : 'Live'}</Pill></div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="mt-3 flex flex-wrap gap-2">{ACTIONS.filter(a => s.rules.includes(a.svc)).map(a => <Btn key={a.kind} kind="soft" data-testid={`qa-${a.kind}`} onClick={() => setK(a.kind)} className="px-3">{a.label}</Btn>)}<Btn kind="danger" data-testid="qa-break" onClick={() => setK('break')} className="px-3">😈 Break it</Btn></div>
      <ActionSheet s={s} kind={k} onClose={() => setK(null)} runAgent={runAgent} net={net} />
    </Card>
  );
}
function useTeamVaults(net: Net) {
  const [team, setTeam] = useState<Record<string, string>>({});
  useEffect(() => { if (net.id !== 143) return; fetch(`${BASE}/showcase-agents-143.json`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => { if (!j) return; const m: Record<string, string> = {}; for (const a of j.agents ?? []) m[String(a.vault).toLowerCase()] = `${a.emoji} ${a.name}`; setTeam(m); }).catch(() => {}); }, [net.id]);
  return team;
}
function Agents({ net, account, vaults, loadVaults, runAgent, ownerTx, setConnectOpen, setTab, toast }: any) {
  const team = useTeamVaults(net);
  const [k, setK] = useState<{ s: VaultState; kind: string } | null>(null);
  const [own, setOwn] = useState<{ s: VaultState; kind: string } | null>(null);
  if (!account) return <Card className="grid place-items-center gap-3 py-10 text-center"><Wallet className="h-8 w-8 text-violet-300" /><p className="text-zinc-300">Connect your wallet to see your agents. They’re found on-chain, so they show up on any device.</p><Btn kind="pri" onClick={() => setConnectOpen(true)}>Connect wallet</Btn></Card>;
  if (!vaults) return <div className="text-sm text-zinc-500">Loading your agents…</div>;
  if (!vaults.length) return <Card className="grid place-items-center gap-3 py-10 text-center"><ShieldCheck className="h-8 w-8 text-violet-300" /><p className="text-zinc-300">No agents on {net.name} yet.</p><Btn kind="pri" onClick={() => setTab('launch')}><Rocket className="h-4 w-4" />Launch your first agent</Btn></Card>;
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3"><h1 className="min-w-0 flex-1 text-2xl font-bold text-white">My agents</h1><Btn onClick={() => loadVaults()}>Refresh</Btn></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {vaults.map((s: VaultState) => {
          const pct = s.budget > 0n ? Math.min(100, Number((s.spent * 1000n) / s.budget) / 10) : 0; const C = 2 * Math.PI * 40;
          const toks = (Object.entries(s.toks) as [TokenSym, bigint][]).filter(([, b]) => b > 0n);
          const canSign = !!s.key || s.executor === account;
          return (
            <Card key={s.v} data-testid="vault-card">
              <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-monad/20"><ShieldCheck className="h-5 w-5 text-violet-300" /></span>
                <div className="min-w-0 flex-1"><div className="truncate font-semibold text-white">Vault {short(s.v)}</div><a className="block truncate text-xs text-violet-300" href={`${net.exp}/address/${s.v}`} target="_blank" rel="noreferrer">agent {short(s.executor)}{s.key ? ' · key in this browser' : s.executor === account ? ' · your wallet' : ' · external'} ↗</a>{team[s.v.toLowerCase()] && <div className="mt-1"><Pill tone="zinc">{team[s.v.toLowerCase()]} · team showcase agent, run by the PolicyPilot runner</Pill></div>}</div>
                <Pill tone={s.paused ? 'warn' : 'ok'}>{s.paused ? 'Paused' : 'Active'}</Pill></div>
              <div className="mt-4 flex min-w-0 items-center gap-4">
                <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="10" /><circle cx="50" cy="50" r="40" fill="none" stroke="#836EF9" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} className="transition-all duration-700" /></svg>
                <dl className="grid min-w-0 flex-1 grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs"><dt className="text-zinc-400">Budget used</dt><dd className="truncate text-right font-mono tabular-nums">{pct.toFixed(0)}%</dd><dt className="text-zinc-400">In vault</dt><dd className="truncate text-right font-mono tabular-nums" data-testid="vault-bal">{mon(s.bal)}</dd><dt className="text-zinc-400">Spent</dt><dd className="truncate text-right font-mono tabular-nums">{mon(s.spent)}</dd><dt className="text-zinc-400">Per action</dt><dd className="truncate text-right font-mono tabular-nums">≤ {mon(s.cap)}</dd><dt className="text-zinc-400">Agent gas</dt><dd className="truncate text-right font-mono tabular-nums">{mon(s.agentBal)}</dd>
                  {toks.map(([k, b]) => <Fragment key={k}><dt className="text-zinc-400">{k}</dt><dd className="truncate text-right font-mono tabular-nums">{Number(formatUnits(b, TOKENS[k].decimals)).toFixed(6)}</dd></Fragment>)}</dl>
              </div>
              <Switch testid="sw-pause-vault" on={!s.paused} onChange={async v => { try { await ownerTx(v ? 'Owner resumes the agent' : 'Owner pauses the agent', vcall(s.v, 'setPaused', [!v])); toast(v ? '▶️ Agent resumed' : '⏸ Agent paused', 'ok'); } catch (e) { toast(plain(reasonOf(e)), 'bad'); } }} label={s.paused ? 'Agent is paused' : 'Agent is live'} sub="Instant kill-switch, one signature" />
              <div className="mt-2 text-[11px] uppercase tracking-wider text-zinc-500">Agent actions{canSign ? '' : ' (simulate only: agent signs elsewhere)'}</div>{!canSign && <p className="mt-1 text-xs text-zinc-400">This agent's key isn't in this browser, so buttons here run a free policy check (eth_call) and send nothing. Owner actions below are real transactions from your wallet.</p>}
              <div className="mt-2 flex flex-wrap gap-2">{ACTIONS.filter(a => s.rules.includes(a.svc)).map(a => <Btn key={a.kind} kind="soft" className="px-3" onClick={() => setK({ s, kind: a.kind })}>{a.label}</Btn>)}<Btn kind="danger" className="px-3" data-testid="break" onClick={() => setK({ s, kind: 'break' })}>😈 Break it</Btn></div>
              <div className="mt-3 text-[11px] uppercase tracking-wider text-zinc-500">Owner</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Btn onClick={() => setOwn({ s, kind: 'deposit' })}><Coins className="h-4 w-4" />Deposit</Btn><Btn onClick={() => setOwn({ s, kind: 'withdraw' })}>Withdraw</Btn>
                <Btn kind="danger" data-testid="emergency" className="col-span-2" onClick={async () => { try { const r = await ownerTx('Owner pulls all MON back (emergency)', vcall(s.v, 'emergencyWithdrawAll', [])); toast(r.msg, 'ok'); } catch (e) { toast(plain(reasonOf(e)), 'bad'); } }}><Siren className="h-4 w-4" />Pull everything back</Btn>
                {toks.length > 0 && <Btn data-testid="tokens" className="col-span-2" onClick={async () => { try { for (const [k, b] of toks) await ownerTx(`Withdraw ${k}`, vcall(s.v, 'withdrawToken', [TOKENS[k].address, account, b])); toast('Tokens sent to your wallet', 'ok'); } catch (e) { toast(plain(reasonOf(e)), 'bad'); } }}>Withdraw tokens ({toks.map(t => t[0]).join(', ')})</Btn>}
                {s.key && <Btn className="col-span-2 text-xs" onClick={() => { if (confirm('Show the agent key? Anyone holding it can act as this agent, though only within the vault limits.')) prompt('Agent key (keep it secret):', s.key!); }}>Export agent key</Btn>}
              </div>
            </Card>);
        })}
      </div>
      {k && <ActionSheet s={k.s} kind={k.kind} onClose={() => setK(null)} runAgent={runAgent} net={net} />}
      <OwnerSheet x={own} onClose={() => setOwn(null)} ownerTx={ownerTx} account={account} />
    </div>
  );
}
function OwnerSheet({ x, onClose, ownerTx, account }: any) {
  const [amt, setAmt] = useState('0.05'); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setRes(null); if (x) setAmt(x.kind === 'withdraw' ? formatEther(x.s.bal) : '0.05'); }, [x]);
  if (!x) return null;
  const go = async () => { setBusy(true); try { const v = parseEther(amt || '0'); setRes(await (x.kind === 'deposit' ? ownerTx(`Deposit ${amt} MON`, { ...vcall(x.s.v, 'deposit', []), value: v }) : ownerTx(`Withdraw ${amt} MON`, vcall(x.s.v, 'withdraw', [account, v])))); } catch (e) { setRes({ ok: false, msg: plain(reasonOf(e)) }); } setBusy(false); };
  return <Sheet open onClose={onClose} title={x.kind === 'deposit' ? 'Deposit MON' : 'Withdraw MON'}><label className="grid gap-1 text-sm text-zinc-300">Amount (MON)<input inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} className="min-h-12 rounded-2xl border border-white/10 bg-black/40 px-3 font-mono text-base outline-none focus:border-monad" /></label>{x.kind === 'deposit' && <p className="mt-2 text-xs text-zinc-400">Max 1 MON per vault (alpha).</p>}<Btn kind="pri" disabled={busy} onClick={go} className="mt-4 w-full">{busy ? 'Working…' : 'Confirm'}</Btn>{res && <div className={`mt-3 break-words rounded-2xl border p-3 text-sm ${res.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>{res.msg}</div>}</Sheet>;
}

// ---------------- Services ----------------
function ServicesView({ net }: { net: Net }) {
  const list = services(net);
  return (
    <div className="grid gap-4">
      <div><h1 className="text-2xl font-bold text-white">Top Monad services</h1><p className="text-sm text-zinc-400">“Live” means the address comes from the protocol’s own docs and passes a mainnet fork test. Everything else is honestly marked “coming soon”.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="services">
        {list.map(s => (
          <Card key={s.id} data-testid={`svc-${s.id}`} data-status={s.status} className={s.status === 'soon' ? 'opacity-80' : ''}>
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-2xl">{s.icon}</span><div className="min-w-0 flex-1"><div className="truncate font-semibold text-white">{s.name}</div><div className="truncate text-xs text-zinc-400">{s.category} · {s.blurb}</div></div><Pill tone={s.status === 'live' ? 'ok' : 'zinc'}>{s.status === 'live' ? 'Live' : 'Soon'}</Pill></div>
            <p className="mt-3 text-sm text-zinc-300">{s.novice}</p>
            {s.status === 'live' && s.address && <div className="mt-3 grid gap-1 text-xs"><a className="flex min-h-8 min-w-0 items-center gap-1 text-violet-300" href={`${net.exp}/address/${s.address}`} target="_blank" rel="noreferrer"><span className="truncate font-mono">{s.address}</span><ExternalLink className="h-3 w-3 shrink-0" /></a><a className="flex min-h-8 items-center gap-1 text-zinc-400 underline" href={s.source} target="_blank" rel="noreferrer">Official source ↗</a><span className="text-zinc-500">Fork test: {s.forkTest}</span></div>}
            {s.status === 'soon' && <p className="mt-3 text-xs text-zinc-500">{s.why}</p>}
          </Card>))}
      </div>
    </div>
  );
}
