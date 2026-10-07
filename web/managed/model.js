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
    source: (baseline?.snapshot || state.baselineSnapshot)?.source?.connectionId || 'Ручная загрузка · источник подтверждён владельцем' };
}
export function reviewGate(review, boundaryKeys = [], resolutions = {}) {
  if (!review || review.stale) return 'Сравнение устарело. Обновите пространство и подготовьте новое сравнение.';
  if (review.ambiguities.length) return 'Часть содержимого не распознана. Принятие заблокировано; проверьте исходный файл.';
  if (review.kind === 'change' && review.rows.some(row => row.conflict)) return 'Другая команда уже изменила этот объект. Сначала согласуйте изменения через новый полный снимок.';
  if (review.kind === 'change' && review.rows.some(row => row.boundaryCrossing && !boundaryKeys.includes(row.key))) return 'Подтвердите каждое изменение объекта исходной базы.';
  if (review.kind === 'reconciliation' && review.rows.some(row => row.classification === 'conflict' && !['keep-working', 'take-snapshot'].includes(resolutions[row.key]))) return 'Выберите версию для каждого конфликта.';
  return '';
}
export const workspaceUrl = (id, view, artifact) => '/workspaces' + (id || view ? '?' + new URLSearchParams({ ...(id ? { id } : {}), ...(view ? { view } : {}), ...(artifact ? { artifact } : {}) }) : '');
