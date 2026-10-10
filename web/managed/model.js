export const labels = {
  unchanged: 'Без изменений', 'intervention-added': 'Добавлен объект', 'component-modified': 'Объект изменён',
  'known-change-retained': 'Наше изменение сохранится', 'known-change-incorporated': 'Наше изменение включено в снимок',
  'external-change': 'Изменение из полного снимка', 'component-deleted': 'Удаление заявлено явно', conflict: 'Нужен выбор версии', ambiguous: 'Недостаточно данных'
};
export const elementLabels = { ...labels, 'element-added': 'Добавлен', 'element-removed': 'Удалён', 'element-modified': 'Изменён' };
export const elementKinds = { node: 'Шаг', transition: 'Переход', variable: 'Переменная', lane: 'Дорожка' };
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
  if (review.kind === 'change' && review.rows.some(row => row.conflict)) return 'Другая команда уже изменила этот объект. Сначала согласуйте изменения через новый полный снимок.';
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

// The domain stays authoritative. This pure projection chooses one next action.
export function solutionNextAction(state, { error, stale, view } = {}) {
  if (error || stale) return { state: stale ? 'stale' : 'error', summary: 'Проверьте актуальное состояние решения.', label: 'Обновить состояние', view: 'overview' };
  if (!state) return { state: 'empty', summary: 'Решений пока нет.', label: 'Добавить решение', view: 'create' };
  if (state.status === 'archived') return { state: 'archived', summary: 'Решение в архиве. Исходные файлы и история сохранены.', label: 'Возобновить работу', action: 'reopen' };
  if (!state.baselineId) return { state: 'no-source', summary: 'Для начала нужен полный экспорт решения.', label: 'Добавить решение', view: 'create' };
  const pending = state.pending || [];
  const problem = pending.find(row => !row.stale && (row.attention?.conflicts || row.attention?.unknown));
  const fixes = pending.find(row => !row.stale && row.decision === 'needs-changes');
  const fresh = problem || fixes || pending.find(row => !row.stale);
  if (fresh) return {
    state: problem ? problem.attention.conflicts ? 'conflict' : 'unknown' : fixes ? 'needs-fixes' : 'unreviewed',
    summary: problem ? problem.attention.conflicts ? 'В изменении есть конфликт. Выберите версию при рассмотрении.' : 'Часть изменения не распознана. Проверьте исходные данные.'
      : fixes ? 'Для изменения запрошены исправления.' : `${pending.length} изменений ожидают рассмотрения.`,
    label: fixes && !problem ? 'Добавить исправление' : 'Рассмотреть изменение',
    view: fixes && !problem ? fresh.kind === 'change' ? 'change' : 'full' : 'review', artifact: fresh.artifactId
  };
  if (pending.length) return { state: 'stale', summary: 'Сравнение устарело после обновления решения.', label: 'Сравнить заново', view: pending[0].kind === 'change' ? 'change' : 'full' };
  if (state.openFindings?.length) return { state: 'needs-fixes', summary: 'Есть замечания к принятому изменению.', label: 'Рассмотреть замечания', view: 'review', artifact: state.openFindings[0].artifactId };
  // Delivery states are projected only when the existing delivery capability is supplied.
  if (state.delivery?.supported && state.delivery.state === 'deployed-unverified') return { state: 'test-awaiting-verification', summary: 'Версия отправлена в TEST. Результат ещё не проверен.', label: 'Проверить TEST', view: 'delivery' };
  if (state.delivery?.supported && state.delivery.state === 'verified') return { state: 'verified', summary: 'TEST проверен. Работа завершена.', label: 'Открыть решение', view: 'solution' };
  const accepted = state.changes?.length || state.reconciliations?.length;
  return accepted ? { state: 'accepted', summary: 'Изменения приняты. Ожидающих решений нет.', label: view === 'solution' ? 'Добавить изменение' : 'Открыть решение', view: view === 'solution' ? 'change' : 'solution' }
    : { state: 'ready', summary: 'Текущая версия сохранена. Можно добавить изменение.', label: 'Добавить изменение', view: 'change' };
}
