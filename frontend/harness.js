import { createPublicClient, createWalletClient, custom, http, parseAbi, parseEther, formatEther, formatUnits, encodeFunctionData, decodeFunctionData, decodeErrorResult, keccak256, toHex, toFunctionSelector, isAddress, getAddress } from 'https://esm.sh/viem@2.21.0';
import { generatePrivateKey, privateKeyToAccount } from 'https://esm.sh/viem@2.21.0/accounts';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const qs = new URLSearchParams(location.search);
const NETS = {
  143: { id: 143, name: 'Mainnet', hex: '0x8f', rpc: 'https://rpc.monad.xyz', exp: 'https://monadvision.com', factory: '0x8738B74778502ff3623A8319837A819d8dBdEeB7', addRpc: 'https://rpc.monad.xyz' },
  10143: { id: 10143, name: 'Testnet', hex: '0x279f', rpc: 'https://testnet-rpc.monad.xyz/', exp: 'https://testnet.monadexplorer.com', factory: '0x2E40E06C0B864caF87cCB00f31e6EE2d0689cDd7', addRpc: 'https://testnet-rpc.monad.xyz/', faucet: 'https://faucet.monad.xyz' },
};
let NETID = Number(qs.get('net') === 'testnet' ? 10143 : qs.get('net') === 'mainnet' ? 143 : localStorage.getItem('pp.net') || 143);
if (!NETS[NETID]) NETID = 143;
const N = NETS[NETID]; if (qs.get('rpc')) N.rpc = qs.get('rpc'); if (qs.get('factory')) N.factory = qs.get('factory');
const chain = { id: N.id, name: 'Monad ' + N.name, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [N.rpc] } }, blockExplorers: { default: { name: 'Explorer', url: N.exp } } };
const pub = createPublicClient({ chain, transport: http(N.rpc, { batch: false, retryCount: 4, retryDelay: 400 }) });
const [ART, REGALL] = await Promise.all([fetch('vault-artifacts.json').then(r => r.json()), fetch('dapps.json').then(r => r.json())]);
const REG = REGALL[String(NETID)] || { dapps: [], tokens: {} };
const fAbi = ART.factory.abi, vAbi = ART.vault.abi, errAbi = vAbi.filter(x => x.type === 'error');
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const routerAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const wmonAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256)']);
const kintsuAbi = parseAbi(['function deposit(uint96 minShares,address receiver) payable returns (uint96)']);
const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)']);
const QUOTER = '0x661e93cca42afacb172121ef892830ca3b70f08d';
const ZERO = '0x0000000000000000000000000000000000000000';
const NONE = { approveToken: ZERO, approveAmount: 0n, outToken: ZERO, minOut: 0n };
const mon = v => `${Number(formatEther(BigInt(v))).toLocaleString(undefined, { maximumFractionDigits: 4 })} MON`;
const txUrl = h => `${N.exp}/tx/${h}`, adUrl = a => `${N.exp}/address/${a}`;

// ---------- chrome ----------
document.documentElement.dataset.theme = localStorage.getItem('ppm.theme') || 'dark';
$('themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('ppm.theme', t); };
$(NETID === 143 ? 'nMain' : 'nTest').classList.add('on');
document.querySelectorAll('.netsw button').forEach(b => b.onclick = () => { localStorage.setItem('pp.net', b.dataset.net); const u = new URL(location); u.searchParams.set('net', b.dataset.net === '143' ? 'mainnet' : 'testnet'); location = u; });
$('alphaNet').textContent = NETID === 143 ? 'You are on Monad MAINNET (real MON).' : 'You are on Monad testnet (free test MON).';
$('hzNet').textContent = `on Monad ${N.name} · factory ${short(N.factory)}`;
$('foot').innerHTML = `Factory <a href="${adUrl(N.factory)}" target="_blank" rel="noopener" class="mono">${N.factory}</a> on Monad ${N.name} (Sourcify-verified). No owner, no admin, no upgrades: only a vault's owner can move its funds. Vault cap 1 MON. <b>Alpha, unaudited.</b> <a href="https://github.com/Blockchains/policypilot-monad">Source</a>. Every number on this page is read live from the chain; nothing is simulated unless it's labelled "simulated".`;
function toast(msg, kind = '') { const d = document.createElement('div'); d.className = 'toast ' + kind; d.innerHTML = msg; $('toasts').append(d); setTimeout(() => d.remove(), 6500); }
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; }));

