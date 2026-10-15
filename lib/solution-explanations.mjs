import crypto from 'node:crypto';
import { snapshotVisual } from './solution-visual.mjs';
import { relatedForm, scenarioFields } from '../web/visual/model.js';
import { aboutContext, ABOUT_SCOPES } from './solution-about.mjs';

export const EXPLANATION_ENGINE = 'declared-source-v1';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const unknown = 'Условия переходов, назначение участников, права, выполнение скриптов и результаты интеграций не установлены. Работа в ELMA не наблюдалась.';
const typeNames = { start: 'начало', end: 'конец', user: 'задача', assignment: 'назначение', gateway: 'развилка', script: 'скрипт', notification: 'уведомление', app_update: 'изменение приложения', status: 'статус', call: 'вызов', ca: 'действие' };

// Names support a reading guide, not proof of purpose, execution order or status.
export function solutionReadingGuide(title, processes, objectCount, limited = 0) {
  const marked = [], ordinary = [];
  for (const process of processes) {
    (/^(?:OLD(?:_|\b)|TEST(?:_|\b)|AGENT(?:_|\b))/.test(process.name) ? marked : ordinary).push(process);
  }
  const themes = [
    ['Договоры и документы', /договор|документ|диадок/i],
    ['Клиенты и партнёры', /контрагент|клиент|партн[её]р/i],
    ['Согласование', /согласован|маршрут/i],
    ['Доступ и пользователи', /пользоват|(?<![а-яё])рол[ьи]|доступ/i],
    ['Другие процессы', /./]
  ];
  const sections = [
    `О решении «${title}»`,
    'Ниже — ориентир по названиям процессов в сохранённом экспорте. Он помогает выбрать, что изучать; назначение решения и реальная работа процессов ещё не подтверждены человеком.',
  ];
  // Past the process bound nothing was projected: the task list and the diagram
  // instructions are replaced by what the reader can actually do.
  const nothingProjected = limited > 0 && !processes.length;
  if (!nothingProjected) sections.push('Какие задачи отражены в экспорте');
  const groups = new Map();
  for (const process of ordinary) {
    const label = themes.find(([, pattern]) => pattern.test(process.name))?.[0] || 'Другие процессы';
    const names = groups.get(label) || []; names.push(process.name); groups.set(label, names);
  }
  for (const [label] of themes) if (groups.has(label)) {
    const names = [...new Set(groups.get(label))];
    sections.push(`${label}\n${names.map(name => '• ' + name).join('\n')}`);
  }
  // Past the process bound nothing was projected: the guide says so instead of reporting an absence.
  if (!ordinary.length && !limited) sections.push('Обычные рабочие процессы по этому экспорту не установлены. Попросите ответственного описать назначение решения.');
  sections.push('Как начать разбор',
    nothingProjected ? 'Схемы этого файла не построены: в нём больше 50 процессов. Разделите экспорт на файлы до 50 процессов или изучайте процессы по названиям на вкладке «Как работает».' :
    'На вкладке «Как работает» нажмите «Посмотреть процесс» в строке нужного процесса. На схеме выберите шаг, чтобы разобрать его действия, связанную форму и исходные данные. Порядок списка выше не является порядком выполнения.',
    'На странице рассмотрения версии оставляйте вопросы в разделе «Комментарии и замечания». Укажите, к какому объекту относится вопрос.');
  if (marked.length) sections.push('Отдельно: названия с пометками OLD / TEST / AGENT',
    'Не смешиваем их с основным обзором. Пометка в названии не доказывает, что процесс выключен или не используется.\n' + marked.map(p => '• ' + p.name).join('\n'));
  sections.push('Что описывает этот обзор',
    `Текущее принятое состояние: ${objectCount} объектов, ${limited ? `процессов: ${processes.length + limited}, из них без схемы: ${limited}` : `${processes.length} процессов`}. Ожидающие рассмотрения версии не включены; они доступны во вкладке «Изменения».`);
  return sections;
}

