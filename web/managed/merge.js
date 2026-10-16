import { componentName, dateLabel } from './model.js';
import { elementKindLabels, partMerge, partMergeBlockers, partMergeFindings } from './labels.js';
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
const decisionText = row => row.parts ? partMerge.choice : (mergeChoiceLabels[row.classification] || {})[row.choice] || row.choice;
const partName = part => part.kind === 'residual' ? partMerge.residual : part.kind === 'order' ? partMerge.order
  : `${elementKindLabels[part.kind] || part.kind} ${part.incoming?.name || part.current?.name || part.base?.name || part.code}`;
// Part merge is offered only when the server names the choice and the part plan is not blocked.
const partView = (row, merge) => {
  if (!row.parts) return null;
  const available = !!merge.partMergeChoice && row.parts.status !== 'blocked';
  const named = id => partName(row.parts.rows.find(part => part.id === id) || { kind: 'order', code: id });
  return { available, choice: available ? merge.partMergeChoice : null,
    reasons: [...new Set([...row.parts.blockers.map(item => item.reason), ...row.parts.rows.flatMap(part => part.blockers)])].map(reason => partMergeBlockers[reason] || reason),
    required: available ? row.parts.rows.filter(part => part.status === 'resolution-required').map(part => ({ id: part.id, name: partName(part),
      label: mergeLabels[part.classification] || part.classification,
      options: Object.entries(mergeChoiceLabels[part.classification] || {}).filter(([value]) => merge.choices?.[part.classification]?.includes(value)) })) : [],
    findings: row.parts.findings.map(finding => ({ type: finding.type, text: partMergeFindings[finding.type] || finding.type,
      parts: [finding.id, ...(finding.parts || [])].filter(Boolean).map(named) })) };
};

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
    required: rows.filter(row => row.status === 'resolution-required').map(row => {
      const parts = partView(row, merge);
      return { key: row.key, name: componentName(row.key), label: mergeLabels[row.classification] || row.classification, team: row.current?.team || null,
        options: [...Object.entries(mergeChoiceLabels[row.classification] || {}).filter(([value]) => merge.choices?.[row.classification]?.includes(value)),
          ...(parts?.available ? [[parts.choice, partMerge.choice]] : [])], parts };
    }),
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

export function mergeGate(view, decisions = {}, reason = '', partDecisions = {}) {
  if (!view.editable) return view.unavailable || 'Решение недоступно для этого сравнения.';
  if (view.required.some(row => !row.options.some(([value]) => value === decisions[row.key]))) return 'Выберите версию для каждого конфликта.';
  if (view.required.some(row => row.parts?.available && decisions[row.key] === row.parts.choice
      && row.parts.required.some(part => !part.options.some(([value]) => value === partDecisions[row.key]?.[part.id])))) return partMerge.chooseParts;
  if (!reason.trim()) return 'Укажите причину решения.';
  return '';
}

// Part decisions are sent only for components resolved by part merge.
export function partInput(view, decisions, partDecisions = {}) {
  const merged = view.required.filter(row => row.parts?.available && decisions[row.key] === row.parts.choice);
  return merged.length ? { partDecisions: Object.fromEntries(merged.map(row => [row.key, { ...partDecisions[row.key] }])) } : {};
}

