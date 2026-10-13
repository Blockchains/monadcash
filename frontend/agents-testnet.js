import { createPublicClient, createWalletClient, custom, http, parseAbi, parseUnits, formatUnits, parseEther, formatEther, keccak256, toHex, isAddress, getAddress, decodeErrorResult, encodeFunctionData } from 'https://esm.sh/viem@2.21.0';
import { generatePrivateKey, privateKeyToAccount } from 'https://esm.sh/viem@2.21.0/accounts';

const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const RPC = qs.get('rpc') || 'https://testnet-rpc.monad.xyz/';
const CHAIN_ID = 10143, CHAIN_HEX = '0x279f';
const EXP = 'https://testnet.monadexplorer.com';
const SHARED_TOKEN = '0xE2966C817267FC7E63362895Cf55C6cb2548b9E3';
const chain = { id: CHAIN_ID, name: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: 'Monad Explorer', url: EXP } }, testnet: true };
const pub = createPublicClient({ chain, transport: http(RPC) });
const ART = await (await fetch('artifacts.json')).json();
const pAbi = ART.policy.abi, tAbi = ART.token.abi;
const errAbi = pAbi.filter(x => x.type === 'error');
const AVATARS = ['🤖','🛒','✈️','🧾','🎮','🐶','🍕','💡','🚀','🎁','🏠','🧠'];
const STORE = 'ppm.agents.v1';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmt = v => Number(formatUnits(BigInt(v), 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const txLink = h => `<a href="${EXP}/tx/${h}" target="_blank" rel="noopener">view tx ↗</a>`;

// ---------- storage ----------
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };
const save = a => localStorage.setItem(STORE, JSON.stringify(a, (k, v) => k === '_state' ? undefined : typeof v === 'bigint' ? v.toString() : v));
let agents = load();
const upsert = ag => { const i = agents.findIndex(x => x.address.toLowerCase() === ag.address.toLowerCase()); i >= 0 ? agents[i] = ag : agents.unshift(ag); save(agents); };
const logAct = (ag, e) => { ag.activity = [{ ts: Date.now(), ...e }, ...(ag.activity || [])].slice(0, 50); upsert(ag); };

// ---------- toasts / theme ----------
function toast(msg, kind = '') { const d = document.createElement('div'); d.className = 'toast ' + kind; d.innerHTML = msg; $('toasts').append(d); setTimeout(() => d.remove(), 6000); }
const theme = localStorage.getItem('ppm.theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
document.documentElement.dataset.theme = theme;
$('themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('ppm.theme', t); };

// ---------- errors ----------
function reason(e) {
  let x = e;
  while (x) {
    const d = x.data?.data ?? x.data;
    if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) { try { const r = decodeErrorResult({ abi: errAbi, data: d }); return { name: r.errorName, args: r.args }; } catch {} }
    if (x.data?.errorName) return { name: x.data.errorName, args: x.data.args };
    x = x.cause;
  }
  const msg = e?.shortMessage || e?.message || String(e);
  if (/User (rejected|denied)|4001/i.test(msg) || e?.code === 4001) return { name: 'UserRejected' };
  if (/insufficient funds/i.test(msg)) return { name: 'InsufficientGas' };
  return { name: null, raw: msg.split('\n')[0] };
}
const FRIENDLY = {
  RecipientNotAllowed: a => `🚫 Blocked: ${short(a[0])} isn't on this agent's allowlist.`,
  PerRequestLimitExceeded: a => `🚫 Blocked: ${fmt(a[0])} mUSD is over the ${fmt(a[1])} mUSD per-payment cap.`,
  BudgetExceeded: a => `🚫 Blocked: only ${fmt(a[1])} mUSD of budget is left (you asked for ${fmt(a[0])}).`,
  RequestAlreadyExecuted: () => `🚫 Blocked: this memo has already been paid (replay protection).`,
  Paused: () => `⏸ Blocked: the agent is paused. Resume it first.`,
  NotExecutor: () => `🚫 Blocked: this key isn't the agent's executor.`,
  NotAdmin: () => `🚫 Only the agent's owner wallet can change its settings.`,
  ZeroAmount: () => `Amount must be greater than 0.`,
  UserRejected: () => `You cancelled the request in your wallet.`,
  InsufficientGas: () => `Not enough MON for gas. Top up from the <a href="https://faucet.monad.xyz" target="_blank">faucet</a>.`,
};
const friendly = r => r.name && FRIENDLY[r.name] ? FRIENDLY[r.name](r.args || []) : `Something went wrong: ${esc(r.raw || r.name)}`;

// ---------- wallet ----------
let wallet = null, account = null;
async function ensureChain() {
  const eth = window.ethereum;
  const cid = await eth.request({ method: 'eth_chainId' });
  if (parseInt(cid, 16) === CHAIN_ID) return;
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); }
  catch (e) {
    if (e.code === 4902 || /Unrecognized|not added/i.test(e.message || '')) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: ['https://testnet-rpc.monad.xyz/'], blockExplorerUrls: [EXP] }] });
    } else throw e;
  }
  const after = parseInt(await eth.request({ method: 'eth_chainId' }), 16);
  if (after !== CHAIN_ID) throw new Error(`Wallet is on chain ${after}. This app only works on Monad testnet (10143); mainnet and other chains are blocked.`);
}
async function connect() {
  if (!window.ethereum) { toast('No browser wallet found. Install <a href="https://metamask.io" target="_blank">MetaMask</a> (or similar), then reload.', 'bad'); return false; }
  try {
    const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await ensureChain();
    account = getAddress(a);
    wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
    const bal = await pub.getBalance({ address: account });
    $('connectBtn').textContent = `${short(account)} · ${Number(formatEther(bal)).toFixed(3)} MON`;
    $('ob1').classList.add('done'); if (bal > 0n) $('ob2').classList.add('done');
    if (bal === 0n) toast('Your wallet has 0 MON. Get some from the <a href="https://faucet.monad.xyz" target="_blank">Monad faucet</a>.', 'bad');
    window.ethereum.on?.('chainChanged', () => location.reload());
    window.ethereum.on?.('accountsChanged', () => location.reload());
    return true;
  } catch (e) { toast(friendly(reason(e)), 'bad'); return false; }
}
$('connectBtn').onclick = connect;
async function needWallet() { if (wallet) { await ensureChain(); return true; } return connect(); }

