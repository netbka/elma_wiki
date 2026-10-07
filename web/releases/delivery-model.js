import { deliveryIsCurrent } from './model.js';

// Two adapters can be present: the synthetic stand (tests/Storybook, never ELMA) and the operator bridge
// (a worker next to elma365pm on the operator machine). Wording for the synthetic stand stays explicit about
// being an exercise; the bridge wording never claims more than the server's evidence states.
export function deliveryPanelView(release, { capabilities, connections = [], attempts = [], bridges = [] } = {}) {
  const latest = attempts.at(-1) || null;
  const current = deliveryIsCurrent(release, latest);
  const synthetic = capabilities?.mode === 'synthetic' && capabilities.liveDelivery === false;
  const bridge = capabilities?.bridge === true;
  const enabled = synthetic || bridge;
  const usable = connection => !!connection && connection.environment !== 'prod' && connection.probe?.protectedHost !== true && (connection.adapter === 'synthetic' ? synthetic : connection.adapter === 'bridge' ? bridge : false);
  const active = attempts.some(a => ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome'].includes(a.state));
  const approved = release.approval?.revision === release.revision && !!release.candidate && !release.blockers.length;
  const viaBridge = latest?.connection?.adapter === 'bridge';
  return { latest, current, synthetic, bridge, enabled, usable, bridges, connections: connections.filter(c => c.role === 'target'),
    canPrepare: enabled && approved && !active,
    canConfirm: enabled && current && latest?.state === 'prepared',
    canCancel: latest?.state === 'prepared',
    canVerify: enabled && current && ['deployed-unverified', 'unknown-outcome', 'verification-failed'].includes(latest?.state),
    confirmation: latest ? `DEPLOY ${latest.solutionCode} ${latest.sha256.slice(0, 12)}` : '',
    next: !enabled ? 'Доставка в ELMA пока недоступна. Используйте приватный пакет передачи.' :
      latest?.state === 'deploying' ? 'Операция выполняется. Обновите состояние; повторный запуск не нужен.' :
      latest && !current ? 'Попытка относится к прежнему кандидату или условиям. Её результат не подтверждает текущий релиз.' :
      latest?.state === 'unknown-outcome' ? 'Результат неизвестен. Сначала прочитайте и проверьте состояние стенда; не повторяйте операцию.' :
      latest?.state === 'deployed-unverified' ? 'Прочитайте и сравните результат. Завершение операции ещё не означает совпадение.' :
      latest?.state === 'verified' ? (viaBridge ? 'Read-back с Target совпал с кандидатом по политике проверки. Это сравнение файлов пакета, не проверка поведения в ELMA.' : 'Учебная проверка прошла. Это не доказательство доставки в ELMA.') :
      latest?.state === 'verification-failed' ? 'Результат не совпал. Изучите расхождения; повторная операция требует новой подготовки и подтверждения.' :
      latest?.state === 'prepared' ? (viaBridge ? 'Проверьте личность Target и точный кандидат, затем отдельно подтвердите доставку.' : 'Проверьте стенд и точный кандидат, затем отдельно подтвердите учебную операцию.') :
      !approved ? 'Сначала завершите рецензию и примите неизменяемый кандидат.' :
      synthetic ? 'Выберите учебный стенд и подготовьте операцию.' :
      !bridges.length ? 'Доставка в ELMA идёт через мост оператора: выдайте токен моста и запустите рабочий процесс на машине оператора.' :
      'Выберите проверенное подключение Target и подготовьте доставку.' };
}
