import crypto from 'node:crypto';
import { actorIdentity } from './actors.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
export const requestFields = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('Invalid change request');
  return structuredClone(input);
};
const text = (value, max, optional = false) => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || !optional && !value.trim()) fail('Invalid change request text');
  return value.trim();
};
const hash = input => crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
// Every Solution keeps its requests inside its own workspace.json: the per-request
// and per-event caps bound the count, this bounds the bytes they may occupy.
export const REQUEST_STORAGE_LIMIT = 4 * 1024 * 1024;
export function assertRequestBudget(record, extra) {
  if (JSON.stringify(record.changeRequests || []).length + JSON.stringify(extra).length > REQUEST_STORAGE_LIMIT) fail('Хранилище запросов этого решения заполнено', 422);
}
// The published text names the kind and urgency in the product vocabulary; the
// server composes it from the stored request, never from caller text.
const kindWords = { screen: 'Экран', process: 'Процесс', data: 'Данные' }, urgencyWords = { normal: 'Обычная', urgent: 'Срочная' };
export const publicationText = row => [row.text, row.reason && `Зачем: ${row.reason}`, `Что изменить: ${kindWords[row.kind]} · Срочность: ${urgencyWords[row.urgency]}`].filter(Boolean).join('\n\n');
export function requestById(record, id) {
  if (!uuid.test(id || '')) fail('Change request not found', 404);
  const found = record.changeRequests?.find(row => row.id === id);
  if (!found) fail('Change request not found', 404);
  return found;
}
export function requestInput(input) {
  const value = requestFields(input, ['id', 'expectedRevision', 'kind', 'title', 'text', 'reason', 'urgency', 'target']);
  if (!uuid.test(value.id || '') || !['screen', 'process', 'data'].includes(value.kind) || !['normal', 'urgent'].includes(value.urgency)) fail('Invalid change request');
  value.title = text(value.title, 160); value.text = text(value.text, 8000); value.reason = text(value.reason, 2000, true);
  requestFields(value.target, ['artifactId', 'componentKey', 'sourceAnchor']);
  if (!uuid.test(value.target.artifactId || '') || value.target.componentKey !== undefined &&
      (typeof value.target.componentKey !== 'string' || !value.target.componentKey || value.target.componentKey.length > 2048)) fail('Invalid change request target');
  if (value.target.sourceAnchor && !value.target.componentKey) fail('A step requires its captured object');
  return value;
}
export function previousRequest(record, input, user) {
  const actor = actorIdentity(user), existing = record.changeRequests?.find(row => row.id === input.id);
  if (existing && (existing.actor.id !== actor.id || existing.inputHash !== hash(input))) fail('Change request ID already used', 409);
  return existing;
}
// Targets are resolved from captured components and sourceAnchorIndex by the
// managed store. Caller-supplied labels/digests never become trusted anchors.
export function createChangeRequest(record, input, target, user) {
  if ((record.changeRequests?.length || 0) >= 500) fail('Maximum 500 change requests per Solution', 422);
  const actor = actorIdentity(user), at = new Date().toISOString();
  const row = { id: input.id, kind: input.kind, title: input.title, text: input.text, reason: input.reason,
    urgency: input.urgency, target, actor, createdAt: at, updatedAt: at, version: 0, status: 'new', fulfilledArtifactId: null,
    inputHash: hash(input), events: [] };
  assertRequestBudget(record, row);
  record.changeRequests ??= []; record.changeRequests.push(row);
  return row;
}
export function changeRequestView(record, row) {
  const { inputHash, ...safe } = row;
  let anchorStatus = 'current';
  // A target inside a version still under review is compared with nothing yet: the
  // accepted state cannot make it stale or removed before the version is accepted.
  if (!record.state.artifacts.some(artifact => artifact.id === row.target.artifactId) && (record.pending || []).some(item => item.artifact.id === row.target.artifactId && !item.supersededBy)) anchorStatus = 'pending';
  else if (row.target.anchor) {
    const key = row.target.anchor.key, matches = record.state.current.filter(component => component.key === key);
    if (matches.length > 1 || record.state.ambiguities?.some(item => item.key === key)) anchorStatus = 'ambiguous';
    else if (!matches.length) anchorStatus = 'removed';
    else if (matches[0].digest !== row.target.anchor.digest) anchorStatus = 'stale';
  } else if (record.state.revision !== row.target.revision) anchorStatus = 'stale';
  return structuredClone({ ...safe, events: row.events.map(({ inputHash, ...event }) => event), anchorStatus });
}
export function appendRequestEvent(record, id, input, user) {
  const value = requestFields(input, ['operationId', 'expectedVersion', 'type', 'text', 'status', 'fulfilledArtifactId']);
  const actor = actorIdentity(user), row = requestById(record, id);
  if (!uuid.test(value.operationId || '') || !['comment', 'status'].includes(value.type)) fail('Invalid change request event');
  const fingerprint = hash(value), previous = row.events.find(event => event.id === value.operationId);
  if (previous) {
    if (previous.inputHash !== fingerprint || previous.actor.id !== actor.id) fail('Change request operation ID already used', 409);
    return row;
  }
  if (record.state.status !== 'active') fail('Reopen the Solution before changing requests', 409);
  if (!Number.isSafeInteger(value.expectedVersion) || row.version !== value.expectedVersion) fail('Change request changed; refresh before editing', 409);
  if (row.events.length >= 200) fail('Maximum 200 events per change request', 422);
  const message = text(value.text, 4000, value.type === 'status');
  if (value.type === 'comment' && (value.status !== undefined || value.fulfilledArtifactId !== undefined)) fail('A comment cannot change status');
  if (value.type === 'status') {
    if (!['new', 'in-progress', 'done', 'rejected'].includes(value.status)) fail('Invalid change request status');
    if (value.status === 'done') {
      if (!record.state.artifacts.some(artifact => artifact.id === value.fulfilledArtifactId)) fail('Select an accepted version in this Solution', 409);
    } else if (value.fulfilledArtifactId !== undefined && value.fulfilledArtifactId !== null) fail('Only completed requests link a fulfilling version');
  }
  const at = new Date().toISOString();
  const event = { id: value.operationId, type: value.type, text: message, actor, at,
    ...(value.type === 'status' ? { status: value.status, fulfilledArtifactId: value.status === 'done' ? value.fulfilledArtifactId : null } : {}), inputHash: fingerprint };
  assertRequestBudget(record, event);
  if (value.type === 'status') { row.status = value.status; row.fulfilledArtifactId = event.fulfilledArtifactId; }
  row.updatedAt = at; row.version++;
  row.events.push(event);
  return row;
}
