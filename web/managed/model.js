import { requests as requestLabels, grouping as groupingLabels, classificationLabels, elementClassificationLabels, elementKindLabels, actions as actionLabels, summaries, kindGroups, displayLabel, isTechnicalKey, ribbon, steps as stepLabels, stepReasons, statuses, activity as activityLabels, buildEligibility, candidateEvidence, gates as gateLabels, composerBuild } from './labels.js';
// Review classification wording lives in labels.js (UX-00); these names stay for
// existing importers.
export const labels = classificationLabels;
export const elementLabels = elementClassificationLabels;
export const elementKinds = elementKindLabels;
export function responsibilityLabel(component) {
  if (!component.responsibility) return component.service === 'processor' ? 'По объекту: ' + component.team + ' · части не установлены' : component.team;
  const counts = new Map();
  for (const part of component.responsibility.elements) { const team = part.team || 'Не установлена'; counts.set(team, (counts.get(team) || 0) + 1); }
  return [...counts].map(([team,count]) => `${team}: ${count}`).join(' · ') || 'Распознанных частей нет';
}
// Download only already authorized review evidence. This report is a manual
// responsibility declaration, not native authorship, liability or an archive.
export function responsibilityReport(state, review) {
  const quote = value => JSON.stringify(value ?? null);
  const lines = [`Решение: ${quote(state.name)}`, `Изменение: ${quote(review.artifactId)}`, `Ревизия рассмотрения: ${review.revision}`,
    `Отпечаток рассмотренных данных: ${review.artifactDigest || 'Не установлен'}`, `Команда изменения: ${quote(review.options.team || review.options.baselineOwner)}`,
    `Загрузил: ${quote(review.uploadedBy?.login)}`, `Принято: ${quote(review.acceptedAt)}`, `Принял: ${quote(review.acceptedDecision?.actor?.login)}`,
    'Заявленная ответственность команд; авторы публикаций ELMA и договорная ответственность не установлены.',
    'Это отчёт рассмотрения. Исходные файлы сохранены отдельно; отчёт не является пакетом установки или подтверждением доставки.', ''];
  for (const row of review.rows) {
    lines.push(`Объект: ${quote(row.key)} · ${labels[row.classification] || row.classification}`,
      `Граница исходной версии: ${row.boundaryCrossing ? 'требует рассмотрения' : 'не выявлена'} · конфликт: ${row.conflict || row.classification === 'conflict' ? 'да' : 'нет'}`);
    if (row.elements) {
      lines.push(`Части: ${row.elements.complete ? 'идентичность установлена' : 'неполные или неоднозначные данные'} · прочие данные изменились: ${row.elements.residualChanged ? 'да' : 'нет'}`);
      for (const part of row.elements.rows) lines.push(`${elementKinds[part.kind] || part.kind} ${quote(part.code)} ${quote(part.name)} · ${elementLabels[part.classification] || part.classification} · прежняя команда: ${quote(part.team)} · граница: ${!!part.boundaryCrossing} · конфликт: ${!!part.conflict}\n  ${quote(part.pointer)} · было: ${part.beforeDigest || 'отсутствует'} · стало: ${part.afterDigest || 'отсутствует'}${part.kind === 'transition' ? '\n  Исходная связь: ' + quote(part.from) + ' -> ' + quote(part.to) + '; права, условия и контракт данных не установлены.' : ''}`);
      for (const unknown of row.elements.ambiguities) lines.push('Не установлено: ' + quote(unknown));
    } else lines.push('Независимая ответственность частей не установлена; сравнение на уровне объекта.');
    lines.push('');
  }
  return lines.join('\n');
}
export function componentName(key) {
  try { const parts = JSON.parse(key); return Array.isArray(parts) ? parts.at(-1) : key; } catch { return key; }
}

