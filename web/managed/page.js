import { mountManagedWorkspace } from './render.js';
import { workspaceUrl } from './model.js';
import { solutionDeliveryClient, composedDeliveryClient } from './delivery-client.js';
import { draftKey } from './change-base.js';
const root = document.getElementById('managed-root'), query = new URLSearchParams(location.search);
const id = query.get('id'), view = query.get('view') || (id ? 'overview' : 'list'), artifact = query.get('artifact');
const requestsApi = `/api/solutions/${encodeURIComponent(id)}/change-requests`;
const shared = location.pathname === '/solutions', home = shared ? '/solutions' : '/workspaces';
const api = shared ? '/api/solutions' : '/api/managed-workspaces';
const href = (id, view, artifact) => workspaceUrl(id, view, artifact, home);
// `mode=file` opens the legacy manual .e365 form instead of the fixed pull entry.
const config = { shared, home, api, artifact, legacy: query.get('mode') === 'file' };
const handoffId = query.get('handoff');
const handoffApi = `${api}/${encodeURIComponent(id)}/handoffs`;
const composedApi = `${api}/${encodeURIComponent(id)}/composed`, candidateId = query.get('candidate');
const composeHref = candidate => href(id, 'compose') + (candidate ? '&candidate=' + encodeURIComponent(candidate) : '');
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
  if (!response.ok) throw Object.assign(Error(value.error || 'Не удалось выполнить действие.'), { status: response.status, body: value, requiresRefresh: input !== undefined && response.status >= 500 });
  return value;
}
const navigate = href => { location.href = href; };
const actions = {
  navigate,
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
  ...(shared && id ? { composed: {
    deliveryClient: composedDeliveryClient(id, request),
    change: async (candidateId, input) => { await request(`${composedApi}/${encodeURIComponent(candidateId)}`, input); navigate(composeHref(candidateId)); },
    build: input => request(`${composedApi}-build`, input),
    // Explicit operator Target profile read; the page re-reads eligibility afterwards, never replays.
    refreshTargetProfile: async input => { await request(`${api}/${encodeURIComponent(id)}/target-profile`, input); navigate(composeHref()); },
    freeze: async input => {
      const result = await request(composedApi, input);
      if (result?.outcome !== 'frozen' || typeof result.candidate?.id !== 'string' || !result.candidate.id)
        throw Object.assign(Error('Не удалось прочитать ответ сервиса. Обновите состояние.'), { requiresRefresh: true });
      navigate(composeHref(result.candidate.id));
    }
  } } : {}),
  ...(api === '/api/solutions' ? {
    // UX-07: the request routes of this Solution (docs/contracts/change-requests.md).
    requests: {
      create: input => request(requestsApi, input),
      get: requestId => request(`${requestsApi}/${encodeURIComponent(requestId)}`),
      event: (requestId, input) => request(`${requestsApi}/${encodeURIComponent(requestId)}/events`, input),
      publish: (requestId, input) => request(`${requestsApi}/${encodeURIComponent(requestId)}/publish`, input),
      retry: requestId => request(`${requestsApi}/${encodeURIComponent(requestId)}/retry`, {})
    },
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
  ...(shared ? { resolveMerge: async (artifactId, input) => { await request(`${api}/${id}/artifacts/${artifactId}/merge`, input); navigate(href(id, 'review', artifactId)); },
    close: async (artifactId, input) => { await request(`${api}/${id}/artifacts/${artifactId}/close`, input); navigate(href(id)); },
    // UX-08: a personal mark updates in place and returns the actor's marks; no navigation.
    markViewed: (artifactId, input) => request(`${api}/${id}/artifacts/${artifactId}/viewed`, input) } : {}),
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
  // Composer: the server's frozen candidates and build capability. Overview only
  // projects composer next actions when both were read; a failure keeps the
  // review-only projection instead of guessing.
  let composed;
  const accepted = workspace?.changes?.length || workspace?.reconciliations?.length;
  if (shared && workspace && view === 'compose') {
    try {
      // Eligibility (scope, coverage, dependencies, Target profile) is read separately: a failed
      // read leaves the build unavailable with its own notice instead of hiding the candidates.
      const [candidates, capabilities, selected, eligibility] = await Promise.all([request(composedApi), request('/api/delivery/capabilities'),
        candidateId ? request(`${composedApi}/${encodeURIComponent(candidateId)}`).catch(error => { if (error.status === 404) return null; throw error; }) : null,
        request(`${composedApi}-eligibility`).catch(error => ({ loadError: error.message }))]);
      composed = { candidates, build: capabilities.composedBuild, eligibility, selected, selectedId: candidateId };
    } catch (error) { composed = { loadError: error.message }; }
  } else if (shared && workspace && accepted && ['overview', 'changes', 'solution'].includes(view)) {
    try {
      const [candidates, capabilities, eligibility] = await Promise.all([request(composedApi), request('/api/delivery/capabilities'),
        request(`${composedApi}-eligibility`).catch(error => ({ loadError: error.message }))]);
      composed = { candidates, build: capabilities.composedBuild, eligibility };
    } catch (error) { composed = { loadError: error.message }; }
  }
  // UX-05: О решении reads the saved purpose (or its generated draft) before rendering,
  // so the page opens with the answer; a failed read keeps the empty sentence and a retry.
  let about;
  if (api === '/api/solutions' && workspace && view === 'overview') {
    try { about = { purpose: await request(`${api}/${encodeURIComponent(id)}/explanations?scope=solution-purpose`) }; }
    catch (error) { about = { purpose: { loadError: error.message } }; }
  }
  // UX-06: the process and screen tabs read the captured artifacts' projections
  // (diagrams, declared fields) before rendering; a failed read is shown per artifact.
  let visuals;
  if (api === '/api/solutions' && workspace && ['flows', 'solution'].includes(view)) {
    const wanted = new Set();
    for (const row of workspace.current || []) {
      if (!['processor', 'widgets', 'applications', 'collections'].includes(row.service)) continue;
      const captured = (workspace.artifacts || []).filter(artifact => (artifact.components || []).some(component => component.key === row.key && component.digest === row.digest)).at(-1);
      if (captured) wanted.add(captured.id);
    }
    visuals = Object.fromEntries(await Promise.all([...wanted].map(async artifactId => {
      try { return [artifactId, await request(`${api}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/visual`)]; }
      catch (error) { return [artifactId, { error: error.message }]; }
    })));
  }
  // UX-07: the request list and the publication configuration, for the tab and for the
  // chips and entry points of Как работает and Экраны и данные; a failed read is shown on the tab.
  let requests;
  if (api === '/api/solutions' && workspace && ['requests', 'flows', 'solution'].includes(view)) {
    try { requests = await request(requestsApi); }
    catch (error) { requests = { loadError: error.message }; }
  }
  // Replacing a prepared change offers its exact captured keys as scope candidates.
  let previousReview = null;
  if (shared && workspace && artifact && view === 'change') {
    try { previousReview = await request(`${api}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}/review`); } catch { previousReview = null; }
  }
  const acquisition = shared && query.get('acquisition') ? await request('/api/config-source/acquisitions/' + encodeURIComponent(query.get('acquisition'))) : null;
  // The fixed entry needs a configured Source API; an unconfigured one is shown as unavailable, never guessed.
  let pullUnavailable = false;
  if (shared && !config.legacy && (view === 'create' || view === 'full')) {
    try { pullUnavailable = (await request('/api/config-source/servers')).configured === false; } catch { pullUnavailable = true; }
  }
  root.replaceChildren(mountManagedWorkspace({ ...config, workspace, view, review, rows, handoff, handoffs, exportEvidence, handoffReason, acquisition, previousReview, composed, pullUnavailable, about, visuals, requests, object: query.get('object'), request: query.get('request') }, actions));
  document.title = (workspace?.name || (view === 'create' ? 'Загрузить решение' : 'Решения')) + ' · E365';
  root.querySelector('h1')?.focus({ preventScroll: true });
} catch (error) {
  root.replaceChildren(mountManagedWorkspace({ ...config, workspace, view, error: error.message, stale: error.status === 409 }, actions));
}
