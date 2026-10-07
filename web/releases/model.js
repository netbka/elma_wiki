import { compareSnapshots } from './comparison.js';
export const deliveryStateLabels = { prepared: 'Подготовлена', deploying: 'Выполняется', 'deployed-unverified': 'Доставлено, не проверено', 'unknown-outcome': 'Результат неизвестен', verified: 'Проверено read-back', 'verification-failed': 'Read-back не совпал', failed: 'Ошибка операции', blocked: 'Заблокирована' };
export function releaseView(record, delivery = null) {
  const changes = compareSnapshots(record.source, record.baseline);
  const blockers = [];
  if (!record.source.code || record.baseline && record.baseline.code !== record.source.code) blockers.push('Код решения не определён или отличается от исходной версии');
  for (const [label, snapshot] of [['DEV', record.source], ['Базовая версия', record.baseline]]) {
    if (!snapshot) continue;
    for (const finding of snapshot.report.diagnostics.filter(d => ['missing', 'malformed', 'unknown', 'opaque'].includes(d.status))) blockers.push(`${label}: ${finding.path} — ${finding.reason}`);
  }
  const unreviewed = changes.filter(row => !record.reviews[row.path] || record.reviews[row.path].decision !== 'accepted');
  const rejected = changes.filter(row => record.reviews[row.path]?.decision === 'rejected');
  if (unreviewed.length) blockers.push(`Не приняты изменения: ${unreviewed.length}`);
  if (!record.baseline && !record.limitations) blockers.push('Нет базовой версии: укажите ограничения сравнения');
  if ([record.source, record.baseline].some(s => s?.report.diagnostics.length) && !record.limitations) blockers.push('Есть неинтерпретируемые фрагменты: укажите ограничения рецензии');
  const approved = record.approval?.revision === record.revision;
  const state = approved ? record.handoffAt ? 'handed-off' : 'prepared' : record.candidate ? 'candidate' : 'review';
  const { owner, ...publicRecord } = record;
  const latest = delivery?.latest || null;
  // Only a matching read-back passes; a returned import, a timeout or a mismatch never does.
  const targetResult = !latest ? 'not-run' : latest.state === 'verified' ? 'pass' : ['verification-failed', 'failed', 'blocked'].includes(latest.state) ? 'fail' : 'not-run';
  return { ...publicRecord, changes, blockers, unreviewed: unreviewed.length, rejected: rejected.length, state, delivery: delivery || { attempts: 0, latest: null }, checks: [
    { id: 'artifact', result: 'pass', label: 'Оригинал сохранён с SHA-256' },
    { id: 'review', result: blockers.length ? 'fail' : 'pass', label: 'Локальная рецензия всего пакета' },
    { id: 'compiler', result: 'not-run', label: 'Проверка ELMA / компиляция' },
    { id: 'dependencies', result: 'not-run', label: 'Зависимости на целевой компании' },
    { id: 'target', result: targetResult, label: latest ? `Target «${latest.connectionName}»: ${deliveryStateLabels[latest.state] || latest.state}` : 'Личность и состояние Target / read-back' }
  ] };
}