// UX-02: business name first, technical key second. These projections read the
// component metadata (service, namespace, code, kind, name) and never change
// identity, digests or classification.
const keyParts = key => { try { const parts = JSON.parse(key); return Array.isArray(parts) ? parts : null; } catch { return null; } };
// Metadata recoverable from the key alone ([service, namespace, code] or
// [service, namespace, kind, code]), for rows known only by key, e.g. objects a review adds.
export function objectFromKey(key) {
  const parts = keyParts(key);
  if (!parts || parts.length < 3) return { key };
  const [service, namespace] = parts, code = parts.at(-1);
  return { key, service, namespace, code, ...(parts.length > 3 ? { kind: parts[2] } : {}) };
}
// The technical label a row had before UX-02; stays the fallback and the muted secondary text.
export function objectCode(input = {}) {
  const row = { ...objectFromKey(input.key), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value != null)) };
  const parts = keyParts(row.key);
  if (parts && parts.length > 3) return row.code ? `${row.namespace} · ${row.code} · ${row.kind}` : `${row.namespace} · ${row.kind}`;
  return row.code || (parts ? parts.at(-1) : row.key) || '';
}
export function objectLabel(row = {}) {
  const code = objectCode(row);
  const name = typeof row.name === 'string' && row.name.trim() && row.name.trim() !== row.code ? row.name.trim() : '';
  return displayLabel({ name, key: code });
}
const kindOfService = { processor: 'processes', widgets: 'forms', appViews: 'forms', applications: 'data', collections: 'data', settings: 'data',
  permissions: 'permissions', permissionsSettings: 'permissions', localizer: 'localization' };
export function objectKind(row = {}) { return kindOfService[row.service] || 'other'; }
export function objectKindLabel(row = {}) { return kindGroups[objectKind(row)]; }
// ELMA exports each section (workspace) as a `pages` record in the global
// namespace whose code is the section code; its name is the module's display name.
const isSectionPage = row => row.service === 'pages' && row.namespace === 'global' && typeof row.code === 'string' && !!row.code;
// Module = the first segment of the namespace (ELMA workspace code); a section page belongs to its own section.
export function objectModule(row = {}) {
  if (isSectionPage(row)) return row.code;
  return typeof row.namespace === 'string' && row.namespace ? row.namespace.split('.')[0] : '';
}
// Display names are labels only; module identity stays the code.
export function moduleNames(rows = []) {
  const names = new Map();
  for (const row of rows) if (isSectionPage(row) && typeof row.name === 'string' && row.name.trim() && row.name.trim() !== row.code) names.set(row.code, row.name.trim());
  return names;
}
export function moduleLabel(module, names) {
  const name = module ? names?.get(module) : '';
  return name ? { text: name, code: module } : { text: module || groupingLabels.withoutModule, code: '' };
}
// Permissions, localization, name-less defaults and section pages are system objects: shown collapsed unless changed.
export function isSystemObject(row = {}) {
  const kind = objectKind(row);
  return kind === 'permissions' || kind === 'localization' || row.code === '__default' || isSectionPage(row) || (!row.name && isTechnicalKey(objectCode(row)));
}
// Groups rows by module, then by kind group in display order; system objects
// go to their own list. The order of rows inside a group is preserved.
export function groupObjects(rows = []) {
  const modules = new Map(), system = [];
  for (const row of rows) {
    if (isSystemObject(row)) { system.push(row); continue; }
    const module = objectModule(row), kind = objectKind(row);
    if (!modules.has(module)) modules.set(module, new Map());
    const kinds = modules.get(module);
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind).push(row);
  }
  const order = Object.keys(kindGroups), names = moduleNames(rows);
  return { modules: [...modules].sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([module, kinds]) => ({ module, name: names.get(module) ?? null, count: [...kinds.values()].reduce((n, list) => n + list.length, 0),
    kinds: [...kinds].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([kind, list]) => ({ kind, label: kindGroups[kind], rows: list })) })), system };
}
// UX-03: one summary of a review. Buckets follow the existing classifications;
// nothing here changes gates, digests or decisions.
export const reviewBucket = row => row.conflict || row.mergeConflict || row.classification === 'conflict' ? 'conflicts'
  : row.classification === 'unchanged' ? 'unchanged' : row.classification === 'intervention-added' ? 'added'
  : row.classification === 'component-deleted' ? 'removed' : row.classification === 'ambiguous' ? 'unknown' : 'modified';
