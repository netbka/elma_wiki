import crypto from 'node:crypto';
import { snapshotVisual } from './solution-visual.mjs';
import { relatedForm, scenarioFields } from '../web/visual/model.js';

export const EXPLANATION_ENGINE = 'declared-source-v1';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const unknown = 'Условия переходов, назначение участников, права, выполнение скриптов и результаты интеграций не установлены. Работа в ELMA не наблюдалась.';
const typeNames = { start: 'начало', end: 'конец', user: 'задача', assignment: 'назначение', gateway: 'развилка', script: 'скрипт', notification: 'уведомление', app_update: 'изменение приложения', status: 'статус', call: 'вызов', ca: 'действие' };

// Only immutable, checksum-checked captured bytes enter this function. Source
// strings are archive references; they are never host paths or executable URLs.
export async function explanationContext(record, target, readBytes) {
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
    paragraphs.push(`Принятое решение «${title}» содержит ${state.current.length} объектов. Ожидающие рассмотрения изменения в этот обзор не входят.`);
    const counts = new Map();
    state.current.forEach(row => counts.set(row.service, (counts.get(row.service) || 0) + 1));
    paragraphs.push('Состав: ' + ([...counts].map(([service,count]) => `${service}: ${count}`).join('; ') || 'объектов нет') + '.');
    let processCount = 0;
    const currentProcesses = new Map();
    for (const [id, components] of groups) {
      const artifact = state.artifacts.find(row => row.id === id), bytes = await readBytes(artifact);
      for (const component of components) for (const evidence of component.evidence) {
        if (evidence.role === 'entity') sources.push({ label: component.code, artifactId: id, pointer: evidence.source, componentKey: component.key });
      }
      if (components.some(row => row.service === 'processor')) {
        try {
          const visual = await snapshotVisual(bytes, id);
          for (const process of visual.processes.filter(p => components.some(row => row.key === JSON.stringify(p.object)))) {
            currentProcesses.set(JSON.stringify(process.object),process);
            processCount++; paragraphs.push(`Процесс «${process.name}»: ${process.nodes.length} шагов, ${process.edges.length} объявленных переходов. ` +
              (process.issues.length ? 'Есть неподдерживаемые или неоднозначные элементы.' : 'Связи взяты из экспорта; возможность их выполнения не проверена.'));
          }
        } catch { paragraphs.push('Часть процессов не удалось восстановить в пределах поддерживаемого формата. Их исходные файлы сохранены.'); }
      }
    }
    if (!processCount) paragraphs.push('Поддерживаемые процессы не установлены. Назначение решения и связи между объектами требуют пояснения человека.');
    const latest = new Map();
    for (const entry of record.explanations || []) if (entry.key !== 'solution') latest.set(entry.key,entry);
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
    paragraphs.push(target.scope === 'step' ? `Шаг «${nodes[0].name}» относится к процессу «${process.name}».` :
      `Процесс «${process.name}» содержит ${nodes.length} шагов и ${process.edges.length} объявленных переходов. Порядок ниже — перечень элементов, а не доказанный путь выполнения.`);
    for (const node of nodes) {
      const outgoing = process.edges.filter(edge => edge.source === node.id), relation = relatedForm(process, node.id), fields = scenarioFields(process,node.id);
      paragraphs.push(`«${node.name}» — ${typeNames[node.type] || 'неподдерживаемый тип шага'}. ` +
        (outgoing.length ? 'Объявленные переходы: ' + outgoing.map(edge => {
          const targets = process.nodes.filter(n => n.id === edge.target);
          return `${edge.name || 'без названия'} → ${targets.length === 1 ? targets[0].name : 'неизвестный или неоднозначный шаг'}${edge.supported ? '' : ' (связь не поддерживается)'}`;
        }).join('; ') + '.' : 'Исходящих переходов в этом экспорте нет.') +
        (relation.form ? ` Связана форма «${relation.form.name}».` : ' Связь с формой не установлена или неоднозначна.') +
        (fields.fields.length ? ' Поля: ' + fields.fields.map(f => `${f.name || f.code || 'без названия'}${f.required ? ' (обязательное по экспорту)' : ''}`).join(', ') + '.' : '') +
        (!node.supported || fields.unknown ? ' Часть представления или привязок не поддерживается.' : ''));
      sources.push({ label: node.name, artifactId: artifact.id, pointer: node.pointer, nodeId: node.id, source: process.source });
      outgoing.forEach(edge => sources.push({ label: edge.name || 'Переход', artifactId: artifact.id, pointer: edge.pointer, nodeId: node.id, source: process.source }));
      if (relation.form) sources.push({ label: relation.form.name, artifactId: artifact.id, pointer: relation.form.tree.pointer, nodeId: node.id, source: process.source });
      fields.fields.forEach(f => sources.push({ label: f.name || f.code || 'Поле', artifactId: artifact.id, pointer: f.pointer, nodeId: node.id, source: process.source }));
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
