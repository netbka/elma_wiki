import { deliveryStateLabels } from './model.js';
const el = (tag, content, className) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node; };
export const environmentLabels = { dev: 'DEV', test: 'TEST', prod: 'PROD (доставка запрещена)' };
export const scenarioLabels = { apply: 'учебный: импорт применяется', unapplied: 'учебный: импорт «успешен», но не применён', fail: 'учебный: ошибка импорта', timeout: 'учебный: нет ответа', drift: 'учебный: Target меняется после подготовки' };
const operationLabels = { returned: 'операция вернула успех (ещё не проверено)', error: 'ошибка операции', timeout: 'нет ответа в отведённое время' };
const actionable = state => ['deployed-unverified', 'unknown-outcome', 'verification-failed'].includes(state);
const active = state => ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome'].includes(state);
let fieldId = 0;
// Delivery section of the release page. `run` comes from the release shell so busy/stale handling stays shared;
// every action reloads the whole release afterwards because attempts change the release's target check.
// A bridge token is shown exactly once, in the render right after it was issued; the server keeps only its hash.
const freshTokens = new Map();
export function mountDelivery({ release, connections = [], attempts = [], adapters = [], bridges = [], api, run, reload }) {
  const section = el('section', undefined, 'release-delivery');
  section.append(el('h2', 'Доставка на Target'), el('p', 'Доставка идёт только через явно выбранное подключение Target после принятия кандидата. Успешный ответ инструмента не означает Verified: состояние Target читается заново и сравнивается с кандидатом. PROD отклоняется на сервере.'));
  const field = (form, label, value = '', kind = 'input') => { const wrapper = el('div'), caption = el('label', label), node = el(kind); node.id = `delivery-field-${++fieldId}`; caption.htmlFor = node.id; if (kind !== 'select') node.value = value; node.maxLength = 200; wrapper.append(caption, node); form.append(wrapper); return node; };
  const option = (select, value, label) => { const item = el('option', label); item.value = value; select.append(item); return item; };
  const button = (label, action, parent) => { const node = el('button', label); node.type = 'button'; node.onclick = action; parent.append(node); return node; };
  const act = operation => run(async () => { freshTokens.clear(); await operation(); return reload(); });
  const targets = connections.filter(c => c.role === 'target' && c.environment !== 'prod');
  const current = attempts.find(a => active(a.state)) || null;
  const bridgeName = id => bridges.find(b => b.id === id)?.name || 'мост удалён';
  // Operator bridges: the service never connects to ELMA; an operator runs a worker next to elma365pm.
  if (adapters.includes('bridge')) {
    const block = el('section'); block.append(el('h3', `Мосты оператора: ${bridges.length}`), el('p', 'Мост — процесс на машине оператора рядом с elma365pm и токенами ELMA. Он сам опрашивает сервис и выполняет экспорт/импорт; сервис хранит только хеш токена моста и не делает исходящих подключений.', 'release-label'));
    for (const bridge of bridges) {
      const card = el('article', undefined, 'card');
      card.append(el('h4', `${bridge.name} · ${bridge.online ? 'на связи' : 'не на связи'}`), el('p', bridge.lastSeen ? `Последний опрос ${bridge.lastSeen} · ${bridge.identity?.host ? `узел ${bridge.identity.host} · версия ${bridge.identity.version || 'не сообщена'}` : 'узел не сообщён'}${bridge.worker ? ` · ${bridge.worker}` : ''}` : 'Мост ещё не выходил на связь: запустите рабочий процесс с выданным токеном.'));
      if (freshTokens.has(bridge.id)) { const token = el('p', undefined, 'release-token'); token.append(el('strong', 'Токен моста (показывается один раз, сохраните его в .env оператора): '), el('code', freshTokens.get(bridge.id))); card.append(token); }
      const actions = el('div', undefined, 'actions');
      button(`Удалить мост — ${bridge.name}`, () => act(() => api.removeBridge(bridge.id)), actions);
      card.append(actions); block.append(card);
    }
    const form = el('form'), name = field(form, 'Название моста'); name.required = true; name.maxLength = 120;
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) run(async () => { const issued = await api.createBridge({ name: name.value }); freshTokens.clear(); freshTokens.set(issued.bridge.id, issued.token); return reload(); }); };
    const submit = el('button', 'Выдать токен моста'); submit.type = 'submit'; form.append(submit); block.append(form);
    section.append(block);
  }
  const list = el('section'); list.append(el('h3', `Подключения: ${connections.length}`));
  if (!adapters.length) list.append(el('p', 'На этом сервисе не настроен адаптер к ELMA. Подключения и доставка недоступны: передайте пакет оператору через приватный пакет передачи. Это ограничение сервиса, а не результат проверки.', 'note'));
  for (const connection of connections) {
    const card = el('article', undefined, 'card');
    card.append(el('h4', `${connection.name} · ${environmentLabels[connection.environment] || connection.environment} · ${connection.role === 'target' ? 'Target' : 'Source'} · адаптер ${connection.adapter}`));
    if (connection.adapterOptions?.scenario) card.append(el('p', `Сценарий: ${scenarioLabels[connection.adapterOptions.scenario] || connection.adapterOptions.scenario}`, 'release-label'));
    if (connection.adapter === 'bridge') card.append(el('p', `Мост: ${bridgeName(connection.adapterOptions?.bridgeId)}`, 'release-label'));
    card.append(el('p', connection.probe ? `Проверено ${connection.probe.at}: ${connection.probe.ok ? 'доступно' : 'недоступно'} · ${connection.probe.identity ? `${connection.probe.identity.host} · версия ${connection.probe.identity.version || 'не сообщена'}` : 'личность не сообщена'}` : 'Личность не проверена: выполните проверку подключения перед доставкой.'));
    if (connection.probe?.protectedHost) card.append(el('p', 'Фактический узел входит в защищённый список: доставка на это подключение будет отклонена независимо от названия.', 'release-error'));
    if (connection.environment === 'prod') card.append(el('p', 'PROD: доставка отключена до отдельного разрешения и проверок AR-06.', 'release-error'));
    const actions = el('div', undefined, 'actions');
    button(`Проверить подключение — ${connection.name}`, () => act(() => api.probe(connection.id)), actions);
    button(`Удалить подключение — ${connection.name}`, () => act(() => api.removeConnection(connection.id)), actions);
    card.append(actions); list.append(card);
  }
  if (adapters.length) {
    const form = el('form'), name = field(form, 'Название подключения'), environment = field(form, 'Среда', '', 'select'), adapter = field(form, 'Адаптер', '', 'select');
    name.required = true; name.maxLength = 120;
    for (const [value, label] of Object.entries(environmentLabels)) option(environment, value, label);
    environment.value = 'test';
    for (const value of adapters) option(adapter, value, value);
    const scenario = field(form, 'Учебный сценарий синтетического адаптера', '', 'select');
    for (const [value, label] of Object.entries(scenarioLabels)) option(scenario, value, label);
    const bridge = field(form, 'Мост оператора для этого подключения', '', 'select');
    for (const item of bridges) option(bridge, item.id, `${item.name}${item.identity?.host ? ' · ' + item.identity.host : ''}`);
    if (!bridges.length) option(bridge, '', 'сначала выдайте токен моста');
    const toggle = () => { scenario.parentElement.hidden = adapter.value !== 'synthetic'; bridge.parentElement.hidden = adapter.value !== 'bridge'; bridge.required = adapter.value === 'bridge'; }; adapter.onchange = toggle; toggle();
    const options = () => adapter.value === 'synthetic' ? { scenario: scenario.value } : adapter.value === 'bridge' ? { bridgeId: bridge.value } : {};
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) act(() => api.createConnection({ name: name.value, role: 'target', environment: environment.value, adapter: adapter.value, adapterOptions: options() })); };
    const submit = el('button', 'Добавить подключение Target'); submit.type = 'submit'; form.append(el('p', 'Подключение — ссылка без учётных данных. Токены и пароли сюда вводить нельзя; они остаются у оператора/моста.', 'release-label'), submit); list.append(form);
  }
  section.append(list);
  const history = el('section'); history.append(el('h3', `Попытки доставки: ${attempts.length}`));
  if (!attempts.length) history.append(el('p', 'Доставок ещё не было.'));
  for (const attempt of [...attempts].reverse()) {
    const card = el('article', undefined, `card${['verification-failed', 'failed', 'blocked'].includes(attempt.state) ? ' release-error' : attempt.state === 'verified' ? ' release-decision' : ''}`);
    card.append(el('h4', `${attempt.connection.name} · ${deliveryStateLabels[attempt.state] || attempt.state}`), el('p', `Target: ${attempt.targetIdentity?.host || 'не подтверждён'} · версия ${attempt.targetIdentity?.version || 'не сообщена'} · ${environmentLabels[attempt.connection.environment] || attempt.connection.environment}`));
    card.append(el('p', `Кандидат ${attempt.candidateId} · SHA-256 ${attempt.sha256}`, 'release-hash'), el('p', `Состояние Target до доставки: ${attempt.evidence.preDeploy.inventoryHash} (${attempt.evidence.preDeploy.files} файлов)`, 'release-hash'));
    if (attempt.evidence.operation) card.append(el('p', `Операция: ${operationLabels[attempt.evidence.operation.result] || attempt.evidence.operation.result}${attempt.evidence.operation.nativeResult ? ` · ответ инструмента: ${attempt.evidence.operation.nativeResult}` : ''}${attempt.evidence.operation.error ? ` · ${attempt.evidence.operation.error}` : ''}`));
    if (attempt.evidence.readBack) {
      const c = attempt.evidence.comparison;
      card.append(el('p', `Read-back: ${attempt.evidence.readBack.inventoryHash} (${attempt.evidence.readBack.files} файлов)`, 'release-hash'), el('p', c.match ? `Совпадение: ${c.compared} файлов сравнены по SHA-256; служебные файлы не сравнивались: ${c.volatile.length}` : `Расхождение: отсутствуют ${c.missing.length}, отличаются ${c.different.length}, сравнивалось ${c.compared}`));
      for (const p of [...c.missing, ...c.different].slice(0, 20)) card.append(el('p', p, 'release-hash'));
    }
    if (attempt.evidence.rollbackReference) card.append(el('p', `Ссылка для отката: ${attempt.evidence.rollbackReference.inventoryHash}. ${attempt.evidence.rollbackReference.note}`, 'release-label'));
    const steps = el('details'); steps.append(el('summary', 'Журнал попытки'));
    for (const event of attempt.history) steps.append(el('p', `${event.at} · ${deliveryStateLabels[event.state] || event.state}${event.note ? ': ' + event.note : ''}`)); card.append(steps);
    if (attempt.state === 'prepared') {
      const expected = `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}`, form = el('form'), confirmation = field(form, `Подтверждение доставки: введите ${expected}`); confirmation.required = true;
      const key = crypto.randomUUID(); // one key per rendered form: a repeated click cannot start a second operation
      const confirm = el('button', 'Подтвердить доставку на Target'); confirm.type = 'submit'; form.append(confirm);
      form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) act(() => api.confirm(attempt.id, { confirmation: confirmation.value.trim(), idempotencyKey: key })); };
      card.append(el('p', 'Перед запуском сервер повторно проверит личность Target, неизменность релиза и кандидата и отсутствие изменений решения на Target.', 'release-label'), form);
    }
    if (attempt.state === 'deploying') { card.append(el('p', 'Операция выполняется на стороне моста/адаптера. Состояние обновится после завершения; обновите карточку, чтобы увидеть результат.', 'release-label')); button('Обновить состояние доставки', () => run(reload), card); }
    if (actionable(attempt.state)) button(attempt.state === 'verification-failed' ? 'Повторить read-back' : 'Выполнить read-back и сравнить', () => act(() => api.verify(attempt.id)), card);
    history.append(card);
  }
  section.append(history);
  const approved = release.approval?.revision === release.revision;
  const next = el('p', !approved ? 'Доставка доступна после принятия текущего кандидата.' : current ? `Есть незавершённая доставка: ${deliveryStateLabels[current.state]}. Завершите или проверьте её прежде чем готовить новую.` : !targets.length ? 'Добавьте и проверьте подключение Target (не PROD), чтобы подготовить доставку.' : 'Выберите проверенное подключение Target и подготовьте доставку: будут зафиксированы личность Target и состояние решения до изменения.');
  section.append(next);
  if (approved && !current && targets.length) {
    const form = el('form'), target = field(form, 'Подключение Target для доставки', '', 'select');
    for (const connection of targets) option(target, connection.id, `${connection.name} · ${environmentLabels[connection.environment]}${connection.probe?.identity ? ' · ' + connection.probe.identity.host : ' · не проверено'}`);
    const prepare = el('button', 'Подготовить доставку'); prepare.type = 'submit'; form.append(prepare);
    form.onsubmit = event => { event.preventDefault(); act(() => api.prepare({ connectionId: target.value, revision: release.revision })); };
    section.append(form);
  }
  return section;
}