// Responsibility flags and three-way merge conflicts are different evidence.
// Preserve both in the display projection without changing captured review rows.
export function reviewRows(review) {
  const conflicts = new Set((review?.merge?.head?.status === 'current' ? [] : review?.merge?.plan?.rows || [])
    .filter(row => row.status === 'resolution-required').map(row => row.key));
  return (review?.rows || []).map(row => conflicts.has(row.key) ? { ...row, mergeConflict: true } : row);
}
export function reviewSummary(review, rows = reviewRows(review)) {
  const counts = { modified: 0, added: 0, removed: 0, conflicts: 0, unchanged: 0, unknown: 0 };
  for (const row of rows) counts[reviewBucket(row)]++;
  const changed = rows.length - counts.unchanged;
  const line = [[ribbon.modified, counts.modified], [ribbon.added, counts.added], [ribbon.removed, counts.removed], [ribbon.conflicts, counts.conflicts], [ribbon.unchanged, counts.unchanged]]
    .map(([label, count]) => `${label} ${count}`).join(' · ');
  return { counts, changed, line, total: rows.length,
    noDifference: rows.length > 0 && changed === 0 && !(review?.ambiguities?.length),
    unknownParts: review?.ambiguities?.length || 0,
    dependencyProblems: (review?.dependencies?.rows || []).filter(row => row.status !== 'component-source-present').length };
}
// UX-08: the actor's "Просмотрено" progress over the changed objects. A mark
// on an object whose digest changed since does not count; it is reported
// separately so the row can say "Изменилось после просмотра".
export function viewedProgress(review, rows = review?.rows || []) {
  if (!review?.viewed) return null;
  const marks = new Map(review.viewed.rows.map(row => [row.key, row]));
  const changed = rows.filter(row => reviewBucket(row) !== 'unchanged');
  const status = row => marks.get(row.key)?.status || 'unviewed';
  const viewed = changed.filter(row => status(row) === 'viewed').length;
  return { viewed, total: changed.length, changedSinceViewed: changed.filter(row => status(row) === 'changed').length,
    line: `${ribbon.viewed} · ${viewed} ${ribbon.viewedOf} ${changed.length}` };
}
// Dependency rows grouped by target and status, with a count, so a target
// referenced from many components reads as one line.
export function groupDependencies(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const id = [row.required ? 'required' : 'optional', row.service || '?', row.targetNamespace || '?', row.targetCode || '?', row.status || ''].join('\u0000');
    if (!groups.has(id)) groups.set(id, { ...row, count: 0, candidates: row.candidates || [] });
    groups.get(id).count++;
  }
  return [...groups.values()].sort((a, b) => (b.required - a.required) || (a.status === 'component-source-present') - (b.status === 'component-source-present') || b.count - a.count);
}
export const dateLabel = value => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Дата не зафиксирована';
export function workspaceSummary(state) {
  const baseline = state.artifacts?.find(row => row.id === state.baselineId);
  return { baseline, changed: state.current?.filter(row => row.interventionId).length ?? state.changedComponents ?? 0,
    pending: state.pending?.length ?? state.pendingCount ?? 0,
    source: (state.artifacts?.find(row => row.snapshot?.source)?.snapshot.source || state.sourceReference || state.baselineSnapshot?.source)?.connectionId
      || 'Ручная загрузка · подключение к источнику не проверено' };
}
export function reviewGate(review, boundaryKeys = [], resolutions = {}) {
  if (!review || review.stale) return 'Сравнение устарело. Обновите решение и подготовьте новое сравнение.';
  if (review.discussion?.blocking) return 'Есть замечания, требующие изменений. Устраните их перед принятием.';
  if (review.ambiguities.length) return 'Часть содержимого не распознана. Принятие заблокировано; проверьте исходный файл.';
  // A current whole-component resolution decides every conflicting object; the
  // server re-checks it at acceptance. A part merge has no physical file yet.
  const head = review.kind === 'change' && review.merge?.head?.status === 'current' ? review.merge.head : null;
  if (head?.decisions?.some(row => row.parts)) return gateLabels.partMergeUnbuildable;
  if (review.kind === 'change' && !head && review.merge?.plan?.status === 'resolution-required') return gateLabels.resolveConflict;
  if (review.kind === 'change' && !head && review.rows.some(row => row.conflict))
    return review.merge?.available ? gateLabels.resolveConflict : 'Другая команда уже изменила этот объект. Сначала согласуйте изменения через новый полный снимок.';
  if (review.kind === 'change' && review.rows.some(row => row.boundaryCrossing && !boundaryKeys.includes(row.key))) return 'Подтвердите каждое изменение объекта исходной базы.';
  if (review.kind === 'reconciliation' && review.rows.some(row => row.classification === 'conflict' && !['keep-working', 'take-snapshot'].includes(resolutions[row.key]))) return 'Выберите версию для каждого конфликта.';
  return '';
}
export const workspaceUrl = (id, view, artifact, home = '/workspaces') => home + (id || view ? '?' + new URLSearchParams({ ...(id ? { id } : {}), ...(view ? { view } : {}), ...(artifact ? { artifact } : {}) }) : '');

