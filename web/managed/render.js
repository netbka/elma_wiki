import { componentName, dateLabel, labels, elementLabels, elementKinds, responsibilityLabel, responsibilityReport, reviewGate, workspaceSummary, workspaceUrl as buildUrl, solutionNextAction } from './model.js';
import { mountSnapshotVisual } from '../visual/render.js';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let sequence = 0;
export function mountManagedWorkspace(model = {}, actions = {}) {
  const { workspace: state, review, view = 'list', rows = [], synthetic = false } = model;
  const workspaceUrl = (id, view, artifact) => buildUrl(id, view, artifact, model.home || '/workspaces');
  const api = model.api || '/api/managed-workspaces';
  const root = el('div', undefined, 'managed-shell'), content = el('div', undefined, 'managed-content');
  const heading = el('h1', state?.name || (view === 'create' ? 'Добавить решение' : view === 'archived' ? 'Архив решений' : 'Решения'));
  heading.tabIndex = -1;
  const notice = el('p', model.loading ? 'Загружаем решение…' : model.notice || '', 'managed-notice'); notice.setAttribute('role', 'status');
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
  const controls = () => root.querySelectorAll('button,input,select,textarea');
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
      if (blocked) error.append(el('p', 'Проверьте актуальное состояние перед повтором. Введённый текст сохранён на этой странице.'), link('Обновить состояние', workspaceUrl(state?.id)));
      error.focus();
    } finally { busy = completed; notice.textContent = completed ? 'Сохранено. Открываем обновлённое состояние…' : ''; lock(); }
  };
  const nav = el('nav', undefined, 'managed-nav'); nav.setAttribute('aria-label', 'Решения');
  for (const [label, mode] of [['Решения', 'list'], ['Архив', 'archived']]) {
    const a = link(label, workspaceUrl(null, mode === 'list' ? null : mode));
    if (!state && view === mode) a.setAttribute('aria-current', 'page'); nav.append(a);
  }
  const secondary = el('details'); secondary.append(el('summary', 'Прежние личные файлы'), link('Открыть личные файлы', '/dashboard'));
  nav.append(secondary); root.append(nav, content); content.append(heading, notice, error);
  if (actions.logout) button('Выйти', () => run(actions.logout), nav);
  if (synthetic) content.append(el('p', 'Учебное решение. Данные синтетические; действия не изменяют ELMA.', 'managed-note'));
  if (model.loading) { root.setAttribute('aria-busy', 'true'); return root; }
  if (model.stale) { content.append(el('p', 'Сравнение устарело. Обновите решение и подготовьте новое сравнение.'), link('Обновить состояние', workspaceUrl(state?.id), true)); return root; }
  if (model.error && !state && !rows.length) { content.append(link('Повторить загрузку', workspaceUrl(null, view === 'archived' ? view : null), true)); return root; }

  if (!state && !['create'].includes(view)) {
    content.append(el('p', view === 'archived' ? 'История и исходные файлы сохранены.' : model.shared ? 'Решения доступны всем вошедшим пользователям сервиса.' : 'Прежние личные решения доступны только вам.'));
    if (!rows.length) {
      content.append(el('h2', view === 'archived' ? 'В архиве пока пусто' : 'Решений пока нет'));
    }
    if (view !== 'archived') content.append(link('Добавить решение', workspaceUrl(null, 'create'), true));
    const list = el('div', undefined, 'managed-list');
    for (const row of rows) {
      const summary = workspaceSummary(row), card = el('article', undefined, 'managed-card');
      card.append(el('h2', row.name), el('p', summary.source, 'managed-muted'),
        el('p', `Текущая версия: ${dateLabel(row.baselineAcceptedAt)}`),
        el('p', `Изменённых объектов: ${summary.changed} · Ожидают разбора: ${summary.pending}`),
        link(row.status === 'archived' ? 'Открыть архив' : 'Открыть решение', workspaceUrl(row.id))); list.append(card);
    }
    content.append(list); return root;
  }

  if (state) {
    const summary = workspaceSummary(state), context = el('div', undefined, 'managed-context');
    context.append(el('p', `${state.status === 'archived' ? 'Архив' : 'В работе'} · Текущая версия: ${dateLabel(state.baselineAcceptedAt)}`));
    const tabs = el('nav', undefined, 'solution-tabs'); tabs.setAttribute('aria-label', 'Разделы решения');
    for (const [label, mode] of [['Обзор', 'overview'], ['Изменения', 'changes'], ['Решение', 'solution']]) {
      const a = link(label, workspaceUrl(state.id, mode));
      if (view === mode || mode === 'changes' && ['change', 'full', 'review'].includes(view)) a.setAttribute('aria-current', 'page');
      tabs.append(a);
    }
    content.append(tabs);
    content.append(context);
    if (['overview', 'changes', 'solution'].includes(view)) {
      const next = solutionNextAction(state, model);
      const actionsBar = el('div', undefined, 'managed-actions');
      if (next.action !== 'reopen') actionsBar.append(link(next.label, workspaceUrl(state.id, next.view, next.artifact), true));
      if (state.status !== 'archived') {
        if (next.view !== 'change') actionsBar.append(link('Добавить изменение', workspaceUrl(state.id, 'change')));
        actionsBar.append(link('Обновить версию', workspaceUrl(state.id, 'full')));
      }
      content.append(el('h2', view === 'solution' ? `Объекты решения · ${state.current.length}` : view === 'changes' ? 'Изменения' : 'Что требует внимания'), el('p', next.summary), actionsBar);
      if (view === 'overview') content.append(el('p', `Изменённых объектов: ${summary.changed} · Ожидают рассмотрения: ${summary.pending}`));
      for (const pending of view === 'solution' ? [] : state.pending) {
        const card = el('article', undefined, 'managed-card');
        card.append(el('h3', pending.kind === 'change' ? `${pending.options.team} · ${pending.options.taskRef}` : 'Обновление текущей версии'),
          el('p', pending.stale ? 'Сравнение устарело. Подготовьте его заново.' : 'Изменение сохранено; решение ещё не принято.'),
          link(pending.stale ? 'Подготовить новое сравнение' : 'Рассмотреть изменения', workspaceUrl(state.id, pending.stale ? pending.kind === 'change' ? 'change' : 'full' : 'review', pending.stale ? null : pending.artifactId)),
          link('Скачать исходный файл', `${api}/${state.id}/artifacts/${pending.artifactId}/original`)); content.append(card);
      }
      const lower = el('div', undefined, 'managed-columns'), current = el('section'), history = el('section');
      current.append(el('h2', `Текущее состояние · ${state.current.length} объектов`));
      const table = el('table'), head = el('tr'); ['Объект', 'Ответственность', 'Состояние'].forEach(label => head.append(el('th', label))); table.append(head);
      for (const row of state.current) { const tr = el('tr'); tr.append(el('td', row.code), el('td', responsibilityLabel(row)), el('td', row.interventionId ? 'Принятое изменение' : 'Принятая версия')); table.append(tr); }
      const scroll = el('div', undefined, 'managed-table'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Рабочее состояние объектов'); scroll.append(table); current.append(scroll);
      history.append(el('h2', 'Принятые изменения'), el('p', `Изменений: ${state.changes.length} · Обновлений версии: ${state.reconciliations.length}`));
      for (const row of state.reviewedChanges || []) history.append(link(row.kind === 'change' ? row.options.taskRef : 'Обновление версии', workspaceUrl(state.id, 'review', row.artifactId)));
      const events = { created: 'Добавлено решение', 'change-accepted': 'Принято изменение', 'baseline-accepted': 'Принята новая версия', archived: 'Перемещено в архив', reopened: 'Работа возобновлена' };
      const list = el('ol'); state.history.forEach(row => list.append(el('li', events[row.type] || row.type))); history.append(list);
      const artifacts = el('details'); artifacts.append(el('summary', 'Исходные файлы и технические данные'), el('p', summary.source),
        el('p', `Заявленная ответственность: ${state.baselineOwner}. Авторы публикаций ELMA не установлены.`),
        el('p', 'Отсутствие объекта в частичном пакете не удаляет его. Текущее состояние не является готовым архивом для установки.'));
      state.artifacts.forEach((artifact, i) => { const item = el('div'); item.append(link(`Скачать файл ${i + 1}`, `${api}/${state.id}/artifacts/${artifact.id}/original`)); technical(item, 'Источник и контрольная сумма', { snapshot: artifact.snapshot, scope: artifact.scopeDeclaration, checksum: artifact.checksum, uploadedBy: artifact.uploadedBy }); artifacts.append(item); });
      history.append(artifacts);
      if (view === 'solution') lower.append(current);
      else if (view === 'changes') lower.append(history);
      else { const details = el('details'); details.append(el('summary', 'Объекты и история'), current, history); lower.append(details); }
      content.append(lower);
      const form = el('form', undefined, 'managed-archive');
      const confirm = check(form, state.status === 'archived' ? 'Возобновить работу с сохранённой базой и историей' : 'Убрать из активных; сохранить снимки, изменения и историю'); confirm.required = true;
      const submit = el('button', state.status === 'archived' ? 'Возобновить работу' : 'В архив', state.status === 'archived' ? '' : 'secondary'); submit.type = 'submit'; form.append(submit);
      form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) run(() => actions.archive({ archived: state.status !== 'archived', expectedRevision: state.revision })); };
      if (state.status === 'archived') content.append(form);
      else { const management = el('details'); management.append(el('summary', 'Архивировать решение'), form); content.append(management); }
      return root;
    }
  }

  if (view === 'create' || ['change', 'full'].includes(view)) {
    if (state?.status === 'archived') { content.append(el('p', 'Сначала возобновите работу из обзора решения.')); return root; }
    const partial = view === 'change', form = el('form', undefined, 'managed-form');
    content.append(el('h2', partial ? 'Добавить изменение' : view === 'create' ? 'Загрузить .e365' : 'Обновить текущую версию'));
    content.append(el('p', partial ? 'Загрузите частичный экспорт изменённых объектов. Остальные объекты сохранятся.' : 'Нужен полный экспорт решения из ELMA365. Частичный экспорт не подходит.'));
    const name = view === 'create' ? field(form, 'Название решения') : null;
    const owner = field(form, partial ? 'Ответственная команда' : 'Кто отвечает за исходную версию', 'text', partial ? '' : state?.baselineOwner || ''); owner.required = true;
    if (name) name.required = true;
    const task = partial ? field(form, 'Что изменили') : null; if (task) task.required = true;
    const file = field(form, 'Файл .e365', 'file'); file.accept = '.e365'; file.required = true;
    const evidence = el('p'); form.append(evidence);
    let captured = null;
    file.onchange = () => { captured = null; evidence.replaceChildren(); };
    const scope = check(form, partial ? 'Это частичный экспорт изменений' : 'Это полный экспорт решения'); scope.required = true;
    const sameSource = state ? check(form, 'Экспорт относится к этому решению и тому же источнику ELMA') : null;
    if (sameSource) sameSource.required = true;
    if (model.shared) { const shared = check(form, 'Файл доступен всем пользователям сервиса'); shared.required = true; }
    form.append(el('p', 'Загрузка сохраняет исходный файл. Она ничего не устанавливает в ELMA.', 'managed-muted'));
    const submit = el('button', view === 'create' ? 'Добавить решение' : 'Сохранить и рассмотреть'); submit.type = 'submit'; form.append(submit);
    form.onsubmit = event => { event.preventDefault(); if (!form.reportValidity()) return;
      const selected = file.files[0];
      if (!selected?.name.toLowerCase().endsWith('.e365')) { error.textContent = 'Выберите файл с расширением .e365.'; error.focus(); return; }
      run(async () => {
        captured ||= await actions.upload(selected);
        evidence.replaceChildren(el('span', 'Исходный файл сохранён.'));
        if (!model.shared) evidence.append(link('Открыть личный файл', '/p/' + captured.id + '/'));
        const snapshot = { projectId: captured.id, snapshotId: captured.currentSnapshotId, scope: partial ? 'partial' : 'full', scopeConfirmed: true };
        if (view === 'create') await actions.create({ name: name.value, baselineOwner: owner.value, snapshot, ...(model.shared ? { sharedConfirmed: true } : {}) });
        else await actions.prepare({ kind: partial ? 'change' : 'reconciliation', snapshot, expectedRevision: state.revision, sameSourceConfirmed: true,
          ...(partial ? { team: owner.value, taskRef: task.value } : { baselineOwner: owner.value }) });
      });
    };
    content.append(form); return root;
  }

  if (view === 'review' && review) {
    let selectedSource = null, showSelectedSource = () => {};
    if (actions.visual) {
      const details=el('details'), target=el('div');
      details.append(el('summary','Посмотреть процесс и форму'),target); content.append(details);
      let loaded=false;
      const load=async()=>{
        target.replaceChildren(mountSnapshotVisual({loading:true}));
        try { target.replaceChildren(mountSnapshotVisual(await actions.visual(review.artifactId), {
          selectAnchor: anchor => { selectedSource = anchor; showSelectedSource(); }
        })); loaded=true; }
        catch(e){target.replaceChildren(mountSnapshotVisual({error:e.message},{retry:load}));}
      };
      details.ontoggle=()=>{if(details.open&&!loaded)load();};
    }
    const full = review.kind === 'reconciliation', form = el('form'), boundaryKeys = new Set(), resolutions = {};
    content.append(el('h2', full ? 'Рассмотреть обновление версии' : 'Рассмотреть изменение'),
      el('p', full ? `После принятия это станет текущей версией. Заявленная ответственность: ${review.options.baselineOwner}.` : `Ответственная команда: ${review.options.team} · ${review.options.taskRef}.`));
    if (review.uploadedBy) content.append(el('p', `Загрузил: ${review.uploadedBy.login}`));
    button('Скачать отчёт об ответственности', () => {
      const url = URL.createObjectURL(new Blob([responsibilityReport(state, review)], { type: 'text/plain;charset=utf-8' }));
      const a = el('a'); a.href = url; a.download = 'responsibility-review.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).className = 'secondary';
    if (review.acceptedAt) content.append(el('p', `Принято: ${dateLabel(review.acceptedAt)} · ${review.acceptedDecision?.actor?.login || 'Автор решения не зафиксирован'}`, 'managed-accepted'));
    if (review.stale) content.append(el('p', 'Это прежнее рассмотрение. Комментарии и исходные ссылки сохранены; новые решения здесь недоступны.', 'managed-note'),
      link(review.supersededBy ? 'Открыть актуальное изменение' : 'Обновить состояние', workspaceUrl(state.id, review.supersededBy ? 'review' : null, review.supersededBy), true));
    const gate = el('p', '', 'managed-note'); gate.setAttribute('role', 'status');
    const submit = el('button', full ? 'Принять версию' : 'Принять изменение'); submit.type = 'submit';
    const update = () => { gate.textContent = reviewGate(review, [...boundaryKeys], resolutions); submit.disabled = !!gate.textContent; submit.dataset.unavailable = String(submit.disabled); };
    for (const row of review.rows) {
      const card = el('section', undefined, 'managed-card'); card.append(el('h3', componentName(row.key)), el('p', row.conflict ? 'Конфликт с изменением другой команды' : labels[row.classification] || row.classification));
      if (row.elements) {
        card.append(el('h4', 'Ответственность частей процесса'),
          el('p', 'Заявленная командой ответственность. Авторы публикаций ELMA и договорная ответственность не установлены.', 'managed-muted'));
        if (!row.elements.complete || row.elements.residualChanged) card.append(el('p', 'Часть данных не установлена или изменены прочие данные. Сохраняется проверка всего объекта.', 'managed-note'));
        const table = el('table'), head = el('tr'); ['Часть', 'Было', 'Изменение'].forEach(label => head.append(el('th', label))); table.append(head);
        for (const part of row.elements.rows.slice(0, 100)) {
          const tr = el('tr'); tr.append(el('td', `${elementKinds[part.kind] || part.kind}: ${part.name} (${part.code})${part.kind === 'transition' ? ' · ' + (part.from || '?') + ' → ' + (part.to || '?') : ''}`), el('td', part.team || 'Не установлена'),
            el('td', `${elementLabels[part.classification] || part.classification}${part.boundaryCrossing ? ' · граница исходной версии' : ''}${part.conflict ? ' · конфликт команд' : ''}`)); table.append(tr);
        }
        const scroll = el('div', undefined, 'managed-table'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Ответственность частей процесса'); scroll.append(table); card.append(scroll);
        if (row.elements.rows.length > 100) card.append(el('p', 'Показаны первые 100 частей. Полный список — в отчёте об ответственности.'));
        if (full && row.classification === 'conflict') card.append(el('p', 'Части помогают понять конфликт. Выбор версии применяется ко всему исходному файлу процесса; автоматического объединения нет.'));
      } else if (row.previousTeam || row.team) card.append(el('p', 'Текущая ответственность: ' + (row.previousTeam || row.team)));
      if (row.removed) card.append(el('p', 'Объект отсутствует в новом полном снимке. Выбор снимка удалит его из рабочего состояния.'));
      if (!full && row.boundaryCrossing && !review.acceptedAt && !review.stale) {
        const choice = check(card, 'Изменение принятого объекта проверено'); choice.onchange = () => { choice.checked ? boundaryKeys.add(row.key) : boundaryKeys.delete(row.key); update(); };
      }
      if (full && row.classification === 'conflict' && !review.acceptedAt && !review.stale) {
        const label = el('label', 'Какую версию сохранить'), choice = el('select'); choice.id = 'managed-choice-' + ++sequence; label.htmlFor = choice.id;
        for (const [value, caption] of [['', 'Выберите решение'], ['keep-working', 'Сохранить наше изменение'], ['take-snapshot', 'Взять версию из полного снимка']]) { const option = el('option', caption); option.value = value; choice.append(option); }
        choice.onchange = () => { resolutions[row.key] = choice.value; update(); }; card.append(label, choice);
      }
      if (full && row.classification === 'conflict' && review.acceptedAt) card.append(el('p', review.acceptedDecision?.resolutions?.[row.key] === 'keep-working' ? 'Сохранена принятая версия' : review.acceptedDecision?.resolutions?.[row.key] === 'take-snapshot' ? 'Принята версия из экспорта' : 'Решение по конфликту не зафиксировано'));
      const context = review.contexts?.find(item => item.key === row.key);
      if (context && actions.context) {
        const target = el('div', undefined, 'change-context'), show = button('Было и стало', async () => {
          if (busy) return; show.disabled = true; target.replaceChildren(el('p', 'Загружаем исходные данные…'));
          try {
            const results = await Promise.allSettled([context.beforeArtifactId, context.afterArtifactId].map(id => id ? actions.context(id, context.objectRef) : Promise.resolve(null)));
            target.replaceChildren();
            results.forEach((result, index) => {
              const panel = el('section'); panel.append(el('h4', index ? 'Стало' : 'Было'));
              if (result.status === 'rejected') panel.append(el('p', result.reason.message));
              else if (!result.value) panel.append(el('p', index ? 'Отсутствует в полном экспорте' : 'Новый объект'));
              else {
                const data = result.value; panel.append(el('p', data.source, 'managed-muted'));
                technical(panel, 'Исходные данные объекта', data.content || 'Предпросмотр недоступен: неизвестные данные или превышен лимит');
                if (index && data.editable && state.status === 'active') panel.append(link('Открыть код объекта', data.editorUrl));
                panel.append(el('p', data.limitation, 'managed-muted'));
              }
              target.append(panel);
            });
          } catch (e) { target.replaceChildren(el('p', e.message)); }
          finally { show.disabled = false; }
        }, card); show.className = 'secondary'; card.append(target);
      }
      technical(card, 'Идентичность и доказательства сравнения', row); form.append(card);
    }
    if (!review.rows.length) form.append(el('p', 'Изменений распознанных объектов нет. Проверьте полноту исходного снимка перед принятием.'));
    if (review.ambiguities.length) technical(form, 'Нераспознанные части', review.ambiguities);
    form.append(link('Скачать исходный файл', `${api}/${state.id}/artifacts/${review.artifactId}/original`));
    if (!review.acceptedAt && !review.stale) {
      const confirm = check(form, full ? 'Принимаю версию и выбранные решения; установка в ELMA не выполняется' : 'Принимаю рассмотренное изменение'); confirm.required = true;
      form.append(gate, submit); update();
      if (review.discussion?.blocking) submit.hidden = true;
    }
    form.onsubmit = event => { event.preventDefault(); if (reviewGate(review, [...boundaryKeys], resolutions) || !form.reportValidity()) return;
      run(() => actions.accept(review.artifactId, { expectedRevision: review.revision, reviewedDigest: review.artifactDigest,
        ...(review.discussion ? { expectedDiscussionRevision: review.discussion.version } : {}),
        ...(full ? { resolutions } : { reviewedBoundaryKeys: [...boundaryKeys] }) }));
    };
    content.append(form);
    if (review.discussion) {
      const discussion = el('section', undefined, 'change-discussion'); discussion.append(el('h2', 'Комментарии и замечания'));
      const anchorLabels = { current: 'Объект совпадает', stale: 'Объект изменился; исходная ссылка сохранена', removed: 'Объект удалён из полного экспорта', ambiguous: 'Связь с объектом неоднозначна' };
      const stepLabels = { current: 'Шаг совпадает', stale: 'Шаг изменился; исходная ссылка сохранена', removed: 'Шаг отсутствует в новом процессе', ambiguous: 'Связь с шагом неоднозначна' };
      const editable = !review.stale && state.status === 'active';
      const entry = (parent, label, type, parentId) => {
        const f = el('form'), caption = el('label', label), text = el('textarea'); text.id = 'change-comment-' + ++sequence; text.required = true; text.maxLength = 4000; caption.htmlFor = text.id; f.append(caption, text);
        let key;
        if (!parentId) { key = el('select'); key.setAttribute('aria-label', 'К чему относится комментарий'); const all = el('option', 'К изменению'); all.value = ''; key.append(all);
          review.rows.forEach(row => { const option = el('option', componentName(row.key)); option.value = row.key; key.append(option); }); f.append(key);
          const sourceCaption = el('p', '', 'managed-muted'); sourceCaption.setAttribute('role', 'status'); f.append(sourceCaption);
          showSelectedSource = () => {
            if (selectedSource) {
              const value = JSON.stringify(selectedSource.object);
              if (![...key.options].some(option => option.value === value)) { const option = el('option', selectedSource.object[2]); option.value = value; key.append(option); }
              key.value = value; sourceCaption.textContent = 'Комментарий к выбранному шагу: ' + selectedSource.nodeId;
            }
            else sourceCaption.textContent = '';
          };
          key.onchange = () => { selectedSource = null; showSelectedSource(); };
          showSelectedSource();
        }
        const send = async kind => { await actions.comment(review.artifactId, { expectedRevision: state.revision,
          expectedDiscussionRevision: review.discussion.version, type: kind, text: text.value,
          ...(parentId ? { parentId } : key?.value ? { componentKey: key.value, ...(selectedSource ? { sourceAnchor: selectedSource } : {}) } : {}) }); };
        const submit = el('button', type === 'comment' ? 'Комментарий' : type === 'reply' ? 'Ответить' : type === 'resolve' ? 'Замечание устранено' : 'Открыть замечание', 'secondary'); submit.type = 'submit'; f.append(submit);
        f.onsubmit = event => { event.preventDefault(); if (f.reportValidity()) run(() => send(type)); };
        if (type === 'comment') button('Нужны изменения', () => { if (f.reportValidity()) run(() => send('reject')); }, f).className = 'secondary';
        parent.append(f);
      };
      if (!review.discussion.findings.length) discussion.append(el('p', 'Комментариев пока нет.'));
      for (const finding of review.discussion.findings) {
        const card = el('article', undefined, 'managed-card'); card.append(el('h3', finding.type === 'reject' ? finding.status === 'open' ? 'Нужны изменения' : 'Замечание устранено' : 'Комментарий'),
          el('p', `${finding.actor?.login || finding.author} · ${dateLabel(finding.createdAt)}`, 'managed-muted'), el('p', finding.text, 'change-text'));
        if (finding.anchor?.key) card.append(el('p', `${componentName(finding.anchor.key)} · ${(finding.sourceAnchor ? stepLabels : anchorLabels)[finding.anchorStatus]}`, 'managed-muted'));
        if (finding.sourceAnchor) { card.append(el('p', 'Шаг: ' + finding.sourceAnchor.nodeId)); technical(card, 'Исходная ссылка на шаг', finding.sourceAnchor); }
        for (const reply of finding.replies) card.append(el('p', `${reply.actor?.login || reply.author}: ${reply.text}`, 'change-text'));
        if (finding.resolution) card.append(el('p', `${finding.resolution.actor?.login || finding.resolution.author}: ${finding.resolution.text}`, 'change-text'));
        if (editable) { const d = el('details'); d.append(el('summary', 'Ответить или изменить статус')); entry(d, 'Ответ', 'reply', finding.id);
          if (finding.type === 'reject') entry(d, 'Что исправлено или что ещё нужно изменить', finding.status === 'open' ? 'resolve' : 'reopen', finding.id); card.append(d); }
        discussion.append(card);
      }
      if (editable) entry(discussion, 'Комментарий к изменению', 'comment');
      content.append(discussion);
      if (editable) content.append(link('Добавить исправление', workspaceUrl(state.id, full ? 'full' : 'change', review.artifactId), !!(review.acceptedAt || review.discussion.blocking)));
    }
    content.append(link('Загрузить другую версию', workspaceUrl(state.id, 'full'))); return root;
  }
  content.append(el('p', 'Сравнение недоступно. Вернитесь к обзору и выберите актуальное действие.'), link('К обзору', workspaceUrl(state?.id), true));
  return root;
}
