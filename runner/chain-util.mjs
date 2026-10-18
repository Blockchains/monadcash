// Shared robustness helpers for the box-free ops jobs (agent-refill, daily-sweep, watchdog).
// PolicyPilot showcase agents (operated by the team). ALPHA / UNAUDITED.
//  - rpcTransport(): viem fallback over several public Monad RPCs, each with retries/timeouts (RPCS env overrides)
//  - sendSafe(): explicit nonce management + stuck-tx replacement (same nonce, fees bumped 30% per attempt)
import { http, fallback, formatGwei } from 'viem';

export const DEFAULT_RPCS = ['https://rpc.monad.xyz', 'https://rpc1.monad.xyz', 'https://rpc3.monad.xyz', 'https://rpc-mainnet.monadinfra.com', 'https://rpc2.monad.xyz'];
export const rpcList = (E = process.env) => {
  const extra = (E.RPCS || E.RPC || '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set([...extra, ...DEFAULT_RPCS])];
};
export const rpcTransport = (urls = rpcList()) =>
  fallback(urls.map(u => http(u, { retryCount: 2, retryDelay: 700, timeout: 15_000 })), { rank: false, retryCount: 4, retryDelay: 1_000 });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = e => String(e?.shortMessage || e?.message || e).split('\n')[0].slice(0, 160);

/**
 * Send one tx with nonce management and stuck-tx replacement.
 *  - nonce = the account's *confirmed* count: if an older run left a tx pending at that nonce, this send replaces it
 *    (fees start 30% above the pending one's floor, so the node accepts the replacement)
 *  - if no receipt within waitMs, re-send the same nonce with fees x1.3 (up to `bumps` times)
 *  - every hash sent is tracked; whichever lands is returned. Throws if none lands.
 * opts.fees: { maxFeePerGas, maxPriorityFeePerGas } to override the initial fees (used by the stuck-tx test).
 */
export async function sendSafe({ pc, wc, tx, log = () => {}, waitMs = 45_000, bumps = 3, fees: f0, stuckMs = 20_000 }) {
  const from = wc.account.address;
  const count = tag => pc.getTransactionCount({ address: from, blockTag: tag });
  for (let restart = 0; restart < 3; restart++) {
    let [latest, pending] = await Promise.all([count('latest'), count('pending')]);
    // a pending tx may be a live showcase tx from the same key: give it stuckMs to land before calling it stuck
    const t0 = Date.now();
    while (pending > latest && Date.now() - t0 < stuckMs) { await sleep(2_000); [latest, pending] = await Promise.all([count('latest'), count('pending')]); }
    const nonce = latest, replacing = pending > latest;
    const est = await pc.estimateFeesPerGas();
    let maxFee = f0?.maxFeePerGas ?? est.maxFeePerGas, tip = f0?.maxPriorityFeePerGas ?? est.maxPriorityFeePerGas;
    if (replacing && !f0) { maxFee = maxFee * 13n / 10n; tip = tip * 13n / 10n; log(`nonce ${nonce}: ${pending - latest} tx(s) pending > ${stuckMs / 1000}s (stuck); replacing`); }
    const sent = []; let lost = false;
    for (let i = 0; i <= bumps && !lost; i++) {
      try {
        const hash = await wc.sendTransaction({ ...tx, nonce, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
        sent.push(hash); log(`sent nonce ${nonce} attempt ${i + 1} maxFee ${formatGwei(maxFee)} gwei: ${hash}`);
      } catch (e) {
        const m = short(e);
        if (/nonce too low|nonce.*(used|lower)/i.test(m) && sent.length === 0) { log(`nonce ${nonce} taken by another tx; re-reading nonce`); lost = true; break; }
        if (/already known|underpriced|replacement|fee too low|base fee|nonce too low/i.test(m)) log(`nonce ${nonce}: rejected (${m})`);
        else throw e;
      }
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        for (const h of sent) {
          const r = await pc.getTransactionReceipt({ hash: h }).catch(() => null);
          if (r) return { hash: h, receipt: r, attempts: i + 1, replaced: replacing || sent.length > 1, sent };
        }
        if ((await count('latest').catch(() => nonce)) > nonce) { // nonce consumed: ours, or a concurrent tx from the same key
          await sleep(3_000);
          for (const h of sent) { const r = await pc.getTransactionReceipt({ hash: h }).catch(() => null); if (r) return { hash: h, receipt: r, attempts: i + 1, replaced: replacing || sent.length > 1, sent }; }
          log(`nonce ${nonce} consumed by another tx; re-reading nonce`); lost = true; break;
        }
        await sleep(1_500);
      }
      if (lost) break;
      maxFee = maxFee * 13n / 10n; tip = tip * 13n / 10n;
      if (maxFee < est.maxFeePerGas) maxFee = est.maxFeePerGas * 13n / 10n; // a deliberately low first try must still clear base fee
      if (tip > maxFee) tip = maxFee;
      log(`nonce ${nonce}: no receipt after ${waitMs / 1000}s; replacing with fees x1.3`);
    }
    if (!lost) throw new Error(`nonce ${nonce}: no tx landed after ${bumps + 1} attempts (${sent.join(', ')})`);
  }
  throw new Error('nonce kept being taken by concurrent txs');
}
