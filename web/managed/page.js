import { mountManagedWorkspace } from './render.js';
import { workspaceUrl } from './model.js';
import { solutionDeliveryClient } from './delivery-client.js';
import { draftKey } from './change-base.js';
const root = document.getElementById('managed-root'), query = new URLSearchParams(location.search);
const id = query.get('id'), view = query.get('view') || (id ? 'overview' : 'list'), artifact = query.get('artifact');
const shared = location.pathname === '/solutions', home = shared ? '/solutions' : '/workspaces';
const api = shared ? '/api/solutions' : '/api/managed-workspaces';
const href = (id, view, artifact) => workspaceUrl(id, view, artifact, home);
const config = { shared, home, api, artifact };
const handoffId = query.get('handoff');
const handoffApi = `${api}/${encodeURIComponent(id)}/handoffs`;
const handoffHref = releaseId => href(id, 'handoff') + (releaseId ? '&handoff=' + encodeURIComponent(releaseId) : '');
async function request(url, input, upload, method = 'POST') {
  let response;
  try {
    response = await fetch(url, input === undefined ? {} : { method, headers: {
      'X-Elma-Wiki-Request': '1', 'Content-Type': upload ? 'application/octet-stream' : 'application/json'
    }, ...(method === 'DELETE' ? {} : { body: upload ? input : JSON.stringify(input) }) });
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
  ...(shared ? { acquisition: {
    upload: file => request('/api/config-source/uploads', file, true),
    catalog: server => request('/api/config-source/servers/' + server + '/solutions'),
    start: input => request('/api/config-source/exports', input),
    get: id => request('/api/config-source/acquisitions/' + id),
    list: () => request('/api/config-source/acquisitions'),
    remember: id => { const url = new URL(location.href); url.searchParams.set('acquisition', id); history.replaceState(null, '', url); },
    resumeUrl: id => { const url = new URL(location.href); url.searchParams.set('acquisition', id); return url.pathname + url.search; }
  } } : {}),
  handoff: {
    ...(shared && id ? { deliveryClient: solutionDeliveryClient(id, request) } : {}),
    create: async input => { const result = await request(handoffApi, { ...input, expectedRevision: workspace.revision }); navigate(handoffHref(result.id)); },
    change: (releaseId, input) => request(`${handoffApi}/${encodeURIComponent(releaseId)}`, input),
    preview: (releaseId, path, side) => request(`${handoffApi}/${encodeURIComponent(releaseId)}/preview?` + new URLSearchParams({ path, side })),
    open: releaseId => navigate(handoffHref(releaseId)),
    download: async (releaseId, revision) => {
      let response;
      try { response = await fetch(`${handoffApi}/${encodeURIComponent(releaseId)}/bundle`, { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }) }); }
      catch { throw Object.assign(Error('Ответ не получен. Обновите передачу перед повтором.'), { requiresRefresh: true }); }
      if (!response.ok) { const value = await response.json(); throw Object.assign(Error(value.error || 'Передача не получена'), { status: response.status, requiresRefresh: response.status >= 500 }); }
      let blob;
      try { blob = await response.blob(); } catch { throw Object.assign(Error('Пакет не получен полностью. Обновите передачу перед повтором.'), { requiresRefresh: true }); }
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'solution-handoff.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },
  ...(api === '/api/solutions' ? {
    visual: artifactId => request(`${api}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/visual`),
    explanations: {
      read: target => request(`${api}/${encodeURIComponent(id)}/explanations?`+new URLSearchParams(target)),
      save: (target,input) => request(`${api}/${encodeURIComponent(id)}/explanations`,{...target,...input})
    }
  } : {}),
  logout: async () => { await request('/auth/logout', {}); navigate('/login'); },
  upload: file => request((shared ? '/api/solutions/uploads?filename=' : '/api/projects?filename=') + encodeURIComponent(file.name), file, true),
  create: async input => { const state = await request(api, input); navigate(href(state.id)); },
  prepare: async input => { const review = await request(`${api}/${id}/prepare`, { ...input, ...(shared && artifact && ['change', 'full'].includes(view) ? { supersedesArtifactId: artifact } : {}) }); navigate(href(id, 'review', review.artifactId)); },
  accept: async (artifactId, input) => { await request(`${api}/${id}/artifacts/${artifactId}/accept`, input); navigate(href(id)); },
  archive: async input => { await request(`${api}/${id}/archive`, input); navigate(href(id)); },
  comment: async (artifactId, input) => { await request(`${api}/${id}/artifacts/${artifactId}/discussion`, input); navigate(href(id, 'review', artifactId)); },
  context: (artifactId, ref) => request(`${api}/${id}/artifacts/${artifactId}/objects/${ref}`),
  // Per-tab preparation draft; storage failures only lose the convenience copy.
  ...(id && ['change', 'full'].includes(view) ? { draft: (key => ({
    read: () => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
    write: value => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} },
    clear: () => { try { sessionStorage.removeItem(key); } catch {} }
  }))(draftKey(api, id, view, artifact)) } : {})
};
root.replaceChildren(mountManagedWorkspace({ ...config, view, loading: true }));
let workspace;
try {
  workspace = id ? await request(`${api}/${encodeURIComponent(id)}`) : null;
  const review = id && artifact && view === 'review' ? await request(`${api}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}/${shared ? 'review' : 'preview'}`) : null;
  if (shared && id && workspace) root.dataset.bugContext = JSON.stringify({ solutionId: id, ...(review ? { artifactId: artifact, expectedDiscussionRevision: review.discussion.version } : {}), expectedRevision: workspace.revision });
  const rows = !id && view !== 'create' ? await request(api + (view === 'archived' ? '?archived=true' : '')) : [];
  let handoff, handoffs, exportEvidence, handoffReason;
  if (shared && workspace && view === 'handoff') {
    handoffs = await request(handoffApi);
    handoff = handoffId ? await request(`${handoffApi}/${encodeURIComponent(handoffId)}`) : null;
    try { exportEvidence = await request(`${api}/${encodeURIComponent(id)}/accepted-export?expectedRevision=${workspace.revision}`); }
    catch (error) { if (![409, 422].includes(error.status)) throw error; handoffReason = 'Передача новой версии недоступна: завершите рассмотрение и примите полный экспорт, содержащий все принятые изменения.'; }
  }
  // Replacing a prepared change offers its exact captured keys as scope candidates.
  let previousReview = null;
  if (shared && workspace && artifact && view === 'change') {
    try { previousReview = await request(`${api}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}/review`); } catch { previousReview = null; }
  }
  const acquisition = shared && query.get('acquisition') ? await request('/api/config-source/acquisitions/' + encodeURIComponent(query.get('acquisition'))) : null;
  root.replaceChildren(mountManagedWorkspace({ ...config, workspace, view, review, rows, handoff, handoffs, exportEvidence, handoffReason, acquisition, previousReview }, actions));
  document.title = (workspace?.name || (view === 'create' ? 'Добавить решение' : 'Решения')) + ' · E365';
  root.querySelector('h1')?.focus({ preventScroll: true });
} catch (error) {
  root.replaceChildren(mountManagedWorkspace({ ...config, workspace, view, error: error.message, stale: error.status === 409 }, actions));
}
