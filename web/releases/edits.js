// AR-05: optional supported edits inside the release review. One renderer for
// production and Storybook; the server alone decides editability and evidence.
const el = (tag, content, className) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node; };
const decisionLabels = { accepted: 'Принято', rejected: 'Отклонено' };
const statusLabels = { current: 'Доказательства актуальны', stale: 'Устарела', corrupt: 'Повреждена' };
// A display hint only: attaching an edit re-verifies the object, snapshot and compiler profile on the server.
export const scriptEditCandidate = entity => String(entity.kind).toUpperCase() === 'WIDGET' && /^widgets\//.test(entity.archivePath || '');

export function mountEdits({ release, change, run, button, field, disabled = false }) {
  const section = el('section', undefined, 'release-edits');
  const edits = release.edits || [];
  section.append(el('h2', `Поддерживаемые правки: ${edits.length}`),
    el('p', 'Необязательно. Правка возможна только для скриптов виджетов/форм, прошедших offline ELMA compiler по проверенному профилю этого снимка. Исходный .e365 не меняется: исходники и runtime правки хранятся отдельно и требуют принятия с причиной. Любая правка снимает принятие кандидата.'),
    el('p', 'Кандидат с правками можно рассмотреть и принять, но нельзя передать или доставить: нативная сборка изменённого пакета пока недоступна.', 'note'));
  for (const edit of edits) {
    const card = el('article', undefined, 'card release-edit');
    card.append(el('h3', `Правка: ${edit.name || edit.archivePath}`),
      el('p', `${edit.archivePath} · ревизия рабочей копии ${edit.workspaceRevision} · ${statusLabels[edit.status] || 'Статус не проверен'}${edit.reason ? ': ' + edit.reason : ''}`),
      el('p', `Автор: ${edit.actor?.login || 'не установлен'} · ${edit.at}`),
      el('p', `База: ${edit.baseChecksum}`, 'release-hash'),
      el('p', `Артефакт правки: ${edit.generated.sha256}`, 'release-hash'),
      el('p', `Compiler: ${edit.compiler.compilerContract} · ELMA ${edit.compiler.platformVersion} · TypeScript ${edit.compiler.typescriptVersion}`));
    const files = el('ul');
    for (const file of edit.files) files.append(el('li', `${file.name} (${file.origin}): +${file.added} / −${file.removed} строк · ${file.originalSha256.slice(0, 12)} → ${file.editedSha256.slice(0, 12)}`));
    card.append(files);
    const review = edit.review && edit.review.sha256 === edit.generated.sha256 ? edit.review : null;
    if (review) card.append(el('p', `${decisionLabels[review.decision]} (${review.actor?.login || 'не установлен'}${review.independent ? '' : ', автор правки'}): ${review.reason}`, `release-decision${review.decision === 'rejected' ? ' release-error' : ''}`));
    const form = el('form'), reason = field(form, `Причина решения по правке — ${edit.archivePath}`, review?.reason || '', 'textarea'); reason.required = true;
    const actions = el('div', undefined, 'actions');
    for (const [value, label] of [['accepted', 'Принять правку'], ['rejected', 'Отклонить правку']])
      button(label, () => { if (reason.reportValidity()) run(() => change(release.id, { revision: release.revision, action: 'review-edit', editId: edit.id, decision: value, reason: reason.value })); }, actions);
    button('Убрать правку из релиза', () => run(() => change(release.id, { revision: release.revision, action: 'detach-edit', editId: edit.id })), actions).classList.add('secondary');
    form.onsubmit = event => event.preventDefault(); form.append(actions); card.append(form); section.append(card);
  }
  const entities = release.source?.entities || [];
  const supported = entities.filter(scriptEditCandidate), readOnly = entities.filter(entity => !scriptEditCandidate(entity));
  if (supported.length) {
    const form = el('form'), wrapper = el('div'), caption = el('label', 'Скрипт виджета из рабочей копии'), picker = el('select');
    picker.id = 'release-edit-object'; caption.htmlFor = picker.id;
    for (const entity of supported) { const option = el('option', `${entity.name || entity.code} · ${entity.archivePath}`); option.value = entity.archivePath; picker.append(option); }
    wrapper.append(caption, picker); form.append(wrapper);
    const attach = button('Подключить проверенную правку из рабочей копии', () => run(() => change(release.id, { revision: release.revision, action: 'attach-edit', archivePath: picker.value })), form);
    attach.classList.add('secondary'); if (disabled) { attach.disabled = true; attach.dataset.unavailable = 'true'; }
    form.onsubmit = event => event.preventDefault(); section.append(form);
  }
  if (readOnly.length) {
    const details = el('details'); details.append(el('summary', `Только чтение: ${readOnly.length}`));
    const list = el('ul');
    for (const entity of readOnly.slice(0, 200)) list.append(el('li', `${entity.name || entity.code} · ${entity.archivePath} — только чтение: вне проверенного контракта скриптов виджетов`));
    details.append(list); if (readOnly.length > 200) details.append(el('p', `Показаны первые 200 из ${readOnly.length}.`)); section.append(details);
  }
  return section;
}
