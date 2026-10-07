import { createReviewEvent } from './flow-reviews.mjs';
import { actorIdentity } from './actors.mjs';

const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const changeId = pending => pending.changeId || pending.artifact.id;
function anchorStatus(event, pending) {
  const { anchor, sourceAnchor } = event, { artifact } = pending;
  if (!anchor?.key) return 'current';
  if (artifact.ambiguities.some(row => row.key === anchor.key) || artifact.ambiguities.length && !artifact.components.some(row => row.key === anchor.key)) return 'ambiguous';
  const component = artifact.components.find(row => row.key === anchor.key);
  if (!component) return artifact.scope === 'full' ? 'removed' : 'stale';
  if (sourceAnchor) {
    if (!pending.sourceAnchors?.available) return 'ambiguous';
    const nodes = pending.sourceAnchors.nodes.filter(node => JSON.stringify(node.object) === anchor.key && node.nodeId === sourceAnchor.nodeId);
    if (nodes.length > 1 || nodes.length === 1 && !nodes[0].supported) return 'ambiguous';
    if (!nodes.length) return 'removed';
    return nodes[0].fingerprint === sourceAnchor.fingerprint ? 'current' : 'stale';
  }
  return component.digest === anchor.digest ? 'current' : 'stale';
}
export function changeDiscussion(record, pending) {
  const events = (record.reviewEvents || []).filter(row => row.flowId === changeId(pending));
  const findings = events.filter(row => ['comment', 'reject'].includes(row.type)).map(event => {
    const resolution = events.filter(row => ['resolve', 'reopen'].includes(row.type) && row.parentId === event.id).at(-1);
    return { ...event, anchorStatus: anchorStatus(event, pending),
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
  let sourceAnchor = parent?.sourceAnchor;
  if (input.sourceAnchor && !parent) {
    const selected = input.sourceAnchor;
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)
      || Object.keys(selected).sort().join() !== ['artifactId','checksum','fingerprint','nodeId','object','pointer'].sort().join()) fail('Некорректная ссылка на шаг');
    const matches = pending.sourceAnchors?.nodes.filter(node => ['artifactId','checksum','fingerprint','nodeId','pointer'].every(field => node[field] === selected[field])
      && JSON.stringify(node.object) === JSON.stringify(selected.object) && JSON.stringify(node.object) === key) || [];
    if (matches.length !== 1) fail('Исходная ссылка на шаг изменилась или неоднозначна. Обновите рассмотрение.', 409);
    const { supported, ...trusted } = matches[0]; sourceAnchor = trusted;
  }
  const flow = { id: changeId(pending), initial: 'change', states: [{ id: key }] };
  const event = createReviewEvent(record.reviewEvents || [], { ...input, revision: pending.review.artifactDigest, stepId: key,
    severity: input.type === 'reject' ? 'must' : 'should', phase: 'rules', category: 'behavior' },
  { flow, revision: pending.review.artifactDigest, author: actor.login, at: record.updatedAt, summary });
  event.actor = actor; event.artifactId = pending.artifact.id;
  event.anchor = parent?.anchor || (component ? { key, digest: component.digest } : null);
  if (sourceAnchor) event.sourceAnchor = sourceAnchor;
  record.reviewEvents ??= []; record.reviewEvents.push(event);
  return changeDiscussion(record, pending);
}
