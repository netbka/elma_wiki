const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const labels = { TRIAGING: 'Задание принято, ожидает разбора', WAITING_USER: 'Нужно уточнение', AWAITING_APPROVAL: 'Согласуйте задание', QUEUED: 'Разработка в очереди', IMPLEMENTING: 'Идёт разработка', PUBLISHING: 'Подготовка результата', PR_READY: 'Результат готов к проверке', BLOCKED: 'Работа остановлена', CANCELLED: 'Задание отменено' };
export function mountRequests(model = {}, actions = {}) {
  const root = el('section', undefined, 'requests'), heading = el('h1', 'Задания на разработку портала'); heading.tabIndex = -1;
  const notice = el('p', model.loading ? 'Загружаем задания…' : '', 'request-status'); notice.setAttribute('role', 'status');
  const error = el('p', model.error || '', 'request-error'); error.setAttribute('role', 'alert'); error.tabIndex = -1;
  root.append(heading, notice, error);
  let busy = false;
  const button = (parent, name, action, secondary = false) => { const b = el('button', name); b.type = 'button'; if (secondary) b.className = 'secondary'; b.onclick = () => run(action, b); parent.append(b); return b; };
  const run = async (fn, trigger) => {
    if (busy) return; busy = true; root.setAttribute('aria-busy', 'true'); error.textContent = '';
    const buttons = [...root.querySelectorAll('button')], prior = buttons.map(b => b.disabled); buttons.forEach(b => b.disabled = true);
    const inputs = [...root.querySelectorAll('input,textarea,select')], inputPrior = inputs.map(n => n.disabled);
    inputs.forEach(n => n.disabled = true); let locked = false;
    try { await fn(); } catch (e) {
      error.textContent = e.message; error.focus();
      if (e.unknown) {
        locked = true;
        prior.fill(true); prior[buttons.indexOf(trigger)] = false; trigger.textContent = 'Повторить отправку';
      }
      if (e.stale) { locked = true; prior.fill(true); const refresh = root.querySelector('[data-refresh]'); if (refresh) prior[buttons.indexOf(refresh)] = false; }
    } finally { buttons.forEach((b, i) => b.disabled = prior[i]); if (!locked) inputs.forEach((n, i) => n.disabled = inputPrior[i]); busy = false; root.removeAttribute('aria-busy'); }
  };
  const refresh = (parent = root, primary = false) => { const b = button(parent, 'Обновить состояние', () => actions.refresh(), !primary); b.dataset.refresh = 'true'; return b; };
  if (model.synthetic) root.append(el('p', 'Учебный пример. Задания и результаты синтетические.', 'request-note'));
  if (model.loading) return root;
  if (model.unconfigured) { root.append(el('h2', 'Исполнитель ещё не подключён'), el('p', 'Задания пока нельзя отправить. Вернитесь к решению; данные не потеряны.')); const a = el('a', 'Вернуться к решениям', 'button'); a.href = '/workspaces'; root.append(a); return root; }
  if (model.error && !model.projects?.length) { refresh(); return root; }
  const records = model.requests || [], selected = model.selected || records[0];
  const columns = el('div', undefined, 'request-columns'), list = el('nav'), detail = el('section'); list.setAttribute('aria-label', 'Мои задания');
  const add = el('a', 'Создать задание'); add.href = '/requests?new=1'; list.append(add);
  for (const r of records) { const a = el('a', r.messages?.[0]?.text?.slice(0, 100) || 'Задание'); a.href = '/requests?id=' + encodeURIComponent(r.id); if (r.id === selected?.id && !model.create) a.setAttribute('aria-current', 'page'); a.append(el('small', labels[r.state] || 'Состояние уточняется')); list.append(a); }
  columns.append(list, detail); root.append(columns);
  const formText = (form, label, value = '') => { const caption = el('label', label), input = el('textarea'); input.name = 'text'; input.value = value; input.required = true; input.maxLength = 8000; caption.append(input); form.append(caption); return input; };
  const submit = (form, name, fn) => { const b = el('button', name); b.type = 'submit'; form.append(b); form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) run(fn, b); }; return b; };
  if (model.create || !selected) {
    detail.append(el('h2', records.length ? 'Новое задание' : 'Пока нет заданий'), el('p', 'Опишите изменение кода портала и ожидаемый результат. Исполнитель сначала уточнит и предложит задание для согласования. Изменения конфигурации ELMA этим исполнителем пока не поддерживаются.'));
    const form = el('form'), projects = model.projects || []; let project = projects[0];
    if (projects.length > 1) { const label = el('label', 'Проект разработки'), select = el('select'); for (const key of projects) { const option = el('option', key === 'wiki' ? 'Код портала' : key); option.value = key; select.append(option); } label.append(select); form.append(label); select.onchange = () => project = select.value; }
    const input = formText(form, 'Что нужно сделать'); submit(form, 'Отправить задание', () => actions.create({ project, text: input.value })); detail.append(form); return root;
  }
  const r = selected;
  detail.append(el('h2', labels[r.state] || 'Состояние уточняется'), el('p', 'Версия задания: ' + r.revision));
  const conversation = el('div', undefined, 'request-conversation');
  for (const message of r.messages || []) conversation.append(el('p', message.text)); detail.append(conversation);
  if (r.questions?.length) { const ul = el('ul'); r.questions.forEach(q => ul.append(el('li', q))); detail.append(el('h3', 'Что нужно уточнить'), ul); }
  if (r.specification) { const s = r.specification, ul = el('ul'); s.criteria.forEach(c => ul.append(el('li', c))); detail.append(el('h3', r.approved ? 'Согласованное задание' : 'Предлагаемое задание'), el('p', s.summary), el('h3', 'Как проверим результат'), ul, el('p', 'Границы работы: ' + s.scope.join('; '))); }
  if (r.state === 'AWAITING_APPROVAL') {
    const form = el('form'), label = el('label'), check = el('input'); check.type = 'checkbox'; check.required = true; label.append(check, el('span', 'Согласовать разработку по этому заданию')); form.append(label);
    const b = submit(form, 'Согласовать задание', () => actions.approve(r)); b.disabled = true; check.onchange = () => b.disabled = !check.checked; detail.append(form);
  }
  if (['WAITING_USER', 'AWAITING_APPROVAL', 'PR_READY'].includes(r.state)) {
    const form = el('form'), input = formText(form, r.state === 'WAITING_USER' ? 'Ваше уточнение' : 'Что нужно изменить'); submit(form, r.state === 'WAITING_USER' ? 'Отправить уточнение' : 'Запросить изменения', () => actions.reply(r, input.value));
    if (r.state === 'WAITING_USER') detail.append(form); else { const d = el('details'); d.append(el('summary', 'Нужно изменить задание'), form); detail.append(d); }
  }
  if (r.state === 'PR_READY' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(r.pullRequest?.url || '')) {
    const a = el('a', 'Открыть результат', 'button'); a.href = r.pullRequest.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; detail.append(a, el('p', 'Результат разработки ещё требует проверки. Это не подтверждение установки в ELMA.'));
  }
  if (r.state === 'BLOCKED') { detail.append(el('p', 'Исполнитель остановил работу. Обновите состояние или передайте причину оператору.')); const d = el('details'); d.append(el('summary', 'Причина остановки'), el('p', r.blocker || 'Причина уточняется')); detail.append(d); }
  refresh(detail, !['AWAITING_APPROVAL', 'WAITING_USER', 'PR_READY', 'CANCELLED'].includes(r.state));
  if (r.state === 'CANCELLED') { const a = el('a', 'Создать новое задание', 'button'); a.href = '/requests?new=1'; detail.append(a); }
  if (r.state !== 'CANCELLED') button(detail, 'Отменить задание', () => actions.cancel(r), true);
  return root;
}
