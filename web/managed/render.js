import { componentName, dateLabel, labels, reviewGate, workspaceSummary, workspaceUrl } from './model.js';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let sequence = 0;
export function mountManagedWorkspace(model = {}, actions = {}) {
  const { workspace: state, review, view = 'list', rows = [], synthetic = false } = model;
  const root = el('div', undefined, 'managed-shell'), content = el('div', undefined, 'managed-content');
  const heading = el('h1', state?.name || (view === 'create' ? 'Создать рабочее пространство' : view === 'archived' ? 'Архив пространств' : 'Рабочие пространства'));
  heading.tabIndex = -1;
  const notice = el('p', model.loading ? 'Загружаем пространство…' : model.notice || '', 'managed-notice'); notice.setAttribute('role', 'status');
  const error = el('div', model.error || '', 'managed-error'); error.setAttribute('role', 'alert'); error.tabIndex = -1;
  let busy = !!model.loading, blocked = !!model.stale;
  const link = (label, href, primary = false) => {
    const a = el('a', label, primary ? 'button' : 'managed-link'); a.href = href;
    if (actions.navigate) a.onclick = event => { event.preventDefault(); actions.navigate(href); };
    return a;
  };
  const button = (label, action, parent = content) => { const b = el('button', label); b.type = 'button'; b.onclick = action; parent.append(b); return b; };
  const field = (form, label, type = 'text', value = '') => {
    const wrap = el('div', undefined, 'managed-field'), caption = el('label', label), input = el('input');
    input.id = 'managed-field-' + ++sequence; input.type = type; input.value = value; caption.htmlFor = input.id;
    if (type === 'text') input.maxLength = 160;
    wrap.append(caption, input); form.append(wrap); return input;
  };
  const check = (form, label) => { const wrap = el('label', undefined, 'managed-check'), input = el('input'); input.type = 'checkbox'; wrap.append(input, el('span', label)); form.append(wrap); return input; };
  const technical = (parent, label, data) => { const details = el('details'), code = el('pre', JSON.stringify(data, null, 2)); details.append(el('summary', label), code); parent.append(details); };
  const controls = () => root.querySelectorAll('button,input,select');
  const lock = () => controls().forEach(node => { node.disabled = busy || blocked || node.dataset.unavailable === 'true'; });
  const run = async operation => {
    if (busy || blocked) return;
    // Preserve disabled states while awaiting a response, and preserve form values on errors.
    controls().forEach(node => { node.dataset.unavailable = String(node.disabled); });
    busy = true; lock(); error.textContent = ''; notice.textContent = 'Сохраняем. Дождитесь ответа…';
    let completed = false;
    try { await operation(); completed = true; }
    catch (e) {
      blocked = e.status === 409 || e.requiresRefresh;
      error.textContent = e.message || 'Не удалось выполнить действие.';
      if (blocked) error.append(el('p', 'Ответ требует сверки состояния. Сохраните введённый текст, затем обновите пространство; повторное принятие заблокировано.'), link('Обновить состояние', workspaceUrl(state?.id)));
      error.focus();
    } finally { busy = completed; notice.textContent = completed ? 'Сохранено. Открываем обновлённое состояние…' : ''; lock(); }
  };
  const nav = el('nav', undefined, 'managed-nav'); nav.setAttribute('aria-label', 'Рабочие пространства');
  for (const [label, mode] of [['Активные', 'list'], ['Архив', 'archived'], ['Создать пространство', 'create']]) {
    const a = link(label, workspaceUrl(null, mode === 'list' ? null : mode));
    if (!state && view === mode) a.setAttribute('aria-current', 'page'); nav.append(a);
  }
  const secondary = el('details'); secondary.append(el('summary', 'Отдельные инструменты'), link('Просмотреть отдельный файл', '/dashboard'), link('Учебный пример', '/p/showcase/'));
  nav.append(secondary); root.append(nav, content); content.append(heading, notice, error);
  if (actions.logout) button('Выйти', () => run(actions.logout), nav);
  if (synthetic) content.append(el('p', 'Учебное пространство. Данные синтетические; действия не изменяют ELMA.', 'managed-note'));
  if (model.loading) { root.setAttribute('aria-busy', 'true'); return root; }
  if (model.stale) { content.append(el('p', 'Сравнение устарело. Обновите пространство и подготовьте сравнение от текущей базы.'), link('Обновить состояние', workspaceUrl(state?.id), true)); return root; }
  if (model.error && !state && !rows.length) { content.append(link('Повторить загрузку', workspaceUrl(null, view === 'archived' ? view : null), true)); return root; }

  if (!state && !['create'].includes(view)) {
    content.append(el('p', view === 'archived' ? 'История и исходные снимки сохранены. Откройте пространство, чтобы возобновить работу.' : 'Начните с полного снимка решения. Частичные пакеты добавляйте как изменения внутри пространства.'));
    if (!rows.length) {
      content.append(el('h2', view === 'archived' ? 'В архиве пока пусто' : 'Пока нет активных пространств'));
      if (view !== 'archived') content.append(link('Создать из полного снимка', workspaceUrl(null, 'create'), true));
    }
    const list = el('div', undefined, 'managed-list');
    for (const row of rows) {
      const summary = workspaceSummary(row), card = el('article', undefined, 'managed-card');
      card.append(el('h2', row.name), el('p', summary.source, 'managed-muted'),
        el('p', `База принята: ${dateLabel(row.baselineAcceptedAt)} · ${row.baselineOwner}`),
        el('p', `Изменённых объектов: ${summary.changed} · Ожидают разбора: ${summary.pending}`),
        link(row.status === 'archived' ? 'Открыть архив' : 'Продолжить работу', workspaceUrl(row.id), true)); list.append(card);
    }
    content.append(list); return root;
  }

  if (state) {
    const summary = workspaceSummary(state), context = el('div', undefined, 'managed-context');
    context.append(el('p', `${state.status === 'archived' ? 'Архив' : 'В работе'} · ${summary.source}`),
      el('p', `База принята: ${dateLabel(state.baselineAcceptedAt)} · Ответственный за базу: ${state.baselineOwner}`));
    if (view !== 'overview') context.append(link('← К обзору пространства', workspaceUrl(state.id)));
    context.append(el('p', 'Ответственность заявлена при рассмотрении пакета. Авторы публикаций ELMA не установлены.', 'managed-muted'));
    content.append(context);
    if (view === 'overview') {
      const actionsBar = el('div', undefined, 'managed-actions');
      if (state.status !== 'archived') actionsBar.append(link('Загрузить изменение', workspaceUrl(state.id, 'change'), true), link('Обновить полный снимок', workspaceUrl(state.id, 'full')));
      content.append(actionsBar, el('h2', 'Что требует внимания'));
      if (!state.pending.length) content.append(el('p', state.status === 'archived' ? 'Возобновите работу, чтобы добавить изменение.' : 'Нет ожидающих решений. Добавьте частичный пакет или сравните новый полный снимок.'));
      for (const pending of state.pending) {
        const card = el('article', undefined, 'managed-card');
        card.append(el('h3', pending.kind === 'change' ? `${pending.options.team} · ${pending.options.taskRef}` : 'Новый полный снимок'),
          el('p', pending.stale ? 'Сравнение устарело. Подготовьте его заново от текущей базы.' : 'Снимок сохранён; решение ещё не принято.'),
          link(pending.stale ? 'Подготовить новое сравнение' : 'Рассмотреть изменения', workspaceUrl(state.id, pending.stale ? pending.kind === 'change' ? 'change' : 'full' : 'review', pending.stale ? null : pending.artifactId)),
          link('Скачать исходный снимок', `/api/managed-workspaces/${state.id}/artifacts/${pending.artifactId}/original`)); content.append(card);
      }
      const lower = el('div', undefined, 'managed-columns'), current = el('section'), history = el('section');
      current.append(el('h2', `Рабочее состояние · ${state.current.length} объектов`), el('p', 'Отсутствие объекта в частичном пакете не удаляет его. Рабочее состояние не является готовым архивом для установки.', 'managed-muted'));
      const table = el('table'), head = el('tr'); ['Объект', 'Ответственность', 'Состояние'].forEach(label => head.append(el('th', label))); table.append(head);
      for (const row of state.current) { const tr = el('tr'); tr.append(el('td', row.code), el('td', row.team), el('td', row.interventionId ? 'Заявленное изменение' : 'Принятая база')); table.append(tr); }
      const scroll = el('div', undefined, 'managed-table'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Рабочее состояние объектов'); scroll.append(table); current.append(scroll);
      history.append(el('h2', 'История'), el('p', `Принято изменений: ${state.changes.length} · Обновлений базы: ${state.reconciliations.length}`));
      const events = { created: 'Принята исходная база', 'change-accepted': 'Принято частичное изменение', 'baseline-accepted': 'Принята новая база', archived: 'Перемещено в архив', reopened: 'Работа возобновлена' };
      const list = el('ol'); state.history.forEach(row => list.append(el('li', events[row.type] || row.type))); history.append(list);
      const artifacts = el('details'); artifacts.append(el('summary', 'Исходные снимки и доказательства'));
      state.artifacts.forEach((artifact, i) => { const item = el('div'); item.append(link(`Скачать снимок ${i + 1} · ${artifact.scope === 'full' ? 'полный' : 'частичный'}`, `/api/managed-workspaces/${state.id}/artifacts/${artifact.id}/original`)); technical(item, 'Происхождение и контрольная сумма', { snapshot: artifact.snapshot, scope: artifact.scopeDeclaration, checksum: artifact.checksum }); artifacts.append(item); });
      history.append(artifacts); lower.append(current, history); content.append(lower);
      const form = el('form', undefined, 'managed-archive');
      const confirm = check(form, state.status === 'archived' ? 'Возобновить работу с сохранённой базой и историей' : 'Убрать из активных; сохранить снимки, изменения и историю'); confirm.required = true;
      const submit = el('button', state.status === 'archived' ? 'Возобновить работу' : 'В архив'); submit.type = 'submit'; form.append(submit);
      form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) run(() => actions.archive({ archived: state.status !== 'archived', expectedRevision: state.revision })); };
      content.append(form); return root;
    }
  }

  if (view === 'create' || ['change', 'full'].includes(view)) {
    if (state?.status === 'archived') { content.append(el('p', 'Сначала возобновите работу из обзора пространства.')); return root; }
    const partial = view === 'change', form = el('form', undefined, 'managed-form');
    content.append(el('h2', partial ? 'Добавить частичный пакет' : view === 'create' ? 'Полный снимок станет исходной базой' : 'Сравнить новый полный снимок'));
    content.append(el('p', partial ? 'Будут рассмотрены только объекты из пакета. Остальная база сохранится.' : 'Нужен полный экспорт этого решения из выбранного источника. Частичный пакет не подходит. Полнота подтверждается вами; сервис не может установить её автоматически.'));
    const name = view === 'create' ? field(form, 'Название пространства') : null;
    const owner = field(form, partial ? 'Команда изменения' : 'Ответственный за базу', 'text', partial ? '' : state?.baselineOwner || ''); owner.required = true;
    if (name) name.required = true;
    const task = partial ? field(form, 'Задача или ссылка на задачу') : null; if (task) task.required = true;
    const file = field(form, 'Файл .e365', 'file'); file.accept = '.e365'; file.required = true;
    const evidence = el('p'); form.append(evidence);
    let captured = null;
    file.onchange = () => { captured = null; evidence.replaceChildren(); };
    const scope = check(form, partial ? 'Подтверждаю: это частичный пакет изменений' : 'Подтверждаю: это полный снимок решения'); scope.required = true;
    const sameSource = state ? check(form, 'Подтверждаю: снимок относится к тому же источнику и решению, что и пространство') : null;
    if (sameSource) sameSource.required = true;
    form.append(el('p', 'Оригинал сохраняется приватно. Неизвестные части могут блокировать принятие. Загрузка ничего не устанавливает в ELMA.', 'managed-muted'));
    const submit = el('button', view === 'create' ? 'Создать пространство' : 'Сохранить и сравнить'); submit.type = 'submit'; form.append(submit);
    form.onsubmit = event => { event.preventDefault(); if (!form.reportValidity()) return;
      const selected = file.files[0];
      if (!selected?.name.toLowerCase().endsWith('.e365')) { error.textContent = 'Выберите файл с расширением .e365.'; error.focus(); return; }
      run(async () => {
        captured ||= await actions.upload(selected);
        evidence.replaceChildren(el('span', 'Исходный файл сохранён. '), link('Открыть для отдельного просмотра', '/p/' + captured.id + '/'));
        const snapshot = { projectId: captured.id, snapshotId: captured.currentSnapshotId, scope: partial ? 'partial' : 'full', scopeConfirmed: true };
        if (view === 'create') await actions.create({ name: name.value, baselineOwner: owner.value, snapshot });
        else await actions.prepare({ kind: partial ? 'change' : 'reconciliation', snapshot, expectedRevision: state.revision, sameSourceConfirmed: true,
          ...(partial ? { team: owner.value, taskRef: task.value } : { baselineOwner: owner.value }) });
      });
    };
    content.append(form); return root;
  }

  if (view === 'review' && review) {
    const full = review.kind === 'reconciliation', form = el('form'), boundaryKeys = new Set(), resolutions = {};
    content.append(el('h2', full ? 'Рассмотреть новый полный снимок' : 'Рассмотреть частичное изменение'),
      el('p', full ? `После принятия снимок станет новой базой. Ответственный: ${review.options.baselineOwner}. Сохранённые локальные изменения останутся отдельно.` : `Команда: ${review.options.team} · Задача: ${review.options.taskRef}. Принятие меняет рабочее состояние; исходная база сохранится.`));
    const gate = el('p', '', 'managed-note'); gate.setAttribute('role', 'status');
    const submit = el('button', full ? 'Принять новую базу' : 'Принять изменение'); submit.type = 'submit';
    const update = () => { gate.textContent = reviewGate(review, [...boundaryKeys], resolutions); submit.disabled = !!gate.textContent; submit.dataset.unavailable = String(submit.disabled); };
    for (const row of review.rows) {
      const card = el('section', undefined, 'managed-card'); card.append(el('h3', componentName(row.key)), el('p', row.conflict ? 'Конфликт с изменением другой команды' : labels[row.classification] || row.classification));
      if (row.previousTeam || row.team) card.append(el('p', 'Текущая ответственность: ' + (row.previousTeam || row.team)));
      if (row.removed) card.append(el('p', 'Объект отсутствует в новом полном снимке. Выбор снимка удалит его из рабочего состояния.'));
      if (!full && row.boundaryCrossing) {
        const choice = check(card, 'Проверено изменение объекта исходной базы'); choice.onchange = () => { choice.checked ? boundaryKeys.add(row.key) : boundaryKeys.delete(row.key); update(); };
      }
      if (full && row.classification === 'conflict') {
        const label = el('label', 'Какую версию сохранить'), choice = el('select'); choice.id = 'managed-choice-' + ++sequence; label.htmlFor = choice.id;
        for (const [value, caption] of [['', 'Выберите решение'], ['keep-working', 'Сохранить наше изменение'], ['take-snapshot', 'Взять версию из полного снимка']]) { const option = el('option', caption); option.value = value; choice.append(option); }
        choice.onchange = () => { resolutions[row.key] = choice.value; update(); }; card.append(label, choice);
      }
      technical(card, 'Идентичность и доказательства сравнения', row); form.append(card);
    }
    if (!review.rows.length) form.append(el('p', 'Изменений распознанных объектов нет. Проверьте полноту исходного снимка перед принятием.'));
    if (review.ambiguities.length) technical(form, 'Нераспознанные части', review.ambiguities);
    form.append(link('Скачать проверяемый оригинал', `/api/managed-workspaces/${state.id}/artifacts/${review.artifactId}/original`));
    const confirm = check(form, full ? 'Подтверждаю новую базу и выбранные решения; это не установка в ELMA' : 'Подтверждаю принятие рассмотренного изменения'); confirm.required = true;
    form.append(gate, submit); update();
    form.onsubmit = event => { event.preventDefault(); if (reviewGate(review, [...boundaryKeys], resolutions) || !form.reportValidity()) return;
      run(() => actions.accept(review.artifactId, { expectedRevision: review.revision, reviewedDigest: review.artifactDigest,
        ...(full ? { resolutions } : { reviewedBoundaryKeys: [...boundaryKeys] }) }));
    };
    content.append(form, link('Загрузить другой полный снимок', workspaceUrl(state.id, 'full'))); return root;
  }
  content.append(el('p', 'Сравнение недоступно. Вернитесь к обзору и выберите актуальное действие.'), link('К обзору', workspaceUrl(state?.id), true));
  return root;
}
