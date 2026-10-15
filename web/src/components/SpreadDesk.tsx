'use client';
import { useEffect, useRef, useState } from 'react';
import { formatUnits, getAddress, isAddress, parseEther, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { AlertTriangle, CheckCircle2, Radio } from 'lucide-react';
import { Btn, Switch } from './ui';
import { haptic } from '@/lib/wallets';
import { addLocal, mon, plain, reasonOf, short, type Net } from '@/lib/vault';
import { pricedGas } from '@/lib/fastPath';
import {
  backQuote, chooseSell, clearsFloor, decodeQuote, explainSpread, fetchCalls, forwardQuotes, minOuts, ROUGH_GAS_WEI, spreadAbi,
  spreadCaptureData, spreadDeployData, spreadGate, spreadWithdrawData, VENUES, workerUrl, type QuoteCall, type VenueId,
} from '@/lib/spread';

type Quote = {
  amount: bigint; uni: bigint; cake: bigint; sell: VenueId | null; buy: VenueId | null;
  usdc: bigint; back: bigint; profit: bigint; bounty: bigint; fee: bigint; poolCut: bigint; ok: boolean;
};

function ask(worker: Worker | null, rpc: string, calls: QuoteCall[]): Promise<Hex[]> {
  if (!worker) return fetchCalls(rpc, calls);
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { worker.removeEventListener('message', onMsg); reject(new Error('Quote timed out')); }, 8_000);
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.id !== id) return;
      window.clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      if (!ev.data.ok) reject(new Error(ev.data.error || 'Quote failed'));
      else resolve(ev.data.rows as Hex[]);
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ id, rpc, calls });
  });
}

