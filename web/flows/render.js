import { flows, kindLabels } from './catalog.js';
import { startFlow, transition } from './model.js';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const list = items => { const node = el('ul'); items.forEach(text => node.append(el('li', text))); return node; };
export function mountFlow({ flow, initial, reviewMount } = {}) {
  const root = el('main', undefined, 'flow-shell');
  let session = startFlow(flow, initial);
  const heading = el('header', undefined, 'flow-heading');
  heading.append(el('p', kindLabels[flow.kind], 'flow-badge'), el('h1', flow.title), el('p', `${flow.persona}. ${flow.situation}`, 'flow-lead'), el('p', `Результат: ${flow.outcome}`));
  const map = el('ol', undefined, 'flow-map'); map.setAttribute('aria-label', 'Карта всего сценария');
  const stage = el('section', undefined, 'flow-stage'); stage.setAttribute('aria-live', 'polite');
  const notes = el('details', undefined, 'flow-notes');
  notes.append(el('summary', 'Как это работает: правила, исследование и источники'), el('h2', 'Бизнес-правила'), list(flow.rules), el('h2', 'Вопросы исследования'), list(flow.questions), el('h2', 'Источники истины'), list(flow.sources), el('p', 'Источники — текущий код и контракты репозитория. Прототип не подключается к ELMA и не запускает код клиента.'));
  const branches = el('details', undefined, 'flow-branches'); branches.append(el('summary', 'Весь маршрут: действия, роли и исключения'));
  const routes = el('ul');
  for (const state of flow.states) {
    const row = el('li'); row.append(el('strong', `${state.title} · ${state.actor}`));
    row.append(list(state.actions.length ? state.actions.map(action => `${action.label} → ${flow.states.find(next => next.id === action.to)?.title}`) : ['Завершение: проверьте результат и доказательства.'])); routes.append(row);
  }
  branches.append(routes);
  const history = el('details'); history.append(el('summary', 'История прохождения'));
  const log = el('ol'); history.append(log);
  const reset = el('button', 'Начать заново'); reset.type = 'button'; reset.onclick = () => { session = startFlow(flow); draw(); };
  const reviewHost = el('section', undefined, 'flow-review');
  root.append(heading, map, stage, branches, notes, reset, history, reviewHost);
  function draw() {
    map.replaceChildren();
    for (const state of flow.states) { const row = el('li', state.title); row.dataset.state = state.id; if (state.id === session.current) row.setAttribute('aria-current', 'step'); map.append(row); }
    const state = flow.states.find(state => state.id === session.current);
    stage.replaceChildren(el('p', `Кто действует: ${state.actor}`, 'flow-badge'), el('h2', state.title), el('p', state.explanation));
    if (flow.id === 'approval') stage.append(el('p', `Версия документа: ${session.version}. Согласована версия: ${session.approvedVersion ?? 'нет'}.`));
    if (flow.id === 'correspondence') stage.append(el('p', `Поле входящего: ${session.topic || 'пусто'}.`));
    if (flow.id === 'workspace') stage.append(el('p', `Рабочая ревизия: ${session.workspaceRevision}. Проверка: ${session.workspaceCheck || 'требуется'}.`));
    if (state.evidence) stage.append(el('p', `Доказательство / ожидаемая запись: ${state.evidence}`, 'flow-evidence'));
    const actions = el('div', undefined, 'flow-actions');
    state.actions.forEach(action => { const button = el('button', action.label); button.type = 'button'; button.dataset.action = action.id; button.onclick = () => { session = transition(flow, session, action.id); draw(); }; actions.append(button); });
    if (!state.actions.length) actions.append(el('p', 'Сценарий завершён. Проверьте результат и оставьте рецензию.'));
    stage.append(actions);
    log.replaceChildren(); session.history.forEach(event => log.append(el('li', event.action)));
    reviewHost.dataset.step = session.current;
  }
  draw();
  if (reviewMount) reviewMount(reviewHost, flow, () => session.current);
  else reviewHost.append(el('p', 'Обсуждения и решения доступны в локальном Storybook. Эта карта системы доступна только для изучения.'));
  return root;
}
export function mountCatalog(options = {}) {
  const root = el('div', undefined, 'flow-catalog');
  const overview = el('section', undefined, 'flow-overview');
  overview.append(el('p', 'ELMA · единая картина для аналитика и бизнеса', 'flow-badge'), el('h1', 'Как работает система'), el('p', 'Потребность → исследование → рецензия → изменение → проверенный результат. Выберите сценарий и пройдите основную и ошибочную ветки.'), el('p', 'Wiki хранит карту и доказательства. ELMA исполняет бизнес-процессы. Статус каждого сценария показывает, что реализовано, а что ещё требует проверки.'));
  const nav = el('nav'); nav.setAttribute('aria-label', 'Сценарии системы');
  const content = el('div');
  const show = flow => {
    content.replaceChildren(mountFlow({ flow, ...options }));
    nav.querySelectorAll('button').forEach(button => { if (button.dataset.flow === flow.id) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current'); });
  };
  for (const flow of flows) { const button = el('button', flow.title); button.type = 'button'; button.dataset.flow = flow.id; button.onclick = () => show(flow); nav.append(button); }
  root.append(overview, nav, content); show(flows.find(flow => flow.id === 'upload')); return root;
}
