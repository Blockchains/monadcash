import { parseAbiItem, type Address, type PublicClient } from 'viem';
import { DEPLOYMENT } from './monad';

export type Execution = { id: string; requestId: string; recipient: string; amount: bigint; totalSpent: bigint; blockNumber: number; timestamp: number; txHash: string };
export type PolicyEvent = { id: string; kind: string; detail: string; blockNumber: number; timestamp: number; txHash: string; logIndex: number };
export type Recipient = { id: string; allowed: boolean; updatedBlock: number };
export type PolicyState = { id: string; budget: bigint | null; perRequestLimit: bigint | null; paused: boolean | null; totalSpent: bigint; executions: number; lastBlock: number };
export type Feed = { mode: 'envio' | 'rpc'; state: PolicyState | null; executions: Execution[]; events: PolicyEvent[]; recipients: Recipient[] };

/** Envio HyperIndex GraphQL endpoint (local `envio dev` by default is http://localhost:8080/v1/graphql). Unset = RPC fallback. */
export const ENVIO_URL = process.env.NEXT_PUBLIC_ENVIO_URL || '';

const Q = `query { PolicyState(limit:1){ id budget perRequestLimit paused totalSpent executions lastBlock }
 Execution(order_by:{blockNumber:desc}, limit:50){ id requestId recipient amount totalSpent blockNumber timestamp txHash }
 PolicyEvent(order_by:[{blockNumber:desc},{logIndex:desc}], limit:50){ id kind detail blockNumber timestamp txHash logIndex }
 Recipient{ id allowed updatedBlock } }`;
const big = (v: unknown) => (v == null ? null : BigInt(v as string));

export async function fetchEnvio(url = ENVIO_URL): Promise<Feed> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: Q }) });
  const j = await r.json(); if (j.errors) throw new Error(j.errors[0].message);
  const s = j.data.PolicyState[0];
  return { mode: 'envio',
    state: s ? { ...s, budget: big(s.budget), perRequestLimit: big(s.perRequestLimit), totalSpent: BigInt(s.totalSpent) } : null,
    executions: j.data.Execution.map((e: any) => ({ ...e, amount: BigInt(e.amount), totalSpent: BigInt(e.totalSpent) })),
    events: j.data.PolicyEvent, recipients: j.data.Recipient };
}

const EV = {
  Executed: parseAbiItem('event Executed(bytes32 indexed requestId, address indexed recipient, uint256 amount, uint256 totalSpent)'),
  RecipientSet: parseAbiItem('event RecipientSet(address indexed recipient, bool allowed)'),
  PausedSet: parseAbiItem('event PausedSet(bool paused)'),
  BudgetSet: parseAbiItem('event BudgetSet(uint256 budget)'),
  PerRequestLimitSet: parseAbiItem('event PerRequestLimitSet(uint256 limit)'),
  ExecutorSet: parseAbiItem('event ExecutorSet(address indexed executor)'),
};

/** Fallback: read the same entities straight from RPC logs (chunked; Monad RPC caps eth_getLogs ranges). */
export async function fetchRpc(pc: PublicClient, addr: Address = DEPLOYMENT.policyPilot, from: bigint = DEPLOYMENT.deployBlock): Promise<Feed> {
  const to = await pc.getBlockNumber(); const logs: any[] = [];
  const STEP = 100n; const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += STEP) ranges.push([a, a + STEP - 1n > to ? to : a + STEP - 1n]);
  const getLogs = async (a: bigint, b: bigint) => {
    for (let t = 0; ; t++) {
      try { return await pc.getLogs({ address: addr, events: Object.values(EV), fromBlock: a, toBlock: b }); }
      catch (e) { if (t >= 5) throw e; await new Promise(r => setTimeout(r, 400 * 2 ** t)); } // public RPC rate limits (429): back off, never silently drop a range
    }
  };
  for (let i = 0; i < ranges.length; i += 4) {
    const batch = await Promise.all(ranges.slice(i, i + 4).map(([a, b]) => getLogs(a, b)));
    for (const l of batch) logs.push(...l);
  }
  const blocks = new Map<bigint, number>();
  await Promise.all([...new Set(logs.map(l => l.blockNumber as bigint))].map(async b => blocks.set(b, Number((await pc.getBlock({ blockNumber: b })).timestamp))));
  const executions: Execution[] = []; const events: PolicyEvent[] = []; const rec = new Map<string, Recipient>();
  for (const l of logs) {
    const base = { blockNumber: Number(l.blockNumber), timestamp: blocks.get(l.blockNumber) ?? 0, txHash: l.transactionHash, logIndex: l.logIndex };
    const a = l.args; let detail = '';
    if (l.eventName === 'Executed') { executions.push({ id: `${l.transactionHash}-${l.logIndex}`, requestId: a.requestId, recipient: a.recipient, amount: a.amount, totalSpent: a.totalSpent, ...base }); detail = `${a.recipient} ${a.amount}`; }
    if (l.eventName === 'RecipientSet') { rec.set(a.recipient.toLowerCase(), { id: a.recipient.toLowerCase(), allowed: a.allowed, updatedBlock: base.blockNumber }); detail = `${a.recipient} allowed=${a.allowed}`; }
    if (l.eventName === 'PausedSet') detail = `paused=${a.paused}`;
    if (l.eventName === 'BudgetSet') detail = `budget=${a.budget}`;
    if (l.eventName === 'PerRequestLimitSet') detail = `limit=${a.limit}`;
    if (l.eventName === 'ExecutorSet') detail = `${a.executor}`;
    events.push({ id: `${l.transactionHash}-${l.logIndex}`, kind: l.eventName, detail, ...base });
  }
  const byNewest = (x: { blockNumber: number; logIndex?: number }, y: { blockNumber: number; logIndex?: number }) => y.blockNumber - x.blockNumber || (y.logIndex ?? 0) - (x.logIndex ?? 0);
  executions.sort(byNewest); events.sort(byNewest);
  return { mode: 'rpc', state: null, executions, events, recipients: [...rec.values()] };
}

export async function fetchFeed(pc: PublicClient): Promise<Feed> {
  if (ENVIO_URL) { try { return await fetchEnvio(); } catch { /* fall back */ } }
  return fetchRpc(pc);
}
