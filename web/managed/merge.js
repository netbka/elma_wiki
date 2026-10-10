import { componentName, dateLabel } from './model.js';
// Pure projection of the server's B/A/C plan and durable resolution history.
// The server stays authoritative; this never chooses a version by default.
export const mergeLabels = {
  unchanged: 'Без изменений', 'current-only': 'Изменено только в принятой версии', 'incoming-only': 'Изменено только в этом изменении',
  identical: 'Одинаковая правка', divergent: 'Разные правки одного объекта', 'addition-current': 'Добавлен в принятой версии',
  'addition-incoming': 'Добавлен в этом изменении', 'addition-identical': 'Одинаково добавлен', 'addition-divergent': 'Добавлен по-разному',
  'delete-incoming': 'Удаление заявлено в этом изменении', 'delete-identical': 'Удалён в обеих версиях',
  'delete-edit': 'Это изменение удаляет объект, а принятая версия его правит', 'edit-delete': 'Принятая версия удалила объект, а это изменение его правит'
};
export const mergeChoiceLabels = {
  divergent: { 'keep-current': 'Оставить принятую версию', 'take-incoming': 'Взять версию из этого изменения' },
  'addition-divergent': { 'keep-current': 'Оставить принятую версию', 'take-incoming': 'Взять версию из этого изменения' },
  'delete-edit': { 'keep-current': 'Оставить принятую правку', remove: 'Удалить объект, как заявлено в изменении' },
  'edit-delete': { 'keep-current': 'Оставить объект удалённым', 'take-incoming': 'Восстановить объект с правкой из изменения' }
};
export const mergeBlockerLabels = { 'rename-uncertain': 'Возможно переименование; соответствие объектов не установлено',
  'duplicate-identity': 'Несколько объектов с одной идентичностью', 'unknown-base': 'Исходная версия не заявлена',
  'incoming-ambiguity': 'Часть изменения не распознана', 'base-ambiguity': 'Часть исходной версии не распознана' };
const statusLabels = { current: 'Действует для текущих версий', stale: 'Устарело: версии изменились, решите заново',
  superseded: 'Заменено более поздним решением', corrupt: 'Данные решения повреждены' };
const reasonLabels = { completed: 'Изменение уже закрыто. Решения сохранены в истории.', superseded: 'Изменение заменено исправлением. Решения не переносятся; рассмотрите актуальное изменение.',
  archived: 'Решение в архиве. Возобновите работу, чтобы решать конфликты.', 'not-a-change': 'Сравнение трёх версий относится только к частичному изменению.' };
const decisionText = row => (mergeChoiceLabels[row.classification] || {})[row.choice] || row.choice;

export function mergeResolutionView(merge) {
  const plan = merge?.plan, head = merge?.head || null, history = merge?.history || [];
  const declared = plan?.inputs?.base?.status === 'declared';
  const visible = !!merge && (history.length > 0 || declared && plan.status !== 'clear');
  const rows = plan?.rows || [];
  return {
    visible, available: !!merge?.available,
    editable: !!merge?.available && plan.status === 'resolution-required' && head?.status !== 'corrupt',
    unavailable: merge?.available ? '' : reasonLabels[merge?.reason] || merge?.message || 'Сравнение трёх версий недоступно.',
    status: plan?.status || null,
    required: rows.filter(row => row.status === 'resolution-required').map(row => ({ key: row.key, name: componentName(row.key),
      label: mergeLabels[row.classification] || row.classification, team: row.current?.team || null,
      options: Object.entries(mergeChoiceLabels[row.classification] || {}).filter(([value]) => merge.choices?.[row.classification]?.includes(value)) })),
    blocked: rows.filter(row => row.status === 'blocked').map(row => ({ key: row.key, name: componentName(row.key),
      reasons: row.blockers.map(reason => mergeBlockerLabels[reason] || reason) })),
    planBlockers: (plan?.blockers || []).map(row => mergeBlockerLabels[row.reason] || row.reason),
    preserved: rows.filter(row => row.status === 'clear').map(row => ({ key: row.key, name: componentName(row.key), label: mergeLabels[row.classification] || row.classification })),
    head: head && { id: head.id, status: head.status, statusLabel: statusLabels[head.status] || head.status, actor: head.actor?.login || 'Автор не зафиксирован',
      at: dateLabel(head.at), reason: head.reason, sequence: head.sequence,
      decisions: head.decisions.map(row => ({ name: componentName(row.key), text: decisionText(row) })) },
    earlier: history.length - (head ? 1 : 0)
  };
}

