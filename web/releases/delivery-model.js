import { deliveryIsCurrent } from './model.js';

export function deliveryPanelView(release, { capabilities, connections = [], attempts = [] } = {}) {
  const latest = attempts.at(-1) || null;
  const current = deliveryIsCurrent(release, latest);
  const synthetic = capabilities?.mode === 'synthetic' && capabilities.liveDelivery === false;
  const active = attempts.some(a => ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome'].includes(a.state));
  const approved = release.approval?.revision === release.revision && !!release.candidate && !release.blockers.length;
  return { latest, current, synthetic, connections: connections.filter(c => c.role === 'target'),
    canPrepare: synthetic && approved && !active,
    canConfirm: synthetic && current && latest?.state === 'prepared',
    canCancel: latest?.state === 'prepared',
    canVerify: synthetic && current && ['deployed-unverified', 'unknown-outcome', 'verification-failed'].includes(latest?.state),
    confirmation: latest ? `DEPLOY ${latest.solutionCode} ${latest.sha256.slice(0, 12)}` : '',
    next: !synthetic ? 'Доставка в ELMA пока недоступна. Используйте приватный пакет передачи.' :
      latest?.state === 'deploying' ? 'Операция выполняется. Обновите состояние; повторный запуск не нужен.' :
      latest && !current ? 'Попытка относится к прежнему кандидату или условиям. Её результат не подтверждает текущий релиз.' :
      latest?.state === 'unknown-outcome' ? 'Результат неизвестен. Сначала прочитайте и проверьте состояние стенда; не повторяйте операцию.' :
      latest?.state === 'deployed-unverified' ? 'Прочитайте и сравните результат. Завершение операции ещё не означает совпадение.' :
      latest?.state === 'verified' ? 'Учебная проверка прошла. Это не доказательство доставки в ELMA.' :
      latest?.state === 'verification-failed' ? 'Результат не совпал. Изучите расхождения; повторная операция требует новой подготовки и подтверждения.' :
      latest?.state === 'prepared' ? 'Проверьте стенд и точный кандидат, затем отдельно подтвердите учебную операцию.' :
      !approved ? 'Сначала завершите рецензию и примите неизменяемый кандидат.' :
      'Выберите учебный стенд и подготовьте операцию.' };
}