// Submit payload, or null while the same gate the save button shows still applies.
export function mergeSubmission(merge, view, decisions, reason, partDecisions = {}) {
  if (mergeGate(view, decisions, reason, partDecisions)) return null;
  return { expectedRevision: merge.plan.inputs.current.revision, planDigest: merge.plan.planDigest,
    expectedResolutionId: view.head?.id ?? null, decisions: { ...decisions }, reason, ...partInput(view, decisions, partDecisions) };
}

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let sequence = 0;
// Part plan of one process: blockers, findings and the per-part choices shown
// only after «Совместить части процесса» is selected.
function mountParts(row, partDecisions, update) {
  const root = el('div', undefined, 'managed-merge-parts');
  root.append(el('h5', partMerge.parts), el('p', partMerge.explain, 'managed-muted'));
  if (!row.parts.available) root.append(el('p', partMerge.unavailable + (row.parts.reasons.length ? ': ' + row.parts.reasons.join('; ') : ''), 'managed-note'));
  if (row.parts.findings.length) {
    const list = el('ul'); list.setAttribute('aria-label', partMerge.findings);
    row.parts.findings.forEach(finding => list.append(el('li', finding.parts.length ? finding.text + ': ' + finding.parts.join(', ') : finding.text)));
    root.append(el('p', partMerge.findings), list);
  }
  if (!row.parts.available) return { root, choices: null };
  const choices = el('div'); choices.hidden = true;
  for (const part of row.parts.required) {
    const caption = el('label', part.name + ': ' + part.label), select = el('select');
    select.id = 'managed-merge-part-' + ++sequence; caption.htmlFor = select.id;
    for (const [value, text] of [['', partMerge.chooseVersion], ...part.options]) { const option = el('option', text); option.value = value; select.append(option); }
    select.onchange = () => { partDecisions[row.key] ??= {}; if (select.value) partDecisions[row.key][part.id] = select.value; else delete partDecisions[row.key][part.id]; update(); };
    choices.append(caption, select);
  }
  choices.append(el('p', partMerge.notMaterialized, 'managed-muted'));
  root.append(choices);
  return { root, choices };
}
export function mountMergeResolution(merge, { submit, technical } = {}) {
  const view = mergeResolutionView(merge), root = el('section', undefined, 'managed-card managed-merge');
  root.setAttribute('aria-label', 'Совмещение с принятыми изменениями');
  root.append(el('h3', 'Совмещение с принятыми изменениями'),
    el('p', partMerge.intro, 'managed-muted'));
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
    const form = el('form'), decisions = {}, partDecisions = {}, gate = el('p', '', 'managed-note'), save = el('button', view.head ? 'Сохранить новое решение' : 'Сохранить решение');
    gate.setAttribute('role', 'status'); save.type = 'submit';
    const reasonLabel = el('label', 'Причина решения'), reason = el('textarea'); reason.id = 'managed-merge-reason-' + ++sequence; reason.required = true; reason.maxLength = 2000; reasonLabel.htmlFor = reason.id;
    const update = () => { gate.textContent = mergeGate(view, decisions, reason.value, partDecisions); save.disabled = !!gate.textContent; save.dataset.unavailable = String(save.disabled); };
    for (const row of view.required) {
      const card = el('div', undefined, 'managed-merge-row'), caption = el('label', `${row.name}: ${row.label}`), choice = el('select');
      choice.id = 'managed-merge-choice-' + ++sequence; caption.htmlFor = choice.id;
      for (const [value, text] of [['', 'Выберите версию'], ...row.options]) { const option = el('option', text); option.value = value; choice.append(option); }
      const parts = row.parts && mountParts(row, partDecisions, update);
      choice.onchange = () => { if (choice.value) decisions[row.key] = choice.value; else delete decisions[row.key];
        if (parts?.choices) parts.choices.hidden = choice.value !== row.parts.choice; update(); };
      card.append(caption, choice); if (row.team) card.append(el('p', 'Принятая версия: ' + row.team, 'managed-muted'));
      if (parts) card.append(parts.root); form.append(card);
    }
    reason.oninput = update;
    form.append(reasonLabel, reason, el('p', 'Решение сохраняется отдельно с автором и точными версиями. Оно не принимает объединённую версию; сборка пакета и установка недоступны.', 'managed-muted'), gate, save);
    form.onsubmit = event => { event.preventDefault(); const input = mergeSubmission(merge, view, decisions, reason.value, partDecisions);
      if (!input) { update(); return; } if (form.reportValidity()) submit?.(input); };
    root.append(form); update();
  }
  technical?.(root, 'Доказательства сравнения и решений', { inputs: merge.plan?.inputs ?? null, planDigest: merge.plan?.planDigest ?? null, head: merge.head, history: merge.history });
  return root;
}