async function send(fn, label) {
  const hash = await fn();
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120000 });
  if (rc.status !== 'success') throw Object.assign(new Error(`${label} reverted`), { hash });
  return rc;
}
// gas estimate x1.2 (Monad charges by gas limit, so keep it tight)
async function gasFor(req) { const g = await pub.estimateGas(req); return g * 12n / 10n; }

// ---------- network badge ----------
(async () => { try { const [id, bn] = await Promise.all([pub.getChainId(), pub.getBlockNumber()]); $('netDot').className = 'dot ' + (id === CHAIN_ID ? 'ok' : 'bad'); $('netTxt').textContent = id === CHAIN_ID ? `Monad testnet live · block ${bn.toLocaleString()}` : `Wrong chain ${id}`; } catch { $('netDot').className = 'dot bad'; $('netTxt').textContent = 'Monad RPC unreachable'; } })();

// ---------- read agent state ----------
async function readAgent(addr) {
  const rd = (functionName, args = []) => pub.readContract({ address: addr, abi: pAbi, functionName, args });
  const [budget, cap, spent, paused, admin, executor, asset] = await Promise.all(['budget', 'perRequestLimit', 'totalSpent', 'paused', 'admin', 'executor', 'asset'].map(f => rd(f)));
  const funds = await pub.readContract({ address: asset, abi: tAbi, functionName: 'balanceOf', args: [addr] });
  return { budget, cap, spent, paused, admin, executor, asset, funds };
}