// Navigation hint only; the server reparses exact bytes under its queue before
// capture, approval and handoff. A virtual mixed state has no handoff entry.
export function hasAcceptedFullExport(state) {
  if (!state || state.status !== 'active' || state.pending?.length || state.openFindings?.length) return false;
  const artifacts = state.artifacts || [], baseline = artifacts.at(-1);
  if (!baseline || baseline.id !== state.baselineId || baseline.scope !== 'full' || !Array.isArray(baseline.components) || !Array.isArray(state.current)) return false;
  const current = new Map(state.current.map(row => [row.key, row.digest]));
  return current.size === state.current.length && baseline.components.length === state.current.length
    && baseline.components.every(row => current.get(row.key) === row.digest);
}

// The change a build may name: the latest accepted change, carrying its merge
// resolution, while that acceptance is still the current revision. A hint only;
// the server re-derives and re-checks the accepted merged revision.
export function acceptedMergeTarget(state) {
  const last = state?.history?.at(-1);
  if (state?.status !== 'active' || state.openFindings?.length || last?.type !== 'change-accepted' || last.revision !== state.revision) return null;
  return state.changes?.find(row => row.id === last.id)?.resolution ? { artifactId: last.id, expectedRevision: state.revision } : null;
}

// The domain stays authoritative. This pure projection chooses one next action
// (product plan one-next-action map). Composer states are projected only when the
// server's composed candidates and build capability were actually loaded.
export function solutionNextAction(state, { error, stale, view, composed } = {}) {
  if (error || stale) return { state: stale ? 'stale' : 'error', summary: 'Проверьте актуальное состояние решения.', label: 'Обновить состояние', view: 'overview' };
  if (!state) return { state: 'empty', summary: 'Решений пока нет.', label: actionLabels.loadSolution, view: 'create' };
  if (state.status === 'archived') return { state: 'archived', summary: 'Решение в архиве. Исходные файлы и история сохранены.', label: 'Возобновить работу', action: 'reopen' };
  if (!state.baselineId) return { state: 'no-source', summary: 'Для начала нужен полный экспорт решения.', label: 'Добавить решение', view: 'create' };
  const pending = state.pending || [];
  const problem = pending.find(row => !row.stale && (row.attention?.conflicts || row.attention?.unknown));
  const fixes = pending.find(row => !row.stale && row.decision === 'needs-changes');
  const fresh = problem || fixes || pending.find(row => !row.stale);
  // A conflicting partial change without a declared base cannot be resolved
  // three-way; the base is established by preparing the change again.
  if (problem?.attention.conflicts && problem.kind === 'change' && problem.baseDeclaration?.status === 'unknown')
    return { state: 'unknown-base', summary: 'В изменении есть конфликт, а его исходная версия не указана. Укажите базу, чтобы сравнить версии.', label: 'Указать базу изменения', view: 'change', artifact: problem.artifactId };
  if (fresh) return {
    state: problem ? problem.attention.conflicts ? 'conflict' : 'unknown' : fixes ? 'needs-fixes' : 'unreviewed',
    summary: problem ? problem.attention.conflicts ? 'В изменении есть конфликт. Выберите версию для каждого объекта.' : 'Часть изменения не распознана. Проверьте исходные данные.'
      : fixes ? 'Для изменения запрошены исправления.' : `${pending.length} изменений ожидают рассмотрения.`,
    label: problem?.attention.conflicts ? 'Разрешить конфликт' : fixes && !problem ? 'Добавить исправление' : 'Рассмотреть изменение',
    view: fixes && !problem ? fresh.kind === 'change' ? 'change' : 'full' : 'review', artifact: fresh.artifactId
  };
  if (pending.length) return { state: 'compare', summary: 'Принятая версия изменилась. Изменения нужно сравнить заново.', label: 'Сравнить изменения', view: pending[0].kind === 'change' ? 'change' : 'full' };
  if (state.openFindings?.length) return { state: 'needs-fixes', summary: 'Есть замечания к принятому изменению.', label: 'Рассмотреть замечания', view: 'review', artifact: state.openFindings[0].artifactId };
  // Delivery states are projected only when the existing delivery capability is supplied.
  if (state.delivery?.supported && state.delivery.state === 'deployed-unverified') return { state: 'test-awaiting-verification', summary: 'Версия отправлена в TEST. Результат ещё не проверен.', label: 'Проверить TEST', view: 'delivery' };
  if (state.delivery?.supported && state.delivery.state === 'verified') return { state: 'verified', summary: 'TEST проверен. Работа завершена.', label: 'Открыть решение', view: 'solution' };
  const accepted = state.changes?.length || state.reconciliations?.length;
  if (accepted && composed && !composed.loadError) {
    const current = (composed.candidates || []).filter(row => row.inputsStatus === 'current').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    // Exact bytes must be approved before a candidate can be verified on a Target.
    if (current && current.approval?.revision !== current.revision) return { state: 'review-build', summary: 'Конфигурация собрана. Проверьте и примите точные байты сборки перед проверкой на Target.',
      label: 'Рассмотреть сборку', view: 'compose', candidate: current.id };
    if (current) return { state: 'verify', summary: current.evidenceBasis === 'native'
      ? candidateEvidence.nativeNext
      : current.evidenceBasis === 'synthetic' ? 'Есть принятая учебная сборка. Её можно проверить только на учебном стенде; это не пакет ELMA и не выпуск.'
      : candidateEvidence.unknownNext,
      label: 'Проверить конфигурацию', view: 'compose', candidate: current.id };
    // Build is offered only when native materialization is available and every eligibility gate is verified.
    const eligible = composed.eligibility?.eligible === true && (composed.eligibility.gates || []).every(gate => gate.status === 'verified');
    if (composed.build?.available === true && !eligible) return { state: 'build-blocked', summary: buildEligibility.blockedSummary, label: 'Открыть сборку', view: 'compose' };
    if (composed.build?.available === true && !acceptedMergeTarget(state)) return { state: 'build-blocked', summary: composerBuild.noMergeSummary, label: 'Открыть сборку', view: 'compose' };
    return composed.build?.available === true
      ? { state: 'build', summary: 'Изменения приняты. Соберите конфигурацию из принятой версии.', label: 'Собрать конфигурацию', view: 'compose' }
      : { state: 'build-blocked', summary: 'Изменения приняты. Сборка конфигурации заблокирована: нативная материализация ELMA недоступна.', label: 'Открыть сборку', view: 'compose' };
  }
  // The fixed path has one way to create a new version: pull again (`full`).
  return accepted ? { state: 'accepted', summary: summaries.accepted, label: view === 'solution' ? actionLabels.refresh : 'Открыть решение', view: view === 'solution' ? 'full' : 'solution' }
    : { state: 'ready', summary: summaries.ready, label: actionLabels.refresh, view: 'full' };
}

