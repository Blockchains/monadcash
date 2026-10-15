/**
 * Runs eth_call quotes off the main thread.
 * The page decides whether a round trip clears the floor.
 * This file never reports an opportunity on its own.
 */
self.onmessage = async (event) => {
  const msg = event.data || {};
  if (!msg || !msg.rpc || !Array.isArray(msg.calls)) return;
  const rows = await Promise.all(msg.calls.map(async (c) => {
    const tx = { to: c.to, data: c.data };
    if (c.from) tx.from = c.from;
    if (c.value) tx.value = c.value;
    const params = [tx, 'latest'];
    if (msg.stateOverride) params.push(msg.stateOverride);
    try {
      const res = await fetch(msg.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params }),
      });
      const json = await res.json();
      if (!json.result) return { ok: false, error: (json.error && json.error.message) || 'quote failed' };
      return { ok: true, result: json.result };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }));
  self.postMessage({ id: msg.id, ok: true, rows });
};