export function processReadingGuide(process) {
  const sections=[`Процесс «${process.name}»`,
    'Это описание схемы из экспорта. Оно показывает, какие задачи и действия объявлены; условия запуска, исполнителей и фактический результат нужно подтвердить отдельно.'];
  const shorten=value=>value.length>140?value.slice(0,139)+'…':value;
  const list=(title,rows,describe=row=>shorten(row.name))=>{
    if(!rows.length)return;
    sections.push(title, rows.slice(0,8).map(row=>'• '+describe(row)).join('\n')+
      (rows.length>8?`\nПоказано 8 из ${rows.length}. Остальные элементы доступны на схеме и в источниках.`:''));
  };
  list('Начало и завершение',process.nodes.filter(node=>['start','end'].includes(node.type)),node=>`${node.type==='start'?'Начало':'Завершение'}: ${shorten(node.name)}`);
  list('Задачи участников',process.nodes.filter(node=>['user','assignment'].includes(node.type)));
  const decisions=process.nodes.filter(node=>node.type==='gateway'||process.edges.filter(edge=>edge.source===node.id).length>1);
  list('Решения и развилки',decisions,node=>{
    const outgoing=process.edges.filter(edge=>edge.source===node.id);
    return `${shorten(node.name)}: путей продолжения — ${outgoing.length}. Откройте шаг и проверьте правила продолжения.`;
  });
  list('Автоматические действия по схеме',process.nodes.filter(node=>['script','notification','app_update','status','call','ca'].includes(node.type)),node=>`${shorten(node.name)} (${typeNames[node.type]})`);
  list('Переходы с названиями',process.edges.filter(edge=>edge.name),edge=>{
    const targets=process.nodes.filter(node=>node.id===edge.target);
    return `${shorten(edge.name)} → ${targets.length===1?shorten(targets[0].name):'неизвестный или неоднозначный шаг'}${edge.supported?'':' (связь не поддерживается)'}`;
  });
  if(!process.nodes.length)sections.push('В поддерживаемой части экспорта шаги не найдены. По этому описанию нельзя определить, что делает процесс.');
  sections.push('Как начать разбор',
    'Выберите на схеме задачу или развилку, которую хотите понять. Объяснение выбранного шага покажет его переходы и связанную форму. Список выше сгруппирован по типам действий и не задаёт маршрут выполнения.',
    'Техническая справка',`Шагов: ${process.nodes.length}. Переходов: ${process.edges.length}. Полные названия и ссылки на исходные данные доступны в источниках объяснения.`);
  return sections;
}