// UX-03b: the choices of the "Решение по версии" dialog. A pure projection of
// the review: the gate text disables acceptance (with its reason), the
// discussion decides whether a finding or a comment can be recorded, and an
// accepted, closed or stale review offers nothing. The first enabled choice is
// the default; nothing is preselected when every choice is disabled.
export function decisionChoices(review, gate = reviewGate(review)) {
  if (!review || review.stale || review.acceptedAt || review.closedAt) return [];
  const choices = [{ id: 'accept', disabled: !!gate, reason: gate || '' }];
  if (review.discussion) choices.push({ id: 'request-fixes', disabled: false, reason: '' }, { id: 'comment', disabled: false, reason: '' });
  return choices;
}
export const decisionDefault = choices => choices.find(choice => !choice.disabled)?.id ?? null;

// A version with no difference can be closed without a decision; any changed,
// added, removed or conflicting object, or an unrecognised part, needs one.
export function canCloseWithoutChanges(review, summary) {
  if (!review || review.stale || review.acceptedAt || review.closedAt) return false;
  return !!summary?.noDifference && !review.ambiguities?.length;
}

// UX-04: the header badge is a projection of the next-action state; it adds no
// state of its own. Archived wins; any open conflict or missing base reads as
// Конфликт; other pending work waits for review; everything after acceptance
// (build, verify, delivery evidence) is Принято; a fresh or empty Solution is В работе.
export function solutionStatus(next = {}) {
  const key = next.state === 'archived' ? 'archived'
    : ['conflict', 'unknown-base'].includes(next.state) ? 'conflict'
    : ['unknown', 'unreviewed', 'needs-fixes', 'compare'].includes(next.state) ? 'awaitingReview'
    : ['accepted', 'build', 'build-blocked', 'review-build', 'verify', 'test-awaiting-verification', 'verified'].includes(next.state) ? 'accepted'
    : 'working';
  return { key, label: statuses[key] };
}

