import { objectKind, componentName, dateLabel, labels, elementLabels, elementKinds, responsibilityLabel, responsibilityReport, reviewGate, workspaceSummary, workspaceUrl as buildUrl, solutionNextAction, objectLabel, objectFromKey, groupObjects, reviewSummary, reviewBucket, objectModule } from './model.js';
import { nouns, grouping, ribbon, facts, reviewSummary as summaryLabels, decision as decisionLabels, diagram as diagramLabels, tabs as tabLabels, header as headerLabels, stepStates } from './labels.js';
import { decisionChoices, decisionDefault, canCloseWithoutChanges, solutionStatus, lifecycleSteps } from './model.js';
import { mountSnapshotVisual } from '../visual/render.js';
import { mountExplanation } from '../explanations/render.js';
import { mountRelease } from '../releases/render.js';
import { hasAcceptedFullExport, requestCounts, fieldRequestCounts, viewedProgress, acceptedMergeTarget } from './model.js';
import { mountAcquisition, mountSolutionPull, serverFromConnection } from './acquisition.js';
import { actions as actionLabels, pull as pullLabels, partMerge, reviewPlain } from './labels.js';
import { mountDependencies } from './dependencies.js';
import { mountMergeResolution, mergeResolutionView } from './merge.js';
import { mountComposer } from './composer.js';
import { mountAbout, mountActivity } from './about.js';
import { mountFlows, mountScreens } from './flows.js';
import { mountRequests, mountRequestForm } from './requests.js';
import { acceptedFullBases, baseOptionLabel, baseEvidence, scopeEvidence, scopeCandidates, preparationFields } from './change-base.js';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let sequence = 0;
export function mountManagedWorkspace(model = {}, actions = {}) {
  const { workspace: state, review, view = 'list', rows = [], synthetic = false } = model;
  const workspaceUrl = (id, view, artifact) => buildUrl(id, view, artifact, model.home || '/workspaces');
  const api = model.api || '/api/managed-workspaces';
  const root = el('div', undefined, 'managed-shell'), content = el('div', undefined, 'managed-content');
  const heading = el('h1', state?.name || (view === 'create' ? actionLabels.loadSolution : view === 'archived' ? 'Архив решений' : 'Решения'));
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
  // Business name first; the technical code follows muted. A name-less technical
  // key is marked so styles can show it as code (UX-02).
  const objectTitle = (tag, row, extra) => {
    const label = objectLabel(row), node = el(tag, label.text, label.technical ? 'managed-technical' : undefined);
    if (label.secondary) node.append(' ', el('small', label.secondary, 'managed-muted managed-code'));
    if (extra) node.append(' ', el('small', extra, 'managed-muted'));
    return node;
  };
  // Review rows carry only the key; take the display metadata from the current state or the reviewed artifact.
  const objectOf = (key, artifactId) => state?.current?.find(row => row.key === key)
    || state?.artifacts?.find(row => row.id === artifactId)?.components?.find(row => row.key === key)
    || state?.artifacts?.flatMap(row => row.components || []).find(row => row.key === key) || objectFromKey(key);
  const controls = () => root.querySelectorAll('button,input,select,textarea');
  const lock = () => controls().forEach(node => { node.disabled = busy || blocked || node.dataset.unavailable === 'true'; });
  const run = async (operation, refreshHref = workspaceUrl(state?.id)) => {
    if (busy || blocked) return;
    // Preserve disabled states while awaiting a response, and preserve form values on errors.
    controls().forEach(node => { node.dataset.unavailable = String(node.disabled); });
    busy = true; lock(); error.textContent = ''; notice.textContent = 'Сохраняем. Дождитесь ответа…';
    let completed = false;
    try { completed = await operation() !== false; }
    catch (e) {
      blocked = e.status === 409 || e.requiresRefresh;
      error.textContent = e.message || 'Не удалось выполнить действие.';
      if (blocked) error.append(el('p', 'Проверьте актуальное состояние перед повтором. Введённый текст сохранён на этой странице.'), link('Обновить состояние', refreshHref));
      error.focus();
    } finally { busy = completed; notice.textContent = completed ? 'Сохранено. Открываем обновлённое состояние…' : ''; lock(); }
  };
  const nav = el('nav', undefined, 'managed-nav'); nav.setAttribute('aria-label', 'Решения');
  for (const [label, mode] of [['Решения', 'list'], ['Архив', 'archived']]) {
    const a = link(label, workspaceUrl(null, mode === 'list' ? null : mode));
    if (!state && view === mode) a.setAttribute('aria-current', 'page'); nav.append(a);
  }
  const secondary = el('details'); secondary.append(el('summary', 'Прежние загрузки'), link('Открыть загруженные файлы', '/dashboard'));
  // Manual .e365 upload is legacy compatibility, reachable only from here.
  if (model.shared) secondary.append(link(pullLabels.manualFile, workspaceUrl(null, 'create') + '&mode=file'));
  nav.append(secondary); root.append(nav, content); content.append(heading, notice, error);
  if (actions.logout) button('Выйти', () => run(actions.logout), nav);
  if (synthetic) content.append(el('p', 'Учебное решение. Данные синтетические; действия не изменяют ELMA.', 'managed-note'));
  if (model.loading) { root.setAttribute('aria-busy', 'true'); return root; }
  if (model.stale) { content.append(el('p', 'Сравнение устарело. Обновите решение и подготовьте новое сравнение.'), link('Обновить состояние', workspaceUrl(state?.id), true)); return root; }
  if (model.error && !state && !rows.length) { content.append(link('Повторить загрузку', workspaceUrl(null, view === 'archived' ? view : null), true)); return root; }

  if (!state && !['create'].includes(view)) {
    content.append(el('p', view === 'archived' ? 'История и исходные файлы сохранены.' : 'Решения доступны всем вошедшим пользователям сервиса.'));
    if (!rows.length) {
      content.append(el('h2', view === 'archived' ? 'В архиве пока пусто' : 'Решений пока нет'));
    }
    if (view !== 'archived') content.append(link(model.shared ? actionLabels.loadSolution : 'Добавить решение', workspaceUrl(null, 'create'), true));
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
    // UX-04: the header carries the status badge, the version date and the lifecycle
    // stepper, all projected from `solutionNextAction`; nothing here adds state.
    const next = solutionNextAction(state, model), status = solutionStatus(next);
    const headline = el('p', undefined, 'managed-headline'), badge = el('span', status.label, 'managed-badge managed-badge-' + status.key);
    badge.setAttribute('aria-label', `${headerLabels.status}: ${status.label}`);
    headline.append(badge, ' · ', `${headerLabels.versionFrom} ${dateLabel(state.baselineAcceptedAt)}`);
    context.append(headline);
    const stepper = el('ol', undefined, 'managed-stepper'); stepper.setAttribute('aria-label', headerLabels.steps);
    for (const step of lifecycleSteps(state, next, model.composed)) {
      const item = el('li', undefined, 'managed-step'); item.dataset.state = step.state;
      if (step.current) item.setAttribute('aria-current', 'step');
      if (step.state === 'unavailable') item.setAttribute('aria-disabled', 'true');
      item.append(el('span', step.label), ' ', el('small', step.reason || step.note || stepStates[step.state], 'managed-muted'));
      stepper.append(item);
    }
    if (stepper.childElementCount) context.append(stepper);
    const tabs = el('nav', undefined, 'solution-tabs'); tabs.setAttribute('aria-label', headerLabels.sections);
    // Tab names and order follow the plan's vocabulary (§6.2). "Как работает" and
    // "Запросы" arrive with UX-06 and UX-07; until then the object inventory, processes
    // included, sits under "Экраны и данные".
    for (const [label, mode] of [[tabLabels.about, 'overview'], [tabLabels.flows, 'flows'], [tabLabels.screensAndData, 'solution'], [tabLabels.changes, 'changes'], ...(model.shared ? [[tabLabels.requests, 'requests']] : [])]) {
      const a = link(label, workspaceUrl(state.id, mode));
      if (view === mode || mode === 'changes' && ['change', 'full', 'review'].includes(view)) a.setAttribute('aria-current', 'page');
      tabs.append(a);
    }
    // The composer lives inside the Solution once a change was accepted; it is not a top-level destination.
    const composeHref = candidate => workspaceUrl(state.id, 'compose') + (candidate ? '&candidate=' + encodeURIComponent(candidate) : '');
    if (model.shared && (state.changes?.length || state.reconciliations?.length || view === 'compose')) {
      const tab = link(tabLabels.build, composeHref());
      if (view === 'compose') tab.setAttribute('aria-current', 'page'); tabs.append(tab);
    }
    if (model.shared && (hasAcceptedFullExport(state) || view === 'handoff')) {
      const tab = link(headerLabels.handoff, workspaceUrl(state.id, 'handoff'));
      if (view === 'handoff') tab.setAttribute('aria-current', 'page'); tabs.append(tab);
    }
    content.append(tabs);
    content.append(context);
    if (view === 'handoff' && model.shared) {
      if (model.error) { content.append(link('Повторить загрузку передачи', workspaceUrl(state.id, 'handoff'), true)); return root; }
      content.append(mountRelease({ ...actions.handoff, release: model.handoff, releases: model.handoffs || [],
        solution: { id: state.id, url: workspaceUrl(state.id), canCreate: !!model.exportEvidence, reason: model.handoffReason } }));
      return root;
    }
    if (view === 'compose' && model.shared) {
      content.append(mountComposer({ candidates: model.composed?.candidates || [], build: model.composed?.build, eligibility: model.composed?.eligibility, selected: model.composed?.selected || null,
        selectedId: model.composed?.selectedId, loadError: model.composed?.loadError, error: model.composed?.error, target: acceptedMergeTarget(state) }, { ...actions.composed, link, candidateHref: composeHref, listHref: composeHref() }));
      return root;
    }
    // UX-07: requests are a Solution feature; the entry points open the form in place,
    // the chips lead to the tab filtered by object. Story and page supply `actions.requests`.
    const requestConfig = model.requests?.publication || {}, requestActions = model.shared && actions.requests ? { ...actions.requests, navigate: actions.navigate } : {};
    const entryActions = model.shared && actions.requests ? {
      requestChange: entry => { const dialog = mountRequestForm({ state, config: requestConfig, home: model.home, ...entry }, requestActions); content.append(dialog); dialog.openModal(); },
      requestCounts: requestCounts(model.requests?.requests || []), fieldRequestCounts: fieldRequestCounts(model.requests?.requests || []), requestHref: key => workspaceUrl(state.id, 'requests', null, model.home) + '&object=' + encodeURIComponent(key)
    } : {};
    if (['overview', 'changes', 'solution', 'flows', 'requests'].includes(view)) {
      // UX-04: the header carries the one primary button (the recommended action) and the
      // Обновить link, the only secondary way to a new version. The partial-export path
      // stays under the technical details below.
      const actionsBar = el('div', undefined, 'managed-actions');
      if (next.action !== 'reopen') actionsBar.append(link(next.label, next.view === 'compose' ? composeHref(next.candidate) : workspaceUrl(state.id, next.view, next.artifact), true));
      if (state.status !== 'archived' && next.view !== 'full') actionsBar.append(link(model.shared ? actionLabels.refresh : 'Обновить версию', workspaceUrl(state.id, 'full')));
      context.append(actionsBar);
      // UX-07: Запросы has the same header; the tab body is the list and the selected record.
      if (view === 'requests' && model.shared) {
        content.append(mountRequests({ state, requests: model.requests?.requests || [], publication: model.requests?.selectedPublication || null, config: requestConfig, selected: model.request || null,
          object: model.object || null, loadError: model.requests?.loadError || null, home: model.home, now: model.now }, requestActions));
        if (model.requestForm) { const dialog = mountRequestForm({ state, config: requestConfig, home: model.home, ...model.requestForm }, requestActions); content.append(dialog); queueMicrotask(() => dialog.openModal()); }
        return root;
      }
      // UX-05: О решении opens with the purpose and the modules; attention follows.
      if (view === 'overview') content.append(mountAbout({ state, about: model.about || {}, editing: !!model.aboutEditing, now: model.now }, { explanations: actions.explanations, navigate: actions.navigate, open: () => workspaceUrl(state.id, 'solution') }));
      // UX-06: Как работает is the process tab; it has no attention block of its own.
      if (view === 'flows') { content.append(mountFlows({ state, visuals: model.visuals || {}, selected: model.object || null }, { visual: actions.visual, explanations: actions.explanations, navigate: actions.navigate, ...entryActions })); return root; }
      content.append(el('h2', view === 'solution' ? `Объекты решения · ${state.current.filter(row => objectKind(row) !== 'processes').length}` : view === 'changes' ? 'Изменения' : 'Что требует внимания'), el('p', next.summary));
      if(actions.explanations && ['overview','solution'].includes(view)){
        const evidence=el('div');
        content.append(mountExplanation({target:{scope:'solution'},label:'Объяснить решение'}, {...actions.explanations,
          openSource:async reference=>{
            evidence.replaceChildren(el('p','Загружаем источник…'));
            try {
              const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reference.componentKey));
              const ref=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
              const value=await actions.context(reference.artifactId,ref);
              const title=el('h3',value.name||value.code);title.tabIndex=-1;
              evidence.replaceChildren(title,el('p',value.source),el('pre',value.content||'Исходный текст недоступен в пределах просмотра.'));
              title.focus();
            }catch(e){const alert=el('p',e.message);alert.setAttribute('role','alert');evidence.replaceChildren(alert);}
          }
        }),evidence);
      }
      if (view === 'overview') content.append(el('p', `Изменённых объектов: ${summary.changed} · Ожидают рассмотрения: ${summary.pending}`));
      if (view === 'overview') content.append(mountActivity(state, { now: model.now }));
      for (const pending of view === 'solution' ? [] : state.pending) {
        const card = el('article', undefined, 'managed-card');
        card.append(el('h3', pending.kind === 'change' ? `${pending.options.team} · ${pending.options.taskRef}` : 'Обновление текущей версии'),
          el('p', pending.stale ? 'Сравнение устарело. Подготовьте его заново.' : 'Изменение сохранено; решение ещё не принято.'),
          ...(pending.baseDeclaration ? [el('p', baseEvidence(pending.baseDeclaration).title, 'managed-muted')] : []),
          link(pending.stale ? 'Подготовить новое сравнение' : 'Рассмотреть изменения', workspaceUrl(state.id, pending.stale ? pending.kind === 'change' ? 'change' : 'full' : 'review', pending.stale ? null : pending.artifactId)),
          link('Скачать исходный файл', `${api}/${state.id}/artifacts/${pending.artifactId}/original`)); content.append(card);
      }
      const lower = el('div', undefined, 'managed-columns'), current = el('section'), history = el('section');
      current.append(el('h2', `Текущее состояние · ${state.current.length} объектов`));
      const visualTarget=el('div');
      // UX-02: objects grouped by module and kind with business names; system objects (permissions,
      // localization, name-less defaults) are one collapsed group. The Solution tab shows the groups;
      // Overview keeps the flat table inside its disclosure.
      const grouped = view === 'solution' ? groupObjects(state.current) : null;
      const objectTable = rows => {
      const table = el('table'), head = el('tr'); ['Объект', 'Ответственность', 'Состояние',...(actions.explanations?['Просмотр']:[])].forEach(label => head.append(el('th', label))); table.append(head);
      for (const row of rows) {
        const tr = el('tr'); tr.append(objectTitle('td', row), el('td', responsibilityLabel(row)), el('td', row.interventionId ? 'Принятое изменение' : 'Принятая версия'));
        if(actions.explanations){
          const cell=el('td');
          if(row.service==='processor'){
            const captured=state.artifacts.filter(artifact=>artifact.components.some(component=>component.key===row.key&&component.digest===row.digest)).at(-1);
            const load=async()=>{
              visualTarget.replaceChildren(mountSnapshotVisual({loading:true}));
              try{
                const value=await actions.visual(captured.id);
                value.processes=value.processes.filter(process=>JSON.stringify(process.object)===row.key);
                visualTarget.replaceChildren(mountSnapshotVisual(value,{explanations:actions.explanations}));
              }catch(e){visualTarget.replaceChildren(mountSnapshotVisual({error:e.message},{retry:load}));}
            };
            if(captured)button('Посмотреть процесс: '+row.code,load,cell).className='secondary';
          }
          tr.append(cell);
        }
        table.append(tr);
      }
      const scroll = el('div', undefined, 'managed-table'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Рабочее состояние объектов'); scroll.append(table); return scroll;
      };
      if (!grouped) current.append(objectTable(state.current));
      // UX-06: Экраны и данные shows forms and data objects with their declared fields,
      // searchable, system objects collapsed; processes live on Как работает.
      else current.append(mountScreens({ state, visuals: model.visuals || {} }, { navigate: actions.navigate, flowsHref: workspaceUrl(state.id, 'flows'), ...entryActions }));
      current.append(visualTarget);
      history.append(el('h2', 'Принятые изменения'), el('p', `Изменений: ${state.changes.length} · Обновлений версии: ${state.reconciliations.length}`));
      for (const row of state.reviewedChanges || []) history.append(link(`${row.kind === 'change' ? row.options.taskRef : 'Обновление версии'}${row.closedAt ? ` · ${decisionLabels.closedNoChanges}` : ''}`, workspaceUrl(state.id, 'review', row.artifactId)));
      const events = { created: 'Добавлено решение', 'change-accepted': 'Принято изменение', 'baseline-accepted': 'Принята новая версия', 'closed-no-changes': decisionLabels.closedNoChanges, archived: 'Перемещено в архив', reopened: 'Работа возобновлена' };
      const list = el('ol'); state.history.forEach(row => list.append(el('li', events[row.type] || row.type))); history.append(list);
      const artifacts = el('details'); artifacts.append(el('summary', 'Исходные файлы и технические данные'), el('p', summary.source),
        el('p', `Заявленная ответственность: ${state.baselineOwner}. Авторы публикаций ELMA не установлены.`),
        el('p', 'Отсутствие объекта в частичном пакете не удаляет его. Текущее состояние не является готовым архивом для установки.'));
      if (model.shared) artifacts.append(link('История передачи решения', workspaceUrl(state.id, 'handoff')));
      if (state.status !== 'archived') artifacts.append(link(model.shared ? pullLabels.legacyChange : 'Добавить изменение', workspaceUrl(state.id, 'change')));
      state.artifacts.forEach((artifact, i) => { const item = el('div'); item.append(link(`Скачать файл ${i + 1}`, `${api}/${state.id}/artifacts/${artifact.id}/original`)); technical(item, 'Источник и контрольная сумма', { snapshot: artifact.snapshot, scope: artifact.scopeDeclaration, checksum: artifact.checksum, uploadedBy: artifact.uploadedBy }); artifacts.append(item); });
      history.append(artifacts);
      if (view === 'solution') {lower.style.gridTemplateColumns='minmax(0,1fr)';lower.append(current);}
      else if (view === 'changes') lower.append(history);
      else { const details = el('details'); details.append(el('summary', nouns.versionsAndHistory), current, history); lower.append(details); }
      content.append(lower);
      for (const artifact of state.artifacts) if (artifact.dependencies?.rows?.length) {
        const details = el('details'); details.append(el('summary', `Зависимости исходного файла ${state.artifacts.indexOf(artifact) + 1}`), mountDependencies(artifact.dependencies)); content.append(details);
      }
      const form = el('form', undefined, 'managed-archive');
      const confirm = check(form, state.status === 'archived' ? 'Возобновить работу с сохранённой базой и историей' : 'Убрать из активных; сохранить снимки, изменения и историю'); confirm.required = true;
      const submit = el('button', state.status === 'archived' ? 'Возобновить работу' : 'В архив', state.status === 'archived' ? '' : 'secondary'); submit.type = 'submit'; form.append(submit);
      form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) run(() => actions.archive({ archived: state.status !== 'archived', expectedRevision: state.revision })); };
      if (state.status === 'archived') content.append(form);
      else { const management = el('details'); management.append(el('summary', actionLabels.toArchive), form); content.append(management); }
      return root;
    }
  }

  if (view === 'create' || ['change', 'full'].includes(view)) {
    if (state?.status === 'archived') { content.append(el('p', 'Сначала возобновите работу из обзора решения.')); return root; }
    // UX-01 fixed path: pull the whole solution from a named server. The file
    // form below remains for legacy uploads (`mode=file`) and partial changes.
    const source = state ? (state.artifacts?.find(row => row.snapshot?.source)?.snapshot.source || state.sourceReference || null) : null;
    const pullable = model.shared && actions.acquisition && !model.legacy && (view === 'create' || view === 'full' && serverFromConnection(source?.connectionId));
    if (pullable) {
      if (view === 'full') content.append(el('h2', actionLabels.refresh));
      const snapshotOf = project => ({ projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'full', scopeConfirmed: true });
      content.append(mountSolutionPull({ ...actions.acquisition }, { source: view === 'full' ? source : null, synthetic, acquisition: model.acquisition, unavailable: model.pullUnavailable, catalog: model.pullCatalog, error: model.pullError },
        row => run(() => view === 'create' ? actions.create({ name: row.name || row.code, snapshot: snapshotOf(row.project) })
          : actions.prepare({ kind: 'reconciliation', snapshot: snapshotOf(row.project), expectedRevision: state.revision }), state ? workspaceUrl(state.id, view, model.artifact) : undefined)));
      if (view === 'create') content.append(link(pullLabels.manualFile, workspaceUrl(null, 'create') + '&mode=file'));
      return root;
    }
    const partial = view === 'change', form = el('form', undefined, 'managed-form');
    content.append(el('h2', partial ? 'Добавить изменение' : view === 'create' ? 'Загрузить .e365' : 'Обновить текущую версию'));
    content.append(el('p', partial ? 'Загрузите частичный экспорт изменённых объектов. Остальные объекты сохранятся.' : 'Нужен полный экспорт решения из ELMA365. Частичный экспорт не подходит.'));
    const name = view === 'create' ? field(form, 'Название решения') : null;
    const owner = field(form, partial ? 'Ответственная команда' : 'Кто отвечает за исходную версию', 'text', partial ? '' : state?.baselineOwner || ''); owner.required = true;
    if (name) name.required = true;
    const task = partial ? field(form, 'Что изменили') : null; if (task) task.required = true;
    const file = field(form, 'Файл .e365', 'file'); file.accept = '.e365'; file.required = true;
    const evidence = el('p'); form.append(evidence);
    let captured = null, pendingAcquisition = null;
    file.onchange = () => { captured = null; pendingAcquisition = null; file.required = true; evidence.replaceChildren(); };
    let acquisition;
    const selectCapture = project => {
      captured = project; file.value = ''; file.required = false;
      evidence.textContent = 'Выбран сохранённый экспорт: ' + project.filename;
    };
    const showAcquisition = record => {
      acquisition.replaceChildren(el('summary', 'Загрузить из ELMA / выбрать решение из конфигурации'),
        mountAcquisition(actions.acquisition, selectCapture, { acquisition: record }));
      if (record) acquisition.open = true;
    };
    if (model.shared && actions.acquisition) {
      acquisition = el('details'); showAcquisition(model.acquisition); form.append(acquisition);
    }
    const scope = check(form, partial ? 'Это частичный экспорт изменений' : 'Это полный экспорт решения'); scope.required = true;
    const sameSource = state ? check(form, 'Экспорт относится к этому решению и тому же источнику ELMA') : null;
    if (sameSource) sameSource.required = true;
    // MR-01: an explicit accepted full base and, for a partial change, a named
    // set of exact captured component keys. Omitting the base keeps it unknown.
    const bases = state ? acceptedFullBases(state) : [];
    let baseSelect, baseConfirm, scopeToggle, scopeName, extra, members, memberBoxes = new Map(), syncBase;
    if (state) {
      const set = el('fieldset', undefined, 'managed-base'); set.append(el('legend', 'Исходная версия экспорта'),
        el('p', 'От какой принятой полной версии подготовлен экспорт? Wiki проверяет точные байты выбранной версии, но не происхождение экспорта в ELMA.', 'managed-muted'));
      const wrap = el('div', undefined, 'managed-field'), caption = el('label', 'Исходная версия (база)'); baseSelect = el('select');
      baseSelect.id = 'managed-base-' + ++sequence; caption.htmlFor = baseSelect.id; wrap.append(caption, baseSelect); set.append(wrap);
      const none = el('option', 'Не указывать — происхождение останется неизвестным'); none.value = ''; baseSelect.append(none);
      for (const base of bases) { const option = el('option', baseOptionLabel(base)); option.value = base.artifactId; baseSelect.append(option); }
      const baseNote = el('p', '', 'managed-note'); baseNote.setAttribute('role', 'status'); set.append(baseNote);
      baseConfirm = check(set, 'Подтверждаю: экспорт подготовлен от выбранной версии. Это заявление, а не проверка происхождения');
      if (partial) {
        const scopeSet = el('div'); set.append(scopeSet);
        scopeToggle = check(scopeSet, 'Указать именованный состав изменения (точные ключи объектов)');
        const scopeBody = el('div'); scopeSet.append(scopeBody);
        scopeName = field(scopeBody, 'Название состава'); members = el('ul', undefined, 'managed-members');
        members.setAttribute('aria-label', 'Объекты состава'); scopeBody.append(el('p', 'Объекты выбранной версии и предыдущей загрузки этого изменения:', 'managed-muted'), members);
        const extraWrap = el('div', undefined, 'managed-field'), extraCaption = el('label', 'Новые объекты: точные ключи, по одному в строке'); extra = el('textarea');
        extra.id = 'managed-extra-' + ++sequence; extraCaption.htmlFor = extra.id; extra.spellcheck = false; extraWrap.append(extraCaption, extra); scopeBody.append(extraWrap);
        scopeBody.append(el('p', 'Каждый объект загруженного частичного экспорта должен входить в состав. Объект состава, отсутствующий в экспорте, не удаляется; удаление здесь не задаётся.', 'managed-muted'));
        scopeToggle.onchange = () => { scopeBody.hidden = !scopeToggle.checked; scopeName.required = scopeToggle.checked; };
      }
      form.insertBefore(set, scope.parentElement);
      syncBase = (keep = []) => {
        const base = bases.find(row => row.artifactId === baseSelect.value);
        baseConfirm.parentElement.hidden = !base; baseConfirm.required = !!base; if (!base) baseConfirm.checked = false;
        baseNote.textContent = !base ? 'База неизвестна. Сравнение пойдёт с текущей версией; автоматическое объединение и сборка недоступны.'
          : `Выбрана ${base.current ? 'текущая' : 'прежняя'} версия: ревизия ${base.revision}, SHA-256 ${base.checksum}. Происхождение будет заявлено, не проверено.`;
        if (!scopeToggle) return;
        scopeToggle.parentElement.hidden = !base; if (!base) scopeToggle.checked = false; scopeToggle.onchange();
        members.replaceChildren(); memberBoxes = new Map();
        for (const row of scopeCandidates(base, model.previousReview)) {
          const item = el('li'), label = el('label', undefined, 'managed-check'), input = el('input'); input.type = 'checkbox'; input.value = row.key; input.checked = keep.includes(row.key);
          label.append(input, el('span', `${row.name}${row.inBase ? '' : ' · новый в предыдущей загрузке'} `), el('code', row.key)); item.append(label); members.append(item); memberBoxes.set(row.key, input);
        }
      };
      baseSelect.onchange = () => syncBase([...memberBoxes].filter(([, input]) => input.checked).map(([key]) => key));
      syncBase();
    }
    content.append(el('p', 'Загруженные файлы доступны всем вошедшим пользователям сервиса.'));
    form.append(el('p', 'Загрузка сохраняет исходный файл. Она ничего не устанавливает в ELMA.', 'managed-muted'));
    const submit = el('button', view === 'create' ? 'Добавить решение' : 'Сохранить и рассмотреть'); submit.type = 'submit'; form.append(submit);
    // Drafts survive rejected, stale and uncertain submissions, including a
    // refresh. Confirmations are not restored; they must be given again.
    const draft = state && actions.draft;
    const collect = () => ({ revision: state.revision, owner: owner.value, task: task?.value ?? null, baseId: baseSelect.value,
      scopeEnabled: !!scopeToggle?.checked, scopeName: scopeName?.value ?? '', extra: extra?.value ?? '',
      selected: [...memberBoxes].filter(([, input]) => input.checked).map(([key]) => key),
      captured: captured ? { id: captured.id, currentSnapshotId: captured.currentSnapshotId, filename: captured.filename } : null,
      ...(saved?.uncertain ? { uncertain: true } : {}) });
    const saved = draft?.read();
    if (saved) {
      owner.value = saved.owner ?? owner.value; if (task) task.value = saved.task ?? '';
      const notes = [];
      if (saved.baseId && !bases.some(row => row.artifactId === saved.baseId)) notes.push('Ранее выбранная база больше не доступна; выберите базу снова.');
      else baseSelect.value = saved.baseId || '';
      syncBase();
      if (scopeToggle && baseSelect.value) {
        scopeToggle.checked = !!saved.scopeEnabled; scopeToggle.onchange(); scopeName.value = saved.scopeName || '';
        const missing = (saved.selected || []).filter(key => !memberBoxes.has(key));
        for (const key of saved.selected || []) if (memberBoxes.has(key)) memberBoxes.get(key).checked = true;
        extra.value = [...missing, ...(saved.extra || '').split('\n').filter(Boolean)].join('\n');
      }
      if (saved.captured?.id) selectCapture(saved.captured);
      if (saved.revision !== state.revision) notes.push(`Черновик сохранён при ревизии ${saved.revision}; решение уже изменилось (ревизия ${state.revision}). Проверьте базу и состав перед отправкой.`);
      if (saved.uncertain) notes.push('Предыдущая отправка могла сохраниться: ответ сервиса не получен. Проверьте раздел «Изменения» перед повтором.');
      const restored = el('div', undefined, 'managed-note'); restored.setAttribute('role', 'status');
      restored.append(el('p', 'Восстановлен черновик этой подготовки. Подтверждения нужно отметить заново.'), ...notes.map(text => el('p', text)));
      if (saved.uncertain) restored.append(link('Открыть изменения', workspaceUrl(state.id, 'changes')));
      const reset = link('Очистить черновик', workspaceUrl(state.id, view, model.artifact)), go = reset.onclick;
      reset.onclick = event => { draft.clear(); go?.(event); }; restored.append(reset);
      form.prepend(restored);
    }
    if (draft) form.addEventListener('input', () => draft.write(collect())), form.addEventListener('change', () => draft.write(collect()));
    form.onsubmit = event => { event.preventDefault(); if (!form.reportValidity()) return;
      const selected = file.files[0];
      if (!captured && !selected?.name.toLowerCase().endsWith('.e365')) { error.textContent = 'Выберите файл с расширением .e365.'; error.focus(); return; }
      const prepared = state ? preparationFields({ partial, bases, baseId: baseSelect.value, baseConfirmed: baseConfirm.checked,
        scopeEnabled: !!scopeToggle?.checked, scopeName: scopeName?.value || '', selected: collect().selected, extra: extra?.value || '' }) : { fields: {} };
      if (prepared.error) { error.textContent = prepared.error; error.focus(); return; }
      run(async () => {
        if (!captured && acquisition) {
          const record = pendingAcquisition ||= await actions.acquisition.upload(selected); actions.acquisition.remember?.(record.id);
          if (record.solutions.length > 1 || record.solutions[0]?.sourceAvailability === 'opaque') {
            showAcquisition(record); evidence.textContent = record.solutions[0]?.sourceAvailability === 'opaque'
              ? 'Исходный файл сохранён. Содержимое непрозрачно или зашифровано; для изменений нужен читаемый экспорт решения.'
              : 'Конфигурация сохранена. Выберите решение и продолжите.';
            return false;
          }
          captured = record.solutions[0].project;
        } else captured ||= await actions.upload(selected);
        evidence.replaceChildren(el('span', 'Исходный файл сохранён.'));
        if (!model.shared) evidence.append(link('Открыть загруженный файл', '/p/' + captured.id + '/'));
        const snapshot = { projectId: captured.id, snapshotId: captured.currentSnapshotId, scope: partial ? 'partial' : 'full', scopeConfirmed: true };
        if (view === 'create') return await actions.create({ name: name.value, baselineOwner: owner.value, snapshot });
        draft?.write(collect());
        try {
          await actions.prepare({ kind: partial ? 'change' : 'reconciliation', snapshot, expectedRevision: state.revision, sameSourceConfirmed: true,
            ...(partial ? { team: owner.value, taskRef: task.value } : { baselineOwner: owner.value }), ...prepared.fields });
        } catch (e) {
          // A lost response may have saved the change; never replay it automatically.
          if (e.requiresRefresh) draft?.write({ ...collect(), uncertain: true });
          throw e;
        }
        draft?.clear();
      }, state ? workspaceUrl(state.id, view, model.artifact) : undefined);
    };
    content.append(form); return root;
  }

  if (view === 'review' && review) {
    const followups = el('div', undefined, 'managed-actions');
    let selectedSource = null, showSelectedSource = () => {}, diagram = null;
    if (actions.visual) {
      const details=el('details'), target=el('div');
      details.append(el('summary','Посмотреть процесс и форму'),target); content.append(details);
      let loaded=null;
      const load=async()=>{
        target.replaceChildren(mountSnapshotVisual({loading:true}));
        try { const visual = mountSnapshotVisual(await actions.visual(review.artifactId), {
          explanations: actions.explanations,
          selectAnchor: anchor => { selectedSource = anchor; showSelectedSource(); }
        }); target.replaceChildren(visual); return visual; }
        catch(e){target.replaceChildren(mountSnapshotVisual({error:e.message},{retry:load})); loaded=null; return null;}
      };
      details.ontoggle=()=>{if(details.open&&!loaded)loaded=load();};
      // UX-03b "Открыть схему": open the captured diagram on one changed process
      // with its changed steps highlighted. The highlight is a projection of the
      // review's process parts; native behaviour stays unobserved.
      diagram = { open: async (object, nodeIds) => { details.open = true; loaded ||= load(); const visual = await loaded; return visual?.focusProcess?.({ object, nodeIds }) ?? false; } };
    }
    const full = review.kind === 'reconciliation', form = el('form'), boundaryKeys = new Set(), resolutions = {};
    content.append(el('h2', full ? 'Рассмотреть обновление версии' : 'Рассмотреть изменение'),
      el('p', full ? reviewPlain.versionIntro : `${reviewPlain.changeIntro} ${review.options.team} · ${review.options.taskRef}.`));
    // UX-03: the answer first. One summary line with counts, the facts as chips,
    // and the provenance evidence behind one "Подробнее". Gates and decisions
    // below are unchanged; this is a projection of the same review rows.
    const rowsWithMeta = review.rows.map(row => ({ ...objectOf(row.key, review.artifactId), ...row }));
    const summary = reviewSummary(review, rowsWithMeta);
    const summaryBlock = el('section', undefined, 'managed-summary');
    // A version with no difference offers two actions and no decision dialog:
    // close it (server operation, nothing advances) or pull again.
    const closable = canCloseWithoutChanges(review, summary) && !!actions.close;
    if (summary.noDifference) {
      summaryBlock.append(el('p', facts.noDifference, 'managed-note'));
      const noChangeActions = el('div', undefined, 'managed-actions');
      if (closable) {
        noChangeActions.append(el('p', decisionLabels.closeNote, 'managed-muted'));
        button(actionLabels.closeNoChanges, () => run(() => actions.close(review.artifactId, { expectedRevision: review.revision, reviewedDigest: review.artifactDigest })), noChangeActions);
      }
      noChangeActions.append(link(actionLabels.refreshAgain, workspaceUrl(state.id, 'full'), !closable)); summaryBlock.append(noChangeActions);
    }
    const line = el('p', summary.line, 'managed-summary-line'); line.setAttribute('role', 'status'); summaryBlock.append(line);
    // UX-08: the actor's own "Просмотрено" marks. A mark binds the object's
    // digest; a changed object shows "Изменилось после просмотра" and stops
    // counting. Marks are personal reading progress and never gate a decision.
    const viewedState = new Map((review.viewed?.rows || []).map(row => [row.key, row])), viewedCards = new Map();
    const markable = !!(review.viewed && actions.markViewed && !review.stale && state.status === 'active');
    const viewedLine = el('p', '', 'managed-viewed-progress'); viewedLine.setAttribute('role', 'status');
    const showViewed = () => {
      const progress = viewedProgress({ viewed: { rows: [...viewedState.values()] } }, rowsWithMeta);
      viewedLine.hidden = !progress?.total; viewedLine.textContent = progress?.total ? progress.line : '';
      for (const [key, view] of viewedCards) {
        const status = viewedState.get(key)?.status;
        if (view.input) view.input.checked = status === 'viewed';
        view.card.classList.toggle('managed-viewed', status === 'viewed'); view.badge.hidden = status !== 'changed';
      }
    };
    const viewedControl = (card, row) => {
      if (!review.viewed || reviewBucket(row) === 'unchanged' || !viewedState.has(row.key)) return;
      const badge = el('p', facts.changedSinceViewed, 'managed-viewed-changed'), view = { card, badge, input: null };
      if (markable) {
        const input = check(card, facts.viewed); input.closest('label').classList.add('managed-viewed-check'); view.input = input;
        input.onchange = async () => {
          if (busy || blocked) { showViewed(); return; }
          input.disabled = true; error.textContent = '';
          try { for (const item of (await actions.markViewed(review.artifactId, { key: row.key, digest: viewedState.get(row.key).digest, viewed: input.checked })).rows) viewedState.set(item.key, item); }
          catch (e) { error.textContent = e.message || facts.viewedFailed; }
          finally { input.disabled = false; showViewed(); }
        };
      }
      card.append(badge); viewedCards.set(row.key, view);
    };
    summaryBlock.append(viewedLine);
    const chips = el('ul', undefined, 'managed-chips'); chips.setAttribute('aria-label', 'Факты');
    const chip = (text, tone) => chips.append(el('li', text, tone));
    // A full version is always compared with the current one: an undeclared base is not a warning there.
    if (review.baseDeclaration && !(full && review.baseDeclaration.status !== 'declared')) {
      const declared = review.baseDeclaration.status === 'declared', baseArtifact = declared ? state.artifacts?.find(row => row.id === review.baseDeclaration.artifactId) : null;
      chip(!declared ? facts.baseUnknown : baseArtifact?.snapshot?.createdAt ? `${facts.baseVersion} ${dateLabel(baseArtifact.snapshot.createdAt)}` : `${summaryLabels.baseRevision} ${review.baseDeclaration.revision}`, declared ? undefined : 'managed-chip-warn');
    }
    const server = serverFromConnection(review.snapshot?.source?.connectionId);
    if (server) chip(`${facts.server}: ${pullLabels.serverNames[server] || server}`);
    if (review.uploadedBy) chip(`${facts.loadedBy}: ${review.uploadedBy.login}`);
    if (summary.unknownParts) chip(`${summaryLabels.unknownParts}: ${summary.unknownParts}`, 'managed-chip-warn');
    if (summary.dependencyProblems) chip(`${summaryLabels.dependencyProblems}: ${summary.dependencyProblems}`, 'managed-chip-warn');
    summaryBlock.append(chips); content.append(summaryBlock);
    const more = el('details', undefined, 'managed-more'); more.append(el('summary', actionLabels.details));
    if (review.uploadedBy) more.append(el('p', `Загрузил: ${review.uploadedBy.login}`));
    more.append(el('p', `${reviewPlain.responsibility}: ${full ? review.options.baselineOwner : review.options.team}`));
    content.append(more);
    if (review.baseDeclaration || review.changeScopeDeclaration) {
      const provenance = el('section', undefined, 'managed-card managed-provenance'), declared = baseEvidence(review.baseDeclaration);
      provenance.append(el('h3', 'Исходная версия и состав'), el('p', declared.title),
        el('p', `Происхождение: ${{ verified: 'подтверждено', declared: 'заявлено, не проверено', unknown: 'неизвестно' }[declared.ancestry]}`, 'managed-note'), el('p', declared.detail, 'managed-muted'));
      if (!full) {
        const scoped = scopeEvidence(review.changeScopeDeclaration); provenance.append(el('p', scoped.title), el('p', scoped.detail, 'managed-muted'));
        if (scoped.members.length) {
          const list = el('ul'); list.setAttribute('aria-label', 'Заявленный состав');
          for (const row of scoped.members) { const item = el('li', `${row.name} · ${row.inChange ? 'есть в экспорте' : 'нет в экспорте — остаётся без изменений'}${row.inBase ? '' : ' · новый относительно базы'} `); item.append(el('code', row.key)); list.append(item); }
          provenance.append(list);
        }
        if (scoped.deletions.length) provenance.append(el('p', `Явных удалений: ${scoped.deletions.length}. Каждое требует отдельной проверки ниже.`));
      }
      technical(provenance, 'Доказательства базы и состава', { baseDeclaration: review.baseDeclaration ?? null, changeScopeDeclaration: review.changeScopeDeclaration ?? null });
      more.append(provenance);
    }
    if (!full && review.merge && mergeResolutionView(review.merge).visible)
      content.append(mountMergeResolution(review.merge, { technical, submit: input => run(() => actions.resolveMerge(review.artifactId, input), workspaceUrl(state.id, 'review', review.artifactId)) }));
    button('Скачать отчёт об ответственности', () => {
      const url = URL.createObjectURL(new Blob([responsibilityReport(state, review)], { type: 'text/plain;charset=utf-8' }));
      const a = el('a'); a.href = url; a.download = 'responsibility-review.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, more).className = 'secondary';
    if (review.acceptedAt) content.append(el('p', `Принято: ${dateLabel(review.acceptedAt)} · ${review.acceptedDecision?.actor?.login || 'Автор решения не зафиксирован'}`, 'managed-accepted'));
    if (review.closedAt) content.append(el('p', `${decisionLabels.closedNoChanges}: ${dateLabel(review.closedAt)} · ${review.closedDecision?.actor?.login || 'Автор решения не зафиксирован'}`, 'managed-accepted managed-closed'));
    if (review.stale) content.append(el('p', !full && review.merge && mergeResolutionView(review.merge).editable
      ? 'Это рассмотрение подготовлено до последних принятых изменений; принять его нельзя. Решение конфликтов выше сохраняется отдельно и ничего не принимает.'
      : 'Это прежнее рассмотрение. Комментарии и исходные ссылки сохранены; новые решения здесь недоступны.', 'managed-note'),
      link(review.supersededBy ? 'Открыть актуальное изменение' : 'Обновить состояние', workspaceUrl(state.id, review.supersededBy ? 'review' : null, review.supersededBy), true));
    const gate = el('p', '', 'managed-note'); gate.setAttribute('role', 'status');
    // UX-03b: one button opens one dialog with the three choices (accept,
    // request fixes, comment only). A closed gate disables acceptance inside the
    // dialog and shows its reason; the other two choices stay available so a
    // reviewer can always say what is wrong. The dialog replaces the former
    // confirmation checkbox: choosing and confirming is the explicit step.
    const decide = el('button', actionLabels.decide); decide.type = 'button';
    const dialog = el('dialog', undefined, 'managed-decision'), dialogForm = el('form'), choicesBox = el('fieldset'), radios = new Map(), notes = new Map();
    const title = el('h2', actionLabels.decide); title.id = 'managed-decision-' + ++sequence; dialog.setAttribute('aria-labelledby', title.id);
    const choiceLabels = {
      accept: [actionLabels.accept, full ? decisionLabels.acceptVersionNote : decisionLabels.acceptChangeNote, full ? decisionLabels.acceptVersion : decisionLabels.acceptChange],
      'request-fixes': [actionLabels.requestFixes, decisionLabels.requestFixesNote, actionLabels.requestFixes],
      comment: [actionLabels.commentOnly, decisionLabels.commentOnlyNote, decisionLabels.sendComment] };
    choicesBox.append(el('legend', decisionLabels.question));
    const commentLabel = el('label'), commentCaption = el('span', decisionLabels.comment), commentText = el('textarea');
    commentText.id = title.id + '-text'; commentText.maxLength = 4000; commentLabel.htmlFor = commentText.id; commentLabel.append(commentCaption, commentText);
    const dialogSubmit = el('button', actionLabels.decide); dialogSubmit.type = 'submit';
    const cancel = el('button', actionLabels.cancel, 'secondary'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    const choiceOf = () => [...radios.entries()].find(([, radio]) => radio.checked)?.[0] ?? null;
    // Until the reviewer picks a choice, the default follows the gate: opening
    // the gate (every boundary confirmed, every conflict decided) makes
    // acceptance the preselected choice again.
    let chosen = false;
    const syncDialog = () => {
      const choice = choiceOf();
      commentCaption.textContent = choice === 'accept' ? decisionLabels.commentOptional : decisionLabels.comment;
      commentText.required = choice !== 'accept';
      dialogSubmit.textContent = choice ? choiceLabels[choice][2] : actionLabels.decide; dialogSubmit.disabled = !choice;
    };
    const update = () => {
      gate.textContent = reviewGate(review, [...boundaryKeys], resolutions);
      const choices = decisionChoices(review, gate.textContent);
      for (const choice of choices) {
        const radio = radios.get(choice.id); if (!radio) continue;
        radio.disabled = choice.disabled; notes.get(choice.id).textContent = choice.disabled ? choice.reason : choiceLabels[choice.id][1];
        if (radio.disabled && radio.checked) radio.checked = false;
      }
      if (!chosen || !choiceOf()) { const fallback = decisionDefault(choices); for (const radio of radios.values()) radio.checked = false; if (fallback) radios.get(fallback).checked = true; }
      decide.dataset.unavailable = String(!!gate.textContent); syncDialog();
    };
    for (const choice of decisionChoices(review)) {
      // The note explains the choice but is not its name: it sits outside the
      // label and is linked with aria-describedby so "Принять" stays "Принять".
      const row = el('div', undefined, 'managed-choice'), label = el('label'), radio = el('input'), note = el('small', '', 'managed-muted');
      radio.type = 'radio'; radio.name = 'decision'; radio.value = choice.id; radio.onchange = () => { chosen = true; syncDialog(); };
      note.id = title.id + '-' + choice.id + '-note'; radio.setAttribute('aria-describedby', note.id);
      label.append(radio, el('span', choiceLabels[choice.id][0])); row.append(label, note); choicesBox.append(row); radios.set(choice.id, radio); notes.set(choice.id, note);
    }
    const dialogActions = el('div', undefined, 'managed-actions'); dialogActions.append(dialogSubmit, cancel);
    dialogForm.append(title, choicesBox, commentLabel, dialogActions); dialog.append(dialogForm);
    dialogForm.onsubmit = event => {
      event.preventDefault();
      const choice = choiceOf(); if (!choice || !dialogForm.reportValidity()) return;
      const text = commentText.value.trim();
      if (choice === 'accept') {
        if (reviewGate(review, [...boundaryKeys], resolutions) || !form.reportValidity()) { update(); return; }
        dialog.close();
        run(() => actions.accept(review.artifactId, { expectedRevision: review.revision, reviewedDigest: review.artifactDigest,
          ...(review.discussion ? { expectedDiscussionRevision: review.discussion.version } : {}), ...(text ? { comment: text } : {}),
          ...(full ? { resolutions } : { reviewedBoundaryKeys: [...boundaryKeys] }) }));
        return;
      }
      dialog.close();
      run(() => actions.comment(review.artifactId, { expectedRevision: state.revision, expectedDiscussionRevision: review.discussion.version,
        type: choice === 'request-fixes' ? 'reject' : 'comment', text }));
    };
    const openDialog = () => { update(); if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.open = true; } (choiceOf() ? radios.get(choiceOf()) : commentText).focus(); };
    decide.onclick = openDialog;
    // UX-03: status ribbon with counts filters the cards; changed objects come
    // first, grouped by module when there is more than one; unchanged objects
    // are one collapsed group. Hidden cards keep their controls; the gate reads
    // the same sets either way.
    const filter = el('nav', undefined, 'managed-ribbon'); filter.setAttribute('aria-label', summaryLabels.filterLabel);
    const unchanged = el('details', undefined, 'managed-unchanged'); unchanged.append(el('summary', `${ribbon.unchanged} · ${summary.counts.unchanged} · ${actionLabels.show}`));
    const modules = new Map(); let activeFilter = 'changed';
    const applyFilter = () => {
      for (const card of form.querySelectorAll('[data-bucket]')) card.hidden = !(activeFilter === 'all' || (activeFilter === 'changed' ? card.dataset.bucket !== 'unchanged' : card.dataset.bucket === activeFilter));
      for (const section of form.querySelectorAll('.managed-module')) section.hidden = ![...section.querySelectorAll('[data-bucket]')].some(card => !card.hidden);
      if (activeFilter === 'all') unchanged.open = true;
      for (const node of filter.querySelectorAll('button')) node.setAttribute('aria-pressed', String(node.dataset.filter === activeFilter));
    };
    const ribbonButtons = [['changed', nouns.changes, summary.changed], ['modified', ribbon.modified, summary.counts.modified], ['added', ribbon.added, summary.counts.added],
      ['removed', ribbon.removed, summary.counts.removed], ['conflicts', ribbon.conflicts, summary.counts.conflicts], ['all', ribbon.all, summary.total]];
    for (const [id, caption, count] of ribbonButtons) {
      if (!count && !['changed', 'all'].includes(id)) continue;
      const node = el('button', `${caption} · ${count}`, 'secondary managed-ribbon-button'); node.type = 'button'; node.dataset.filter = id; node.onclick = () => { activeFilter = id; applyFilter(); }; filter.append(node);
    }
    if (review.rows.length) form.append(filter);
    const place = (card, row) => {
      card.dataset.bucket = reviewBucket(row);
      if (card.dataset.bucket === 'unchanged') return unchanged.append(card);
      const module = objectModule(row);
      if (!modules.has(module)) { const section = el('section', undefined, 'managed-module'); section.append(el('h3', `${grouping.module} ${module || grouping.withoutModule}`)); modules.set(module, section); form.append(section); }
      modules.get(module).append(card);
    };
    for (const row of rowsWithMeta) {
      const card = el('section', undefined, 'managed-card'); card.append(objectTitle('h3', row), el('p', row.conflict ? 'Конфликт с изменением другой команды' : labels[row.classification] || row.classification));
      viewedControl(card, row);
      if (row.elements) {
        const changedParts = row.elements.rows.filter(part => part.classification !== 'unchanged');
        if (changedParts.length) {
          const list = el('ul', undefined, 'managed-change-list'); list.setAttribute('aria-label', reviewPlain.whatChanged);
          for (const part of changedParts.slice(0, 20)) {
            const [masculine, feminine] = reviewPlain.partVerbs[part.classification] || reviewPlain.partVerbs.changed;
            list.append(el('li', `${elementKinds[part.kind] || part.kind} «${part.name || part.code}» ${reviewPlain.feminine.has(part.kind) ? feminine : masculine}${part.conflict ? reviewPlain.conflictSuffix : ''}`));
          }
          card.append(el('h4', reviewPlain.whatChanged), list);
          if (changedParts.length > 20) card.append(el('p', reviewPlain.moreParts(changedParts.length - 20), 'managed-muted'));
        }
        if (!row.elements.complete || row.elements.residualChanged) card.append(el('p', 'Часть данных не установлена или изменены прочие данные. Сохраняется проверка всего объекта.', 'managed-note'));
      }
      // Context first ("Было и стало"); the full parts table is one click away.
      const partsHost = row.elements ? el('details', undefined, 'managed-more managed-parts') : null;
      if (partsHost) {
        partsHost.append(el('summary', reviewPlain.partsDetails), el('h4', 'Ответственность частей процесса'),
          el('p', 'Заявленная командой ответственность. Авторы публикаций ELMA и договорная ответственность не установлены.', 'managed-muted'));
        const table = el('table'), head = el('tr'); ['Часть', 'Было', 'Изменение'].forEach(label => head.append(el('th', label))); table.append(head);
        for (const part of row.elements.rows.slice(0, 100)) {
          const tr = el('tr'); tr.append(el('td', `${elementKinds[part.kind] || part.kind}: ${part.name} (${part.code})${part.kind === 'transition' ? ' · ' + (part.from || '?') + ' → ' + (part.to || '?') : ''}`), el('td', part.team || 'Не установлена'),
            el('td', `${elementLabels[part.classification] || part.classification}${part.boundaryCrossing ? ' · граница исходной версии' : ''}${part.conflict ? ' · конфликт команд' : ''}`)); table.append(tr);
        }
        const scroll = el('div', undefined, 'managed-table'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Ответственность частей процесса'); scroll.append(table); partsHost.append(scroll);
        if (row.elements.rows.length > 100) partsHost.append(el('p', 'Показаны первые 100 частей. Полный список — в отчёте об ответственности.'));
        if (full && row.classification === 'conflict') card.append(el('p', 'Части помогают понять конфликт. Выбор версии применяется ко всему исходному файлу процесса; автоматического объединения нет.'));
      } else if (row.previousTeam || row.team) card.append(el('p', 'Текущая ответственность: ' + (row.previousTeam || row.team)));
      if (row.elements && diagram) {
        const changedSteps = row.elements.rows.filter(part => part.kind === 'node' && part.classification !== 'unchanged').map(part => part.code);
        const diagramNote = el('p', '', 'managed-muted'); diagramNote.setAttribute('role', 'status');
        const open = button(actionLabels.openDiagram, async () => {
          open.disabled = true; diagramNote.textContent = '';
          try { if (!(await diagram.open(row.key, changedSteps))) diagramNote.textContent = diagramLabels.processNotFound; }
          finally { open.disabled = false; }
        }, card); open.className = 'secondary'; card.append(diagramNote);
      }
      if (row.removed) card.append(el('p', 'Объект отсутствует в новом полном снимке. Выбор снимка удалит его из рабочего состояния.'));
      if (!full && row.boundaryCrossing && !review.acceptedAt && !review.stale) {
        const choice = check(card, 'Изменение принятого объекта проверено'); choice.onchange = () => { choice.checked ? boundaryKeys.add(row.key) : boundaryKeys.delete(row.key); update(); };
      }
      if (full && row.classification === 'conflict' && !review.acceptedAt && !review.stale) {
        const label = el('label', 'Какую версию сохранить'), choice = el('select'); choice.id = 'managed-choice-' + ++sequence; label.htmlFor = choice.id;
        for (const [value, caption] of [['', partMerge.chooseVersion], ['keep-working', 'Сохранить наше изменение'], ['take-snapshot', 'Взять версию из полного снимка']]) { const option = el('option', caption); option.value = value; choice.append(option); }
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
      if (partsHost) card.append(partsHost);
      technical(card, 'Идентичность и доказательства сравнения', row); place(card, row);
    }
    // A single module needs no module heading; its cards sit directly in the form.
    if (modules.size === 1) { const [section] = modules.values(); section.replaceWith(...[...section.children].slice(1)); modules.clear(); }
    showViewed();
    if (summary.counts.unchanged) form.append(unchanged);
    if (review.rows.length && !summary.changed) form.append(el('p', summaryLabels.noChangedObjects, 'managed-muted'));
    applyFilter();
    if (!review.rows.length) form.append(el('p', 'Изменений распознанных объектов нет. Проверьте полноту исходного снимка перед принятием.'));
    if (review.dependencies) form.append(mountDependencies(review.dependencies));
    if (review.ambiguities.length) technical(form, 'Нераспознанные части', review.ambiguities);
    form.append(link('Скачать исходный файл', `${api}/${state.id}/artifacts/${review.artifactId}/original`));
    const decidable = decisionChoices(review).length > 0 && !closable;
    // UX-09 agent pass (docs/audits/ux-09-agent-pass-2026-10-17.md, blocker 3):
    // the gate reason and the one decision button sit under the counter line,
    // so "what next" is read with "what changed" instead of after every card.
    if (decidable) { const strip = el('div', undefined, 'managed-actions managed-decision-strip'); strip.append(decide); summaryBlock.append(gate, strip); update(); }
    form.onsubmit = event => { event.preventDefault(); if (decidable) openDialog(); };
    content.append(form);
    // A fixture that opens the dialog opens it modally, as the button does:
    // showModal needs a connected element, so it waits for the mount.
    if (decidable) { content.append(dialog); if (model.decisionOpen) { update(); const show = (attempt = 0) => { if (dialog.open) return; if (dialog.isConnected && typeof dialog.showModal === 'function') dialog.showModal(); else if (attempt < 10 && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => show(attempt + 1)); else dialog.open = true; }; show(); } }
    if (review.discussion) {
      const discussion = el('section', undefined, 'change-discussion'); discussion.append(el('h2', 'Комментарии и замечания'));
      const anchorLabels = { current: 'Объект совпадает', stale: 'Объект изменился; исходная ссылка сохранена', removed: 'Объект удалён из полного экспорта', ambiguous: 'Связь с объектом неоднозначна' };
      const stepLabels = { current: 'Шаг совпадает', stale: 'Шаг изменился; исходная ссылка сохранена', removed: 'Шаг отсутствует в новом процессе', ambiguous: 'Связь с шагом неоднозначна' };
      const editable = !review.stale && state.status === 'active';
      const entry = (parent, label, type, parentId) => {
        const f = el('form'), caption = el('label', label), text = el('textarea'); text.id = 'change-comment-' + ++sequence; text.required = true; text.maxLength = 4000; caption.htmlFor = text.id; f.append(caption, text);
        let key;
        if (!parentId) { key = el('select'); key.setAttribute('aria-label', 'К чему относится комментарий'); const all = el('option', 'К изменению'); all.value = ''; key.append(all);
          review.rows.forEach(row => { const label = objectLabel(objectOf(row.key, review.artifactId)); const option = el('option', label.secondary ? `${label.text} · ${label.secondary}` : label.text); option.value = row.key; key.append(option); }); f.append(key);
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
        parent.append(f);
      };
      if (!review.discussion.findings.length) discussion.append(el('p', 'Комментариев пока нет.'));
      for (const finding of review.discussion.findings) {
        const card = el('article', undefined, 'managed-card'); card.append(el('h3', finding.type === 'reject' ? finding.status === 'open' ? decisionLabels.requestedFixes : decisionLabels.fixesDone : 'Комментарий'),
          el('p', `${finding.actor?.login || finding.author} · ${dateLabel(finding.createdAt)}`, 'managed-muted'), el('p', finding.text, 'change-text'));
        if (finding.anchor?.key) card.append(el('p', `${objectLabel(objectOf(finding.anchor.key, review.artifactId)).text} · ${(finding.sourceAnchor ? stepLabels : anchorLabels)[finding.anchorStatus]}`, 'managed-muted'));
        if (finding.sourceAnchor) { card.append(el('p', 'Шаг: ' + finding.sourceAnchor.nodeId)); technical(card, 'Исходная ссылка на шаг', finding.sourceAnchor); }
        for (const reply of finding.replies) card.append(el('p', `${reply.actor?.login || reply.author}: ${reply.text}`, 'change-text'));
        if (finding.resolution) card.append(el('p', `${finding.resolution.actor?.login || finding.resolution.author}: ${finding.resolution.text}`, 'change-text'));
        if (editable) { const d = el('details'); d.append(el('summary', 'Ответить или изменить статус')); entry(d, 'Ответ', 'reply', finding.id);
          if (finding.type === 'reject') entry(d, 'Что исправлено или что ещё нужно изменить', finding.status === 'open' ? 'resolve' : 'reopen', finding.id); card.append(d); }
        discussion.append(card);
      }
      if (editable) entry(discussion, 'Комментарий к изменению', 'comment');
      content.append(discussion);
      if (editable) followups.append(link('Добавить исправление', workspaceUrl(state.id, full ? 'full' : 'change', review.artifactId), !!(review.acceptedAt || review.discussion.blocking)));
    }
    followups.append(link('Загрузить другую версию', workspaceUrl(state.id, 'full')));
    content.append(followups); return root;
  }
  content.append(el('p', 'Сравнение недоступно. Вернитесь к обзору и выберите актуальное действие.'), link('К обзору', workspaceUrl(state?.id), true));
  return root;
}
