import { dateLabel } from './model.js';
import { mountDelivery } from '../releases/delivery.js';
// Solution composer (#94 MR-06): a pure projection of server-frozen composed
// candidates plus the server's build capability. The server stays authoritative:
// HTTP never freezes build bytes, so "build" is shown only as the server reports it.
export const composerMissingLabels = {
  'native-materialization-worker': 'нативный исполнитель сборки, реализующий опубликованный контракт',
  'versioned-materialization-request-contract': 'версионированный запрос нативной сборки',
  'baseline-preserving-stage-service': 'подготовка с сохранением исходной версии',
  'process-runtime-compiler': 'компилятор процессов',
  'native-package-validation-receipt': 'квитанция проверки нативного пакета',
  'manifest-regeneration-policy': 'правила пересборки manifest',
  'isolated-native-assembler': 'изолированный нативный сборщик'
};
const statusLabels = {
  stale: 'Устарел: принятые изменения, решение конфликта или рецензия изменились после сборки',
  'awaiting-approval': 'Собран; точные байты ещё не приняты',
  approved: 'Точные байты приняты; доставка только через проверяемую попытку'
};
// Unknown gap keys stay visible with a neutral label; nothing is hidden or reworded as solved.
export const composerMissingLabel = key => composerMissingLabels[key] || `не описанное требование: ${key}`;
// The reason reflects what the server reports: pinned contracts vs. none, never a fixed claim.
export function composerBuildView(build) {
  const available = build?.available === true, reference = build?.reference || 'netbka/elma365#60';
  const contracts = Array.isArray(build?.contracts) ? build.contracts.filter(row => typeof row === 'string') : [];
  const reason = available ? '' : contracts.length
    ? `Нативная сборка конфигурации недоступна: контракт ${contracts.join(', ')} закреплён, но его ещё никто не исполняет (${reference}).`
    : build?.contracts ? `Нативная сборка конфигурации недоступна: закреплённого контракта материализации ELMA нет (${reference}).`
    : `Нативная сборка конфигурации недоступна: сервис не сообщил её возможность (${reference}).`;
  return { available, reason, contracts, reference,
    missing: available ? [] : (Array.isArray(build?.missing) ? build.missing : []).map(composerMissingLabel) };
}

export function composedCandidateRow(record) {
  const approved = !!record.approval && record.approval.revision === record.revision;
  const status = record.inputsStatus === 'stale' ? 'stale' : approved ? 'approved' : 'awaiting-approval';
  const native = record.evidenceBasis === 'native' && record.releaseEligible === true;
  return { id: record.id, revision: record.revision, status, statusLabel: statusLabels[status],
    sha256: record.candidate.sha256, shortSha: record.candidate.sha256.slice(0, 12), size: record.candidate.size,
    createdAt: dateLabel(record.createdAt), frozenBy: record.frozenBy?.login || 'Автор не зафиксирован',
    units: (record.units || []).map(unit => ({ id: unit.id, adapter: unit.adapter })),
    platformVersion: record.targetProfile?.platformVersion || 'не установлена', native,
    evidenceLabel: native ? 'Нативная сборка; пригодность к выпуску требует проверки на Target'
      : 'Учебная сборка (синтетический сборщик): не нативный пакет ELMA, к выпуску не допускается; доставка только на учебный стенд',
    approval: approved ? { actor: record.approval.actor?.login || 'Автор не зафиксирован', at: dateLabel(record.approval.at), reason: record.approval.reason } : null,
    canApprove: status === 'awaiting-approval', canRevoke: status === 'approved', deliverable: record.deliverable === true && status === 'approved' };
}

// Shape consumed by the shared delivery renderer; the server re-checks everything.
export const composedDeliveryRelease = record => ({ id: record.id, revision: record.revision, approval: record.approval, candidate: record.candidate,
  code: record.code, blockers: [], associationStatus: record.inputsStatus === 'stale' ? 'stale' : 'current' });

