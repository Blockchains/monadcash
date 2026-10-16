#!/usr/bin/env node
// Hourly public read. Appends block, base fee, and the shMON unstake fee.
// It does not search for a route and it does not send a transaction.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/research/live.json');
const RPCS = ['https://rpc.monad.xyz', 'https://rpc-mainnet.monadinfra.com', 'https://rpc.ankr.com/monad_mainnet'];
const SHMON = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c';
const FEE_SELECTOR = '0x7710d4ff';
const MAX = 720;

async function rpc(method, params) {
  let last = 'no rpc';
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const body = await res.json();
      if (body.error) { last = `${url} ${body.error.message || 'error'}`; continue; }
      if (body.result == null) { last = `${url} empty`; continue; }
      return { url, result: body.result };
    } catch (err) {
      last = `${url} ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(last);
}

function percentFromRay(hex) {
  const ray = BigInt(hex);
  const scaled = (ray * 100000000n) / (10n ** 27n);
  const digits = scaled.toString().padStart(7, '0');
  const whole = digits.slice(0, -6);
  const frac = digits.slice(-6).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function gwei(hex) {
  const wei = BigInt(hex);
  const whole = wei / 1000000000n;
  const frac = (wei % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

const obs = { readAt: new Date().toISOString(), ok: false };
try {
  const block = await rpc('eth_blockNumber', []);
  const full = await rpc('eth_getBlockByNumber', [block.result, false]);
  const fee = await rpc('eth_call', [{ to: SHMON, data: FEE_SELECTOR }, 'latest']);
  const base = full.result.baseFeePerGas;
  obs.ok = true;
  obs.rpc = block.url;
  obs.block = Number(BigInt(block.result));
  obs.baseFeeWei = BigInt(base).toString();
  obs.baseFeeGwei = gwei(base);
  obs.shMonUnstakeFeeRay = BigInt(fee.result).toString();
  obs.shMonUnstakeFeePercent = percentFromRay(fee.result);
  obs.note = 'Public read of block, base fee, and shMON unstake fee. This line is not a route and it is not a profit.';
} catch (err) {
  obs.error = err instanceof Error ? err.message : String(err);
  obs.note = 'The public RPC did not return this read.';
}

mkdirSync(dirname(OUT), { recursive: true });
let doc = { schema: 'policypilot.tape.live.v1', observations: [] };
try { doc = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* first read */ }
if (!Array.isArray(doc.observations)) doc.observations = [];
const prev = doc.observations[doc.observations.length - 1];
if (obs.ok && prev && prev.ok && prev.block === obs.block && prev.shMonUnstakeFeeRay === obs.shMonUnstakeFeeRay) {
  console.log(`unchanged block ${obs.block}`);
  process.exit(0);
}
doc.schema = 'policypilot.tape.live.v1';
doc.observations.push(obs);
if (doc.observations.length > MAX) doc.observations = doc.observations.slice(-MAX);
writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(obs.ok ? `appended block ${obs.block} base ${obs.baseFeeGwei} gwei shMON ${obs.shMonUnstakeFeePercent}%` : `appended failure: ${obs.error}`);
