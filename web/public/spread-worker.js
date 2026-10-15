/**
 * Runs eth_call quotes off the main thread. The page decides whether a round trip
 * clears the floor. This file never reports an opportunity on its own.
 */
self.onmessage = async (event) => {
  const msg = event.data || {};
  if (!msg || !msg.rpc || !Array.isArray(msg.calls)) return;
  try {
    const rows = await Promise.all(msg.calls.map(async (c) => {
      const res = await fetch(msg.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }),
      });
      const json = await res.json();
      if (!json.result) throw new Error((json.error && json.error.message) || 'quote failed');
      return json.result;
    }));
    self.postMessage({ id: msg.id, ok: true, rows });
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
