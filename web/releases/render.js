import { changeLabels, impactLabels } from './comparison.js';
const el = (tag, content, className) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node; };
const stateLabels = { review: 'Рецензия', candidate: 'Кандидат подготовлен', prepared: 'Принят для локальной передачи', 'handed-off': 'Пакет передачи выдан' };
const checkLabels = { pass: 'Пройдено', fail: 'Не пройдено', 'not-run': 'Не выполнялось', unsupported: 'Не поддерживается' };
const eventLabels = { review: 'Решение по изменению', details: 'Условия передачи изменены', freeze: 'Кандидат подготовлен', approve: 'Кандидат принят для передачи', handoff: 'Пакет передачи выдан' };
let fieldId = 0;
export function mountRelease({ release, projects = [], releases = [], change, create, preview, download, open, visibleChanges = 20 } = {}) {
  const root = el('div', undefined, 'release-shell');
  const status = el('p'); status.setAttribute('role', 'status');
  const error = el('p'); error.setAttribute('role', 'alert');
  let busy = false, stale = false;
  const button = (label, action, parent = root) => { const node = el('button', label); node.type = 'button'; node.onclick = action; parent.append(node); return node; };
  const field = (form, label, value = '', kind = 'input') => { const wrapper = el('div'), caption = el('label', label), node = el(kind); node.id = `release-field-${++fieldId}`; caption.htmlFor = node.id; node.value = value; node.dataset.draftKey = label; node.dataset.savedValue = value; node.maxLength = kind === 'textarea' ? 4000 : 200; wrapper.append(caption, node); form.append(wrapper); return node; };
  const choose = (form, label, allowNone) => {
    const select = field(form, label, '', 'select');
    const first = el('option', allowNone ? 'Нет базовой версии (ограниченное сравнение)' : 'Выберите загруженный DEV пакет'); first.value = ''; select.append(first);
    for (const project of projects.filter(p => !p.legacy)) { const item = el('option', `${project.filename} · ${new Date(project.createdAt).toLocaleString('ru-RU')}`); item.value = project.id; select.append(item); }
    if (!allowNone) select.required = true; return select;
  };
  const run = async (operation, redraw = true) => {
    if (busy || stale) return;
    busy = true; error.textContent = ''; root.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const next = await operation();
      if (redraw && next) {
        const drafts = new Map([...root.querySelectorAll('[data-draft-key]')].filter(node => node.value !== node.dataset.savedValue).map(node => [node.dataset.draftKey, node.value]));
        const replacement = mountRelease({ release: next, projects, releases, change, create, preview, download, open, visibleChanges });
        for (const node of replacement.querySelectorAll('[data-draft-key]')) if (drafts.has(node.dataset.draftKey)) node.value = drafts.get(node.dataset.draftKey);
        root.replaceWith(replacement); const heading = replacement.querySelector('h1'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); return;
      }
    } catch (e) { stale = e.status === 409 && /другой вкладке|Обновите релиз/.test(e.message); error.textContent = e.message; }
    finally {
      busy = false; root.querySelectorAll('button').forEach(b => b.disabled = stale || b.dataset.unavailable === 'true');
      if (stale) { const refresh = button('Обновить релиз (запишите черновик перед обновлением)', () => open(release.id)); refresh.disabled = false; }
    }
  };
  root.append(el('p', 'Приватное пространство аналитика', 'eyebrow'), el('h1', release?.title || 'Подготовить релиз'), el('p', 'Загрузить DEV → Рассмотреть изменения → Подготовить кандидат → Передать', 'lead'), status, error);
  if (release?.synthetic) root.append(el('p', 'Синтетический пример. Решения не сохраняются; этот Storybook не принимает реальные пакеты.', 'note'));
  if (!release) {
    root.append(el('p', 'Выберите два отдельных загруженных проекта. Имя и код решения не объединяют их автоматически. Исходные файлы сохраняются как неизменяемые снимки релиза.'));
    if (!projects.some(p => !p.legacy)) { const link = el('a', 'Загрузить .e365 в мои проекты'); link.href = '/dashboard'; root.append(link); }
    const form = el('form'), title = field(form, 'Название релиза'), intent = field(form, 'Деловая цель', '', 'textarea'), source = choose(form, 'Новый пакет DEV', false), baseline = choose(form, 'Предыдущий пакет DEV — базовая версия', true), target = field(form, 'Назначение передачи (непроверенная компания или ответственный)');
    title.required = intent.required = target.required = true; title.maxLength = 160;
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) run(() => create({ title: title.value, intent: intent.value, sourceProjectId: source.value, baselineProjectId: baseline.value || null, targetIntent: target.value })); };
    const submit = el('button', 'Начать рецензию'); submit.type = 'submit'; form.append(submit); root.append(form);
    const list = el('section'); list.append(el('h2', 'Продолжить релиз'));
    if (!releases.length) list.append(el('p', 'Сохранённых релизов пока нет.'));
    for (const row of releases) button(`${row.title} · ${stateLabels[row.state]}`, () => open(row.id), list);
    root.append(list); return root;
  }
  status.textContent = `${stateLabels[release.state]} · ревизия ${release.revision}`;
  const progress = el('ol', undefined, 'release-progress');
  const currentStage = release.state === 'review' ? 1 : release.state === 'candidate' ? 2 : 3;
  ['DEV снимок сохранён', 'Рецензия', 'Кандидат', 'Передача'].forEach((label, index) => { const step = el('li', label); if (index === currentStage) step.setAttribute('aria-current', 'step'); progress.append(step); }); root.append(progress);
  root.append(el('h2', 'Следующее действие'), el('p', release.blockers.length ? `Завершите рецензию и устраните блокировки: ${release.blockers.length}. Не приняты файлы: ${release.unreviewed}.` : !release.candidate ? 'Подготовьте неизменяемый кандидат из исходного пакета.' : !release.approval ? 'Проверьте кандидат и примите его только для локальной передачи.' : 'Скачайте приватный пакет передачи и передайте его оператору отдельно.'));
  root.append(el('p', release.intent), el('p', `Назначение передачи: ${release.targetIntent}. Личность и состояние Target не проверены.`));
  root.append(el('p', 'Этот релиз использует исходный .e365 целиком. Правки в рабочей копии редактора не входят в кандидат.', 'note'));
  for (const [label, snapshot] of [['Новый DEV', release.source], ['Базовая версия DEV', release.baseline]]) {
    const section = el('section'); section.append(el('h2', label));
    if (snapshot) {
      section.append(el('p', `${snapshot.filename} · ${snapshot.importedAt} · решение ${snapshot.code || 'не определено'} · ${snapshot.coverage}`), el('p', `SHA-256: ${snapshot.checksum}`, 'release-hash'));
      const link = el('a', 'Исходный проект'); link.href = `/p/${snapshot.projectId}/`; section.append(link);
    } else section.append(el('p', 'Базовая версия отсутствует. Это двухсторонняя рецензия содержимого, а не доказательство отсутствия конфликтов.'));
    root.append(section);
  }
  const blockers = el('section'); blockers.append(el('h2', `Блокирующие замечания: ${release.blockers.length}`));
  const blockerList = el('ul'); for (const reason of release.blockers) blockerList.append(el('li', reason)); blockers.append(blockerList); root.append(blockers);
  const changes = el('section'); changes.append(el('h2', `Изменения всего пакета: ${release.changes.length}`), el('p', 'Решение подтверждает рецензию; оно не исключает файл из пакета. Права, обязательность полей и процессы не считаются косметическими. Непроиндексированные байты тоже сравниваются.'));
  if (!release.changes.length) changes.append(el('p', 'Файлы в распакованном составе совпадают. Сам архив может иметь другую упаковку; передаётся точный новый оригинал.'));
  if (release.changes.length) changes.append(el('p', `Показано ${Math.min(visibleChanges, release.changes.length)} из ${release.changes.length}. Все файлы остаются в области рецензии.`));
  for (const item of release.changes.slice(0, visibleChanges)) {
    const card = el('article', undefined, 'card'); card.append(el('h3', `${changeLabels[item.type]}: ${item.title}`), el('p', `${item.path} · ${impactLabels[item.impact]}`));
    for (const [label, value] of [['До', item.before], ['После', item.after]]) card.append(el('p', value ? `${label}: ${value.size} байт · ${value.sha256}` : `${label}: файл отсутствует`, 'release-hash'));
    for (const diff of item.fields) card.append(el('p', `Поле ${diff.code}: ${diff.before ? JSON.stringify(diff.before) : 'отсутствует'} → ${diff.after ? JSON.stringify(diff.after) : 'отсутствует'}`));
    const details = el('details'); details.append(el('summary', 'Посмотреть точные исходные фрагменты (приватно)'));
    for (const [side, label, available] of [['baseline', 'До', item.before], ['source', 'После', item.after]]) {
      if (!available) continue;
      const content = el('pre', '', 'release-preview');
      button(`Показать ${label}`, () => run(async () => { const value = await preview(release.id, item.path, side); content.textContent = value.text === null ? 'Бинарный файл: сверяйте SHA-256' : `${value.text}${value.truncated ? '\n[Показаны первые 256 КБ; сравнение учитывает весь файл]' : ''}`; }, false), details); details.append(content);
    }
    card.append(details);
    const decision = release.reviews[item.path];
    if (decision) card.append(el('p', `${decision.decision === 'accepted' ? 'Принято' : 'Отклонено'}: ${decision.reason}`, `release-decision${decision.decision === 'rejected' ? ' release-error' : ''}`));
    const form = el('form'), reason = field(form, `Причина решения — ${item.path}`, decision?.reason || '', 'textarea'); reason.required = true;
    const actions = el('div', undefined, 'actions');
    for (const [value, label] of [['accepted', 'Принять изменение'], ['rejected', 'Отклонить изменение']]) button(label, () => { if (reason.reportValidity()) run(() => change(release.id, { revision: release.revision, action: 'review', path: item.path, decision: value, reason: reason.value })); }, actions);
    form.onsubmit = event => event.preventDefault(); form.append(actions); card.append(form); changes.append(card);
  }
  root.append(changes);
  if (visibleChanges < release.changes.length) button('Показать следующие 20 изменений', () => { visibleChanges += 20; run(async () => release); }, changes);
  const details = el('section'); details.append(el('h2', 'Условия рецензии и передачи'));
  const form = el('form'), title = field(form, 'Название релиза', release.title), intent = field(form, 'Деловая цель', release.intent, 'textarea'), target = field(form, 'Назначение передачи (непроверенная компания или ответственный)', release.targetIntent), limits = field(form, 'Ограничения: неполное покрытие, отсутствие базы, неизвестное влияние', release.limitations, 'textarea'), notes = field(form, 'Примечания для оператора', release.notes, 'textarea');
  title.required = intent.required = target.required = true; title.maxLength = 160;
  button('Сохранить условия (снимает принятие кандидата)', () => { if (form.reportValidity()) run(() => change(release.id, { revision: release.revision, action: 'details', title: title.value, intent: intent.value, targetIntent: target.value, limitations: limits.value, notes: notes.value })); }, form);
  form.onsubmit = event => event.preventDefault(); details.append(form); root.append(details);
  const checks = el('section'); checks.append(el('h2', 'Проверки и доказательства')); const checkList = el('ul', undefined, 'release-checks');
  for (const check of release.checks) checkList.append(el('li', `${check.label}: ${checkLabels[check.result]}`)); checks.append(checkList, el('p', 'Принятие относится только к локальной рецензии и передаче. Оно не разрешает импорт и не доказывает совместимость, зависимости, успешное развёртывание или Verified.')); root.append(checks);
  if (release.candidate) root.append(el('p', `Неизменяемый кандидат ${release.candidate.id}: ${release.candidate.sha256}`, 'release-hash'));
  if (release.approval) root.append(el('p', `Принято владельцем ${release.approval.actor}: ${release.approval.reason}`));
  const actions = el('div', undefined, 'actions');
  const freeze = button('Подготовить неизменяемый кандидат', () => run(() => change(release.id, { revision: release.revision, action: 'freeze' })), actions); freeze.dataset.unavailable = String(release.blockers.length > 0); freeze.disabled = release.blockers.length > 0;
  const approval = el('form'), why = field(approval, 'Объяснение принятия кандидата', '', 'textarea'); why.required = true;
  const accept = button('Принять кандидат для передачи', () => { if (why.reportValidity()) run(() => change(release.id, { revision: release.revision, action: 'approve', reason: why.value })); }, approval); accept.dataset.unavailable = String(!release.candidate || release.blockers.length > 0); accept.disabled = accept.dataset.unavailable === 'true'; approval.onsubmit = event => event.preventDefault(); root.append(actions, approval);
  const handoff = button('Скачать приватный пакет передачи', () => run(async () => { await download(release.id, release.revision); return open(release.id); }), root); handoff.dataset.unavailable = String(!release.approval); handoff.disabled = !release.approval;
  const history = el('details'); history.append(el('summary', 'История решений'));
  for (const event of release.history) history.append(el('p', `${event.at} · ${event.actor} · ${eventLabels[event.action] || event.action} · ревизия ${event.revision}${event.reason ? ': ' + event.reason : ''}`)); root.append(history);
  button('Все релизы', () => open(null));
  return root;
}
