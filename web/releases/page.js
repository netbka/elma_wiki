import { mountRelease } from './render.js';
const host = document.getElementById('release-root');
async function request(url, input) {
  const response = await fetch(url, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, body: JSON.stringify(input) });
  if (!response.ok) { const result = await response.json(); throw Object.assign(Error(result.error || 'Операция не выполнена'), { status: response.status }); }
  return response;
}
const json = async (url, input) => (await request(url, input)).json();
async function open(id) {
  const [projects, releases, release] = await Promise.all([json('/api/projects'), json('/api/releases'), id ? json('/api/releases/' + encodeURIComponent(id)) : null]);
  history.replaceState(null, '', id ? '/releases?id=' + encodeURIComponent(id) : '/releases');
  host.replaceChildren(mountRelease({ release, projects, releases, open, create: async input => { const next = await json('/api/releases', input); history.replaceState(null, '', '/releases?id=' + next.id); return next; }, change: (id, input) => json(`/api/releases/${id}/change`, input), preview: (id, path, side) => json(`/api/releases/${id}/preview?path=${encodeURIComponent(path)}&side=${side}`), download: async (id, revision) => {
    const blob = await (await request(`/api/releases/${id}/bundle`, { revision })).blob(), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'release-handoff.zip'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  } }));
}
open(new URL(location.href).searchParams.get('id')).catch(error => { host.textContent = error.message; });