// UX-04: the lifecycle stepper. One row of the product plan's one-next-action
// map maps to one current step; steps before it are done, steps after it are
// next. A step the product cannot perform yet is unavailable with a two-word
// reason (build without a builder, release before P6) and is never shown as
// working. Error and stale states have no stepper: the page asks to refresh.
export function lifecycleSteps(state, next = solutionNextAction(state), composed) {
  if (!next || ['error', 'stale', 'empty'].includes(next.state)) return [];
  const order = ['load', 'compare', 'review', 'build', 'verify', 'release'];
  const current = next.state === 'no-source' ? 'load'
    : ['ready', 'compare'].includes(next.state) ? 'compare'
    : ['unreviewed', 'needs-fixes', 'conflict', 'unknown', 'unknown-base'].includes(next.state) ? 'review'
    : ['accepted', 'build', 'build-blocked', 'review-build'].includes(next.state) ? 'build'
    : ['verify', 'test-awaiting-verification'].includes(next.state) ? 'verify'
    : next.state === 'verified' ? 'release'
    : next.state === 'archived' ? (state?.changes?.length || state?.reconciliations?.length ? 'build' : state?.baselineId ? 'compare' : 'load') : 'compare';
  // 'accepted' is the review-only projection: the composer was not loaded, so no
  // builder is known. Release stays unavailable until P6 defines it.
  // 'accepted' with a failed composer read is unknown, not "no builder".
  const unavailable = { build: next.state === 'accepted' && composed?.loadError ? stepReasons.builderUnknown : ['accepted', 'build-blocked'].includes(next.state) ? stepReasons.noBuilder : '', release: stepReasons.notYet };
  // A training (synthetic) build is not an ELMA package: a done Сборка step says
  // so instead of reading as a finished build. The note never changes the state.
  const candidate = next.candidate ? (composed?.candidates || []).find(row => row.id === next.candidate) : null;
  const notes = { build: candidate && candidate.evidenceBasis !== 'native' ? stepReasons.syntheticBuild : '' };
  const index = order.indexOf(current);
  return order.map((id, position) => {
    const reason = unavailable[id] || '';
    const stateOf = reason ? 'unavailable' : position < index ? 'done' : position === index && next.state !== 'archived' ? 'current' : 'next';
    return { id, label: stepLabels[id], state: stateOf, current: position === index && next.state !== 'archived', reason, note: stateOf === 'done' ? notes[id] || '' : '' };
  });
}