// ---------- reasons ----------
const PLAIN = {
  PerPaymentCapExceeded: a => `Over the per-action cap: tried ${mon(a[0])}, but the cap is ${mon(a[1])}.`,
  BudgetExceeded: a => `Over budget: tried ${mon(a[0])}, only ${mon(a[1])} left.`,
  RecipientNotAllowed: a => `${short(a[0])} isn't an approved payee.`,
  CallNotAllowed: a => `${dappName(a[0])} → ${selName(a[1])} isn't an approved dapp action.`,
  RecipientMustBeVault: a => `Tried to send the output to ${short(a[0])} instead of back to the vault.`,
  TokenCapExceeded: a => `Token approval of ${a[1]} is over the cap of ${a[2]}.`,
  MinOutNotMet: a => `Slippage guard: got ${a[0]}, needed at least ${a[1]}.`,
  RequestAlreadyExecuted: () => `Replay blocked: that request already ran.`,
  Paused: () => `The owner paused this agent.`, NotExecutor: () => `This key isn't the vault's agent.`, NotOwner: () => `Only the vault owner can do that.`,
  VaultCapExceeded: a => `Vault cap: the balance would be ${mon(a[0])}, but the max is ${mon(a[1])}.`, GlobalCapExceeded: () => `The factory-wide alpha deposit cap is reached.`,
  InsufficientBalance: a => `The vault only holds ${mon(a[1])}.`, ForbiddenSelector: () => `Approve/transfer functions can never be allowlisted.`, ForbiddenTarget: () => `That address can't be a dapp target.`,
};
const decodeReason = d => { try { const r = decodeErrorResult({ abi: errAbi, data: d }); return { name: r.errorName, args: r.args }; } catch { return null; } };
function reasonOf(e) { let x = e; while (x) { const d = x.data?.data ?? x.data; if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) { const r = decodeReason(d); if (r) return r; } if (x.data?.errorName) return { name: x.data.errorName, args: x.data.args }; x = x.cause; }
  const m = e?.shortMessage || e?.message || String(e); if (e?.code === 4001 || /reject|denied/i.test(m)) return { name: 'UserRejected', raw: 'You cancelled in your wallet.' }; return { name: null, raw: m.split('\n')[0] }; }
const plain = r => r?.name && PLAIN[r.name] ? PLAIN[r.name](r.args || []) : (r?.raw || r?.name || 'Reverted');
function parseRecorded(s) { const m = /^(\w+)\((.*)\)$/.exec(s || ''); if (!m) return { name: null, raw: s }; const args = m[2] ? m[2].split(', ').map(x => /^\d+$/.test(x) ? BigInt(x) : x) : []; return { name: m[1], args }; }

// ---------- registry helpers ----------
const byAddr = {}; for (const d of REG.dapps) byAddr[d.address.toLowerCase()] = d;
for (const [sym, t] of Object.entries(REG.tokens || {})) if (!byAddr[t.address.toLowerCase()]) byAddr[t.address.toLowerCase()] = { name: sym, icon: '🪙', category: 'Token' };
const dappName = a => byAddr[String(a).toLowerCase()]?.name || short(a);
const SELS = {}; for (const d of REG.dapps) for (const r of d.rules) SELS[r.selector] = r.fn.split('(')[0]; SELS['0xa9059cbb'] = 'transfer';
const selName = s => SELS[String(s).toLowerCase()] || s;

