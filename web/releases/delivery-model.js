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
  const diverged = attempt => attempt?.state === 'verification-failed' && ['diverged', 'stale-applied'].includes(attempt.evidence?.reconciliation?.outcome) && !attempt.retriedBy;
  // A dispatched attempt whose outcome is still open. When its candidate went stale, only a
  // reconcile-only read-back (never a verification) can release the Target.
  const open = attempt => !!attempt && (['deploying', 'deployed-unverified', 'unknown-outcome', 'partial-outcome', 'failed'].includes(attempt.state) || diverged(attempt));
  const active = attempts.some(a => ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome', 'partial-outcome', 'failed'].includes(a.state) || diverged(a));
  const approved = release.associationStatus !== 'stale' && release.approval?.revision === release.revision && !!release.candidate && !release.blockers.length;
  // AR-05: an edited candidate has no native package (elma365#60), so it is never delivered.
  const edited = release.candidate?.provenance === 'supported-edit';
  const viaBridge = latest?.connection?.adapter === 'bridge';
  // MR-08: an observed read-back reconciles the outcome; retry and recovery depend only on it.
  const reconciliation = latest?.evidence?.reconciliation || null;
  const observed = enabled && current && latest?.state === 'verification-failed' && !!reconciliation && reconciliation.mode !== 'reconcile-only' && !latest.retriedBy;
  // A diverged (partial) install is recovered forward only when the adapter declared an idempotent re-import.
  const reimport = latest?.capabilities?.reimport === 'idempotent';
  // MR-08 promotion: the latest attempt, verified for the current candidate on a non-production Target,
  // goes to another usable Target on the same platform version. PROD is never a destination here:
  // the server needs an owner grant it never constructs and a typed PROD confirmation no route accepts.
  // An owner-designated DEV2 test install of a native candidate is never release evidence or a promotion source.
  const testInstall = latest?.composed?.deliveryBasis === 'designated-test-install';
  const promotable = enabled && current && !active && latest?.state === 'verified' && latest.verificationCurrent !== false && latest.connection?.environment !== 'prod' && !edited && !testInstall;
  const promotionTarget = connection => promotable && usable(connection) && connection.id !== latest.connection.id &&
    connection.probe.identity.host !== latest.targetIdentity?.host && !!connection.probe.identity.version && connection.probe.identity.version === latest.targetIdentity?.version;
  const targets = connections.filter(c => c.role === 'target');
  return { latest, current, synthetic, bridge, enabled, selectable, usable, bridges, connections: targets, testInstall,
    reconciliation, promotable, promotionTarget,
    promotionDestinations: promotable ? targets.filter(c => c.id !== latest.connection.id) : [],
    prodRefused: targets.some(c => c.environment === 'prod'),
    canPromote: promotable && targets.some(promotionTarget),
    canRetry: observed && reconciliation.outcome === 'not-applied',
    canRecover: observed && reconciliation.outcome === 'diverged' && reimport,
    recoveryRefused: observed && reconciliation.outcome === 'diverged' && !reimport,
    canPrepare: enabled && approved && !edited && !active,
    canConfirm: enabled && current && latest?.state === 'prepared' && usable(connections.find(c => c.id === latest.connection?.id)),
    canCancel: latest?.state === 'prepared',
    canVerify: enabled && current && ['deployed-unverified', 'unknown-outcome', 'partial-outcome', 'verification-failed', 'failed'].includes(latest?.state),
    canReconcile: enabled && !current && open(latest) && latest.state !== 'deploying',
    confirmation: latest ? `DEPLOY ${latest.solutionCode} ${latest.sha256.slice(0, 12)}` : '',
    next: edited && !latest ? 'Кандидат с правками только для рецензии: он не устанавливается до нативной сборки изменённого пакета (elma365#60).' :
      !enabled ? 'Доставка в ELMA пока недоступна. Используйте приватный пакет передачи.' :
      latest?.state === 'deploying' ? 'Операция выполняется. Обновите состояние; повторный запуск не нужен.' :
      latest && !current && open(latest) ? 'Кандидат изменился, но результат прежней операции на Target не сверен. Выполните сверку состояния Target: она не подтверждает прежний кандидат, а только освобождает Target, если ничего не применено.' :
      latest && !current ? 'Попытка относится к прежнему кандидату или условиям. Её результат не подтверждает текущий релиз.' :
      latest?.state === 'partial-outcome' ? 'Часть единиц установки не подтвердила применение. Прочитайте и проверьте состояние Target; повтор операции запрещён, нужен план восстановления.' :
      latest?.state === 'unknown-outcome' ? 'Результат неизвестен. Сначала прочитайте и проверьте состояние стенда; не повторяйте операцию.' :
      latest?.state === 'deployed-unverified' ? 'Прочитайте и сравните результат. Завершение операции ещё не означает совпадение.' :
      latest?.state === 'verified' && latest.verificationCurrent === false ? 'Прежняя проверка не подтверждает текущий кандидат. Сохраните историю и подготовьте новую проверяемую доставку.' :
      latest?.state === 'verified' && testInstall ? 'Тестовая установка на DEV2 совпала с кандидатом по read-back. Это не выпуск: нативные подтверждения установки ещё не приняты, кандидат не продвигается.' :
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
