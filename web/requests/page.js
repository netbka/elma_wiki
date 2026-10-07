import { mountRequests } from './render.js';
const root = document.querySelector('#request-root'), query = new URLSearchParams(location.search), pending = new Map();
let model = {}, selectedId = query.get('id');
async function call(route, input) {
  let response;
  try { response = await fetch(route, { method: input ? 'POST' : 'GET', credentials: 'same-origin',
    headers: input ? { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' } : {}, body: input ? JSON.stringify(input) : undefined }); }
  catch { throw Object.assign(Error(input ? 'Ответ не получен. Повторите отправку того же задания.' : 'Не удалось загрузить задания.'), { unknown: !!input }); }
  let value; try { value = await response.json(); } catch { throw Object.assign(Error('Ответ не получен. Повторите запрос.'), { unknown: !!input }); }
  if (!response.ok) throw Object.assign(Error(value.error || 'Не удалось выполнить действие'), { status: response.status, unconfigured: value.configured === false, stale: response.status === 409, unknown: !!input && response.status >= 500 });
  return value;
}
async function load() {
  try { const value = await call('/api/requests'); const selected = selectedId ? value.requests.find(r => r.id === selectedId) || await call('/api/requests/' + encodeURIComponent(selectedId)) : null;
    model = { ...value, selected, create: query.has('new') }; }
  catch (e) { model = { ...model, error: e.message, unconfigured: e.unconfigured }; }
  render();
}
async function send(route, input) {
  const key = route + JSON.stringify(input); if (!pending.has(key)) pending.set(key, crypto.randomUUID());
  const result = await call(route, { ...input, operationId: pending.get(key) }); selectedId = result.id; query.delete('new');
  model = { ...model, selected: result, create: false, requests: [result, ...(model.requests || []).filter(r => r.id !== result.id)], error: '' };
  history.replaceState(null, '', '/requests?id=' + encodeURIComponent(result.id)); await load(); root.querySelector('h1')?.focus();
}
const actions = { refresh: load, create: input => send('/api/requests', input),
  reply: (r, text) => send('/api/requests/' + r.id + '/reply', { revision: r.revision, text }),
  approve: r => send('/api/requests/' + r.id + '/approve', { revision: r.revision }),
  cancel: r => send('/api/requests/' + r.id + '/cancel', { revision: r.revision }) };
function render() { root.replaceChildren(mountRequests(model, actions)); }
root.replaceChildren(mountRequests({ loading: true })); await load();
