import { mountRelease } from './render.js';
const host = document.getElementById('release-root');
async function request(url, input, method = 'POST') {
  const response = await fetch(url, input === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, ...(method === 'DELETE' ? {} : { body: JSON.stringify(input) }) });
  if (!response.ok) { const result = await response.json(); throw Object.assign(Error(result.error || 'Операция не выполнена'), { status: response.status }); }
  return response;
}
const json = async (url, input) => (await request(url, input)).json();
async function open(id) {
  const safeId = id ? encodeURIComponent(id) : null;
  const [projects, releases, release, connections, attempts, adapters, bridges] = await Promise.all([json('/api/projects'), json('/api/releases'), safeId ? json('/api/releases/' + safeId) : null,
    safeId ? json('/api/connections') : [], safeId ? json(`/api/releases/${safeId}/delivery`) : [], safeId ? json('/api/connections/adapters') : { adapters: [] }, safeId ? json('/api/bridges') : []]);
  history.replaceState(null, '', safeId ? '/releases?id=' + safeId : '/releases');
  const deliveryApi = { createConnection: input => json('/api/connections', input), probe: cid => json(`/api/connections/${cid}/probe`, {}), removeConnection: cid => request(`/api/connections/${cid}`, {}, 'DELETE'),
    createBridge: input => json('/api/bridges', input), removeBridge: bid => request(`/api/bridges/${bid}`, {}, 'DELETE'),
    prepare: input => json(`/api/releases/${safeId}/delivery`, { action: 'prepare', ...input }), confirm: (attemptId, input) => json(`/api/releases/${safeId}/delivery`, { action: 'confirm', attemptId, ...input }), verify: attemptId => json(`/api/releases/${safeId}/delivery`, { action: 'verify', attemptId }) };
  const delivery = release ? { connections, attempts, adapters: adapters.adapters, bridges, api: deliveryApi } : null;
  host.replaceChildren(mountRelease({ release, projects, releases, open, delivery, create: async input => { const next = await json('/api/releases', input); history.replaceState(null, '', '/releases?id=' + next.id); return next; }, change: (id, input) => json(`/api/releases/${id}/change`, input), preview: (id, path, side) => json(`/api/releases/${id}/preview?path=${encodeURIComponent(path)}&side=${side}`), download: async (id, revision) => {
    const blob = await (await request(`/api/releases/${id}/bundle`, { revision })).blob(), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'release-handoff.zip'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  } }));
}
open(new URL(location.href).searchParams.get('id')).catch(error => { host.textContent = error.message; });