// ---------- render ----------
function ring(spent, budget) {
  const pct = budget > 0n ? Math.min(100, Number(spent * 1000n / budget) / 10) : 0, C = 2 * Math.PI * 44;
  return `<svg class="ring" viewBox="0 0 108 108"><defs><linearGradient id="gr"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#836ef9"/></linearGradient></defs>
  <circle class="bgc" cx="54" cy="54" r="44"/><circle class="fg" cx="54" cy="54" r="44" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/>
  <text x="54" y="56" text-anchor="middle">${pct.toFixed(0)}%</text><text class="sub" x="54" y="72" text-anchor="middle">budget used</text></svg>`;
}
const ICON = { create: '✨', pay: '💸', blocked: '🛡️', pause: '⏸', resume: '▶️', edit: '✏️', recipient: '📇', gas: '⛽', fund: '🪙', import: '📥', error: '⚠️' };
async function render() {
  const box = $('agents');
  if (!agents.length) { box.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🤖</div><h3>No agents yet</h3><p>Create your first agent. It gets its own spending rules on Monad testnet.</p><button class="btn pri" onclick="document.getElementById('createBtn').click()">＋ Create agent</button></div>`; return; }
  $('ob3').classList.add('done');
  box.innerHTML = agents.map(ag => `<div class="card agent" id="ag-${ag.address}">
    <div class="ahead"><div class="av">${esc(ag.avatar || '🤖')}</div><div style="flex:1;min-width:0"><h3>${esc(ag.name)}</h3><div class="muted small mono"><a href="${EXP}/address/${ag.address}" target="_blank" rel="noopener">${short(ag.address)} ↗</a></div></div><span class="badge" data-st>…</span></div>
    <div class="ringrow"><div data-ring>${ring(0n, 1n)}</div><div class="stats" data-stats><div>Loading…</div><div></div></div></div>
    <div class="acts">
      <button class="btn pri" data-a="pay">💸 Ask agent to pay</button>
      <button class="btn" data-a="pause">⏸ Pause</button>
      <button class="btn" data-a="edit">✏️ Edit</button>
    </div>
    <ul class="feed" data-feed>${(ag.activity || []).map(e => `<li><span class="ic">${ICON[e.type] || '•'}</span><span class="t">${e.text}<br><span class="muted small">${new Date(e.ts).toLocaleString()}</span></span>${e.tx ? txLink(e.tx) : ''}</li>`).join('') || '<li class="muted">No activity yet.</li>'}</ul>
    <div class="more"><span class="muted">Signer: ${ag.agentKey ? '🔑 agent key ' + short(ag.executor) : '👛 your wallet'}</span>${ag.agentKey ? `<button class="btn ghost small" data-a="export">Export key</button>` : ''}<button class="btn ghost small" data-a="refresh">↻ Refresh</button><button class="btn ghost small danger" data-a="forget">Remove from this browser</button></div>
  </div>`).join('');
  for (const ag of agents) refreshCard(ag);
}
async function refreshCard(ag) {
  const el = document.getElementById('ag-' + ag.address); if (!el) return;
  try {
    const s = await readAgent(ag.address);
    const gas = ag.agentKey ? await pub.getBalance({ address: s.executor }) : null;
    el.querySelector('[data-ring]').innerHTML = ring(s.spent, s.budget);
    const rem = s.budget > s.spent ? s.budget - s.spent : 0n;
    el.querySelector('[data-stats]').innerHTML = `<div>Spent</div><div><b>${fmt(s.spent)}</b> mUSD</div><div>Remaining</div><div><b>${fmt(rem)}</b> mUSD</div><div>Per payment</div><div>≤ ${fmt(s.cap)} mUSD</div><div>Funds held</div><div>${fmt(s.funds)} mUSD</div>${gas !== null ? `<div>Agent gas</div><div>${Number(formatEther(gas)).toFixed(4)} MON</div>` : ''}<div>Recipients</div><div>${(ag.recipients || []).length || '?'}</div>`;
    const st = el.querySelector('[data-st]'); st.textContent = s.paused ? 'Paused' : 'Active'; st.className = 'badge ' + (s.paused ? 'warn' : 'ok');
    const pb = el.querySelector('[data-a=pause]'); pb.textContent = s.paused ? '▶️ Resume' : '⏸ Pause'; pb.dataset.paused = s.paused ? '1' : '';
    ag._state = s;
  } catch (e) { el.querySelector('[data-stats]').innerHTML = `<div>Error</div><div>${esc(reason(e).raw || 'cannot read contract')}</div>`; }
}
$('agents').addEventListener('click', async ev => {
  const b = ev.target.closest('[data-a]'); if (!b) return;
  const card = b.closest('.agent'); const ag = agents.find(a => 'ag-' + a.address === card.id); if (!ag) return;
  const a = b.dataset.a;
  if (a === 'refresh') return refreshCard(ag);
  if (a === 'pay') return openPay(ag);
  if (a === 'edit') return openEdit(ag);
  if (a === 'export') { if (confirm('Show the agent private key? It is testnet-only, but anyone holding it can sign as this agent (still only within the on-chain limits).')) prompt('Agent key (testnet only). Copy it and keep it safe:', ag.agentKey); return; }
  if (a === 'forget') { if (confirm(`Remove "${ag.name}" from this browser? The on-chain contract stays. ${ag.agentKey ? 'The agent key will be DELETED unless you exported it.' : ''}`)) { agents = agents.filter(x => x !== ag); save(agents); render(); toast('Agent removed from this browser.'); } return; }
  if (a === 'pause') {
    if (!await needWallet()) return;
    const want = !b.dataset.paused; b.disabled = true;
    try { const rc = await send(() => wallet.writeContract({ address: ag.address, abi: pAbi, functionName: 'setPaused', args: [want] }), 'pause');
      logAct(ag, { type: want ? 'pause' : 'resume', text: want ? 'Agent paused' : 'Agent resumed', tx: rc.transactionHash }); toast(want ? '⏸ Agent paused' : '▶️ Agent resumed', 'ok'); render(); }
    catch (e) { toast(friendly(reason(e)), 'bad'); b.disabled = false; }
  }
});

// ---------- modals ----------
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; }));

// ---------- create wizard ----------
let W = {}, step = 1;
$('fAvs').innerHTML = AVATARS.map(a => `<button type="button" data-v="${a}">${a}</button>`).join('');
$('fAvs').onclick = e => { const b = e.target.closest('button'); if (!b) return; W.avatar = b.dataset.v; [...$('fAvs').children].forEach(x => x.classList.toggle('on', x === b)); };
$('fExec').onclick = e => { const b = e.target.closest('button'); if (!b) return; W.exec = b.dataset.v; [...$('fExec').children].forEach(x => x.classList.toggle('on', x === b));
  $('execHint').textContent = W.exec === 'agent' ? 'A fresh key is generated in this browser and stored locally. It\u2019s testnet-only, and you can export or delete it. The contract caps whatever it can spend. You\u2019ll send it a small amount of MON for gas.' : 'Your own wallet will sign every payment. Simpler, but you\u2019ll approve each one yourself.'; $('fGas').disabled = W.exec !== 'agent'; };
const renderR = () => $('fRList').innerHTML = W.recipients.map((r, i) => `<div><span class="mono">${r}</span><button data-i="${i}" title="remove">✕</button></div>`).join('') || '<p class="hint">No recipients yet. Add at least one.</p>';
$('fRList').onclick = e => { const b = e.target.closest('button'); if (b) { W.recipients.splice(+b.dataset.i, 1); renderR(); } };
const addR = v => { v = v.trim(); if (!isAddress(v)) return toast('That is not a valid address.', 'bad'); v = getAddress(v); if (!W.recipients.includes(v)) W.recipients.push(v); $('fRcpt').value = ''; renderR(); };
$('fAddR').onclick = () => addR($('fRcpt').value); $('fRcpt').onkeydown = e => { if (e.key === 'Enter') addR($('fRcpt').value); };
$('fSelf').onclick = async () => { if (await needWallet()) addR(account); };
function showStep(n) { step = n; document.querySelectorAll('#mCreate .pane').forEach(p => p.hidden = +p.dataset.p !== n); document.querySelectorAll('#mCreate .steps .s').forEach((s, i) => s.classList.toggle('on', i < n));
  $('fBack').style.visibility = n > 1 ? 'visible' : 'hidden'; $('fNext').textContent = n === 4 ? '🚀 Launch agent' : 'Next'; $('fNext').disabled = false;
  if (n === 4) { const own = $('fOwnToken').checked, n2 = W.recipients.length;
    const sigs = 1 + (own ? 1 : 0) + n2 + 1 + (W.exec === 'agent' && +$('fGas').value > 0 ? 1 : 0);
    $('fSummary').innerHTML = `<div>Agent</div><div>${esc(W.avatar)} ${esc($('fName').value)}</div><div>Signer</div><div>${W.exec === 'agent' ? '🔑 in-browser agent key' : '👛 your wallet'}</div><div>Budget</div><div>${esc($('fBudget').value)} mUSD</div><div>Per payment</div><div>≤ ${esc($('fCap').value)} mUSD</div><div>Recipients</div><div>${n2}</div><div>Token</div><div>${own ? 'your own new test token' : 'shared mUSD test token'}</div><div>Wallet prompts</div><div>${sigs} signatures (testnet gas only)</div>`;
    $('fProg').innerHTML = ''; } }
$('createBtn').onclick = async () => {
  W = { avatar: AVATARS[0], exec: 'agent', recipients: [] }; $('fName').value = ''; $('fAvs').children[0].classList.add('on'); [...$('fAvs').children].slice(1).forEach(x => x.classList.remove('on'));
  [...$('fExec').children].forEach((x, i) => x.classList.toggle('on', i === 0)); $('fGas').disabled = false; renderR(); bindNext(); showStep(1); $('mCreate').hidden = false; };
$('fBack').onclick = () => showStep(Math.max(1, step - 1));
$('fNext').onclick = async () => {
  if (step === 1) { if (!$('fName').value.trim()) return toast('Give your agent a name.', 'bad'); return showStep(2); }
  if (step === 2) { const b = +$('fBudget').value, c = +$('fCap').value; if (!(b > 0 && c > 0)) return toast('Budget and per-payment cap must be > 0.', 'bad'); if (c > b) return toast('The per-payment cap can\u2019t be more than the budget.', 'bad'); return showStep(3); }
  if (step === 3) { if (!W.recipients.length) return toast('Add at least one recipient.', 'bad'); return showStep(4); }
  if (step === 4) return launch();
};
function progItem(text) { const li = document.createElement('li'); li.className = 'run'; li.textContent = text; $('fProg').append(li); return { ok: h => { li.className = 'ok'; if (h) li.insertAdjacentHTML('beforeend', txLink(h)); }, err: m => { li.className = 'err'; li.insertAdjacentHTML('beforeend', ` – ${m}`); } }; }
async function launch() {
  $('fNext').disabled = true; $('fBack').style.visibility = 'hidden';
  if (!await needWallet()) { $('fNext').disabled = false; return; }
  const name = $('fName').value.trim(), budget = parseUnits(String($('fBudget').value), 18), cap = parseUnits(String($('fCap').value), 18);
  const own = $('fOwnToken').checked, gasTop = W.exec === 'agent' ? parseEther(String($('fGas').value || '0')) : 0n;
  let agentKey = null, executor = account;
  if (W.exec === 'agent') { agentKey = generatePrivateKey(); executor = privateKeyToAccount(agentKey).address; }
  // save a pending record early so the agent key is never lost if a later step fails
  const ag = { name, avatar: W.avatar, address: null, executor, agentKey, recipients: [...W.recipients], owner: account, activity: [], createdAt: Date.now() };
  const pendingKey = 'ppm.pending.' + Date.now(); if (agentKey) localStorage.setItem(pendingKey, JSON.stringify({ name, agentKey }));
  let p;
  try {
    let token = SHARED_TOKEN;
    if (own) { p = progItem('Deploying your test token…'); const rc = await send(() => wallet.deployContract({ abi: tAbi, bytecode: ART.token.bytecode }), 'token'); token = rc.contractAddress; p.ok(rc.transactionHash); }
    p = progItem('Deploying your agent\u2019s guardrail contract…');
    const rc = await send(() => wallet.deployContract({ abi: pAbi, bytecode: ART.policy.bytecode, args: [token, account, executor, cap, budget] }), 'policy');
    ag.address = rc.contractAddress; ag.token = token; p.ok(rc.transactionHash); localStorage.removeItem(pendingKey);
    logAct(ag, { type: 'create', text: `Agent created with a ${fmt(budget)} mUSD budget, ≤ ${fmt(cap)} per payment`, tx: rc.transactionHash });
    for (const r of W.recipients) { p = progItem(`Allowing ${short(r)}…`); const r2 = await send(() => wallet.writeContract({ address: ag.address, abi: pAbi, functionName: 'setRecipient', args: [r, true] }), 'recipient'); p.ok(r2.transactionHash); logAct(ag, { type: 'recipient', text: `Allowed ${short(r)}`, tx: r2.transactionHash }); }
    p = progItem(`Funding the policy with ${fmt(budget)} test mUSD…`);
    const r3 = await send(() => wallet.writeContract({ address: token, abi: tAbi, functionName: 'mint', args: [ag.address, budget] }), 'fund'); p.ok(r3.transactionHash); logAct(ag, { type: 'fund', text: `Funded with ${fmt(budget)} test mUSD`, tx: r3.transactionHash });
    if (gasTop > 0n) { p = progItem(`Sending ${formatEther(gasTop)} MON gas to the agent key…`); const r4 = await send(() => wallet.sendTransaction({ to: executor, value: gasTop }), 'gas'); p.ok(r4.transactionHash); logAct(ag, { type: 'gas', text: `Topped up agent gas: ${formatEther(gasTop)} MON`, tx: r4.transactionHash }); }
    toast(`🎉 ${esc(name)} is live on Monad testnet!`, 'ok');
    $('fNext').textContent = 'Done'; $('fNext').disabled = false; $('fNext').onclick = () => { $('mCreate').hidden = true; $('fNext').onclick = null; location.hash = ''; bindNext(); };
    render(); window.__lastAgent = ag.address;
  } catch (e) {
    p?.err(friendly(reason(e)));
    if (ag.address) { upsert(ag); render(); toast('The agent was created, but setup didn\u2019t finish. Use Edit to finish it.', 'bad'); }
    else toast(friendly(reason(e)), 'bad');
    $('fNext').textContent = 'Retry'; $('fNext').disabled = false; $('fNext').onclick = () => { $('fProg').innerHTML = ''; launch(); };
  }
}
const nextHandler = $('fNext').onclick; function bindNext() { $('fNext').onclick = nextHandler; }

// ---------- pay ----------
let PA = null;
function openPay(ag) { PA = ag; $('pName').textContent = ag.name; $('pTo').innerHTML = (ag.recipients || []).map(r => `<option>${r}</option>`).join(''); $('pToX').value = ''; $('pMemo').value = 'payment-' + Math.random().toString(36).slice(2, 7); $('pRes').hidden = true; $('pGo').disabled = false; $('mPay').hidden = false; }
$('pGo').onclick = async () => {
  const ag = PA, res = $('pRes'); res.hidden = false; res.className = 'res'; res.innerHTML = '⏳ Agent is checking its policy…'; $('pGo').disabled = true;
  try {
    const to = ($('pToX').value.trim() || $('pTo').value); if (!isAddress(to)) throw new Error('Invalid recipient address');
    const amount = parseUnits(String($('pAmt').value || '0'), 18), memo = $('pMemo').value.trim() || 'payment';
    const requestId = keccak256(toHex(`${ag.address}:${memo}`));
    let signer;
    if (ag.agentKey) { const acc = privateKeyToAccount(ag.agentKey); signer = createWalletClient({ account: acc, chain, transport: http(RPC) }); }
    else { if (!await needWallet()) throw new Error('Wallet not connected'); signer = wallet; }
    const args = [requestId, getAddress(to), amount];
    try { await pub.simulateContract({ address: ag.address, abi: pAbi, functionName: 'execute', args, account: signer.account }); }
    catch (e) { const r = reason(e); res.className = 'res bad'; res.innerHTML = `<div class="h">${friendly(r)}</div><p class="muted small">The on-chain policy refused it in a free simulation (eth_call), so nothing was sent and no gas was spent. Reason from the contract: <span class="mono">${esc(r.name || r.raw)}</span></p>`;
      logAct(ag, { type: 'blocked', text: `${friendly(r)} (${fmt(amount)} mUSD → ${short(to)}, memo “${esc(memo)}”)` }); render(); $('pGo').disabled = false; return; }
    res.innerHTML = '✍️ Policy OK. Agent is signing and sending…';
    const gas = await gasFor({ account: signer.account, to: ag.address, data: encodeFunctionData({ abi: pAbi, functionName: 'execute', args }) });
    const rc = await send(() => signer.writeContract({ address: ag.address, abi: pAbi, functionName: 'execute', args, gas }), 'execute');
    res.className = 'res ok'; res.innerHTML = `<div class="h">✅ Paid ${fmt(amount)} mUSD to ${short(to)}</div><p>Confirmed in block ${rc.blockNumber}. ${txLink(rc.transactionHash)}</p>`;
    logAct(ag, { type: 'pay', text: `Paid ${fmt(amount)} mUSD → ${short(to)} (memo “${esc(memo)}”)`, tx: rc.transactionHash }); toast(`💸 Paid ${fmt(amount)} mUSD`, 'ok'); render();
  } catch (e) { const r = reason(e); res.className = 'res bad'; res.innerHTML = `<div class="h">${friendly(r)}</div>`; logAct(ag, { type: 'error', text: friendly(r), tx: e.hash }); render(); }
  $('pGo').disabled = false;
};

// ---------- edit ----------
let EA = null;
function openEdit(ag) { EA = ag; const s = ag._state; $('eBudget').value = s ? formatUnits(s.budget, 18) : ''; $('eCap').value = s ? formatUnits(s.cap, 18) : ''; $('eRcpt').value = ''; $('eGas').value = ''; $('eFund').value = ''; $('eGas').disabled = !ag.agentKey; $('mEdit').hidden = false; }
$('eGo').onclick = async () => {
  const ag = EA, s = ag._state; if (!await needWallet()) return; $('eGo').disabled = true;
  try {
    if (s && account.toLowerCase() !== s.admin.toLowerCase()) throw Object.assign(new Error(''), { data: { errorName: 'NotAdmin' } });
    const nb = parseUnits(String($('eBudget').value || '0'), 18), nc = parseUnits(String($('eCap').value || '0'), 18);
    if (s && nb !== s.budget) { const rc = await send(() => wallet.writeContract({ address: ag.address, abi: pAbi, functionName: 'setBudget', args: [nb] }), 'budget'); logAct(ag, { type: 'edit', text: `Budget → ${fmt(nb)} mUSD`, tx: rc.transactionHash }); }
    if (s && nc !== s.cap) { const rc = await send(() => wallet.writeContract({ address: ag.address, abi: pAbi, functionName: 'setPerRequestLimit', args: [nc] }), 'cap'); logAct(ag, { type: 'edit', text: `Per-payment cap → ${fmt(nc)} mUSD`, tx: rc.transactionHash }); }
    const r = $('eRcpt').value.trim(); if (r) { if (!isAddress(r)) throw new Error('Invalid recipient'); const rc = await send(() => wallet.writeContract({ address: ag.address, abi: pAbi, functionName: 'setRecipient', args: [getAddress(r), true] }), 'recipient'); ag.recipients = [...new Set([...(ag.recipients || []), getAddress(r)])]; logAct(ag, { type: 'recipient', text: `Allowed ${short(r)}`, tx: rc.transactionHash }); }
    const g = +$('eGas').value; if (g > 0 && ag.agentKey) { const rc = await send(() => wallet.sendTransaction({ to: ag.executor, value: parseEther(String(g)) }), 'gas'); logAct(ag, { type: 'gas', text: `Topped up agent gas: ${g} MON`, tx: rc.transactionHash }); }
    const f = +$('eFund').value; if (f > 0) { const rc = await send(() => wallet.writeContract({ address: s.asset, abi: tAbi, functionName: 'mint', args: [ag.address, parseUnits(String(f), 18)] }), 'fund'); logAct(ag, { type: 'fund', text: `Funded with ${f} test mUSD`, tx: rc.transactionHash }); }
    toast('✅ Saved', 'ok'); $('mEdit').hidden = true; render();
  } catch (e) { toast(friendly(reason(e)), 'bad'); }
  $('eGo').disabled = false;
};

// ---------- import ----------
$('importBtn').onclick = () => { $('iAddr').value = ''; $('iKey').value = ''; $('mImport').hidden = false; };
$('iGo').onclick = async () => {
  const a = $('iAddr').value.trim(); if (!isAddress(a)) return toast('Invalid address', 'bad');
  try { const s = await readAgent(getAddress(a)); let key = $('iKey').value.trim() || null;
    if (key) { const ad = privateKeyToAccount(key).address; if (ad.toLowerCase() !== s.executor.toLowerCase()) return toast('That key is not this agent\u2019s executor.', 'bad'); }
    const isDemo = getAddress(a) === '0x583fDB6441a9bCE517CF5bb15b9dB7340BB57D4E';
    const ag = { name: isDemo ? 'Demo agent (read-only)' : 'Imported agent', avatar: '📥', address: getAddress(a), executor: s.executor, agentKey: key, recipients: [], owner: s.admin, activity: [] };
    logAct(ag, { type: 'import', text: `Imported. Policy: ${fmt(s.budget)} mUSD budget, ${fmt(s.spent)} spent${key ? '' : '. No agent key, so payments are signed by your wallet if it is the executor'}` });
    $('mImport').hidden = true; render(); toast('📥 Agent imported', 'ok');
  } catch (e) { toast('That address isn\u2019t a PolicyPilot contract on Monad testnet.', 'bad'); }
};

// recover agent keys from interrupted launches
for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('ppm.pending.')) toast(`A launch was interrupted. Its unused agent key is saved under localStorage “${k}”.`); }
render();
if (window.ethereum) window.ethereum.request({ method: 'eth_accounts' }).then(a => { if (a?.length) connect(); }).catch(() => {});
setInterval(() => agents.forEach(refreshCard), 20000);
window.__appReady = true;