// UX-05: people are people. A display name and initials projected from the
// trusted actor record (login is an e-mail or a messenger login; the id is never
// shown). Pure: no lookups, no claims about the person beyond their login.
export function actorDisplay(actor) {
  const login = typeof actor === 'string' ? actor : actor?.login || '';
  const local = login.includes('@') ? login.slice(0, login.indexOf('@')) : login;
  const words = local.split(/[\s._-]+/).filter(Boolean).map(word => word[0].toLocaleUpperCase('ru-RU') + word.slice(1));
  const name = words.join(' ') || (actor?.id ? '…' : '');
  const initials = words.slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('ru-RU') || '?';
  return { name, initials, login };
}
export function relativeTime(value, now = Date.now()) {
  const at = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(at)) return dateLabel(value);
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return activityLabels.justNow;
  if (minutes < 60) return `${minutes} ${activityLabels.minutesAgo}`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ${activityLabels.hoursAgo}`;
  if (minutes < 48 * 60) return activityLabels.yesterday;
  return dateLabel(value);
}
// One card per module: business rows by kind; system objects are counted, not listed.
export function moduleCards(rows = []) {
  const grouped = groupObjects(rows);
  return grouped.modules.map(({ module, name, count, kinds }) => {
    const of = kind => kinds.find(row => row.kind === kind)?.rows || [];
    const systemRows = grouped.system.filter(row => objectModule(row) === module);
    return { module, name, count, processes: of('processes'), forms: of('forms'), data: of('data'), other: of('other'), systemRows, system: systemRows.length };
  });
}
// Activity list from the attributed audit records the server already keeps; newest first.
export function activityFeed(state, limit = 8, now = Date.now()) {
  return (state?.audit || []).slice(-limit).reverse().map((row, index) => ({
    id: row.at + ':' + index, action: row.action, label: activityLabels.events[row.action] || row.action,
    actor: actorDisplay(row.actor), at: row.at, when: relativeTime(row.at, now), artifactId: row.artifactId ?? null }));
}

// UX-06: the captured artifact that holds a row's exact bytes (latest wins), and
// the search rule shared by the tabs: business name, code, namespace or key,
// case-insensitive; an empty query matches everything.
export function capturedArtifact(state, row) {
  return (state?.artifacts || []).filter(artifact => (artifact.components || []).some(component => component.key === row.key && component.digest === row.digest)).at(-1) || null;
}
export function matchesQuery(row, query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  return [row.name, row.code, row.namespace, row.key, objectLabel(row).text].some(value => typeof value === 'string' && value.toLocaleLowerCase('ru-RU').includes(needle));
}
// UX-05 follow-up: the module card as data. Title falls back to "Без модуля"
// when the namespace is empty; sentence parts carry the first `limit` names and
// how many more there are; a module without a code cannot be described.
export function moduleCardView(card, limit = 6) {
  const label = objectLabel({ code: card.module, name: card.name, namespace: card.module });
  const parts = [['processes', card.processes], ['forms', card.forms], ['data', card.data]].filter(([, rows]) => rows.length)
    .map(([kind, rows]) => ({ kind, names: rows.slice(0, limit).map(row => objectLabel(row).text), more: Math.max(0, rows.length - limit) }));
  return { title: { text: label.text || groupingLabels.withoutModule, technical: label.technical || !label.text }, parts, explainable: !!card.module };
}

// UX-07: requests as data. The kind an object row suggests; the "Где" label of a
// stored request (module · business name, plus the step id when anchored to a
// step); open-request counts per object key for the chips; the creation payload
// from what the form and the entry point know. Anchors are copied from the
// captured projection untouched; a step anchor is sent only with its own object.
export const requestKindOf = row => ({ processes: 'process', forms: 'screen' })[objectKind(row)] || 'data';
export function requestTargetLabel(state, request) {
  const key = request?.target?.anchor?.key;
  if (!key) return { text: requestLabels.wholeSolution, technical: false, step: '' };
  const row = (state?.current || []).find(item => item.key === key) || objectFromKey(key), label = objectLabel(row), module = objectModule(row);
  const field = request.target.fieldAnchor;
  return { text: (module ? `${moduleLabel(module, moduleNames(state?.current || [])).text} · ` : '') + label.text, technical: label.technical, step: request.target.sourceAnchor?.nodeId || '',
    field: field ? field.name && field.name !== field.code ? `${field.name} · ${field.code}` : field.code : '' };
}
export function requestCounts(requests = []) {
  const counts = new Map();
  for (const row of requests) if (['new', 'in-progress'].includes(row.status) && row.target?.anchor?.key) counts.set(row.target.anchor.key, (counts.get(row.target.anchor.key) || 0) + 1);
  return counts;
}
// The key of a field-level chip: the object plus the field's pointer in the export.
export const fieldRequestKey = (objectKey, pointer) => `${objectKey}#${pointer}`;
export function fieldRequestCounts(requests = []) {
  const counts = new Map();
  for (const row of requests) if (['new', 'in-progress'].includes(row.status) && row.target?.anchor?.key && row.target.fieldAnchor) {
    const key = fieldRequestKey(row.target.anchor.key, row.target.fieldAnchor.pointer); counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
// A field anchors only when the export declares it uniquely (code, pointer and
// fingerprint); otherwise the request names the field in its text, as before.
export const fieldAnchorable = (field, fields = []) => Boolean(field?.code && field.pointer && field.fingerprint && fields.filter(item => item.code === field.code).length === 1);
export function requestInput({ state, kind, row = null, anchor = null, field = null, title = '', text = '', reason = '', urgency = 'normal' }) {
  const artifact = row ? capturedArtifact(state, row) : (state.artifacts || []).find(item => item.id === state.baselineId) || (state.artifacts || []).at(-1);
  if (!artifact) return null;
  const step = row && anchor && anchor.artifactId === artifact.id && JSON.stringify(anchor.object) === row.key
    ? { artifactId: anchor.artifactId, checksum: anchor.checksum, fingerprint: anchor.fingerprint, nodeId: anchor.nodeId, object: anchor.object, pointer: anchor.pointer } : null;
  return { id: crypto.randomUUID(), expectedRevision: state.revision, kind, title: title.trim(), text: text.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}), urgency,
    target: { artifactId: artifact.id, ...(row ? { componentKey: row.key } : {}), ...(step ? { sourceAnchor: step } : {}),
      ...(row && !step && field?.artifactId === artifact.id ? { fieldAnchor: { code: field.code, pointer: field.pointer, fingerprint: field.fingerprint } } : {}) } };
}
