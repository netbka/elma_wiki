import { deliveryStateLabels } from './model.js';
import { deliveryPanelView } from './delivery-model.js';

const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
let sequence = 0;
// A bridge token is shown exactly once, in the render right after it was issued; the server keeps only its hash.
const freshTokens = new Map();
export function mountDelivery({ release, client, onAction, onRefresh, onState, isBlocked = () => false, initialDrafts = new Map() } = {}) {
  const root = el('section', undefined, 'release-delivery'); root.setAttribute('aria-label', 'Доставка и проверка результата');
  let data = null, busy = false, selected = '', destination = '', loadError = '';
  root.getDrafts = () => new Map([...initialDrafts, ...[...root.querySelectorAll('[data-draft-key]')].map(node => [node.dataset.draftKey, node.value])]);
  const execute = async input => {
    if (busy || isBlocked()) return;
    busy = true;
    freshTokens.clear();
    const status = root.querySelector('[role="status"]');
    status.textContent = input.action === 'confirm' ? 'Операция выполняется. Дождитесь ответа; повторный запуск не нужен.' : input.action === 'verify' ? 'Читаем и сравниваем результат операции…' : input.action === 'promote' ? 'Заново читаем Target назначения и готовим продвижение…' : input.action === 'retry' ? 'Заново читаем Target и готовим повтор после сверки…' : 'Обновляем подготовку доставки…';
    try { await onAction(input); }
    finally {
      busy = false;
      if (root.isConnected) status.textContent = 'Действие не подтверждено. Проверьте сообщение об ошибке и обновите состояние перед продолжением.';
    }
  };
  const button = (parent, label, action, unavailable = false) => {
    const node = el('button', label, 'secondary'); node.type = 'button'; node.dataset.unavailable = String(unavailable); node.disabled = unavailable || busy || isBlocked();
    node.onclick = action; parent.append(node); return node;
  };
  const field = (parent, label, value = '', tag = 'input') => {
    const wrap = el('div'), caption = el('label', label), node = el(tag);
    node.id = 'delivery-field-' + ++sequence; caption.htmlFor = node.id; node.value = value;
    node.dataset.draftKey = label; node.dataset.savedValue = value; wrap.append(caption, node); parent.append(wrap); return node;
  };
  // MR-08 promotion of the verified candidate to another non-production Target. PROD is listed only as refused.
  const promotion = (view, latest) => {
    const block = el('section', undefined, 'card'); block.setAttribute('aria-label', 'Продвижение проверенного кандидата');
    block.append(el('h3', 'Продвижение проверенного кандидата'));
    if (view.promotable) {
      block.append(el('p', 'Тот же кандидат можно отправить на другой Target с той же версией платформы. Сервис заново читает Target назначения: если его состояние отличается от состояния, на котором кандидат проверен (drift), продвижение блокируется до создания попытки. Запуск требует отдельного подтверждения и read-back.', 'note'));
      const picker = field(block, 'Target назначения для продвижения', '', 'select'); delete picker.dataset.draftKey;
      const empty = el('option', 'Выберите Target назначения'); empty.value = ''; picker.append(empty);
      for (const connection of view.promotionDestinations) {
        const option = el('option', `${connection.name}${connection.environment === 'prod' ? ' — PROD: продвижение запрещено' : !view.usable(connection) ? ' — требуется проверка доступности' : !view.promotionTarget(connection) ? ' — тот же узел или другая версия платформы' : ''}`);
        option.value = connection.id; option.disabled = !view.promotionTarget(connection); picker.append(option);
      }
      if (!view.promotionDestinations.some(c => c.id === destination && view.promotionTarget(c))) destination = '';
      picker.value = destination; picker.onchange = () => { destination = picker.value; draw(); };
      const chosen = view.promotionDestinations.find(c => c.id === destination);
      if (!view.canPromote) block.append(el('p', 'Нет другого проверенного Target с той же версией платформы. Добавьте и проверьте подключение назначения.', 'note'));
      // Only a destination the model accepts reaches the coordinator; PROD never does.
      const promote = button(block, 'Подготовить продвижение на Target назначения', () => {
        if (chosen && view.promotionTarget(chosen)) execute({ action: 'promote', attemptId: latest.id, connectionId: chosen.id, revision: release.revision, idempotencyKey: `release-ui-promote-${latest.id}-${chosen.id}-${data.attempts.length}` });
      }, !chosen || !view.promotionTarget(chosen));
      if (!promote.disabled) promote.classList.remove('secondary');
    }
    if (view.prodRefused) block.append(el('p', 'PROD: продвижение из интерфейса невозможно. Для него нужно отдельное разрешение владельца, которое сервис не выдаёт; агенты PROD не изменяют.', 'release-error'));
    return block;
  };
  const refresh = async operation => {
    if (busy || isBlocked()) return;
    busy = true; loadError = ''; if (operation) freshTokens.clear(); root.querySelectorAll('button').forEach(b => b.disabled = true);
    try { if (operation) await operation(); data = await client.load(release.id); onState?.(data); }
    catch (error) { loadError = error.message; }
    finally { busy = false; draw(); }
  };
  const draw = () => {
    if (root.contains(document.activeElement)) {
      const focusKey = document.activeElement.dataset.draftKey;
      queueMicrotask(() => {
        if (!root.isConnected) return;
        const target = [...root.querySelectorAll('[data-draft-key]')].find(node => focusKey && node.dataset.draftKey === focusKey) || root.querySelector('h2');
        target.tabIndex = target.tagName === 'H2' ? -1 : 0; target.focus({ preventScroll: true });
      });
    }
    const drafts = root.getDrafts();
    // Retain panel drafts even when a failed load replaces the fields with retry.
    initialDrafts = new Map(drafts);
    root.replaceChildren(el('h2', 'Доставка и проверка результата'));
    const alert = el('p', loadError); alert.setAttribute('role', 'alert'); root.append(alert);
    if (loadError) {
      root.append(el('p', 'Состояние доставки не получено. Действия заблокированы до успешного обновления.'));
      const retry = button(root, 'Повторить загрузку доставки', onRefresh || (() => refresh())); retry.dataset.recovery = 'true'; retry.disabled = false; return;
    }
    if (!data) {
      root.append(el('p', client ? 'Загружаем состояние доставки…' : release?.candidate?.provenance === 'supported-edit' ? 'Кандидат с правками только для рецензии: он не устанавливается до нативной сборки изменённого пакета (elma365#60).' : 'Доставка в ELMA пока недоступна. Используйте приватный пакет передачи.'));
      return;
    }
    const view = deliveryPanelView(release, data);
    if (view.synthetic) root.append(el('p', 'Учебный режим: стенд синтетический, ELMA не подключена. Операции и успешная проверка относятся только к этому примеру.', 'note'));
    const status = el('p', view.next); status.setAttribute('role', 'status'); root.append(status);
    const reload = button(root, 'Обновить состояние доставки', onRefresh); reload.dataset.recovery = 'true'; reload.disabled = busy;
    if (view.enabled) {
      if (view.synthetic) {
        const create = el('form'), name = field(create, 'Название учебного стенда'); name.maxLength = 120; name.required = true;
        const scenario = field(create, 'Учебный сценарий', '', 'select');
        for (const [value, label] of Object.entries({ apply: 'Импорт применяется', unapplied: 'Успешный ответ без изменений', fail: 'Ошибка импорта', timeout: 'Нет ответа', drift: 'Состояние меняется после подготовки' })) {
          const option = el('option', label); option.value = value; scenario.append(option);
        }
        button(create, 'Добавить учебный стенд', () => { if (create.reportValidity()) refresh(() => client.createConnection({ name: name.value.trim(), role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { scenario: scenario.value } })); });
        create.onsubmit = event => event.preventDefault(); root.append(create);
      }
      if (view.bridge) {
        // Operator bridges: the service never connects to ELMA; the worker next to elma365pm polls for jobs.
        const block = el('section'); block.setAttribute('aria-label', 'Мосты оператора');
        block.append(el('h3', `Мосты оператора: ${view.bridges.length}`), el('p', 'Мост — процесс на машине оператора рядом с elma365pm и токенами ELMA. Он сам опрашивает сервис и выполняет экспорт/импорт; сервис хранит только хеш токена моста и не делает исходящих подключений.', 'note'));
        for (const bridge of view.bridges) {
          const card = el('article', undefined, 'card');
          card.append(el('h3', bridge.name), el('p', `${bridge.online ? 'На связи' : 'Не на связи'} · ${bridge.lastSeen ? `последний опрос ${bridge.lastSeen} · ${bridge.identity?.host ? `узел ${bridge.identity.host} · версия ${bridge.identity.version || 'не сообщена'}` : 'узел не сообщён'}${bridge.worker ? ` · ${bridge.worker}` : ''}` : 'мост ещё не выходил на связь: запустите рабочий процесс с выданным токеном'}`));
          if (freshTokens.has(bridge.id)) { const token = el('p', undefined, 'release-token'); token.append(el('strong', 'Токен моста (показывается один раз, сохраните его в .env оператора): '), el('code', freshTokens.get(bridge.id))); card.append(token); }
          if (client?.removeBridge) button(card, 'Удалить мост — ' + bridge.name, () => refresh(() => { freshTokens.clear(); return client.removeBridge(bridge.id); }));
          block.append(card);
        }
        const issue = el('form'), bridgeName = field(issue, 'Название моста'); bridgeName.maxLength = 120; bridgeName.required = true;
        button(issue, 'Выдать токен моста', () => { if (issue.reportValidity()) refresh(async () => { const issued = await client.createBridge({ name: bridgeName.value.trim() }); freshTokens.clear(); freshTokens.set(issued.bridge.id, issued.token); }); });
        issue.onsubmit = event => event.preventDefault(); block.append(issue);
        const create = el('form'), name = field(create, 'Название подключения Target'); name.maxLength = 120; name.required = true;
        const environment = field(create, 'Среда Target', '', 'select');
        for (const [value, label] of Object.entries({ test: 'TEST', dev: 'DEV' })) { const option = el('option', label); option.value = value; environment.append(option); }
        const bridgePick = field(create, 'Мост оператора для подключения', '', 'select'); delete bridgePick.dataset.draftKey; // never restore a stale empty draft over the first real bridge
        for (const bridge of view.bridges) { const option = el('option', `${bridge.name}${bridge.identity?.host ? ' · ' + bridge.identity.host : ''}`); option.value = bridge.id; bridgePick.append(option); }
        if (!view.bridges.length) { const option = el('option', 'сначала выдайте токен моста'); option.value = ''; bridgePick.append(option); }
        button(create, 'Добавить подключение Target', () => { if (create.reportValidity() && bridgePick.value) refresh(() => client.createConnection({ name: name.value.trim(), role: 'target', environment: environment.value, adapter: 'bridge', adapterOptions: { bridgeId: bridgePick.value } })); }, !view.bridges.length);
        create.onsubmit = event => event.preventDefault(); block.append(el('p', 'Подключение — ссылка без учётных данных. Токены и пароли сюда вводить нельзя; они остаются у оператора.', 'note'), create);
        root.append(block);
      }
      for (const connection of view.connections) {
        const card = el('article', undefined, 'card');
        const preset = connection.preset;
        card.append(el('h3', connection.name), el('p', preset
          ? `Предопределённый Target · ${preset.environmentRole === 'shared-business' ? 'общая бизнес-среда, только чтение' : 'техническая среда'} · мост --target=${preset.bridgeTarget} · ${preset.host || 'узел не задан'} · ${connection.probe?.identity?.host ? 'проверен: ' + connection.probe.identity.host : 'Личность не проверена'}`
          : `${connection.environment.toUpperCase()} · ${connection.adapter}${connection.adapter === 'bridge' ? ` (${view.bridges.find(b => b.id === connection.adapterOptions?.bridgeId)?.name || 'мост удалён'})` : ''} · ${connection.probe?.identity?.host || 'Личность не проверена'}`));
        if (preset) card.append(el('p', !preset.available ? `Недоступен: ${preset.reason}` : `Разрешено: ${preset.allowedOperations.join(', ')}${preset.allowedOperations.includes('deploy') ? ` · доставка только кандидата, назначенного владельцем (${preset.designatedCandidates.length ? preset.designatedCandidates.map(sha => sha.slice(0, 12)).join(', ') : 'не назначен'})` : ' · доставка запрещена'}`, preset.available ? 'note' : 'release-error'));
        if (preset && connection.probe?.identity?.host && connection.probe.hostMatches === false) card.append(el('p', 'Мост сообщает другой узел, чем настроен: операции отклоняются.', 'release-error'));
        if (connection.probe?.protectedHost) card.append(el('p', 'Фактический узел входит в защищённый список: доставка будет отклонена независимо от названия.', 'release-error'));
        if (!preset || preset.available) button(card, 'Проверить подключение — ' + connection.name, () => refresh(() => client.probeConnection(connection.id)));
        if (client?.removeConnection && !preset) button(card, 'Удалить подключение — ' + connection.name, () => refresh(() => client.removeConnection(connection.id)));
        root.append(card);
      }
      const picker = field(root, view.synthetic ? 'Учебный стенд для доставки' : 'Подключение Target для доставки', '', 'select');
      const empty = el('option', view.synthetic ? 'Выберите учебный стенд' : 'Выберите подключение Target'); empty.value = ''; picker.append(empty);
      for (const connection of view.connections) {
        const option = el('option', `${connection.name}${connection.environment === 'prod' ? ' — PROD недоступен' : connection.preset && !connection.preset.available ? ' — не настроен' : connection.preset && !connection.preset.allowedOperations.includes('deploy') ? ' — только чтение' : !view.usable(connection) ? ' — требуется проверка доступности' : ''}`); option.value = connection.id;
        option.disabled = !view.selectable(connection);
        picker.append(option);
      }
      if (!selected) selected = drafts.get(picker.dataset.draftKey) || '';
      if (!view.connections.some(c => c.id === selected)) selected = '';
      picker.value = selected; picker.onchange = () => { selected = picker.value; initialDrafts.delete(picker.dataset.draftKey); draw(); };
      const connection = view.connections.find(c => c.id === selected);
      if (connection) {
        const identity = connection.probe?.identity, stand = connection.adapter === 'bridge' ? 'Target' : 'учебный стенд';
        root.append(el('p', identity ? `Проверенный ${stand}: ${identity.host} · версия ${identity.version || 'не определена'} · ${connection.probe.ok ? 'доступен' : 'недоступен'}` : `${connection.adapter === 'bridge' ? 'Target' : 'Стенд'} ещё не проверен. Его имя не подтверждает личность.`));
        button(root, connection.adapter === 'bridge' ? 'Проверить Target' : 'Проверить учебный стенд', () => refresh(() => client.probeConnection(connection.id)));
      }
      const prepare = button(root, view.synthetic && connection?.adapter !== 'bridge' ? 'Подготовить учебную доставку' : 'Подготовить доставку на Target', () => execute({ action: 'prepare', revision: release.revision, connectionId: selected }), !view.canPrepare || !view.usable(connection));
      if (!prepare.disabled) prepare.classList.remove('secondary');
    }
    const latest = view.latest;
    if (latest) {
      const attempt = el('section', undefined, 'card'); attempt.setAttribute('aria-label', 'Последняя попытка доставки');
      attempt.append(el('h3', `Последняя попытка: ${deliveryStateLabels[latest.state] || latest.state}`), el('p', `${latest.connection.adapter === 'synthetic' ? 'Учебный стенд (не ELMA)' : 'Target'}: ${latest.connection.name} · ${latest.targetIdentity.host} · версия ${latest.targetIdentity.version || 'не определена'}`), el('p', `Решение ${latest.solutionCode} · ревизия ${latest.releaseRevision}`), el('p', `Кандидат SHA-256: ${latest.sha256}`, 'release-hash'));
      if (!view.current) attempt.append(el('p', 'Устаревшая попытка: текущий кандидат или условия релиза изменились.', 'note'));
      if (view.testInstall) attempt.append(el('p', 'Тестовая установка на назначенный владельцем DEV2: кандидат ждёт нативных подтверждений установки. Эта попытка не является доказательством выпуска и не продвигается на другой Target.', 'note'));
      if (latest.state === 'prepared' && view.current && !view.canConfirm) attempt.append(el('p', 'Подключение Target недоступно или не проверено. Проверьте подключение и обновите состояние перед подтверждением.', 'note'));
      if (view.canConfirm) {
        const form = el('form'); form.append(el('p', `Для отдельного подтверждения введите: ${view.confirmation}`, 'release-hash'));
        const viaBridge = latest.connection.adapter === 'bridge';
        const confirmation = field(form, viaBridge ? 'Подтверждение доставки на Target' : 'Подтверждение учебной операции'); confirmation.dataset.draftKey += ' ' + latest.id; confirmation.maxLength = 200; confirmation.autocomplete = 'off'; confirmation.required = true;
        const confirm = button(form, viaBridge ? 'Подтвердить доставку на Target' : 'Подтвердить учебную операцию', () => {
          if (confirmation.value === view.confirmation) execute({ action: 'confirm', attemptId: latest.id, confirmation: confirmation.value, idempotencyKey: 'release-ui-' + latest.id });
        }, true);
        confirmation.oninput = () => { const disabled = confirmation.value !== view.confirmation; confirm.disabled = disabled || busy || isBlocked(); confirm.dataset.unavailable = String(disabled); };
        confirm.classList.remove('secondary');
        form.onsubmit = event => event.preventDefault(); attempt.append(form);
      }
      if (view.canCancel) button(attempt, 'Отменить подготовку', () => execute({ action: 'cancel', attemptId: latest.id }));
      if (view.canVerify) button(attempt, 'Прочитать и проверить результат', () => execute({ action: 'verify', attemptId: latest.id })).classList.remove('secondary');
      if (view.canReconcile) button(attempt, 'Сверить состояние Target без подтверждения', () => execute({ action: 'reconcile', attemptId: latest.id })).classList.remove('secondary');
      // MR-08 lineage: a promotion or a retry is a new attempt with its own typed confirmation.
      if (latest.promotion) attempt.append(el('p', `Продвижение кандидата, проверенного на Target «${latest.promotion.fromConnection?.name || 'исходный'}» (${latest.promotion.fromTargetIdentity?.host || 'узел не сообщён'}). При подготовке состояние назначения совпадало с состоянием, на котором кандидат проверен.`, 'note'));
      if (latest.retryOf) attempt.append(el('p', latest.retryOf.mode === 'forward-recovery' ? 'Восстановление частичной установки повторным идемпотентным импортом после сверки read-back.' : 'Повтор после сверки read-back: прежняя попытка ничего не применила.', 'note'));
      if (latest.retriedBy) attempt.append(el('p', 'Для этой попытки уже создан повтор; следующий шаг — в новой попытке.', 'note'));
      const reconciliation = latest.evidence.reconciliation;
      if (reconciliation && reconciliation.mode !== 'reconcile-only') attempt.append(el('p', reconciliation.outcome === 'applied' ? 'Сверка read-back: изменения применены, Target совпал с кандидатом.'
        : reconciliation.outcome === 'not-applied' ? 'Сверка read-back: изменения не применены, Target в прежнем состоянии.'
        : 'Сверка read-back: частичная установка — Target не совпадает ни с прежним состоянием, ни с кандидатом.', reconciliation.outcome === 'diverged' ? 'release-error' : 'note'));
      if (view.canRetry) button(attempt, 'Подготовить повтор после сверки', () => execute({ action: 'retry', attemptId: latest.id, idempotencyKey: 'release-ui-retry-' + latest.id })).classList.remove('secondary');
      if (view.canRecover) button(attempt, 'Подготовить восстановление повторным импортом', () => execute({ action: 'retry', attemptId: latest.id, idempotencyKey: 'release-ui-retry-' + latest.id })).classList.remove('secondary');
      if (view.recoveryRefused) attempt.append(el('p', 'Адаптер не подтверждает идемпотентный повторный импорт: восстановление из интерфейса недоступно, нужен утверждённый план восстановления.', 'note'));
      if (view.canRetry || view.canRecover) attempt.append(el('p', 'Повтор создаёт новую подготовленную попытку на том же Target. Перед ней Target читается заново: если он изменился после сверки (drift), повтор блокируется. Запуск требует отдельного подтверждения.', 'note'));
      if (reconciliation?.mode === 'reconcile-only') attempt.append(el('p', reconciliation.outcome === 'not-applied' ? 'Сверка без подтверждения: изменения не применены, Target освобождён. Прежний кандидат не подтверждён.'
        : reconciliation.outcome === 'stale-applied' ? 'Сверка без подтверждения: на Target применён устаревший кандидат. Target остаётся зарезервированным до решения владельца.'
        : 'Сверка без подтверждения: частичная установка. Target остаётся зарезервированным; нужен план восстановления.', 'note'));
      const comparison = latest.evidence.comparison;
      if (comparison) {
        attempt.append(el('p', `Сравнено файлов: ${comparison.compared}. Политика проверки: ${comparison.policy || 'прежняя, требуется повторная проверка'}.`));
        if (comparison.volatile?.length) attempt.append(el('p', 'Прежняя проверка исключала файлы: ' + comparison.volatile.join(', ') + '. Это не полная проверка пакета.', 'note'));
        if (comparison.missing.length) attempt.append(el('p', 'Отсутствуют: ' + comparison.missing.join(', '), 'release-hash'));
        if (comparison.different.length) attempt.append(el('p', 'Отличаются: ' + comparison.different.join(', '), 'release-hash'));
        if (comparison.unexpected?.length) attempt.append(el('p', 'Лишние файлы: ' + comparison.unexpected.join(', '), 'release-hash'));
      }
      if (latest.evidence.verificationError) attempt.append(el('p', 'Проверка результата не подтверждена. Проверьте личность стенда, ответ и актуальность кандидата; успешное сообщение операции не является доказательством.', 'note'));
      const unitLabels = { pending: 'не запущена', dispatched: 'передана адаптеру, ответа ещё нет', applied: 'адаптер сообщил о применении', failed: 'ошибка', skipped: 'пропущена', unreported: 'результат не сообщён' };
      if (latest.evidence.units?.length) {
        const units = el('ol'); units.setAttribute('aria-label', 'Единицы установки');
        for (const unit of latest.evidence.units) units.append(el('li', `${unit.unitId}: ${unitLabels[unit.status] || unit.status}`));
        attempt.append(el('p', 'Ответы по единицам установки в порядке импорта. Это сообщения адаптера, не проверка результата.'), units);
      }
      if (latest.evidence.operation) attempt.append(el('p', latest.evidence.operation.nativeResult || latest.evidence.operation.error || 'Операция завершилась; требуется проверка результата'));
      if (latest.evidence.rollbackReference) attempt.append(el('p', 'Зафиксировано состояние до операции. Восстановление документов или процессов этим не гарантируется.'));
      root.append(attempt);
      if (view.promotable || view.prodRefused) root.append(promotion(view, latest));
    }
    if (data.attempts.length) {
      const history = el('details'); history.append(el('summary', 'История доставок'));
      for (const attempt of data.attempts) {
        history.append(el('h3', `${attempt.connection.name} · ревизия ${attempt.releaseRevision} · ${deliveryStateLabels[attempt.state] || attempt.state}`));
        if (attempt.candidateStatus === 'stale' || attempt.state === 'verified' && attempt.verificationCurrent === false) history.append(el('p', 'Историческое доказательство не подтверждает текущую передачу.', 'note'));
        for (const event of attempt.history) history.append(el('p', `${event.at} · ${deliveryStateLabels[event.state] || event.state} · ${event.note || ''}`));
      }
      root.append(history);
    }
    for (const node of root.querySelectorAll('[data-draft-key]')) if (drafts.has(node.dataset.draftKey)) { node.value = drafts.get(node.dataset.draftKey); node.oninput?.(); }
    initialDrafts.clear();
  };
  draw(); if (client) refresh(); return root;
}
