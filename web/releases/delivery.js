import { deliveryStateLabels } from './model.js';
import { deliveryPanelView } from './delivery-model.js';

const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
let sequence = 0;
export function mountDelivery({ release, client, onAction, onRefresh } = {}) {
  const root = el('section', undefined, 'release-delivery'); root.setAttribute('aria-label', 'Доставка и проверка результата');
  let data = null, busy = false, selected = '', loadError = '';
  const execute = async input => {
    const status = root.querySelector('[role="status"]');
    status.textContent = input.action === 'confirm' ? 'Учебная операция выполняется. Дождитесь ответа; повторный запуск не нужен.' : input.action === 'verify' ? 'Читаем и сравниваем результат учебной операции…' : 'Обновляем подготовку учебной операции…';
    await onAction(input);
    if (root.isConnected) status.textContent = 'Действие не подтверждено. Проверьте сообщение об ошибке и обновите состояние перед продолжением.';
  };
  const button = (parent, label, action, unavailable = false) => {
    const node = el('button', label); node.type = 'button'; node.dataset.unavailable = String(unavailable); node.disabled = unavailable || busy;
    node.onclick = action; parent.append(node); return node;
  };
  const field = (parent, label, value = '', tag = 'input') => {
    const wrap = el('div'), caption = el('label', label), node = el(tag);
    node.id = 'delivery-field-' + ++sequence; caption.htmlFor = node.id; node.value = value;
    node.dataset.draftKey = label; node.dataset.savedValue = value; wrap.append(caption, node); parent.append(wrap); return node;
  };
  const refresh = async operation => {
    if (busy) return;
    busy = true; loadError = ''; root.querySelectorAll('button').forEach(b => b.disabled = true);
    try { if (operation) await operation(); data = await client.load(release.id); }
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
    const drafts = new Map([...root.querySelectorAll('[data-draft-key]')].map(node => [node.dataset.draftKey, node.value]));
    root.replaceChildren(el('h2', 'Доставка и проверка результата'));
    const alert = el('p', loadError); alert.setAttribute('role', 'alert'); root.append(alert);
    if (loadError) {
      root.append(el('p', 'Состояние доставки не получено. Действия заблокированы до успешного обновления.'));
      button(root, 'Повторить загрузку доставки', () => refresh()); return;
    }
    if (!data) {
      root.append(el('p', client ? 'Загружаем состояние доставки…' : 'Доставка в ELMA пока недоступна. Используйте приватный пакет передачи.'));
      return;
    }
    const view = deliveryPanelView(release, data);
    if (view.synthetic) root.append(el('p', 'Учебный режим: стенд синтетический, ELMA не подключена. Операции и успешная проверка относятся только к этому примеру.', 'note'));
    const status = el('p', view.next); status.setAttribute('role', 'status'); root.append(status);
    button(root, 'Обновить состояние доставки', onRefresh);
    if (view.synthetic) {
      const create = el('form'), name = field(create, 'Название учебного стенда'); name.maxLength = 120; name.required = true;
      const scenario = field(create, 'Учебный сценарий', '', 'select');
      for (const [value, label] of Object.entries({ apply: 'Импорт применяется', unapplied: 'Успешный ответ без изменений', fail: 'Ошибка импорта', timeout: 'Нет ответа', drift: 'Состояние меняется после подготовки' })) {
        const option = el('option', label); option.value = value; scenario.append(option);
      }
      button(create, 'Добавить учебный стенд', () => { if (create.reportValidity()) refresh(() => client.createConnection({ name: name.value.trim(), role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { scenario: scenario.value } })); });
      create.onsubmit = event => event.preventDefault(); root.append(create);
      for (const connection of view.connections) {
        const card = el('article', undefined, 'card');
        card.append(el('h3', connection.name), el('p', `${connection.environment.toUpperCase()} · ${connection.adapter} · ${connection.probe?.identity?.host || 'Личность не проверена'}`));
        if (connection.probe?.protectedHost) card.append(el('p', 'Фактический узел входит в защищённый список: доставка будет отклонена независимо от названия.', 'release-error'));
        button(card, 'Проверить подключение — ' + connection.name, () => refresh(() => client.probeConnection(connection.id)));
        if (client?.removeConnection) button(card, 'Удалить подключение — ' + connection.name, () => refresh(() => client.removeConnection(connection.id)));
        root.append(card);
      }
      const picker = field(root, 'Учебный стенд для доставки', '', 'select');
      const empty = el('option', 'Выберите учебный стенд'); empty.value = ''; picker.append(empty);
      for (const connection of view.connections) {
        const option = el('option', `${connection.name}${connection.environment === 'prod' ? ' — PROD недоступен' : ''}`); option.value = connection.id;
        option.disabled = connection.environment === 'prod' || connection.adapter !== 'synthetic' || connection.probe?.protectedHost === true;
        picker.append(option);
      }
      picker.value = selected; picker.onchange = () => { selected = picker.value; draw(); };
      const connection = view.connections.find(c => c.id === selected);
      if (connection) {
        const identity = connection.probe?.identity;
        root.append(el('p', identity ? `Проверенный учебный стенд: ${identity.host} · версия ${identity.version || 'не определена'} · ${connection.probe.ok ? 'доступен' : 'недоступен'}` : 'Стенд ещё не проверен. Его имя не подтверждает личность.'));
        button(root, 'Проверить учебный стенд', () => refresh(() => client.probeConnection(connection.id)));
      }
      button(root, 'Подготовить учебную доставку', () => execute({ action: 'prepare', revision: release.revision, connectionId: selected }), !view.canPrepare || !connection || connection.environment === 'prod' || connection.adapter !== 'synthetic' || connection.probe?.protectedHost === true);
    }
    const latest = view.latest;
    if (latest) {
      const attempt = el('section', undefined, 'card'); attempt.setAttribute('aria-label', 'Последняя попытка доставки');
      attempt.append(el('h3', `Последняя попытка: ${deliveryStateLabels[latest.state] || latest.state}`), el('p', `${latest.connection.adapter === 'synthetic' ? 'Учебный стенд (не ELMA)' : 'Target'}: ${latest.connection.name} · ${latest.targetIdentity.host} · версия ${latest.targetIdentity.version || 'не определена'}`), el('p', `Решение ${latest.solutionCode} · ревизия ${latest.releaseRevision}`), el('p', `Кандидат SHA-256: ${latest.sha256}`, 'release-hash'));
      if (!view.current) attempt.append(el('p', 'Устаревшая попытка: текущий кандидат или условия релиза изменились.', 'note'));
      if (view.canConfirm) {
        const form = el('form'); form.append(el('p', `Для отдельного подтверждения введите: ${view.confirmation}`, 'release-hash'));
        const confirmation = field(form, 'Подтверждение учебной операции'); confirmation.dataset.draftKey += ' ' + latest.id; confirmation.maxLength = 200; confirmation.autocomplete = 'off'; confirmation.required = true;
        const confirm = button(form, 'Подтвердить учебную операцию', () => {
          if (confirmation.value === view.confirmation) execute({ action: 'confirm', attemptId: latest.id, confirmation: confirmation.value, idempotencyKey: 'release-ui-' + latest.id });
        }, true);
        confirmation.oninput = () => { const disabled = confirmation.value !== view.confirmation; confirm.disabled = disabled; confirm.dataset.unavailable = String(disabled); };
        form.onsubmit = event => event.preventDefault(); attempt.append(form);
      }
      if (view.canCancel) button(attempt, 'Отменить подготовку', () => execute({ action: 'cancel', attemptId: latest.id }));
      if (view.canVerify) button(attempt, 'Прочитать и проверить результат', () => execute({ action: 'verify', attemptId: latest.id }));
      const comparison = latest.evidence.comparison;
      if (comparison) {
        attempt.append(el('p', `Сравнено файлов: ${comparison.compared}. Не сравнивались служебные файлы: ${comparison.volatile.length}.`));
        if (comparison.missing.length) attempt.append(el('p', 'Отсутствуют: ' + comparison.missing.join(', '), 'release-hash'));
        if (comparison.different.length) attempt.append(el('p', 'Отличаются: ' + comparison.different.join(', '), 'release-hash'));
      }
      if (latest.evidence.operation) attempt.append(el('p', latest.evidence.operation.nativeResult || latest.evidence.operation.error || 'Операция завершилась; требуется проверка результата'));
      if (latest.evidence.rollbackReference) attempt.append(el('p', 'Зафиксировано состояние до операции. Восстановление документов или процессов этим не гарантируется.'));
      root.append(attempt);
    }
    if (data.attempts.length) {
      const history = el('details'); history.append(el('summary', 'История доставок'));
      for (const attempt of data.attempts) {
        history.append(el('h3', `${attempt.connection.name} · ревизия ${attempt.releaseRevision} · ${deliveryStateLabels[attempt.state] || attempt.state}`));
        for (const event of attempt.history) history.append(el('p', `${event.at} · ${deliveryStateLabels[event.state] || event.state} · ${event.note || ''}`));
      }
      root.append(history);
    }
    for (const node of root.querySelectorAll('[data-draft-key]')) if (drafts.has(node.dataset.draftKey)) { node.value = drafts.get(node.dataset.draftKey); node.oninput?.(); }
  };
  draw(); if (client) refresh(); return root;
}
