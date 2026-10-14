'use client';
import { useEffect, useRef, useState } from 'react';
import { formatEther, formatUnits, parseEther, type Address, type PublicClient, type WalletClient } from 'viem';
import { AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import { Btn } from './ui';
import { haptic } from '@/lib/wallets';
import { addLocal, factoryAbi, mon, plain, quoteAll, reasonOf, short, type Net, type VaultState } from '@/lib/vault';
import { buildSuper, SUPER_VAULTS, type SuperVault } from '@/lib/superVaults';

type RunAgent = (s: VaultState, kind: string, amount: bigint) => Promise<{ ok: boolean; msg: React.ReactNode; detail: string }>;

const ACTION: Record<SuperVault['id'], { kind: string; target: string; verb: string }> = {
  yield: { kind: 'kintsu', target: 'Kintsu', verb: 'Stake' },
  trader: { kind: 'bestswap', target: 'the best of Uniswap, PancakeSwap and Kuru', verb: 'Swap' },
  payments: { kind: 'pay', target: 'your wallet', verb: 'Pay yourself' },
};

const defaultAmount = (t: SuperVault) => t.playbook.find(s => /^\d/.test(s.amount))?.amount ?? String(t.cap);

function fits(s: VaultState, t: SuperVault) {
  return t.services.every(id => s.rules.includes(id));
}
function canSign(s: VaultState, account: Address | null) {
  return !!(s.key || (account && s.executor.toLowerCase() === account.toLowerCase()));
}

type Gate = { ok: boolean; code: string; label: string; detail: string };

/** Instant, in-memory check. The chain is asked only when the user dispatches. */
export function dispatchGate(o: {
  mainnet: boolean; account: boolean; mode: 'create' | 'run'; amount: string;
  cap: bigint; budget: bigint; spent: bigint; bal: bigint; paused: boolean; canSign: boolean;
}): Gate {
  let wei: bigint;
  try { wei = parseEther(o.amount || '0'); } catch { return { ok: false, code: 'amount', label: 'ENTER AN AMOUNT', detail: 'Use a MON amount such as 0.02.' }; }
  if (wei <= 0n) return { ok: false, code: 'amount', label: 'ENTER AN AMOUNT', detail: 'The action needs more than 0 MON.' };
  if (!o.mainnet) return { ok: false, code: 'net', label: 'MAINNET ONLY', detail: 'These presets call live Monad protocols. Switch the network to mainnet.' };
  if (wei > o.cap) return { ok: false, code: 'cap', label: 'EXCEEDS CAP', detail: `The per-action cap is ${mon(o.cap)}. Raise it only from custom rules.` };
  if (!o.account) return { ok: false, code: 'connect', label: 'CONNECT WALLET', detail: 'One wallet connection, then this button sends the transaction.' };
  if (o.mode === 'create') return { ok: true, code: 'create', label: 'READY TO CREATE', detail: 'One signature creates the vault, deposits MON, and makes your wallet the agent.' };
  if (o.paused) return { ok: false, code: 'paused', label: 'VAULT PAUSED', detail: 'Resume it from Agents, then come back. Nothing is sent while it is paused.' };
  if (o.spent + wei > o.budget) return { ok: false, code: 'budget', label: 'EXCEEDS BUDGET', detail: `${mon(o.budget - o.spent)} of the budget is left.` };
  if (wei > o.bal) return { ok: false, code: 'bal', label: 'NOT ENOUGH MON', detail: `This vault holds ${mon(o.bal)}. Deposit from Agents, or pick a smaller amount.` };
  if (!o.canSign) return { ok: true, code: 'sim', label: 'POLICY PASS', detail: 'This browser cannot sign for the agent, so Dispatch runs a free on-chain check and sends nothing.' };
  return { ok: true, code: 'go', label: 'PASSED — READY', detail: 'Inside the cap, the budget, and the vault balance. Dispatch sends one real transaction.' };
}

export default function FastDispatch({ net, pub, account, wallet, bal, vaults, need, send, runAgent, loadVaults, refreshHist, toast }: {
  net: Net; pub: PublicClient; account: Address | null; wallet: WalletClient | null; bal: bigint | null;
  vaults: VaultState[] | null; need: () => Promise<boolean>; send: (w: WalletClient, req: { to: Address; data?: `0x${string}`; value?: bigint }) => Promise<{ transactionHash: `0x${string}` }>;
  runAgent: RunAgent; loadVaults: () => Promise<void>; refreshHist: () => void; toast: (m: React.ReactNode, k?: 'ok' | 'bad' | 'info') => void;
}) {
  const [preset, setPreset] = useState<SuperVault>(SUPER_VAULTS[0]);
  const [vaultId, setVaultId] = useState<string>('new');
  const [amount, setAmount] = useState(defaultAmount(SUPER_VAULTS[0]));
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const [best, setBest] = useState<string | null>(null);
  const userPicked = useRef(false);
  const action = ACTION[preset.id];
  const matches = (vaults ?? []).filter(s => fits(s, preset));
  const selected = vaultId === 'new' ? null : matches.find(s => s.v.toLowerCase() === vaultId.toLowerCase()) ?? null;
  const mainnet = net.id === 143;

  useEffect(() => { userPicked.current = false; setAmount(defaultAmount(preset)); setLine(null); setBest(null); }, [preset.id]);
  useEffect(() => {
    if (userPicked.current) return;
    const ready = (vaults ?? []).filter(s => fits(s, preset) && !s.paused && s.bal > 0n).sort((a, b) => (a.bal > b.bal ? -1 : 1));
    setVaultId(ready[0]?.v ?? 'new');
  }, [preset.id, vaults]);

  useEffect(() => {
    if (preset.id !== 'trader' || !selected) { setBest(null); return; }
    let on = true;
    const t = setTimeout(() => {
      let wei = 0n; try { wei = parseEther(amount || '0'); } catch { return; }
      if (wei === 0n) return;
      quoteAll(pub, selected.v, wei).then(qs => {
        if (!on) return;
        const ok = qs.filter(q => q.out && q.out > 0n);
        const top = ok.reduce<(typeof ok)[number] | null>((a, b) => (!a || b.out! > a.out! ? b : a), null);
        setBest(top ? `${top.name} · ${Number(formatUnits(top.out!, 6)).toFixed(6)} USDC` : 'No venue quoted this amount');
      }).catch(() => on && setBest(null));
    }, 280);
    return () => { on = false; clearTimeout(t); };
  }, [preset.id, selected?.v, amount, pub]);

  const cap = selected ? selected.cap : parseEther(String(preset.cap));
  const gate = dispatchGate({
    mainnet, account: !!account, mode: selected ? 'run' : 'create', amount,
    cap, budget: selected?.budget ?? parseEther(String(preset.budget)), spent: selected?.spent ?? 0n,
    bal: selected?.bal ?? 0n, paused: !!selected?.paused, canSign: selected ? canSign(selected, account) : true,
  });

  const pickPreset = (t: SuperVault) => { haptic(); setPreset(t); };
  const pickVault = (id: string) => { haptic(); userPicked.current = true; setVaultId(id); setLine(null); };

  const create = async () => {
    if (!(await need()) || !account || !wallet) return;
    setBusy(true); setLine(null);
    try {
      let dep = parseEther(String(preset.deposit)); let shortDeposit = false;
      try {
        const [gc, td] = await Promise.all([
          pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'globalCap' }),
          pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'totalDeposited' }),
        ]) as [bigint, bigint];
        const room = gc > td ? gc - td : 0n;
        if (dep > room) { dep = room > parseEther('0.020001') ? room - parseEther('0.000001') : 0n; shortDeposit = true; }
      } catch { /* older factory */ }
      const c = buildSuper(preset, account, [], Number(formatEther(dep)));
      await pub.call({ account, to: net.factory, data: c.data, value: c.value });
      const rc = await send(wallet, { to: net.factory, data: c.data, value: c.value });
      addLocal(net, { label: `${preset.name} created${dep > 0n ? ` + ${formatEther(dep)} MON deposited` : ''} (1 tx)`, kind: 'owner', tx: rc.transactionHash, from: account });
      const list = await pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'vaultsOf', args: [account] }) as Address[];
      const v = list[list.length - 1];
      localStorage.setItem(`pp.super.${v.toLowerCase()}`, preset.id);
      await loadVaults(); refreshHist();
      setVaultId(v);
      setLine({ ok: true, text: `${preset.name} is live${dep > 0n ? ` with ${formatEther(dep)} MON` : ''}. Dispatch runs the first action.`, href: `${net.exp}/tx/${rc.transactionHash}` });
      if (shortDeposit) toast(dep === 0n ? 'The alpha deposit cap is full, so the vault was created empty. Deposit from Agents before dispatching.' : `Deposit was reduced to ${formatEther(dep)} MON to fit the alpha cap.`, 'info');
      haptic(20);
    } catch (e) { const text = plain(reasonOf(e)); setLine({ ok: false, text }); toast(text, 'bad'); }
    setBusy(false);
  };

  const go = async () => {
    if (!gate.ok || busy) return;
    if (gate.code === 'connect') { await need(); return; }
    if (gate.code === 'create') { await create(); return; }
    if (!selected) return;
    setBusy(true); setLine(null);
    try {
      const r = await runAgent(selected, action.kind, parseEther(amount));
      setLine({ ok: r.ok, text: r.detail });
      toast(r.msg, r.ok ? 'ok' : 'bad');
      if (r.ok) { await loadVaults(); refreshHist(); }
    } catch (e) { const text = plain(reasonOf(e)); setLine({ ok: false, text }); toast(text, 'bad'); }
    setBusy(false);
  };

  const button = gate.code === 'connect' ? 'Connect wallet' : gate.code === 'create' ? `Create vault · ${preset.deposit} MON` : gate.code === 'sim' ? 'Check policy' : '1-click dispatch';

  return (
    <section data-testid="fast-dispatch" className="min-w-0 rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-monad/20 text-violet-200"><Zap className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white">Three taps</h2>
          <p className="text-xs text-zinc-400">A preset, a vault, then one real action. No addresses to paste, and the request id is generated for you.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">1 · Preset</div>
          <div className="grid gap-2">
            {SUPER_VAULTS.map(t => {
              const on = preset.id === t.id;
              return (
                <button key={t.id} type="button" data-testid={`preset-${t.id}`} onClick={() => pickPreset(t)} className={`min-w-0 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${on ? 'border-monad bg-monad/10' : 'border-white/10 bg-white/[0.02]'}`}>
                  <div className="flex min-w-0 items-center gap-2"><span className="text-lg">{t.emoji}</span><span className="min-w-0 flex-1 truncate font-medium text-zinc-50">{t.name}</span></div>
                  <p className="mt-1 break-words text-xs text-zinc-400">{t.tagline}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-300"><span>Cap {t.cap} MON</span><span>Budget {t.budget} MON</span></div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">2 · Vault</div>
          <div className="grid max-h-80 gap-2 overflow-y-auto">
            <button type="button" data-testid="vault-new" onClick={() => pickVault('new')} className={`min-w-0 rounded-2xl border border-dashed p-3 text-left transition active:scale-[0.99] ${vaultId === 'new' ? 'border-monad bg-monad/10' : 'border-white/15 bg-white/[0.02]'}`}>
              <div className="font-medium text-zinc-50">New {preset.name}</div>
              <p className="mt-1 break-words text-xs text-zinc-400">Create and deposit {preset.deposit} MON in one transaction. Your wallet is the agent.</p>
            </button>
            {!account && <p className="text-xs text-zinc-500">Connect to see vaults you already own.</p>}
            {account && !vaults && <p className="text-xs text-zinc-500">Loading your vaults…</p>}
            {matches.map(s => {
              const on = selected?.v === s.v;
              const pct = s.budget > 0n ? Math.min(100, Number((s.spent * 1000n) / s.budget) / 10) : 0;
              const left = s.budget > s.spent ? s.budget - s.spent : 0n;
              const low = s.budget > 0n && left * 5n < s.budget;
              const dot = s.paused ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' : low ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24]' : 'bg-emerald-400 shadow-[0_0_10px_#34d399]';
              return (
                <button key={s.v} type="button" data-testid="vault-choice" onClick={() => pickVault(s.v)} className={`min-w-0 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${on ? 'border-monad bg-monad/10' : 'border-white/10 bg-white/[0.02]'}`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-50">Vault {short(s.v)}</span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-300">{mon(s.bal)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-1 flex min-w-0 justify-between gap-2 text-[11px] text-zinc-500"><span className="min-w-0 truncate">{mon(left)} budget left</span><span className="shrink-0">{s.paused ? 'Paused' : low ? 'Low' : 'Live'}</span></div>
                </button>
              );
            })}
            {account && vaults && !matches.length && <p className="text-xs text-zinc-500">None of your vaults have this preset’s services. Create one above.</p>}
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">3 · Dispatch</div>
          <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="break-words text-sm text-zinc-200">{action.verb} on {action.target}</div>
            <label className="grid gap-1 text-xs text-zinc-400">Amount (MON)
              <input data-testid="dispatch-amount" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setLine(null); }} className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/40 px-3 font-mono text-base text-white outline-none focus:border-monad" />
            </label>
            <div className="text-[11px] text-zinc-500">Cap {mon(cap)} · budget {selected ? mon(selected.budget) : `${preset.budget} MON`}</div>
            {best && <div data-testid="dispatch-quote" className="break-words text-xs text-emerald-200">Best quote: {best}</div>}
            <div data-testid="dispatch-gate" data-code={gate.code} className={`flex min-w-0 items-start gap-2 rounded-xl px-1 text-sm ${gate.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {gate.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="min-w-0"><span className="font-mono text-xs">{gate.label}</span><span className="mt-0.5 block break-words text-[11px] text-zinc-400">{gate.detail}</span></span>
            </div>
            {bal != null && account && vaultId === 'new' && bal < parseEther(String(preset.deposit)) && <p className="break-words text-[11px] text-amber-200">Your wallet has {mon(bal)}. Creating this vault deposits {preset.deposit} MON.</p>}
            <Btn kind="pri" data-testid="dispatch-go" disabled={busy || (!gate.ok && gate.code !== 'connect')} onClick={go} className="mt-auto h-14 w-full text-base">{busy ? 'Working…' : button}</Btn>
          </div>
          {line && <div data-testid="dispatch-receipt" className={`mt-3 break-words rounded-2xl border p-3 text-xs ${line.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-red-500/40 bg-red-500/10 text-red-100'}`}>{line.text}{line.href && <> <a className="underline" href={line.href} target="_blank" rel="noreferrer">tx ↗</a></>}</div>}
        </div>
      </div>
    </section>
  );
}
