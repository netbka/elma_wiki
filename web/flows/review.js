// Mounted only by the local Storybook development server.
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const phases = { intent: '1 · Цель пользователя', rules: '2 · Бизнес-правила', accessibility: '3 · Удобство и доступность' };
const severities = { should: 'Желательно', blocker: 'Блокирует', must: 'Обязательно', nit: 'Небольшое замечание' };
const categories = { behavior: 'Поведение', data: 'Данные', rights: 'Права доступа', copy: 'Объяснение', accessibility: 'Доступность', other: 'Другое' };
const statuses = { pending: 'Ожидает решения', rejected: 'Требует исправлений', approved: 'Принято для этой версии' };
export function mountReview(host, flow, currentStep) {
  let summary, busy = false, stale = false;
  const heading = el('h2', 'Рецензия сценария'), state = el('p', 'Загружаем рецензии…'); state.className = 'review-status'; state.setAttribute('role', 'status');
  const error = el('p'); error.className = 'review-error'; error.setAttribute('role', 'alert');
  const hint = el('p', 'Сначала пройдите путь от цели человека. Затем откройте правила и проверьте исключения. В конце оцените понятность и доступность. Имя — подпись локального рецензента, без проверки личности.');
  const form = el('form'); form.className = 'review-form';
  function field(label, node, wide = false) { const wrapper = el('label', label); if (wide) wrapper.className = 'review-wide'; wrapper.append(node); form.append(wrapper); return node; }
  function select(values) { const node = el('select'); Object.entries(values).forEach(([value, label]) => { const option = el('option', label); option.value = value; node.append(option); }); return node; }
  const author = field('Ваше имя', el('input')); author.required = true; author.maxLength = 120; author.autocomplete = 'name';
  const phase = field('Этап рецензии', select(phases));
  const severity = field('Важность', select(severities));
  const category = field('Категория', select(categories));
  const message = field('Цель, наблюдение, ожидаемый результат и причина', el('textarea'), true); message.required = true; message.maxLength = 4000;
  const actions = el('div'); actions.className = 'review-wide review-actions';
  const comments = el('div'); comments.className = 'review-findings';
  const history = el('details'); history.className = 'review-history'; history.append(el('summary', 'История решений и предыдущих версий'));
  const events = el('div'); history.append(events);
  const buttons = [];
  const api = async (options = {}) => {
    const response = await fetch(`/__elma/reviews?flowId=${encodeURIComponent(flow.id)}`, { ...options, headers: { 'X-Elma-Review': '1', 'Content-Type': 'application/json' } });
    const value = await response.json(); if (!response.ok) throw Object.assign(Error(value.error || 'Рецензия не сохранена'), { status: response.status }); return value;
  };
  function setBusy(value) {
    busy = value;
    host.querySelectorAll('button').forEach(button => { button.disabled = value || (stale && button !== reload); });
  }
  async function save(type, extra = {}) {
    if (busy || stale || !summary) return;
    if (!author.reportValidity() || !message.reportValidity()) return;
    setBusy(true); error.textContent = '';
    try {
      const history = summary.history;
      summary = await api({ method: 'POST', body: JSON.stringify({ flowId: flow.id, revision: summary.revision, author: author.value, text: message.value, stepId: currentStep(), phase: phase.value, severity: severity.value, category: category.value, type, ...extra }) });
      summary.history = history;
      message.value = ''; draw();
    } catch (e) { if (e.status === 409 && /Версия/.test(e.message)) stale = true; error.textContent = e.message; }
    finally { setBusy(false); if (summary?.blocking) buttons.find(button => button.dataset.type === 'approve').disabled = true; }
  }
  for (const [type, label] of [['comment', 'Оставить комментарий'], ['reject', 'Отклонить с причиной'], ['approve', 'Принять сценарий']]) {
    const button = el('button', label); button.type = 'button'; button.dataset.type = type; button.onclick = () => save(type); buttons.push(button); actions.append(button);
  }
  const refresh = el('button', 'Обновить рецензии'); refresh.type = 'button'; refresh.onclick = load; actions.append(refresh);
  const reload = el('button', 'Перезагрузить сценарий'); reload.type = 'button'; reload.onclick = () => location.reload(); actions.append(reload);
  form.append(actions); form.onsubmit = event => event.preventDefault();
  host.append(heading, hint, state, error, form, comments, history);
  function draw() {
    state.textContent = `${statuses[summary.status]} · версия ${summary.revision.slice(0, 12)} · открытых блокирующих: ${summary.blocking}`;
    buttons.find(button => button.dataset.type === 'approve').disabled = summary.blocking > 0;
    comments.replaceChildren();
    for (const finding of summary.findings) {
      const row = el('article');
      row.append(el('h3', `${finding.type === 'reject' ? 'Отклонение' : 'Комментарий'} · ${finding.author}`), el('p', `${finding.status === 'resolved' ? 'Закрыто' : 'Открыто'} · ${severities[finding.severity]} · ${phases[finding.phase]} · ${flow.states.find(s => s.id === finding.stepId)?.title}`), el('p', finding.text));
      for (const reply of finding.replies) { const note = el('p', `${reply.author}: ${reply.text}`); note.className = 'review-reply'; row.append(note); }
      if (finding.resolution) row.append(el('p', `Решение: ${finding.resolution}`));
      for (const [type, label] of [['reply', 'Ответить'], [finding.status === 'open' ? 'resolve' : 'reopen', finding.status === 'open' ? 'Закрыть с объяснением' : 'Открыть снова']]) {
        const button = el('button', label); button.type = 'button'; button.onclick = () => save(type, { parentId: finding.id }); row.append(button);
      }
      comments.append(row);
    }
    if (!summary.findings.length) comments.append(el('p', 'Замечаний этой версии пока нет.'));
    events.replaceChildren();
    for (const event of [...summary.history || [], ...summary.events]) events.append(el('p', `${event.createdAt} · ${event.revision.slice(0, 12)} · ${event.author} · ${event.type}: ${event.text}`));
    // Old decisions stay visible, but never accept the current revision.
    if (summary.previousRevisions.length) events.prepend(el('p', 'Предыдущие версии имеют отдельные решения. Текущая версия требует новой рецензии.'));
  }
  async function load() {
    if (busy || stale) return;
    setBusy(true); error.textContent = '';
    try {
      const latest = await api();
      if (summary && latest.revision !== summary.revision) {
        stale = true;
        throw Error('Версия сценария изменилась. Перезагрузите сценарий перед рецензией; обновление комментариев не обновляет показанное поведение.');
      }
      summary = latest; draw();
    } catch (e) { state.textContent = stale ? 'Сценарий устарел' : 'Рецензии недоступны'; error.textContent = e.message; }
    finally { setBusy(false); if (summary?.blocking) buttons.find(button => button.dataset.type === 'approve').disabled = true; }
  }
  load();
}
