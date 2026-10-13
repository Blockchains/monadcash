'use client';
import { useEffect, useState } from 'react';
import { formatEther, type Address, type PublicClient } from 'viem';
import { Card, Pill } from './ui';
import { vaultAbi, type Net } from '@/lib/vault';

type Agent = { id: string; name: string; emoji: string; about: string; vault: Address; agent: Address; perActionCapMON: string; allowed: number; blocked: number };
type Snap = { label: string; note: string; updatedAt: string; startedAt: string; totals: { allowed: number; blocked: number; ownerTxs: number; monConsumed?: string }; agents: Agent[]; recent: { ts: string; persona: string; actor: string; label: string; status: string; reason?: string; tx: string }[]; status: string };
type Live = Record<string, { nonce: number; bal: bigint; spent: bigint; paused: boolean }>;
const n4 = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const ago = (t: string) => { const s = Math.max(0, (Date.now() - Date.parse(t)) / 1000); return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

/** Team-operated demo agents. Kept visually and numerically separate from organic users. */
export default function ShowcaseAgents({ net, pub, base, totalVaults, extraTeamVaults = 0 }: { net: Net; pub: PublicClient; base: string; totalVaults?: number; extraTeamVaults?: number }) {
  const [snap, setSnap] = useState<Snap | null>(null); const [live, setLive] = useState<Live>({}); const [err, setErr] = useState(false);
  useEffect(() => { if (net.id !== 143) return; const RAW = 'https://raw.githubusercontent.com/Blockchains/policypilot-monad/main/web/public/showcase-agents-143.json'; // updated by the scheduled Actions runner
    const get = (u: string) => fetch(u, { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(r.status)));
    Promise.allSettled([get(RAW), get(`${base}/showcase-agents-143.json`)]).then(([a, b]) => { const xs = [a, b].filter(x => x.status === 'fulfilled').map(x => (x as PromiseFulfilledResult<Snap>).value); if (!xs.length) return setErr(true); setSnap(xs.sort((x, y) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt))[0]); }); }, [net.id, base]);
  useEffect(() => {
    if (!snap) return; let stop = false;
    const tick = async () => {
      const out: Live = {};
      await Promise.all(snap.agents.map(async a => {
        try {
          const [nonce, bal, spent, paused] = await Promise.all([pub.getTransactionCount({ address: a.agent }), pub.getBalance({ address: a.vault }), pub.readContract({ address: a.vault, abi: vaultAbi, functionName: 'totalSpent' }) as Promise<bigint>, pub.readContract({ address: a.vault, abi: vaultAbi, functionName: 'paused' }) as Promise<boolean>]);
          out[a.id] = { nonce, bal, spent, paused };
        } catch { /* rpc hiccup */ }
      }));
      if (!stop) setLive(out);
    };
    tick(); const t = setInterval(tick, 15000); return () => { stop = true; clearInterval(t); };
  }, [snap, pub]);
  if (net.id !== 143 || err || !snap) return null;
  const liveTx = Object.values(live).reduce((s, x) => s + x.nonce, 0);
  const team = snap.agents.length + extraTeamVaults;
  return (
    <section data-testid="showcase-agents" className="grid min-w-0 gap-3 rounded-3xl border border-amber-400/25 bg-amber-400/[0.04] p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-amber-100">PolicyPilot showcase agents (operated by the team)</h2>
        <Pill tone="zinc">{snap.status.startsWith('running') ? 'running' : 'stopped'}</Pill>
      </div>
      <p className="text-xs text-amber-100/70">{snap.note} Real Monad mainnet transactions. Counts below exclude organic users.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Team agent txs (live nonce)', String(liveTx || '–')], ['✅ Allowed', String(snap.totals.allowed)], ['⛔ Blocked on-chain', String(snap.totals.blocked)], ['Organic (non-team) vaults', totalVaults != null ? String(Math.max(0, totalVaults - team)) : '–']].map(([k, v]) => (
          <Card key={k} className="p-3"><div className="font-mono text-lg tabular-nums text-white">{v}</div><div className="text-[11px] leading-tight text-zinc-400">{k}</div></Card>))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {snap.agents.map(a => { const l = live[a.id]; return (
          <Card key={a.id} className="min-w-0 p-3">
            <div className="flex min-w-0 items-center gap-2"><span className="text-xl">{a.emoji}</span><span className="min-w-0 flex-1 truncate font-medium text-white">{a.name}</span><span className="shrink-0 text-xs text-zinc-400">{l ? `${l.nonce} txs` : '…'}</span></div>
            <p className="mt-1 text-xs text-zinc-400">{a.about}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-300"><span>✅ {a.allowed}</span><span>⛔ {a.blocked}</span><span>cap {a.perActionCapMON} MON</span>{l && <span>spent {n4(l.spent)} MON</span>}{l && <span>vault {n4(l.bal)} MON</span>}</div>
            <a className="mt-2 inline-flex min-h-11 items-center break-all font-mono text-[11px] text-violet-300 underline" href={`${net.exp}/address/${a.vault}`} target="_blank" rel="noreferrer">vault {a.vault} ↗</a>
          </Card>); })}
      </div>
      <details className="min-w-0">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-zinc-300">Latest team transactions · snapshot {ago(snap.updatedAt)}</summary>
        <ol className="mt-2 grid gap-1">
          {snap.recent.slice(0, 20).map(r => (
            <li key={r.tx} className="min-w-0"><a href={`${net.exp}/tx/${r.tx}`} target="_blank" rel="noreferrer" className={`block min-h-11 rounded-xl border px-3 py-2 text-xs ${r.status === 'blocked' ? 'border-red-500/25 text-red-100' : r.status === 'allowed' ? 'border-emerald-500/20 text-emerald-100' : 'border-white/10 text-zinc-300'}`}>
              <span className="break-words">{r.status === 'blocked' ? '⛔' : r.status === 'allowed' ? '✅' : '👤'} {r.label}</span>{r.reason && <span className="block break-words text-red-300/80">vault said: {r.reason}</span>}<span className="block text-zinc-500">{ago(r.ts)} ↗</span></a></li>))}
        </ol>
      </details>
    </section>
  );
}
