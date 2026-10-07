import { createReviewEvent } from './flow-reviews.mjs';
import { actorIdentity } from './actors.mjs';

const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const changeId = pending => pending.changeId || pending.artifact.id;
function anchorStatus(anchor, artifact) {
  if (!anchor?.key) return 'current';
  if (artifact.ambiguities.some(row => row.key === anchor.key) || artifact.ambiguities.length && !artifact.components.some(row => row.key === anchor.key)) return 'ambiguous';
  const component = artifact.components.find(row => row.key === anchor.key);
  if (!component) return artifact.scope === 'full' ? 'removed' : 'stale';
  return component.digest === anchor.digest ? 'current' : 'stale';
}
export function changeDiscussion(record, pending) {
  const events = (record.reviewEvents || []).filter(row => row.flowId === changeId(pending));
  const findings = events.filter(row => ['comment', 'reject'].includes(row.type)).map(event => {
    const resolution = events.filter(row => ['resolve', 'reopen'].includes(row.type) && row.parentId === event.id).at(-1);
    return { ...event, anchorStatus: anchorStatus(event.anchor, pending.artifact),
      status: resolution?.type === 'resolve' ? 'resolved' : 'open', resolution: resolution || null,
      replies: events.filter(row => row.type === 'reply' && row.parentId === event.id) };
  });
  return { changeId: changeId(pending), version: events.length, findings, events,
    blocking: findings.filter(row => row.type === 'reject' && row.status === 'open').length };
}
export function appendChangeReview(record, pending, input, user, { acceptance = false } = {}) {
  const actor = actorIdentity(user), summary = changeDiscussion(record, pending);
  if (!Number.isInteger(input.expectedDiscussionRevision) || input.expectedDiscussionRevision !== summary.version)
    fail('Обсуждение изменилось. Обновите рассмотрение перед решением.', 409);
  if (!acceptance && !['comment', 'reject', 'reply', 'resolve', 'reopen'].includes(input.type)) fail('Недопустимое действие рассмотрения');
  const parent = input.parentId ? summary.findings.find(row => row.id === input.parentId) : null;
  if (input.parentId && !parent) fail('Замечание не найдено', 404);
  const key = parent?.anchor?.key || input.componentKey || 'change';
  const component = pending.artifact.components.find(row => row.key === key);
  if (key !== 'change' && !component && !parent) fail('Объект рассмотрения не найден', 404);
  const flow = { id: changeId(pending), initial: 'change', states: [{ id: key }] };
  const event = createReviewEvent(record.reviewEvents || [], { ...input, revision: pending.review.artifactDigest, stepId: key,
    severity: input.type === 'reject' ? 'must' : 'should', phase: 'rules', category: 'behavior' },
  { flow, revision: pending.review.artifactDigest, author: actor.login, at: record.updatedAt, summary });
  event.actor = actor; event.artifactId = pending.artifact.id;
  event.anchor = parent?.anchor || (component ? { key, digest: component.digest } : null);
  record.reviewEvents ??= []; record.reviewEvents.push(event);
  return changeDiscussion(record, pending);
}
