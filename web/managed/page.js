import { mountManagedWorkspace } from './render.js';
import { workspaceUrl } from './model.js';
const root = document.getElementById('managed-root'), query = new URLSearchParams(location.search);
const id = query.get('id'), view = query.get('view') || (id ? 'overview' : 'list'), artifact = query.get('artifact');
const api = '/api/managed-workspaces';
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
  upload: file => request('/api/projects?filename=' + encodeURIComponent(file.name), file, true),
  create: async input => { const state = await request(api, input); navigate(workspaceUrl(state.id)); },
  prepare: async input => { const review = await request(`${api}/${id}/prepare`, input); navigate(workspaceUrl(id, 'review', review.artifactId)); },
  accept: async (artifactId, input) => { await request(`${api}/${id}/artifacts/${artifactId}/accept`, input); navigate(workspaceUrl(id)); },
  archive: async input => { await request(`${api}/${id}/archive`, input); navigate(workspaceUrl(id)); }
};
root.replaceChildren(mountManagedWorkspace({ view, loading: true }));
let workspace;
try {
  workspace = id ? await request(`${api}/${encodeURIComponent(id)}`) : null;
  const review = id && artifact && view === 'review' ? await request(`${api}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}/preview`) : null;
  const rows = !id && view !== 'create' ? await request(api + (view === 'archived' ? '?archived=true' : '')) : [];
  root.replaceChildren(mountManagedWorkspace({ workspace, view, review, rows }, actions));
} catch (error) {
  root.replaceChildren(mountManagedWorkspace({ workspace, view, error: error.message, stale: error.status === 409 }, actions));
}
