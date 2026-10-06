const $ = s => document.querySelector(s);
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-Elma-Wiki-Request': '1', ...options.headers } });
  const value = await response.json(); if (!response.ok) throw Error(value.error || 'Запрос не выполнен'); return value;
}
const post = (url, value) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
function result(id, message, error = false) { const node = $(id); node.textContent = message; node.classList.toggle('error', error); }
function cost() {
  const input = (id, min, max) => Math.min(max, Math.max(min, Number($(id).value) || 0));
  const hours = input('#calc-people', 1, 1000) * input('#calc-hours', 0, 200) * input('#calc-percent', 0, 100) / 100;
  $('#calc-total').textContent = Math.round(hours * input('#calc-rate', 0, 100000)).toLocaleString('ru-RU') + ' ₽';
  $('#calc-time').textContent = hours.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' часов в месяц — по заданным предположениям';
}
if ($('#calc-total')) { document.querySelectorAll('.calc input').forEach(el => el.addEventListener('input', cost)); cost(); }
if ($('#github-login')) {
  try {
    const state = await api('/api/session');
    if (state.user) location.replace('/dashboard');
    $('#local-login-card').classList.toggle('hidden', !state.localEnabled);
    $('#oauth-notice').classList.toggle('hidden', state.githubConfigured);
    if (!state.githubConfigured) $('#github-login').textContent = 'Как настроить GitHub →';
    if (!state.githubConfigured) $('#github-login').href = '/guide#oauth';
  } catch { result('#login-result', 'Не удалось проверить состояние сервера', true); }
  $('#local-login').addEventListener('click', async () => { try { await post('/auth/local', {}); location.assign('/dashboard'); } catch (e) { result('#login-result', e.message, true); } });
}
if ($('#portal-list')) {
  let selectedRepo, portals = [];
  async function refresh(selected) {
    portals = await api('/api/portals');
    $('#portal-list').innerHTML = portals.length ? portals.map(p => `<div class="workspace"><div><strong>${esc(p.name)}</strong><span>${p.createdAt ? esc(new Date(p.createdAt).toLocaleDateString('ru-RU')) : 'Данные локальной командной строки'}</span></div><a href="/p/${encodeURIComponent(p.id)}/">Открыть →</a></div>`).join('') : '<p>Создайте первый портал. Загруженные данные видны только вам.</p>';
    $('#target-portal').innerHTML = portals.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }
  try {
    const session = await api('/api/session');
    if (!session.user) location.replace('/login');
    $('#session-name').textContent = session.user?.login || '';
    if (session.user?.provider !== 'github') { $('#inspect-repo').disabled = true; $('#repo-login-hint').innerHTML = 'Для чтения GitHub-репозитория <a href="/auth/github">войдите через GitHub</a>. Локальная загрузка доступна сейчас.'; }
    await refresh();
  } catch (e) { result('#create-result', e.message, true); }
  $('#logout').addEventListener('click', async () => { await post('/auth/logout', {}); location.assign('/'); });
  $('#create-portal').addEventListener('submit', async e => { e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true;
    try { const portal = await post('/api/portals', { name: $('#portal-name').value }); await refresh(portal.id); $('#portal-name').value = ''; result('#create-result', 'Портал создан. Загрузите конфигурацию в панели справа.'); }
    catch (error) { result('#create-result', error.message, true); } finally { button.disabled = false; }
  });
  $('#upload-config').addEventListener('click', async () => {
    const portal = $('#target-portal').value, files = $('#config-files').files, button = $('#upload-config');
    if (!portal || !files.length) return result('#upload-result', 'Выберите портал и .e365', true);
    button.disabled = true; result('#upload-result', 'Разбор…'); const messages = [];
    try { for (const file of files) {
      const report = await api(`/p/${portal}/api/import?server=${encodeURIComponent($('#environment').value.trim())}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Elma-Wiki-Import': '1' }, body: file });
      messages.push(`${report.code}: ${report.entities} объектов, ${report.fields} полей, ${report.functions} функций. ${(report.warnings || []).join(' ')}`); result('#upload-result', messages.join('\n'));
    } $('#upload-result').insertAdjacentHTML('beforeend', `<p><a href="/p/${encodeURIComponent(portal)}/">Открыть готовый портал →</a></p>`); }
    catch (e) { result('#upload-result', messages.concat(e.message).join('\n'), true); } finally { button.disabled = false; }
  });
  $('#inspect-repo').addEventListener('click', async () => {
    const button = $('#inspect-repo'); button.disabled = true; $('#import-repo').classList.add('hidden'); $('#repo-candidates').innerHTML = ''; selectedRepo = null; result('#repo-result', 'Чтение дерева GitHub…');
    try {
      selectedRepo = await post('/api/github/inspect', { repo: $('#repo-url').value.trim() });
      $('#repo-candidates').innerHTML = selectedRepo.candidates.map((c, i) => `<label><input type="radio" name="repo-config" value="${i}" ${i === 0 ? 'checked' : ''}><span><strong>${esc(c.path)}</strong> · ${c.type === 'archive' ? '.e365' : 'Извлечённая конфигурация'} · ${Math.round(c.size / 1024)} КБ</span></label>`).join('');
      $('#import-repo').classList.toggle('hidden', !selectedRepo.candidates.length); result('#repo-result', selectedRepo.candidates.length ? `Ветка ${selectedRepo.branch}. Выберите конфигурацию и целевой портал.` : 'В default branch нет .e365 или каталогов с сервисными manifest.json.');
    } catch (e) { result('#repo-result', e.message, true); } finally { button.disabled = false; }
  });
  $('#import-repo').addEventListener('click', async () => {
    const button = $('#import-repo'), portal = $('#target-portal').value, item = selectedRepo?.candidates[Number($('[name="repo-config"]:checked')?.value)];
    if (!portal || portal === 'local' || !item) return result('#repo-result', 'Выберите созданный личный портал и конфигурацию', true);
    button.disabled = true; result('#repo-result', 'Загрузка и разбор GitHub-конфигурации…');
    try { const report = await post(`/api/portals/${portal}/github`, { repo: selectedRepo.repo, path: item.path, server: $('#environment').value.trim() }); result('#repo-result', `${report.code}: ${report.entities} объектов. ${(report.warnings || []).join(' ')}`); $('#repo-result').insertAdjacentHTML('beforeend', `<p><a href="/p/${encodeURIComponent(portal)}/">Открыть портал →</a></p>`); }
    catch (e) { result('#repo-result', e.message, true); } finally { button.disabled = false; }
  });
}
document.querySelectorAll('pre.code-panel').forEach(pre => {
  const text = pre.textContent, button = document.createElement('button'); button.className = 'copy-code'; button.textContent = 'Копировать'; button.type = 'button';
  button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); button.textContent = 'Скопировано'; } catch { button.textContent = 'Выделите текст'; } }); pre.prepend(button);
});
