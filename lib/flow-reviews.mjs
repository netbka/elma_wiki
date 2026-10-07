import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { flowById } from '../web/flows/catalog.js';
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const text = (value, name, max = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name}: требуется текст до ${max} символов`);
  return value.trim();
};
const choice = (value, values, name) => { if (!values.includes(value)) fail(`Недопустимое значение: ${name}`); return value; };
export const reviewPhases = ['intent', 'rules', 'accessibility'];
export const reviewSeverities = ['blocker', 'must', 'should', 'nit'];
export function reviewSummary(events, flowId, revision) {
  const current = events.filter(event => event.flowId === flowId && event.revision === revision);
  const findings = current.filter(event => ['comment', 'reject'].includes(event.type)).map(event => {
    const resolution = current.filter(row => ['resolve', 'reopen'].includes(row.type) && row.parentId === event.id).at(-1);
    return { ...event, status: resolution?.type === 'resolve' ? 'resolved' : 'open', resolution: resolution?.type === 'resolve' ? resolution.text : '', replies: current.filter(row => row.type === 'reply' && row.parentId === event.id) };
  });
  const blocking = findings.filter(row => row.status === 'open' && (row.type === 'reject' || ['blocker', 'must'].includes(row.severity)));
  // Any new finding/reopen invalidates acceptance until a fresh explicit decision.
  const latest = current.filter(row => ['approve', 'comment', 'reject', 'reopen'].includes(row.type)).at(-1);
  const status = blocking.length ? 'rejected' : latest?.type === 'approve' ? 'approved' : 'pending';
  return { flowId, revision, status, blocking: blocking.length, findings, events: current, previousRevisions: [...new Set(events.filter(row => row.flowId === flowId && row.revision !== revision).map(row => row.revision))] };
}
// Local Storybook review store. No customer projects or uploaded archives enter it.
// Shared product review reuses these event rules with a trusted actor and summary.
export function createReviewEvent(events, input, { flow, revision, author = input.author, at,
  summary = reviewSummary(events, flow.id, revision) } = {}) {
  if (!revision || input.revision !== revision) fail('Версия рассмотрения изменилась. Обновите страницу.', 409);
  const type = choice(input.type, ['comment', 'reject', 'reply', 'resolve', 'reopen', 'approve'], 'действие');
  const message = text(input.text, 'Комментарий / причина');
  if (events.length >= 20000) fail('Архив рецензий достиг лимита; сохраните историю отдельно.', 409);
  const stepId = input.stepId || flow.initial;
  if (!flow.states.some(state => state.id === stepId)) fail('Шаг сценария не найден');
  const event = { id: crypto.randomUUID(), flowId: flow.id, revision, type,
    author: text(author, 'Имя рецензента', 254), text: message, stepId, createdAt: at };
  if (['comment', 'reject'].includes(type)) {
    event.severity = choice(input.severity, reviewSeverities, 'важность');
    event.phase = choice(input.phase, reviewPhases, 'этап рецензии');
    event.category = choice(input.category, ['behavior', 'data', 'rights', 'copy', 'accessibility', 'other'], 'категория');
  }
  if (['reply', 'resolve', 'reopen'].includes(type)) {
    const parent = summary.findings.find(row => row.id === input.parentId);
    if (!parent) fail('Замечание не найдено', 404);
    if (type === 'resolve' && parent.status === 'resolved') fail('Замечание уже закрыто', 409);
    if (type === 'reopen' && parent.status === 'open') fail('Замечание уже открыто', 409);
    event.parentId = parent.id;
  }
  if (type === 'approve' && summary.blocking) fail('Сначала устраните открытые замечания, требующие изменений.', 409);
  return event;
}

export function flowReviewStore(file, { revision, now = () => new Date().toISOString(), getFlow = flowById } = {}) {
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const read = async () => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  const getRevision = async () => typeof revision === 'function' ? revision() : revision;
  const validFlow = async flowId => { const flow = await getFlow(flowId); if (!flow) fail('Сценарий не найден', 404); return flow; };
  return {
    async get(flowId) { await validFlow(flowId); const current = await getRevision(); const events = await read(); return { ...reviewSummary(events, flowId, current), history: events.filter(row => row.flowId === flowId && row.revision !== current) }; },
    append(input) { return serial(async () => {
      const flow = await validFlow(input.flowId), current = await getRevision();
      const events = await read(), event = createReviewEvent(events, input, { flow, revision: current, at: now(),
        author: text(input.author, 'Имя рецензента', 120) });
      const next = [...events, event];
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      try { await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600 }); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      return reviewSummary(next, flow.id, current);
    }); }
  };
}