// ---------- history ----------
const LOCAL = `pp.hist.${NETID}`;
const localHist = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; } };
const addLocal = e => { const h = localHist(); h.unshift({ ...e, ts: Date.now() }); localStorage.setItem(LOCAL, JSON.stringify(h.slice(0, 200), (k, v) => typeof v === 'bigint' ? v.toString() : v)); };
let EVENTS = [], FILTER = 'all';
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } })); return out; }
function classify(tx, step) {
  const ev = { tx: tx?.hash || step.tx, from: tx?.from || step.from, label: step.label, kind: step.kind, value: 0n, dapp: 'Owner', icon: '👤' };
  if (!tx) return ev;
  try {
    const f = decodeFunctionData({ abi: vAbi, data: tx.input });
    ev.fn = f.functionName;
    if (f.functionName === 'execute') { ev.dapp = 'Payout'; ev.icon = '💸'; ev.value = f.args[2]; ev.to = f.args[1]; }
    else if (f.functionName === 'executeCall') { const t = f.args[1]; const d = byAddr[t.toLowerCase()]; ev.dapp = d?.name || short(t); ev.icon = d?.icon || '🧩'; ev.value = f.args[2]; ev.target = t; ev.sel = f.args[3].slice(0, 10); }
    else { ev.dapp = 'Owner'; ev.icon = { setPaused: '⏸', emergencyWithdrawAll: '🧯', withdraw: '↩️', withdrawToken: '↩️', deposit: '📥' }[f.functionName] || '⚙️'; }
  } catch { try { const f = decodeFunctionData({ abi: fAbi, data: tx.input }); ev.fn = f.functionName; ev.dapp = 'Owner'; ev.icon = '🛡️'; ev.value = 0n; } catch { ev.fn = tx.input === '0x' ? 'transfer' : 'call'; ev.icon = '⛽'; } }
  return ev;
}
async function loadHistory() {
  let show = null; try { show = await (await fetch(`showcase-${NETID}.json`, { cache: 'no-store' })).json(); } catch {}
  const steps = [...(show?.steps || []).map(s => ({ ...s, src: 'showcase' })), ...localHist().map(s => ({ ...s, src: 'you' }))];
  $('hSrc').textContent = show ? `Live from chain: ${show.steps.length} showcase txs by vault ${short(show.vault)}${localHist().length ? ` + ${localHist().length} of yours` : ''}` : (localHist().length ? 'Your actions in this browser' : '');
  if (!steps.length) { $('timeline').innerHTML = `<li class="empty">No agent activity on ${N.name} yet. Put a harness on an agent below and its actions will show up here.</li>`; renderStats(); return; }
  const rows = await pool(steps, 3, async s => {
    if (!s.tx) return { ...s, simulated: true, status: 'blocked', value: s.value ? BigInt(s.value) : 0n, dapp: s.dapp || 'Payout', icon: s.icon || '🛡️' };
    const [tx, rc] = await Promise.all([pub.getTransaction({ hash: s.tx }), pub.getTransactionReceipt({ hash: s.tx })]);
    const ev = classify(tx, s); ev.block = rc.blockNumber; ev.status = rc.status === 'success' ? 'allowed' : 'blocked'; ev.gasUsed = rc.gasUsed; ev.fee = rc.gasUsed * rc.effectiveGasPrice; ev.src = s.src; ev.vault = tx.to;
    ev.reason = s.revertReason ? parseRecorded(s.revertReason) : null; ev.input = tx.input; ev.ownerOp = s.kind === 'owner';
    if (ev.ownerOp) ev.status = rc.status === 'success' ? 'owner' : 'blocked';
    return ev;
  });
  EVENTS = rows.filter(Boolean).sort((a, b) => Number((a.block || 0n) - (b.block || 0n)));
  renderFilters(); renderTimeline(); renderChart(); renderStats();
}
function renderFilters() {
  const dapps = [...new Set(EVENTS.filter(e => !e.ownerOp).map(e => e.dapp))];
  const opts = [['all', 'All'], ['allowed', '✅ Allowed'], ['blocked', '⛔ Blocked'], ['owner', '👤 Owner'], ...dapps.map(d => ['d:' + d, d])];
  $('filters').innerHTML = opts.map(([v, l]) => `<button data-f="${esc(v)}" class="${FILTER === v ? 'on' : ''}">${esc(l)}</button>`).join('');
  $('filters').onclick = e => { const b = e.target.closest('button'); if (!b) return; FILTER = b.dataset.f; renderFilters(); renderTimeline(); };
}
function renderTimeline() {
  const list = EVENTS.filter(e => FILTER === 'all' || (FILTER.startsWith('d:') ? e.dapp === FILTER.slice(2) : e.status === FILTER)).slice().reverse();
  $('timeline').innerHTML = list.map((e, i) => {
    const cls = e.status === 'allowed' ? 'ok' : e.status === 'blocked' ? 'bad' : 'own';
    const pill = e.simulated ? '<span class="pill sim">blocked · simulated, no tx</span>' : e.status === 'allowed' ? '<span class="pill ok">allowed ✓</span>' : e.status === 'blocked' ? '<span class="pill bad">blocked on-chain ✕</span>' : '<span class="pill">owner</span>';
    const why = e.status === 'blocked' ? `<div class="why">🛡️ ${esc(plain(e.reason))}</div>` : '';
    let dec = ''; try { if (e.input) { const f = decodeFunctionData({ abi: vAbi, data: e.input }); dec = `${f.functionName}(${f.args.map(a => typeof a === 'object' && a !== null && !Array.isArray(a) ? JSON.stringify(a, (k, v) => typeof v === 'bigint' ? v.toString() : v) : typeof a === 'string' && a.length > 80 ? a.slice(0, 74) + '…' : String(a)).join(', ')})`; } } catch {}
    return `<li class="ev ${cls}" style="animation-delay:${Math.min(i, 20) * 40}ms" data-i="${i}">
      <div class="h"><span class="t">${e.icon} ${esc(e.label)}</span>${pill}</div>
      <div class="muted small">${esc(e.dapp)}${e.value ? ' · ' + mon(e.value) : ''}${e.block ? ' · block ' + e.block : ''}${e.src === 'you' ? ' · <b>you</b>' : ''}</div>${why}
      <div class="det">${e.tx ? `<div><b>Tx</b> <a href="${txUrl(e.tx)}" target="_blank" rel="noopener">${e.tx} ↗</a></div>` : ''}${e.vault ? `<div><b>Vault</b> <a href="${adUrl(e.vault)}" target="_blank" rel="noopener">${e.vault}</a></div>` : ''}
        ${e.from ? `<div><b>Signed by</b> ${e.from}</div>` : ''}${dec ? `<div><b>Decoded</b> <span class="mono">${esc(dec)}</span></div>` : ''}${e.reason ? `<div><b>Revert</b> <span class="mono">${esc(e.reason.name || e.reason.raw)}</span> (decoded with eth_call just before sending)</div>` : ''}
        ${e.fee !== undefined ? `<div><b>Gas</b> ${e.gasUsed} used · fee ${mon(e.fee)}</div>` : ''}</div></li>`;
  }).join('') || '<li class="empty">Nothing matches this filter.</li>';
  $('timeline').onclick = e => { const li = e.target.closest('li.ev'); if (li && !e.target.closest('a')) li.classList.toggle('open'); };
}
function renderChart() {
  const pts = EVENTS.filter(e => e.block && !e.ownerOp && e.status === 'allowed');
  const svg = $('chart'); if (!pts.length) { svg.innerHTML = '<text x="300" y="95" text-anchor="middle">No spend yet</text>'; $('perDapp').innerHTML = '<p class="muted small">No spend yet.</p>'; return; }
  let cum = 0n; const series = pts.map(e => { cum += e.value; return { b: Number(e.block), v: Number(formatEther(cum)), e }; });
  const blocked = EVENTS.filter(e => e.block && e.status === 'blocked');
  const b0 = Math.min(...EVENTS.filter(e => e.block).map(e => Number(e.block))), b1 = Math.max(...EVENTS.filter(e => e.block).map(e => Number(e.block))), vmax = Math.max(...series.map(s => s.v)) || 1;
  const X = b => 40 + (b1 === b0 ? 260 : (b - b0) / (b1 - b0) * 540), Y = v => 160 - v / vmax * 140;
  let d = `M${X(b0)},160`; for (const s of series) d += ` L${X(s.b)},${Y(s.v)}`;
  svg.innerHTML = `<defs><linearGradient id="cg"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#836ef9"/></linearGradient><linearGradient id="ca" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#836ef9" stop-opacity=".35"/><stop offset="1" stop-color="#836ef9" stop-opacity="0"/></linearGradient></defs>
   <line class="ax" x1="40" y1="160" x2="590" y2="160"/><line class="ax" x1="40" y1="15" x2="40" y2="160"/>
   <path class="ar" d="${d} L${X(series.at(-1).b)},160 Z"/><path class="ln" d="${d}"/>
   ${series.map(s => `<circle class="pt" cx="${X(s.b)}" cy="${Y(s.v)}" r="4"><title>${esc(s.e.label)}</title></circle>`).join('')}
   ${blocked.map(e => `<circle class="pb" cx="${X(Number(e.block))}" cy="160" r="4"><title>blocked: ${esc(e.label)}</title></circle>`).join('')}
   <text x="44" y="14">${vmax.toFixed(3)} MON</text><text x="40" y="176">block ${b0}</text><text x="590" y="176" text-anchor="end">${b1}</text>`;
  const per = {}; for (const e of EVENTS.filter(e => !e.ownerOp)) { const p = per[e.dapp] ||= { a: 0, b: 0, v: 0n, icon: e.icon }; e.status === 'allowed' ? (p.a++, p.v += e.value) : p.b++; }
  const mx = Math.max(...Object.values(per).map(p => p.a + p.b));
  $('perDapp').innerHTML = Object.entries(per).map(([k, p]) => `<div><div class="bl"><span>${p.icon} ${esc(k)}</span><span><span style="color:var(--ok)">${p.a}✓</span> <span style="color:var(--bad)">${p.b}✕</span> · ${mon(p.v)}</span></div><div class="bt"><div class="bf" style="width:${(p.a + p.b) / mx * 100}%"></div></div></div>`).join('');
}
async function renderStats() {
  const a = EVENTS.filter(e => e.status === 'allowed' && !e.ownerOp).length, b = EVENTS.filter(e => e.status === 'blocked').length;
  $('kAllowed').textContent = a; $('kBlocked').textContent = b;
  try {
    const n = await pub.readContract({ address: N.factory, abi: fAbi, functionName: 'vaultCount' }); $('kVaults').textContent = n.toString();
    const addrs = await pool([...Array(Math.min(Number(n), 40)).keys()], 3, i => pub.readContract({ address: N.factory, abi: fAbi, functionName: 'allVaults', args: [BigInt(i)] }));
    const bals = await pool(addrs.filter(Boolean), 3, v => pub.getBalance({ address: v }));
    $('kTvl').textContent = Number(formatEther(bals.filter(x => x != null).reduce((s, x) => s + x, 0n))).toFixed(4);
    $('kSrc').textContent = `Read live from factory ${short(N.factory)}${Number(n) > 40 ? ' (TVL covers the first 40 vaults)' : ''}. Allowed/blocked counts come from the history below.`;
  } catch (e) { $('kSrc').textContent = 'Could not read factory: ' + (e.shortMessage || e.message); }
}
(async () => { try { const [id, bn] = await Promise.all([pub.getChainId(), pub.getBlockNumber()]); $('netDot').className = 'dot ' + (id === N.id ? 'ok' : 'bad'); $('netTxt').textContent = `Monad ${N.name} live · block ${bn.toLocaleString()}`; } catch { $('netDot').className = 'dot bad'; $('netTxt').textContent = 'RPC unreachable'; } })();

