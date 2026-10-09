// The URL captures the exact Solution/handoff pair. Execution identity comes from
// the authenticated session; shared content IDs never enter the legacy API.
export function solutionDeliveryClient(solutionId, request) {
  const handoff = id => `/api/solutions/${encodeURIComponent(solutionId)}/handoffs/${encodeURIComponent(id)}`;
  return {
    async load(id) {
      const [capabilities, connections, attempts, bridges] = await Promise.all([
        request('/api/delivery/capabilities'), request('/api/connections'),
        request(handoff(id) + '/delivery'), request('/api/bridges')
      ]);
      return { capabilities, connections, attempts, bridges };
    },
    createConnection: input => request('/api/connections', input),
    probeConnection: id => request(`/api/connections/${encodeURIComponent(id)}/probe`, {}),
    removeConnection: id => request(`/api/connections/${encodeURIComponent(id)}`, {}, false, 'DELETE'),
    createBridge: input => request('/api/bridges', input),
    removeBridge: id => request(`/api/bridges/${encodeURIComponent(id)}`, {}, false, 'DELETE'),
    async act(id, input) {
      try { await request(handoff(id) + '/delivery', input); }
      catch (error) {
        // A refused reservation is a known non-dispatch, not a stale review.
        error.recoverable = error.status === 409 && /На этом Target уже есть незавершённая доставка/.test(error.message);
        throw error;
      }
      // A failed subsequent read is also an unknown response: never replay a write.
      try { return await request(handoff(id)); }
      catch (error) { error.requiresRefresh = true; throw error; }
    },
    refresh: id => request(handoff(id))
  };
}