export function composerView({ candidates = [], build = null, selectedId = null } = {}) {
  const rows = [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(composedCandidateRow);
  const buildView = composerBuildView(build), current = rows.filter(row => row.status !== 'stale');
  const selected = rows.find(row => row.id === selectedId) || null;
  const summary = !rows.length ? buildView.available ? 'Принятая версия ещё не собрана.' : 'Собранных конфигураций нет. ' + buildView.reason
    : !current.length ? 'Все сборки устарели. Нужна новая сборка для текущих принятых изменений.'
    : current.some(row => row.status === 'approved') ? 'Есть принятая сборка. Проверьте её доставкой и чтением результата.'
    : 'Есть сборка, ожидающая решения по точным байтам.';
  return { rows, build: buildView, selected, summary, missingSelection: !!selectedId && !selected };
}

export function composerGate(row, action, reason = '') {
  if (!row) return 'Сборка не выбрана.';
  if (row.status === 'stale') return 'Сборка устарела; решение по ней недоступно.';
  if (action === 'approve' && !row.canApprove) return 'Сборка уже принята.';
  if (action === 'revoke' && !row.canRevoke) return 'Принятие уже отозвано.';
  if (!reason.trim()) return 'Укажите причину решения.';
  return '';
}

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let sequence = 0;
// model: { candidates, build, selected (full record or null), error, loadError }
// actions: { link(label, href, primary), candidateHref(id), listHref, change(id, input), deliveryClient }
export function mountComposer(model = {}, actions = {}) {
  const root = el('section', undefined, 'managed-composer'); root.setAttribute('aria-label', 'Сборка конфигурации');
  const heading = el('h2', 'Сборка конфигурации'); heading.tabIndex = -1;
  const status = el('p', '', 'managed-notice'); status.setAttribute('role', 'status');
  const error = el('div', model.error || '', 'managed-error'); error.setAttribute('role', 'alert');
  root.append(heading, el('p', 'Принятые изменения → сборка неизменяемой конфигурации → решение по точным байтам → доставка и чтение результата на Target.', 'managed-muted'), status, error);
  const link = actions.link || ((label, href) => { const a = el('a', label, 'managed-link'); a.href = href; return a; });
  if (model.loadError) {
    root.append(el('p', 'Состояние сборок не получено. Действия недоступны до успешной загрузки.'), link('Повторить загрузку сборок', actions.listHref, true));
    return root;
  }
  const view = composerView({ candidates: model.candidates, build: model.build, selectedId: model.selected?.id ?? model.selectedId });
  root.append(el('p', view.summary));

  const build = el('div', undefined, 'managed-card'); build.setAttribute('aria-label', 'Новая сборка');
  const start = el('button', 'Собрать конфигурацию'); start.type = 'button'; start.disabled = true; start.dataset.unavailable = 'true';
  build.append(el('h3', 'Новая сборка'), start);
  if (view.build.available) build.append(el('p', 'Сборка запускается сервером из принятых входных данных; результат появится в списке.', 'managed-muted'));
  else {
    build.append(el('p', view.build.reason, 'managed-note'));
    if (view.build.missing.length) { const list = el('ul'); list.setAttribute('aria-label', 'Чего не хватает для нативной сборки'); view.build.missing.forEach(text => list.append(el('li', text))); build.append(list); }
    build.append(el('p', 'Нерабочая сборка не изображается рабочей: учебные сборки ниже созданы синтетическим сборщиком и не являются пакетом ELMA.', 'managed-muted'));
  }
  root.append(build);

  if (view.missingSelection) root.append(el('p', 'Выбранная сборка не найдена в этом решении.', 'managed-note'));
  const list = el('div', undefined, 'managed-list');
  for (const row of view.rows) {
    const card = el('article', undefined, 'managed-card');
    card.append(el('h3', `Сборка ${row.shortSha}`), el('p', row.statusLabel, row.status === 'approved' ? 'managed-accepted' : row.status === 'stale' ? 'managed-note' : ''),
      el('p', row.evidenceLabel, row.native ? 'managed-muted' : 'managed-note'),
      el('p', `${row.frozenBy} · ${row.createdAt} · единиц установки: ${row.units.length}`, 'managed-muted'));
    if (view.selected?.id !== row.id) card.append(link('Открыть сборку', actions.candidateHref?.(row.id)));
    else card.setAttribute('aria-current', 'true');
    list.append(card);
  }
  if (view.rows.length) root.append(el('h3', `Сборки · ${view.rows.length}`), list);
  if (view.selected && model.selected) root.append(mountCandidate(model.selected, view.selected, actions, { status, error }));
  return root;
}

function mountCandidate(record, row, actions, { status, error }, initialDrafts = new Map()) {
  const root = el('section', undefined, 'managed-card'); root.setAttribute('aria-label', 'Выбранная сборка');
  root.append(el('h3', `Выбранная сборка ${row.shortSha}`), el('p', row.statusLabel, row.status === 'approved' ? 'managed-accepted' : 'managed-note'),
    el('p', `SHA-256: ${row.sha256} · ${row.size} байт · платформа Target: ${row.platformVersion}`, 'change-text'), el('p', row.evidenceLabel));
  const units = el('ol'); units.setAttribute('aria-label', 'Порядок импорта');
  row.units.forEach(unit => units.append(el('li', `${unit.id} · ${unit.adapter}`))); root.append(el('h4', 'Порядок импорта'), units);
  if (row.approval) root.append(el('p', `Принял ${row.approval.actor} · ${row.approval.at}: ${row.approval.reason}`, 'change-text'));
  // `blocked` follows a conflict or lost response; a stale candidate still loads its history read-only.
  let busy = false, blocked = false;
  if (row.canApprove || row.canRevoke) {
    const action = row.canApprove ? 'approve' : 'revoke', form = el('form'), gate = el('p', '', 'managed-note');
    const caption = el('label', row.canApprove ? 'Причина принятия точных байтов' : 'Причина отзыва принятия'), reason = el('textarea');
    reason.id = 'managed-composer-reason-' + ++sequence; caption.htmlFor = reason.id; reason.required = true; reason.maxLength = 4000;
    const submit = el('button', row.canApprove ? 'Принять сборку' : 'Отозвать принятие'); submit.type = 'submit';
    const update = () => { gate.textContent = composerGate(row, action, reason.value); submit.disabled = busy || blocked || !!gate.textContent; };
    reason.oninput = update;
    form.append(caption, reason, el('p', 'Принятие относится к рецензии точных байтов. Оно не разрешает импорт и не выбирает Target.', 'managed-muted'), gate, submit);
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || blocked || composerGate(row, action, reason.value)) return;
      busy = true; update(); error.textContent = ''; status.textContent = 'Сохраняем. Дождитесь ответа…';
      try { await actions.change(record.id, { action, revision: record.revision, reason: reason.value }); status.textContent = 'Сохранено. Открываем обновлённое состояние…'; }
      catch (e) {
        blocked = e.status === 409 || !!e.requiresRefresh; status.textContent = '';
        error.textContent = e.message || 'Не удалось выполнить действие.';
        if (blocked) error.append(el('p', 'Проверьте актуальное состояние перед повтором. Введённый текст сохранён на этой странице.'), (actions.link || (() => el('span')))('Обновить состояние', actions.candidateHref?.(record.id), true));
      } finally { busy = false; update(); }
    };
    root.append(form); update();
  } else if (row.status === 'stale') root.append(el('p', 'Решение и доставка недоступны: соберите конфигурацию заново для текущих принятых изменений. История сохраняется.', 'managed-note'));
  if (actions.deliveryClient && row.status !== 'awaiting-approval') {
    // Same contract as the handoff: a write whose response is lost is never replayed;
    // the section is redrawn only from a fresh server read.
    const replace = async (operation, drafts) => {
      error.textContent = '';
      try {
        const next = await operation();
        const replacement = mountCandidate(next, composedCandidateRow(next), actions, { status, error }, drafts);
        root.replaceWith(replacement); replacement.querySelector('.release-delivery h2')?.focus({ preventScroll: true });
      } catch (e) {
        blocked = blocked || e.status === 409 && !e.recoverable || !!e.requiresRefresh;
        error.textContent = e.message || 'Не удалось выполнить действие.';
        if (blocked) root.querySelectorAll('button').forEach(node => { node.disabled = true; });
        if (blocked) error.append(el('p', 'Проверьте актуальное состояние перед повтором; операция не повторяется автоматически.'), (actions.link || (() => el('span')))('Обновить состояние', actions.candidateHref?.(record.id), true));
      }
    };
    const panel = mountDelivery({ release: composedDeliveryRelease(record), client: actions.deliveryClient, isBlocked: () => busy || blocked, initialDrafts,
      onAction: input => replace(() => actions.deliveryClient.act(record.id, input), panel.getDrafts()),
      onRefresh: () => replace(() => actions.deliveryClient.refresh(record.id), panel.getDrafts()) });
    root.append(panel);
  } else if (row.status === 'awaiting-approval') root.append(el('p', 'Доставка станет доступна после принятия точных байтов.', 'managed-muted'));
  return root;
}