// ---------- wallet ----------
let wallet = null, account = null;
async function ensureChain() {
  const eth = window.ethereum; const cid = parseInt(await eth.request({ method: 'eth_chainId' }), 16); if (cid === N.id) return;
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: N.hex }] }); }
  catch (e) { if (e.code === 4902 || /Unrecognized|not added/i.test(e.message || '')) await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: N.hex, chainName: 'Monad ' + (N.id === 143 ? '' : 'Testnet'), nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: [N.addRpc], blockExplorerUrls: [N.exp] }] }); else throw e; }
  if (parseInt(await eth.request({ method: 'eth_chainId' }), 16) !== N.id) throw new Error(`Switch your wallet to Monad ${N.name}.`);
}
async function connect() {
  if (!window.ethereum) { toast('No browser wallet found. Install MetaMask or another wallet.', 'bad'); return false; }
  try { const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' }); await ensureChain(); account = getAddress(a);
    wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
    const bal = await pub.getBalance({ address: account }); $('connectBtn').textContent = `${short(account)} · ${Number(formatEther(bal)).toFixed(3)} MON`;
    if (bal === 0n) toast(N.faucet ? `0 MON. Get test MON from the <a href="${N.faucet}" target="_blank">faucet</a>.` : 'Your wallet has 0 MON.', 'bad');
    window.ethereum.on?.('chainChanged', () => location.reload()); window.ethereum.on?.('accountsChanged', () => location.reload());
    loadVaults(); return true; } catch (e) { toast(esc(plain(reasonOf(e))), 'bad'); return false; }
}
$('connectBtn').onclick = connect;
const need = async () => wallet ? (await ensureChain(), true) : connect();
async function sendW(w, req, label) { const hash = await w.sendTransaction(req); const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180000 }); if (rc.status !== 'success') throw Object.assign(new Error(label + ' reverted'), { hash }); return rc; }

