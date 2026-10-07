import { mountRelease } from './render.js';
const host = document.getElementById('release-root');
async function request(url, input, method = 'POST') {
  let response;
  try { response = await fetch(url, input === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, ...(method === 'DELETE' ? {} : { body: JSON.stringify(input) }) }); }
  catch (error) {
    if (input !== undefined && url.endsWith('/delivery')) throw Object.assign(Error('Нет ответа от сервиса. Результат операции неизвестен; обновите релиз перед продолжением.'), { requiresRefresh: true });
    throw error;
  }
  if (!response.ok) { const result = await response.json(); throw Object.assign(Error(result.error || 'Операция не выполнена'), { status: response.status }); }
  return response;
}
const json = async (url, input) => (await request(url, input)).json();
const deliveryClient = {
  async load(id) {
    const [capabilities, connections, attempts] = await Promise.all([json('/api/delivery/capabilities'), json('/api/connections'), json(`/api/releases/${id}/delivery`)]);
    return { capabilities, connections, attempts };
  },
  createConnection: input => json('/api/connections', input),
  probeConnection: id => json(`/api/connections/${id}/probe`, {}),
  removeConnection: id => request(`/api/connections/${id}`, {}, 'DELETE'),
  async act(id, input) {
    try { await json(`/api/releases/${id}/delivery`, input); return await json(`/api/releases/${id}`); }
    catch (error) {
      if (!error.status) { error.requiresRefresh = true; error.message = 'Нет подтверждённого ответа от сервиса. Обновите релиз и проверьте состояние доставки перед продолжением.'; }
      throw error;
    }
  },
  refresh: id => json(`/api/releases/${id}`)
};
async function open(id) {
  const [projects, releases, release] = await Promise.all([json('/api/projects'), json('/api/releases'), id ? json('/api/releases/' + encodeURIComponent(id)) : null]);
  history.replaceState(null, '', id ? '/releases?id=' + encodeURIComponent(id) : '/releases');
  host.replaceChildren(mountRelease({ release, projects, releases, open, deliveryClient, loadSnapshots: id => json(`/api/projects/${encodeURIComponent(id)}/snapshots`), create: async input => { const next = await json('/api/releases', input); history.replaceState(null, '', '/releases?id=' + next.id); return next; }, change: (id, input) => json(`/api/releases/${id}/change`, input), preview: (id, path, side) => json(`/api/releases/${id}/preview?path=${encodeURIComponent(path)}&side=${side}`), download: async (id, revision) => {
    const blob = await (await request(`/api/releases/${id}/bundle`, { revision })).blob(), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'release-handoff.zip'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  } }));
}
open(new URL(location.href).searchParams.get('id')).catch(error => { host.textContent = error.message; });
