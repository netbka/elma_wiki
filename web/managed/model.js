export const labels = {
  unchanged: 'Без изменений', 'intervention-added': 'Добавлен объект', 'component-modified': 'Объект изменён',
  'known-change-retained': 'Наше изменение сохранится', 'known-change-incorporated': 'Наше изменение включено в снимок',
  'external-change': 'Изменение из полного снимка', conflict: 'Нужен выбор версии', ambiguous: 'Недостаточно данных'
};
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