// Only immutable, checksum-checked captured bytes enter this function. Source
// strings are archive references; they are never host paths or executable URLs.
export async function explanationContext(record, target, readBytes) {
  // UX-05: purpose and module descriptions are generated from declared names only.
  if (ABOUT_SCOPES.includes(target.scope)) return aboutContext(record, target);
  if (target.module !== undefined) fail('Модуль указывается только для описания модуля');
  if (!['solution', 'process', 'step'].includes(target.scope)) fail('Выберите решение, процесс или шаг');
  const state = record.state, sources = [], paragraphs = [], all = [...state.artifacts, ...record.pending.map(row => row.artifact)];
  let key, fingerprint, title, related = [], writable = state.status === 'active', reason = writable ? null : 'Решение в архиве. Объяснение доступно для чтения.';
  if (target.scope === 'solution') {
    if (target.artifactId !== undefined || target.source !== undefined || target.nodeId !== undefined) fail('Обзор решения относится к принятому состоянию');
    key = 'solution'; title = state.name;
    fingerprint = hash(state.current.map(row => [row.key, row.digest]).sort((a,b) => a[0].localeCompare(b[0])));
    const groups = new Map();
    for (const component of state.current) {
      const matches = state.artifacts.filter(artifact => artifact.components.some(row => row.key === component.key && row.digest === component.digest));
      const artifact = matches.at(-1);
      if (!artifact) fail('Источник принятого объекта не установлен', 409);
      const rows = groups.get(artifact.id) || []; rows.push(component); groups.set(artifact.id, rows);
    }
    const counts = new Map();
    state.current.forEach(row => counts.set(row.service, (counts.get(row.service) || 0) + 1));
    let processCount = 0, limited = 0;
    const currentProcesses = new Map();
    for (const [id, components] of groups) {
      const artifact = state.artifacts.find(row => row.id === id), bytes = await readBytes(artifact);
      for (const component of components) for (const evidence of component.evidence) {
        if (evidence.role === 'entity') sources.push({ label: component.code, artifactId: id, pointer: evidence.source, componentKey: component.key });
      }
      if (components.some(row => row.service === 'processor')) {
        try {
          const visual = await snapshotVisual(bytes, id);
          // Only the current processes that come from this file are unshown; the file may hold more.
          if (visual.processLimit) limited += components.filter(row => row.service === 'processor').length;
          for (const process of visual.processes.filter(p => components.some(row => row.key === JSON.stringify(p.object)))) {
            currentProcesses.set(JSON.stringify(process.object),process);
            processCount++;
          }
        } catch { paragraphs.push('Часть процессов не удалось восстановить в пределах поддерживаемого формата. Их исходные файлы сохранены.'); }
      }
    }
    paragraphs.unshift(...solutionReadingGuide(title, [...currentProcesses.values()], state.current.length, limited));
    if (limited) paragraphs.push(`Не показаны: ${limited} процессов сверх предела обзора (не более 50 в одном файле). Их исходные файлы сохранены; схемы и объяснения процессов этого файла недоступны, пока он не разделён.`);
    if (!processCount && !limited) paragraphs.push('Поддерживаемые процессы не установлены. Назначение решения и связи между объектами требуют пояснения человека.');
    const incomplete = [...currentProcesses.values()].filter(p => p.issues.length).length;
    if (incomplete) paragraphs.push(`Для ${incomplete} процессов часть элементов не удалось однозначно восстановить. Смотрите ограничения в просмотре выбранного процесса; исходные файлы сохранены.`);
    paragraphs.push('Техническая справка', 'Состав по типам исходных данных: ' +
      ([...counts].map(([service,count]) => `${service}: ${count}`).join('; ') || 'объектов нет') + '.');
    const latest = new Map();
    for (const entry of record.explanations || []) if (entry.key !== 'solution' && !ABOUT_SCOPES.includes(entry.target?.scope)) latest.set(entry.key,entry);
    related = [...latest.values()].map(entry => {
      const [scope, object, nodeId] = JSON.parse(entry.key), componentKey = JSON.stringify(object);
      const component = state.current.find(row => row.key === componentKey), process = currentProcesses.get(componentKey);
      let sourceStatus = !component ? 'removed' : component.digest === entry.fingerprint ? 'current' : 'stale';
      if (component && scope === 'step' && process) {
        const nodes = process.nodes.filter(node => node.id === nodeId);
        if (!nodes.length) sourceStatus = 'removed';
        else if (nodes.length !== 1 || !nodes[0].anchorIdentityKnown) sourceStatus = 'ambiguous';
      }
      return { ...entry, sourceStatus, sources: entry.sources.map(source => ({ ...source, componentKey })) };
    });
  } else {
    if (typeof target.artifactId !== 'string' || typeof target.source !== 'string' || target.source.length > 1024 ||
        (target.scope === 'step' ? typeof target.nodeId !== 'string' || !target.nodeId || target.nodeId.length > 512 : target.nodeId !== undefined)) fail('Выберите конкретный процесс или шаг');
    const artifact = all.find(row => row.id === target.artifactId);
    if (!artifact) fail('Исходный файл не найден', 404);
    const visual = await snapshotVisual(await readBytes(artifact), artifact.id);
    if (visual.processLimit) fail(`Для обзора выберите меньший пакет: не более 50 процессов в одном файле (здесь ${visual.processLimit})`, 422);
    const matches = visual.processes.filter(row => row.source === target.source);
    if (matches.length !== 1) fail('Процесс не найден или неоднозначен', 422);
    const process = matches[0], componentKey = JSON.stringify(process.object);
    if (visual.processes.filter(row => JSON.stringify(row.object) === componentKey).length !== 1) fail('Идентичность процесса неоднозначна', 422);
    const component = artifact.components.find(row => row.key === componentKey);
    if (!component) fail('Идентичность процесса не установлена', 422);
    key = JSON.stringify([target.scope, process.object, target.nodeId ?? null]);
    // Conservative dependency coverage: the whole component includes forms,
    // transition settings, scripts, manifest metadata and declared resources.
    fingerprint = component.digest;
    const pending = record.pending.find(row => row.artifact.id === artifact.id);
    const current = state.current.find(row => row.key === componentKey);
    if (pending ? pending.supersededBy || pending.revision !== state.revision : current?.digest !== component.digest) {
      writable = false; reason = 'Это прежняя версия источника. Откройте актуальный процесс перед сохранением.';
    }
    const nodes = target.scope === 'step' ? process.nodes.filter(row => row.id === target.nodeId) : process.nodes;
    if (target.scope === 'step' && (nodes.length !== 1 || !nodes[0].anchorIdentityKnown)) fail('Идентичность шага не установлена или неоднозначна', 422);
    title = target.scope === 'step' ? `${process.name} → ${nodes[0].name}` : process.name;
    if(target.scope==='step')paragraphs.push(`Шаг «${nodes[0].name}» относится к процессу «${process.name}».`);
    else paragraphs.push(...processReadingGuide(process));
    for (const node of nodes) {
      const outgoing = process.edges.filter(edge => edge.source === node.id);
      const relation = target.scope === 'step' ? relatedForm(process, node.id) : null;
      const fields = target.scope === 'step' ? scenarioFields(process,node.id) : null;
      if(target.scope==='step')paragraphs.push(`«${node.name}» — ${typeNames[node.type] || 'неподдерживаемый тип шага'}. ` +
        (outgoing.length ? 'Объявленные переходы: ' + outgoing.map(edge => {
          const targets = process.nodes.filter(n => n.id === edge.target);
          return `${edge.name || 'без названия'} → ${targets.length === 1 ? targets[0].name : 'неизвестный или неоднозначный шаг'}${edge.supported ? '' : ' (связь не поддерживается)'}`;
        }).join('; ') + '.' : 'Исходящих переходов в этом экспорте нет.') +
        (relation.form ? ` Связана форма «${relation.form.name}».` : ' Связь с формой не установлена или неоднозначна.') +
        (fields.fields.length ? ' Поля: ' + fields.fields.map(f => `${f.name || f.code || 'без названия'}${f.required ? ' (обязательное по экспорту)' : ''}`).join(', ') + '.' : '') +
        (!node.supported || fields.unknown ? ' Часть представления или привязок не поддерживается.' : ''));
      sources.push({ label: node.name, artifactId: artifact.id, pointer: node.pointer, nodeId: node.id, source: process.source });
      outgoing.forEach(edge => sources.push({ label: edge.name || 'Переход', artifactId: artifact.id, pointer: edge.pointer, nodeId: node.id, source: process.source }));
      // The overview describes nodes/transitions. Form/field details belong to
      // the selected step, avoiding repeated field inventories on large graphs.
      if (target.scope === 'step') {
        if (relation.form) sources.push({ label: relation.form.name, artifactId: artifact.id, pointer: relation.form.tree.pointer, nodeId: node.id, source: process.source });
        fields.fields.forEach(f => sources.push({ label: f.name || f.code || 'Поле', artifactId: artifact.id, pointer: f.pointer, nodeId: node.id, source: process.source }));
      }
    }
    if (process.issues.length) paragraphs.push(`Ограничения восстановления: ${process.issues.length}. Неподдерживаемые элементы остаются в исходном файле.`);
  }
  const text = [...paragraphs, 'Что ещё проверить', unknown].join('\n\n');
  if (text.length > 16000 || sources.length > 500) fail('Для объяснения выберите отдельный процесс или шаг: превышен предел обзора', 422);
  return { key, fingerprint, title, related, target: structuredClone(target), expectedRevision: state.revision,
    writable, reason, draft: { text, sources, engine: EXPLANATION_ENGINE, evidence: 'declared-source', nativeObservation: 'absent' } };
}

export function explanationView(context, entries = []) {
  const history = entries.filter(entry => entry.key === context.key);
  const saved = history.at(-1) || null;
  return { ...context, version: history.length, saved: saved ? { ...saved, sourceStatus: saved.fingerprint === context.fingerprint ? 'current' : 'stale' } : null,
    history: history.slice(-20).reverse() };
}
