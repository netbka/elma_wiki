import { mountManagedWorkspace } from './render.js';
import { workspaceUrl } from './model.js';
const root = document.getElementById('managed-root'), query = new URLSearchParams(location.search);
const id = query.get('id'), view = query.get('view') || (id ? 'overview' : 'list'), artifact = query.get('artifact');
const shared = location.pathname === '/solutions', home = shared ? '/solutions' : '/workspaces';
const api = shared ? '/api/solutions' : '/api/managed-workspaces';
const href = (id, view, artifact) => workspaceUrl(id, view, artifact, home);
const config = { shared, home, api };
async function request(url, input, upload) {
  let response;
  try {
    response = await fetch(url, input === undefined ? {} : { method: 'POST', headers: {
      'X-Elma-Wiki-Request': '1', 'Content-Type': upload ? 'application/octet-stream' : 'application/json'
    }, body: upload ? input : JSON.stringify(input) });
  } catch {
    throw Object.assign(Error(input === undefined ? 'Сервис недоступен. Повторите загрузку.' : 'Ответ не получен. Действие могло сохраниться; проверьте состояние перед повтором.'), { requiresRefresh: input !== undefined });
  }
  let value;
  try { value = await response.json(); } catch { throw Object.assign(Error('Не удалось прочитать ответ сервиса. Обновите состояние.'), { requiresRefresh: input !== undefined }); }
  if (!response.ok) throw Object.assign(Error(value.error || 'Не удалось выполнить действие.'), { status: response.status, requiresRefresh: input !== undefined && response.status >= 500 });
  return value;
}
const navigate = href => { location.href = href; };
const actions = {
  logout: async () => { await request('/auth/logout', {}); navigate('/login'); },
  upload: file => request((shared ? '/api/solutions/uploads?sharedConfirmed=true&filename=' : '/api/projects?filename=') + encodeURIComponent(file.name), file, true),
  create: async input => { const state = await request(api, input); navigate(href(state.id)); },
  prepare: async input => { const review = await request(`${api}/${id}/prepare`, input); navigate(href(id, 'review', review.artifactId)); },
  accept: async (artifactId, input) => { await request(`${api}/${id}/artifacts/${artifactId}/accept`, input); navigate(href(id)); },
  archive: async input => { await request(`${api}/${id}/archive`, input); navigate(href(id)); }
};
root.replaceChildren(mountManagedWorkspace({ ...config, view, loading: true }));
let workspace;
try {
  workspace = id ? await request(`${api}/${encodeURIComponent(id)}`) : null;
  const review = id && artifact && view === 'review' ? await request(`${api}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}/preview`) : null;
  const rows = !id && view !== 'create' ? await request(api + (view === 'archived' ? '?archived=true' : '')) : [];
  root.replaceChildren(mountManagedWorkspace({ ...config, workspace, view, review, rows }, actions));
  document.title = (workspace?.name || (view === 'create' ? 'Добавить решение' : 'Решения')) + ' · E365';
  root.querySelector('h1')?.focus({ preventScroll: true });
} catch (error) {
  root.replaceChildren(mountManagedWorkspace({ ...config, workspace, view, error: error.message, stale: error.status === 409 }, actions));
}
