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
  // A predefined DEV/DEV2 Target is selectable only when configured and deploy-capable (DEV never is);
  // the server still requires an owner-designated candidate and resolves the actor's matching bridge.
  const presetDeploys = connection => !connection.preset || (connection.preset.available === true && connection.preset.allowedOperations?.includes('deploy'));
  const selectable = connection => !!connection && connection.role === 'target' && connection.environment !== 'prod' && connection.probe?.protectedHost !== true && presetDeploys(connection) && (connection.adapter === 'synthetic' ? synthetic : connection.adapter === 'bridge' ? bridge : false);
  const usable = connection => !!connection && connection.role === 'target' && connection.environment !== 'prod' && connection.probe?.ok === true && !!connection.probe.identity?.host && connection.probe?.protectedHost !== true && presetDeploys(connection) && (connection.adapter === 'synthetic' ? synthetic : connection.adapter === 'bridge' ? bridge && (connection.preset ? connection.probe.hostMatches === true : bridges.some(b => b.id === connection.adapterOptions?.bridgeId && b.online)) : false);
  // An operation error or a diverged (partial) read-back keeps the Target reserved until reconciled (MR-08).
  const diverged = attempt => attempt?.state === 'verification-failed' && attempt.evidence?.reconciliation?.outcome === 'diverged' && !attempt.retriedBy;
  const active = attempts.some(a => ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome', 'partial-outcome', 'failed'].includes(a.state) || diverged(a));
  const approved = release.associationStatus !== 'stale' && release.approval?.revision === release.revision && !!release.candidate && !release.blockers.length;
  const viaBridge = latest?.connection?.adapter === 'bridge';
  return { latest, current, synthetic, bridge, enabled, selectable, usable, bridges, connections: connections.filter(c => c.role === 'target'),
    canPrepare: enabled && approved && !active,
    canConfirm: enabled && current && latest?.state === 'prepared' && usable(connections.find(c => c.id === latest.connection?.id)),
    canCancel: latest?.state === 'prepared',
    canVerify: enabled && current && ['deployed-unverified', 'unknown-outcome', 'partial-outcome', 'verification-failed', 'failed'].includes(latest?.state),
    confirmation: latest ? `DEPLOY ${latest.solutionCode} ${latest.sha256.slice(0, 12)}` : '',
    next: !enabled ? 'Доставка в ELMA пока недоступна. Используйте приватный пакет передачи.' :
      latest?.state === 'deploying' ? 'Операция выполняется. Обновите состояние; повторный запуск не нужен.' :
      latest && !current ? 'Попытка относится к прежнему кандидату или условиям. Её результат не подтверждает текущий релиз.' :
      latest?.state === 'partial-outcome' ? 'Часть единиц установки не подтвердила применение. Прочитайте и проверьте состояние Target; повтор операции запрещён, нужен план восстановления.' :
      latest?.state === 'unknown-outcome' ? 'Результат неизвестен. Сначала прочитайте и проверьте состояние стенда; не повторяйте операцию.' :
      latest?.state === 'deployed-unverified' ? 'Прочитайте и сравните результат. Завершение операции ещё не означает совпадение.' :
      latest?.state === 'verified' && latest.verificationCurrent === false ? 'Прежняя проверка не подтверждает текущий кандидат. Сохраните историю и подготовьте новую проверяемую доставку.' :
      latest?.state === 'verified' ? (viaBridge ? 'Read-back с Target совпал с кандидатом по политике проверки. Это сравнение файлов пакета, не проверка поведения в ELMA.' : 'Учебная проверка прошла. Это не доказательство доставки в ELMA.') :
      diverged(latest) ? 'Read-back показал частичную установку: Target не совпадает ни с прежним состоянием, ни с кандидатом. Новая операция запрещена до восстановления по утверждённому плану и повторного read-back.' :
      latest?.state === 'verification-failed' ? (latest.evidence?.verificationError ? 'Не удалось подтвердить read-back. Проверьте доступность и личность Target и повторите чтение; новая операция требует новой подготовки и подтверждения.' : 'Результат не совпал. Изучите расхождения; повторная операция требует новой подготовки и подтверждения.') :
      latest?.state === 'failed' ? 'Ошибка операции не доказывает, что ничего не применено. Сначала прочитайте и проверьте состояние Target; новая подготовка доступна после сверки.' :
      latest?.state === 'blocked' ? 'Доставка заблокирована. Проверьте личность и состояние Target; после исправления подготовьте новую попытку.' :
      latest?.state === 'cancelled' ? 'Подготовка отменена. Для доставки выберите Target и подготовьте новую попытку.' :
      latest?.state === 'prepared' ? (viaBridge ? 'Проверьте личность Target и точный кандидат, затем отдельно подтвердите доставку.' : 'Проверьте стенд и точный кандидат, затем отдельно подтвердите учебную операцию.') :
      !approved ? 'Сначала завершите рецензию и примите неизменяемый кандидат.' :
      !connections.some(usable) ? 'Нет доступного проверенного подключения Target. Добавьте подключение или проверьте его доступность; PROD защищён.' :
      synthetic ? 'Выберите учебный стенд и подготовьте операцию.' :
      !bridges.length ? 'Доставка в ELMA идёт через мост оператора: выдайте токен моста и запустите рабочий процесс на машине оператора.' :
      'Выберите проверенное подключение Target и подготовьте доставку.' };
}