export function mergeGate(view, decisions = {}, reason = '') {
  if (!view.editable) return view.unavailable || 'Решение недоступно для этого сравнения.';
  if (view.required.some(row => !row.options.some(([value]) => value === decisions[row.key]))) return 'Выберите версию для каждого конфликта.';
  if (!reason.trim()) return 'Укажите причину решения.';
  return '';
}

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let sequence = 0;
export function mountMergeResolution(merge, { submit, technical } = {}) {
  const view = mergeResolutionView(merge), root = el('section', undefined, 'managed-card managed-merge');
  root.setAttribute('aria-label', 'Совмещение с принятыми изменениями');
  root.append(el('h3', 'Совмещение с принятыми изменениями'),
    el('p', 'Сравнение исходной версии, принятой версии и этого изменения. Выбор применяется к объекту целиком; автоматического объединения нет.', 'managed-muted'));
  if (view.head) {
    const card = el('div', undefined, 'managed-merge-head');
    card.append(el('h4', `Сохранённое решение №${view.head.sequence}`), el('p', view.head.statusLabel, view.head.status === 'current' ? 'managed-accepted' : 'managed-note'),
      el('p', `${view.head.actor} · ${view.head.at}`, 'managed-muted'), el('p', 'Причина: ' + view.head.reason, 'change-text'));
    if (view.head.decisions.length) { const list = el('ul'); view.head.decisions.forEach(row => list.append(el('li', `${row.name}: ${row.text}`))); card.append(list); }
    if (view.earlier) card.append(el('p', `Прежних решений в истории: ${view.earlier}. Они сохранены без изменений.`, 'managed-muted'));
    root.append(card);
  }
  if (!view.available) root.append(el('p', view.unavailable, 'managed-note'));
  if (view.planBlockers.length || view.blocked.length) {
    root.append(el('p', 'Решение заблокировано, пока не устранены недостающие данные: ' + [...new Set([...view.planBlockers, ...view.blocked.flatMap(row => row.reasons)])].join('; ') + '.', 'managed-note'));
    if (view.blocked.length) { const list = el('ul'); list.setAttribute('aria-label', 'Заблокированные объекты'); view.blocked.forEach(row => list.append(el('li', `${row.name}: ${row.reasons.join('; ')}`))); root.append(list); }
  }
  if (view.preserved.length) {
    const details = el('details'), list = el('ul');
    view.preserved.forEach(row => list.append(el('li', `${row.name} · ${row.label}`)));
    details.append(el('summary', `Без конфликта: ${view.preserved.length}. Остальное содержимое сохраняется как есть`), list); root.append(details);
  }
  if (view.editable) {
    const form = el('form'), decisions = {}, gate = el('p', '', 'managed-note'), save = el('button', view.head ? 'Сохранить новое решение' : 'Сохранить решение');
    gate.setAttribute('role', 'status'); save.type = 'submit';
    const reasonLabel = el('label', 'Причина решения'), reason = el('textarea'); reason.id = 'managed-merge-reason-' + ++sequence; reason.required = true; reason.maxLength = 2000; reasonLabel.htmlFor = reason.id;
    const update = () => { gate.textContent = mergeGate(view, decisions, reason.value); save.disabled = !!gate.textContent; save.dataset.unavailable = String(save.disabled); };
    for (const row of view.required) {
      const card = el('div', undefined, 'managed-merge-row'), caption = el('label', `${row.name}: ${row.label}`), choice = el('select');
      choice.id = 'managed-merge-choice-' + ++sequence; caption.htmlFor = choice.id;
      for (const [value, text] of [['', 'Выберите версию'], ...row.options]) { const option = el('option', text); option.value = value; choice.append(option); }
      choice.onchange = () => { if (choice.value) decisions[row.key] = choice.value; else delete decisions[row.key]; update(); };
      card.append(caption, choice); if (row.team) card.append(el('p', 'Принятая версия: ' + row.team, 'managed-muted')); form.append(card);
    }
    reason.oninput = update;
    form.append(reasonLabel, reason, el('p', 'Решение сохраняется отдельно с автором и точными версиями. Оно не принимает объединённую версию; сборка пакета и установка недоступны.', 'managed-muted'), gate, save);
    form.onsubmit = event => { event.preventDefault(); if (mergeGate(view, decisions, reason.value) || !form.reportValidity()) return;
      submit?.({ expectedRevision: merge.plan.inputs.current.revision, planDigest: merge.plan.planDigest,
        expectedResolutionId: view.head?.id ?? null, decisions: { ...decisions }, reason: reason.value }); };
    root.append(form); update();
  }
  technical?.(root, 'Доказательства сравнения и решений', { inputs: merge.plan?.inputs ?? null, planDigest: merge.plan?.planDigest ?? null, head: merge.head, history: merge.history });
  return root;
}