const usdc = (v: bigint) => `${Number(formatUnits(v, 6)).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;

export default function SpreadDesk({ net, pub, account, wallet, bal, need, send, toast, block }: {
  net: Net; pub: PublicClient; account: Address | null; wallet: WalletClient | null; bal: bigint | null;
  need: () => Promise<boolean>;
  send: (w: WalletClient, req: { to?: Address; data?: Hex; value?: bigint; gas?: bigint }) => Promise<{ transactionHash: Hex; contractAddress?: Address | null }>;
  toast: (m: React.ReactNode, k?: 'ok' | 'bad' | 'info') => void; block: bigint | null;
}) {
  const [amount, setAmount] = useState('0.05');
  const [vault, setVault] = useState<Address | null>(null);
  const [snap, setSnap] = useState<{ pool: bigint; shares: bigint; yours: bigint } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [paste, setPaste] = useState('');
  const [line, setLine] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const tried = useRef<bigint | null>(null);
  const key = account ? `pp.spread.${net.id}.${account.toLowerCase()}` : '';

  useEffect(() => {
    let w: Worker | null = null;
    try { w = new Worker(workerUrl()); workerRef.current = w; } catch { workerRef.current = null; }
    return () => { w?.terminate(); workerRef.current = null; };
  }, []);

  useEffect(() => {
    if (!key) { setVault(null); return; }
    const saved = localStorage.getItem(key);
    setVault(saved && isAddress(saved) ? getAddress(saved) : null);
  }, [key]);

  useEffect(() => {
    if (!vault) { setSnap(null); return; }
    let on = true;
    (async () => {
      const code = await pub.getCode({ address: vault });
      if (!on) return;
      if (!code || code === '0x') { if (key) localStorage.removeItem(key); setVault(null); return; }
      const who = account ?? '0x0000000000000000000000000000000000000000';
      const [pool, shares, yours] = await Promise.all([
        pub.getBalance({ address: vault }),
        pub.readContract({ address: vault, abi: spreadAbi, functionName: 'balanceOf', args: [who] }),
        pub.readContract({ address: vault, abi: spreadAbi, functionName: 'assetsOf', args: [who] }),
      ]) as [bigint, bigint, bigint];
      if (on) setSnap({ pool, shares, yours });
    })().catch(() => { if (on) setSnap(null); });
    return () => { on = false; };
  }, [vault, pub, account, block, key]);

  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick(n => n + 1), 2_000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (net.id !== 143) { setQuote(null); setQuoting(false); return; }
    let wei = 0n;
    try { wei = parseEther(amount || '0'); } catch { setQuote(null); return; }
    if (wei <= 0n) { setQuote(null); setQuoting(false); return; }
    let on = true;
    setQuoting(true);
    setQuoteError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const worker = workerRef.current;
          const [uniRaw, cakeRaw] = await ask(worker, net.rpc, forwardQuotes(wei));
          if (!on) return;
          const uni = decodeQuote(uniRaw);
          const cake = decodeQuote(cakeRaw);
          const choice = chooseSell(uni, cake);
          if (!choice) {
            setQuote({ amount: wei, uni, cake, sell: null, buy: null, usdc: 0n, back: 0n, profit: 0n, bounty: 0n, fee: 0n, poolCut: 0n, ok: false });
            return;
          }
          const [backRaw] = await ask(worker, net.rpc, [backQuote(choice.buy, choice.usdc)]);
          if (!on) return;
          const back = decodeQuote(backRaw);
          const cleared = clearsFloor(wei, back);
          setQuote({ amount: wei, uni, cake, sell: choice.sell, buy: choice.buy, usdc: choice.usdc, back, profit: cleared.profit, bounty: cleared.bounty, fee: cleared.fee, poolCut: cleared.pool, ok: cleared.ok });
        } catch (e) {
          if (!on) return;
          setQuote(null);
          setQuoteError(e instanceof Error ? e.message : 'Quote failed');
        } finally { if (on) setQuoting(false); }
      })();
    }, 200);
    return () => { on = false; window.clearTimeout(timer); };
  }, [amount, tick, net.id, net.rpc]);

  let wei = 0n;
  try { wei = parseEther(amount || '0'); } catch { wei = 0n; }
  const quoteForAmount = quote && quote.amount === wei ? quote : null;
  const gate = spreadGate({
    mainnet: net.id === 143, account: !!account, vault: !!vault, amount,
    pool: snap?.pool ?? 0n, walletBal: bal, quoting: quoting || (!!vault && !quoteForAmount && !quoteError),
    quoteOk: quoteForAmount ? quoteForAmount.ok : quoteError ? false : null,
  });

  const remember = (a: Address) => { if (key) localStorage.setItem(key, a); setVault(a); };
  const fail = (e: unknown) => {
    const text = explainSpread(e, plain(reasonOf(e)));
    setLine({ ok: false, text });
    toast(text, 'bad');
    if (auto) setAuto(false);
  };

  const go = async () => {
    if (gate.code === 'connect') { await need(); return; }
    if (!gate.ok || !account || !wallet) return;
    setBusy(true); setLine(null);
    const size = parseEther(amount);
    try {
      if (!vault) {
        const data = spreadDeployData(account);
        const gas = await pricedGas(pub, account, { data, value: size });
        const rc = await send(wallet, { data, value: size, gas });
        if (!rc.contractAddress) throw new Error('The pool address was missing from the receipt.');
        remember(rc.contractAddress);
        addLocal(net, { label: `Opened a spread pool with ${amount} MON`, kind: 'owner', tx: rc.transactionHash, from: account });
        const href = `${net.exp}/tx/${rc.transactionHash}`;
        setLine({ ok: true, text: `Opened ${short(rc.contractAddress)} with ${amount} MON.`, href });
        toast(<>Pool opened. <a className="underline" href={href} target="_blank" rel="noreferrer">View tx ↗</a></>, 'ok');
      } else {
        const q = quote && quote.amount === size ? quote : null;
        if (!q?.sell || !q.buy || !q.ok) throw new Error('That quote is no longer current.');
        const mins = minOuts(size, q.usdc, q.back);
        const data = spreadCaptureData(q.sell, q.buy, size, mins.minUsdc, mins.minWmon);
        const gas = await pricedGas(pub, account, { to: vault, data });
        const rc = await send(wallet, { to: vault, data, gas });
        addLocal(net, { label: `Round trip ${amount} MON via ${VENUES[q.sell].name} → ${VENUES[q.buy].name}`, kind: 'allowed', tx: rc.transactionHash, from: account });
        const href = `${net.exp}/tx/${rc.transactionHash}`;
        setLine({ ok: true, text: `Round trip submitted. The receipt is the result.`, href });
        toast(<>Submitted. <a className="underline" href={href} target="_blank" rel="noreferrer">View tx ↗</a></>, 'ok');
      }
      haptic(20);
    } catch (e) { fail(e); }
    setBusy(false);
  };

  useEffect(() => {
    if (!auto || busy || gate.code !== 'go' || block == null || !quoteForAmount?.ok) return;
    if (tried.current === block) return;
    tried.current = block;
    void go();
    // go is recreated each render; the block guard keeps this to one send per head.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, busy, gate.code, block, quoteForAmount?.ok]);

  const withdraw = async () => {
    if (!vault || !wallet || !account || !snap || snap.shares === 0n) return;
    if (!(await need())) return;
    setBusy(true); setLine(null);
    try {
      const data = spreadWithdrawData(snap.shares);
      const gas = await pricedGas(pub, account, { to: vault, data });
      const rc = await send(wallet, { to: vault, data, gas });
      addLocal(net, { label: 'Withdrew from the spread pool', kind: 'owner', tx: rc.transactionHash, from: account });
      const href = `${net.exp}/tx/${rc.transactionHash}`;
      setLine({ ok: true, text: 'Withdrew your shares to this wallet.', href });
      toast(<>Withdrawn. <a className="underline" href={href} target="_blank" rel="noreferrer">View tx ↗</a></>, 'ok');
    } catch (e) { fail(e); }
    setBusy(false);
  };

  const usePaste = async () => {
    if (!account) { await need(); return; }
    if (!isAddress(paste.trim())) { toast('Paste the pool address, starting with 0x.', 'bad'); return; }
    const a = getAddress(paste.trim());
    try { await pub.readContract({ address: a, abi: spreadAbi, functionName: 'minProfitBps' }); }
    catch { toast('That contract is not a PolicyPilot spread pool.', 'bad'); return; }
    remember(a); setPaste('');
    toast(`Using pool ${short(a)}.`, 'ok');
  };

  const button = gate.code === 'connect' ? 'Connect wallet' : gate.code === 'open' ? `Open pool · ${amount || '0'} MON` : gate.code === 'go' ? 'Submit round trip' : 'Waiting for a spread';

  return (
    <section data-testid="spread-desk" className="min-w-0 rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-200"><Radio className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white">Spread</h2>
          <p className="break-words text-xs text-zinc-400">This tab asks Uniswap v3 and PancakeSwap v3 every couple of seconds. A round trip is sent only when the quote clears a 0.05% floor and a rough gas cost. There is no promised rate.</p>
        </div>
      </div>

      <div data-testid="spread-quote" className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-300">
        <div className="flex min-w-0 justify-between gap-3"><span className="min-w-0">Uniswap</span><span className="shrink-0 font-mono">{quoteForAmount ? usdc(quoteForAmount.uni) : quoting ? '…' : '—'}</span></div>
        <div className="flex min-w-0 justify-between gap-3"><span className="min-w-0">PancakeSwap</span><span className="shrink-0 font-mono">{quoteForAmount ? usdc(quoteForAmount.cake) : quoting ? '…' : '—'}</span></div>
        <div className="flex min-w-0 justify-between gap-3"><span className="min-w-0 break-words">{quoteForAmount?.sell ? `Back via ${VENUES[quoteForAmount.buy!].name}` : 'Round trip'}</span><span className="shrink-0 font-mono">{quoteForAmount?.sell ? mon(quoteForAmount.back) : '—'}</span></div>
        <div className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 text-zinc-400">
          <span>Quoted profit {quoteForAmount ? mon(quoteForAmount.profit) : '—'}</span>
          <span>Caller 10% {quoteForAmount ? mon(quoteForAmount.bounty) : '—'}</span>
          <span>Pool 80% {quoteForAmount ? mon(quoteForAmount.poolCut) : '—'}</span>
          <span>Rough gas {mon(ROUGH_GAS_WEI)}</span>
        </div>
        {quoteError && <p className="break-words text-rose-300">{quoteError}</p>}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-[11px] text-zinc-400">
        <span className="rounded-full bg-black/30 px-2 py-1">Pool {mon(snap?.pool ?? 0n)}</span>
        <span className="rounded-full bg-black/30 px-2 py-1">Yours {mon(snap?.yours ?? 0n)}</span>
        <span className="rounded-full bg-black/30 px-2 py-1">Cap 1 MON</span>
        {vault && <span className="max-w-full break-all rounded-full bg-black/30 px-2 py-1 font-mono">{short(vault)}</span>}
      </div>

      <div className="mt-4 grid grid-cols-1 items-end gap-3 md:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-xs text-zinc-400">{vault ? 'Round trip (MON)' : 'Deposit (MON)'}
          <input data-testid="spread-amount" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setLine(null); }} className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/40 px-3 font-mono text-base text-white outline-none focus:border-monad" />
        </label>
        <div className="min-w-0">
          <div data-testid="spread-gate" data-code={gate.code} className={`mb-2 flex min-w-0 items-start gap-2 text-sm ${gate.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {gate.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0"><span className="font-mono text-xs">{gate.label}</span><span className="mt-0.5 block break-words text-[11px] text-zinc-400">{gate.detail}</span></span>
          </div>
          <Btn kind="pri" data-testid="spread-go" disabled={busy || (!gate.ok && gate.code !== 'connect')} onClick={() => void go()} className="h-14 w-full text-base">{busy ? 'Working…' : button}</Btn>
        </div>
      </div>

      <Switch testid="spread-auto" on={auto} disabled={!vault} onChange={v => { tried.current = null; setAuto(v); }} label="Auto-submit" sub="Off until you turn it on. One try per block. A rejection turns it off." />

      {snap && snap.shares > 0n && (
        <Btn kind="ghost" data-testid="spread-withdraw" disabled={busy} onClick={() => void withdraw()} className="mt-2 w-full">Withdraw {mon(snap.yours)} to this wallet</Btn>
      )}

      {line && <div data-testid="spread-receipt" className={`mt-3 break-words rounded-2xl border p-3 text-xs ${line.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-red-500/40 bg-red-500/10 text-red-100'}`}>{line.text}{line.href && <> <a className="underline" href={line.href} target="_blank" rel="noreferrer">tx ↗</a></>}</div>}

      <p className="mt-3 break-words text-[11px] text-zinc-500">10% of a successful profit pays the wallet that submitted the transaction. 10% goes to the wallet that opened the pool. The rest stays. The caller pays gas even when the transaction reverts. Anyone who knows the address can submit a round trip; they cannot withdraw your MON.</p>

      <form className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); void usePaste(); }}>
        <input data-testid="spread-address" value={paste} onChange={e => setPaste(e.target.value)} placeholder="Already opened one? Paste 0x…" className="min-h-11 w-full min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 font-mono text-xs outline-none focus:border-monad" />
        <Btn type="submit" kind="ghost" className="shrink-0">Use pool</Btn>
      </form>
    </section>
  );
}