// ---------- harness wizard ----------
let agMode = 'new'; const rulesSel = new Set(REG.dapps.map(d => d.id)); const customRules = [];
$('agSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; agMode = b.dataset.v; [...$('agSeg').children].forEach(x => x.classList.toggle('on', x === b)); $('agAddr').hidden = agMode !== 'addr'; $('sGas').disabled = agMode === 'self'; upd(); };
$('dappCards').innerHTML = REG.dapps.map(d => `<div class="dcard on" data-id="${d.id}"><span class="ic">${d.icon}</span><div><div class="nm">${esc(d.name)}</div><div class="cat">${esc(d.category)} · <a href="${esc(d.source)}" target="_blank" rel="noopener">verified source ↗</a></div><div class="cat">${esc(d.blurb)}</div></div><span class="tg">✅</span></div>`).join('') + (REG.dapps.length ? '' : '<p class="muted small">No verified dapps on this network. Payouts to approved payees only.</p>') + (REG.notYetVerified?.length ? `<div class="unver">Not included (couldn't verify an official address): ${REG.notYetVerified.map(esc).join('; ')}</div>` : '');
$('dappCards').onclick = e => { if (e.target.closest('a')) return; const c = e.target.closest('.dcard'); if (!c) return; const id = c.dataset.id; rulesSel.has(id) ? rulesSel.delete(id) : rulesSel.add(id); c.classList.toggle('on', rulesSel.has(id)); c.querySelector('.tg').textContent = rulesSel.has(id) ? '✅' : '⬜'; upd(); };
$('cuAdd').onclick = () => { const a = $('cuAddr').value.trim(), s = $('cuSig').value.trim(); if (!isAddress(a)) return toast('Invalid contract address', 'bad'); let sel; try { sel = toFunctionSelector('function ' + s.replace(/^function\s+/, '')); } catch { return toast('Invalid function signature', 'bad'); }
  customRules.push({ target: getAddress(a), selector: sel, recipientWord: Number($('cuWord').value), fn: s }); $('cuList').innerHTML = customRules.map(c => `<div>🧩 ${short(c.target)} · ${esc(c.fn)} (${c.selector})</div>`).join(''); upd(); };
const sv = id => Number($(id).value);
function upd() {
  if (sv('sCap') > sv('sBud')) $('sCap').value = $('sBud').value;
  $('vDep').textContent = sv('sDep').toFixed(2) + ' MON'; $('vCap').textContent = sv('sCap').toFixed(3) + ' MON'; $('vBud').textContent = sv('sBud').toFixed(3) + ' MON'; $('vGas').textContent = sv('sGas').toFixed(2) + ' MON';
  const names = REG.dapps.filter(d => rulesSel.has(d.id)).map(d => d.name).concat(customRules.map(c => short(c.target)));
  $('preview').innerHTML = `Your agent can spend <b>at most ${sv('sCap').toFixed(3)} MON per action</b> and <b>${sv('sBud').toFixed(3)} MON in total</b>, ${names.length ? `only on <b>${names.map(esc).join(', ')}</b> or ` : 'only '}paying approved payees. Outputs always come back to the vault. You can pause it or pull everything back with one click.`;
}
['sDep', 'sCap', 'sBud', 'sGas'].forEach(id => $(id).oninput = upd); upd();
const prog = t => { const li = document.createElement('li'); li.className = 'run'; li.textContent = t; $('goProg').append(li); return { ok: h => { li.className = 'ok'; if (h) li.insertAdjacentHTML('beforeend', ` <a href="${txUrl(h)}" target="_blank" rel="noopener">tx ↗</a>`); }, err: m => { li.className = 'err'; li.insertAdjacentHTML('beforeend', ' – ' + esc(m)); } }; };
$('goBtn').onclick = async () => {
  if (!await need()) return; $('goBtn').disabled = true; $('goProg').innerHTML = '';
  let p;
  try {
    let exec = account, key = null;
    if (agMode === 'new') { key = generatePrivateKey(); exec = privateKeyToAccount(key).address; localStorage.setItem(`pp.agentkey.${exec.toLowerCase()}`, key); }
    else if (agMode === 'addr') { if (!isAddress($('agAddr').value.trim())) throw new Error('Paste a valid agent address'); exec = getAddress($('agAddr').value.trim()); }
    const payees = [account, ...$('payees').value.split(/[\s,]+/).filter(Boolean).map(a => { if (!isAddress(a)) throw new Error('Bad payee ' + a); return getAddress(a); })];
    const rules = [], caps = [];
    for (const d of REG.dapps.filter(d => rulesSel.has(d.id))) { for (const r of d.rules) rules.push({ target: d.address, selector: r.selector, recipientWord: r.recipientWord }); for (const c of d.tokenCaps) caps.push({ token: REG.tokens[c.token].address, cap: BigInt(c.cap) }); }
    for (const c of customRules) rules.push({ target: c.target, selector: c.selector, recipientWord: c.recipientWord });
    const args = [exec, parseEther(String(sv('sCap'))), parseEther(String(sv('sBud'))), [...new Set(payees)], rules, caps];
    const data = encodeFunctionData({ abi: fAbi, functionName: 'createVault', args }), value = parseEther(String(sv('sDep')));
    p = prog('Creating your vault with every rule baked in (1 signature)…');
    await pub.call({ account, to: N.factory, data, value }).catch(e => { throw e; });
    const rc = await sendW(wallet, { to: N.factory, data, value }, 'create'); p.ok(rc.transactionHash);
    addLocal({ label: 'Harness on: vault created with limits + dapps', kind: 'owner', tx: rc.transactionHash, from: account });
    if (key && sv('sGas') > 0) { p = prog(`Sending ${sv('sGas')} MON of gas to the agent key…`); const r2 = await sendW(wallet, { to: exec, value: parseEther(String(sv('sGas'))) }, 'gas'); p.ok(r2.transactionHash); addLocal({ label: 'Gas sent to agent key', kind: 'owner', tx: r2.transactionHash, from: account }); }
    toast('🛡️ Harness on! Your agent is live.', 'ok'); await loadVaults(); loadHistory(); location.hash = 'mine';
  } catch (e) { const r = reasonOf(e); p ? p.err(plain(r)) : toast(esc(plain(r)), 'bad'); }
  $('goBtn').disabled = false;
};

// ---------- my vaults ----------
let VAULTS = [];
async function readVault(v) {
  const rd = f => pub.readContract({ address: v, abi: vAbi, functionName: f });
  const [owner, executor, cap, budget, spent, paused, bal] = await Promise.all([rd('owner'), rd('executor'), rd('perPaymentCap'), rd('budget'), rd('totalSpent'), rd('paused'), pub.getBalance({ address: v })]);
  const agentBal = await pub.getBalance({ address: executor });
  const toks = {}; for (const [s, t] of Object.entries(REG.tokens || {})) toks[s] = await pub.readContract({ address: t.address, abi: erc20, functionName: 'balanceOf', args: [v] }).catch(() => 0n);
  return { v, owner, executor, cap, budget, spent, paused, bal, agentBal, toks, key: localStorage.getItem(`pp.agentkey.${executor.toLowerCase()}`) };
}
function ring(spent, budget) { const pct = budget > 0n ? Math.min(100, Number(spent * 1000n / budget) / 10) : 0, C = 2 * Math.PI * 44;
  return `<svg class="ring" viewBox="0 0 108 108"><defs><linearGradient id="gr"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#836ef9"/></linearGradient></defs><circle class="bgc" cx="54" cy="54" r="44"/><circle class="fg" cx="54" cy="54" r="44" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/><text x="54" y="56" text-anchor="middle">${pct.toFixed(0)}%</text><text class="sub" x="54" y="72" text-anchor="middle">budget used</text></svg>`; }
async function loadVaults() {
  if (!account) return; const box = $('vaults'); box.innerHTML = '<div class="muted">Loading your vaults from the factory…</div>';
  try {
    const list = await pub.readContract({ address: N.factory, abi: fAbi, functionName: 'vaultsOf', args: [account] });
    if (!list.length) { box.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🛡️</div><h3>No vaults yet on ${N.name}</h3><p>Put a harness on an agent above. It takes one transaction.</p></div>`; return; }
    VAULTS = await pool([...list].reverse(), 2, readVault);
    box.innerHTML = VAULTS.filter(Boolean).map((s, i) => { const has = d => REG.dapps.some(x => x.id === d);
      const tk = Object.entries(s.toks).filter(([, b]) => b > 0n).map(([k, b]) => `${Number(formatUnits(b, REG.tokens[k].decimals)).toFixed(6)} ${k}`).join(', ');
      return `<div class="card agent" data-i="${i}"><div class="ahead"><div class="av">🛡️</div><div style="flex:1;min-width:0"><h3>Vault ${short(s.v)}</h3><div class="muted small"><a href="${adUrl(s.v)}" target="_blank" rel="noopener">explorer ↗</a> · agent ${short(s.executor)}${s.key ? ' (key in this browser)' : s.executor === account ? ' (your wallet)' : ''}</div></div><span class="badge ${s.paused ? 'warn' : 'ok'}">${s.paused ? 'Paused' : 'Active'}</span></div>
      <div class="ringrow">${ring(s.spent, s.budget)}<div class="vstats"><div>In vault</div><div><b>${mon(s.bal)}</b></div><div>Spent</div><div>${mon(s.spent)} / ${mon(s.budget)}</div><div>Per action</div><div>≤ ${mon(s.cap)}</div><div>Agent gas</div><div>${mon(s.agentBal)}</div>${tk ? `<div>Tokens</div><div>${tk}</div>` : ''}</div></div>
      <div class="acts">
        <span class="sep">Agent actions${s.key || s.executor === account ? '' : ' (agent signs elsewhere: simulate only)'}</span>
        <button class="btn pri" data-a="pay">💸 Pay</button>${has('wmon') ? '<button class="btn" data-a="wrap">🎁 Wrap</button>' : ''}${has('uniswap') ? '<button class="btn" data-a="swap">🦄 Swap→USDC</button>' : ''}${has('kintsu') ? '<button class="btn" data-a="stake">🥩 Stake</button>' : ''}
        <button class="btn danger" data-a="break">😈 Try to break it</button>
        <span class="sep">Owner</span>
        <button class="btn" data-a="deposit">📥 Deposit</button><button class="btn" data-a="withdraw">↩️ Withdraw</button><button class="btn" data-a="pause">${s.paused ? '▶️ Resume' : '⏸ Pause'}</button><button class="btn danger" data-a="emergency">🧯 Pull everything back</button>${tk ? '<button class="btn" data-a="tokens">🪙 Withdraw tokens</button>' : ''}${s.key ? '<button class="btn ghost small" data-a="export">Export agent key</button>' : ''}
      </div></div>`; }).join('');
  } catch (e) { box.innerHTML = `<div class="empty">Couldn't load vaults: ${esc(e.shortMessage || e.message)}</div>`; }
}
$('reloadMine').onclick = loadVaults;
const agentWallet = s => s.key ? createWalletClient({ account: privateKeyToAccount(s.key), chain, transport: http(N.rpc) }) : (s.executor === account ? wallet : null);
async function agentDo(s, label, req, dapp, icon) {
  const w = agentWallet(s); const accFrom = w ? w.account.address ?? w.account : s.executor;
  try { await pub.call({ account: accFrom, ...req }); }
  catch (e) { const r = reasonOf(e); addLocal({ label: 'Blocked: ' + label, kind: 'blocked', dapp, icon, revertReason: r.name ? `${r.name}(${(r.args || []).map(String).join(', ')})` : r.raw, simulated: true, value: req.valueHint || 0n });
    return { ok: false, msg: `🛡️ Blocked by the vault: ${plain(r)} Nothing was sent and no gas was spent.` }; }
  if (!w) return { ok: true, msg: `✅ This would pass the policy. The agent ${short(s.executor)} has to sign it, and its key isn't in this browser.` };
  const g = (await pub.estimateGas({ account: accFrom, ...req })) * 13n / 10n;
  const rc = await sendW(w, { ...req, gas: g }, label); addLocal({ label, kind: 'allowed', tx: rc.transactionHash, from: accFrom });
  return { ok: true, msg: `✅ Done: ${esc(label)}. <a href="${txUrl(rc.transactionHash)}" target="_blank" rel="noopener">tx ↗</a>` };
}
const rid = t => keccak256(toHex(`${t}:${Date.now()}:${Math.random()}`));
const vc = (v, fn, args) => ({ to: v, data: encodeFunctionData({ abi: vAbi, functionName: fn, args }) });
function modal(title, body, go) { $('aTitle').textContent = title; $('aBody').innerHTML = body; $('aRes').hidden = true; $('mAct').hidden = false; $('aGo').disabled = false;
  $('aGo').onclick = async () => { $('aGo').disabled = true; const r = $('aRes'); r.hidden = false; r.className = 'res'; r.textContent = '⏳ Working…';
    try { const o = await go(); r.className = 'res ' + (o.ok ? 'ok' : 'bad'); r.innerHTML = o.msg; } catch (e) { r.className = 'res bad'; r.textContent = plain(reasonOf(e)); }
    $('aGo').disabled = false; loadVaults(); loadHistory(); }; }
const amt = (id, v) => `<label>Amount (MON)</label><input id="${id}" type="number" step="0.001" min="0" value="${v}">`;
$('vaults').addEventListener('click', async ev => {
  const b = ev.target.closest('[data-a]'); if (!b) return; const s = VAULTS[+b.closest('.agent').dataset.i]; const a = b.dataset.a, T = REG.tokens || {};
  const ownerTx = async (label, req) => { if (!await need()) throw new Error('Connect wallet'); const rc = await sendW(wallet, req, label); addLocal({ label, kind: 'owner', tx: rc.transactionHash, from: account }); return { ok: true, msg: `✅ ${esc(label)} <a href="${txUrl(rc.transactionHash)}" target="_blank">tx ↗</a>` }; };
  if (a === 'pay') modal('Agent pays', `<label>To (approved payee)</label><input id="x1" class="mono" value="${s.owner}">${amt('x2', '0.001')}`, () => { const v = parseEther($('x2').value); return agentDo(s, `Agent pays ${$('x2').value} MON to ${short($('x1').value)}`, { ...vc(s.v, 'execute', [rid('pay'), getAddress($('x1').value), v]), valueHint: v }, 'Payout', '💸'); });
  if (a === 'wrap') modal('Agent wraps MON → WMON', amt('x2', '0.001'), () => { const v = parseEther($('x2').value); return agentDo(s, `Agent wraps ${$('x2').value} MON → WMON`, { ...vc(s.v, 'executeCall', [rid('wrap'), T.WMON.address, v, encodeFunctionData({ abi: wmonAbi, functionName: 'deposit' }), { ...NONE, outToken: T.WMON.address, minOut: v }]), valueHint: v }, 'Wrapped MON', '🎁'); });
  if (a === 'swap') modal('Agent swaps MON → USDC (Uniswap v3)', amt('x2', '0.002') + '<p class="hint">Gets a live quote from Uniswap QuoterV2 and enforces minOut = quote − 3%. Output goes back to the vault.</p>', async () => { const v = parseEther($('x2').value);
    const q = await pub.simulateContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: T.WMON.address, tokenOut: T.USDC.address, amountIn: v, fee: 3000, sqrtPriceLimitX96: 0n }] }); const minOut = q.result[0] * 97n / 100n;
    const R = REG.dapps.find(d => d.id === 'uniswap').address;
    return agentDo(s, `Agent swaps ${$('x2').value} MON → USDC`, { ...vc(s.v, 'executeCall', [rid('swap'), R, v, encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: T.WMON.address, tokenOut: T.USDC.address, fee: 3000, recipient: s.v, amountIn: v, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }), { ...NONE, outToken: T.USDC.address, minOut }]), valueHint: v }, 'Uniswap v3', '🦄'); });
  if (a === 'stake') modal('Agent stakes MON with Kintsu', amt('x2', '0.001'), () => { const v = parseEther($('x2').value); const K = REG.dapps.find(d => d.id === 'kintsu').address;
    return agentDo(s, `Agent stakes ${$('x2').value} MON → sMON`, { ...vc(s.v, 'executeCall', [rid('stake'), K, v, encodeFunctionData({ abi: kintsuAbi, functionName: 'deposit', args: [1n, s.v] }), { ...NONE, outToken: T.sMON.address, minOut: 1n }]), valueHint: v }, 'Kintsu', '🥩'); });
  if (a === 'break') modal('😈 Try to break the harness', `<p>Pick an attack. It runs as a free simulation, so no gas is spent and nothing leaves the vault.</p><select id="x1"><option value="cap">Spend 2× the per-action cap</option><option value="stranger">Pay a stranger (0x…dEaD)</option>${T.USDC ? '<option value="drain">Move USDC out with transfer()</option><option value="self">Swap but send output to the agent</option>' : ''}<option value="withdraw">Agent withdraws the vault</option></select>`, () => {
    const k = $('x1').value, A = s.executor;
    if (k === 'cap') return agentDo(s, `Agent tries to spend ${formatEther(s.cap * 2n)} MON (2× cap)`, { ...vc(s.v, 'execute', [rid('b'), s.owner, s.cap * 2n]), valueHint: s.cap * 2n }, 'Payout', '💸');
    if (k === 'stranger') return agentDo(s, 'Agent tries to pay a stranger', vc(s.v, 'execute', [rid('b'), '0x000000000000000000000000000000000000dEaD', 1n]), 'Payout', '💸');
    if (k === 'drain') return agentDo(s, 'Agent tries USDC.transfer to itself', vc(s.v, 'executeCall', [rid('b'), T.USDC.address, 0n, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [A, 1n] }), NONE]), 'USDC', '🪙');
    if (k === 'self') { const R = REG.dapps.find(d => d.id === 'uniswap').address; return agentDo(s, 'Agent tries a swap that pays itself', vc(s.v, 'executeCall', [rid('b'), R, 1000n, encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: T.WMON.address, tokenOut: T.USDC.address, fee: 3000, recipient: A, amountIn: 1000n, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }), NONE]), 'Uniswap v3', '🦄'); }
    return agentDo(s, 'Agent tries to withdraw the vault', vc(s.v, 'withdraw', [A, 1n]), 'Owner-only', '🔒');
  });
  if (a === 'deposit') modal('Deposit MON', amt('x2', '0.05') + '<p class="hint">Max 1 MON per vault (alpha cap).</p>', () => ownerTx(`Deposit ${$('x2').value} MON`, { ...vc(s.v, 'deposit', []), value: parseEther($('x2').value) }));
  if (a === 'withdraw') modal('Withdraw MON', amt('x2', formatEther(s.bal)), () => ownerTx(`Withdraw ${$('x2').value} MON`, vc(s.v, 'withdraw', [account, parseEther($('x2').value)])));
  if (a === 'pause') { modal(s.paused ? 'Resume agent' : 'Pause agent', '<p>One signature from your wallet.</p>', () => ownerTx(s.paused ? 'Owner resumes the agent' : 'Owner pauses the agent', vc(s.v, 'setPaused', [!s.paused]))); }
  if (a === 'emergency') modal('Pull everything back', '<p>Pauses the agent and sends every MON in the vault to your wallet in one transaction.</p>', () => ownerTx('Owner pulls all MON back (emergency)', vc(s.v, 'emergencyWithdrawAll', [])));
  if (a === 'tokens') modal('Withdraw tokens', '<p>Sends every registry token the vault holds (USDC, WMON, sMON) to your wallet. One tx per token.</p>', async () => { let last; for (const [k, bal] of Object.entries(s.toks)) if (bal > 0n) last = await ownerTx(`Withdraw ${k}`, vc(s.v, 'withdrawToken', [T[k].address, account, bal])); return last || { ok: true, msg: 'Nothing to withdraw.' }; });
  if (a === 'export') { if (confirm('Show the agent key? Anyone holding it can act as this agent, though still only within the vault limits.')) prompt('Agent key:', s.key); }
});

loadHistory();
if (window.ethereum) window.ethereum.request({ method: 'eth_accounts' }).then(a => { if (a?.length) connect(); }).catch(() => {});
window.__harnessReady = true;
