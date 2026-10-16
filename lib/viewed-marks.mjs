import crypto from 'node:crypto';
import { actorIdentity } from './actors.mjs';

// UX-08: per-actor "Просмотрено" marks on review rows. A mark is personal
// reading progress, not a review decision: it never advances the Solution
// revision, enters review events or audit, gates acceptance or binds a
// candidate. Each mark binds the row digest the actor saw within one change
// lineage (a correction continues its change); when a later review of the same
// change shows that object with another digest, the mark reads as `changed`
// and stops counting until the actor marks the object again.
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
// Comparison evidence of a row, change and full-update rows alike. Display
// names and responsibility are presentation and stay out of the digest.
const ROW_FIELDS = ['classification', 'digest', 'baseDigest', 'baselineDigest', 'workingDigest', 'incomingDigest', 'removed', 'conflict', 'explicitDeletion'];
export const MAX_VIEWED_MARKS = 20000;
export const viewedRowDigest = row => hash(JSON.stringify([row.key, ...ROW_FIELDS.map(field => row[field] ?? null)]));
const lineage = pending => pending.changeId || pending.artifact.id;

export function viewedMarks(record, pending, rows, performedBy) {
  const identity = actorIdentity(performedBy), flowId = lineage(pending);
  const marks = new Map((record.viewedMarks || []).filter(mark => mark.actor.id === identity.id && mark.flowId === flowId).map(mark => [mark.key, mark]));
  return { actor: identity, rows: rows.map(row => {
    const digest = viewedRowDigest(row), mark = marks.get(row.key);
    return { key: row.key, digest, status: !mark ? 'unviewed' : mark.digest === digest ? 'viewed' : 'changed', at: mark?.at ?? null };
  }) };
}

// Returns true when the stored marks changed. The caller states the digest it
// displayed, so a page older than the review cannot mark newer content.
export function setViewedMark(record, pending, rows, input, performedBy) {
  const identity = actorIdentity(performedBy);
  if (typeof input.key !== 'string' || typeof input.digest !== 'string' || typeof input.viewed !== 'boolean') fail('State the object, its digest and the mark explicitly');
  const matches = rows.filter(row => row.key === input.key);
  if (matches.length !== 1) fail('Object is absent or ambiguous in this review', 409);
  if (viewedRowDigest(matches[0]) !== input.digest) fail('The object changed; refresh the review before marking it', 409);
  const flowId = lineage(pending), marks = record.viewedMarks ??= [];
  const index = marks.findIndex(mark => mark.actor.id === identity.id && mark.flowId === flowId && mark.key === input.key);
  if (!input.viewed) { if (index < 0) return false; marks.splice(index, 1); return true; }
  if (index >= 0 && marks[index].digest === input.digest) return false;
  if (index < 0 && marks.length >= MAX_VIEWED_MARKS) fail('Maximum viewed marks reached for this Solution', 422);
  const mark = { actor: identity, flowId, key: input.key, digest: input.digest, artifactId: pending.artifact.id, at: new Date().toISOString() };
  if (index >= 0) marks[index] = mark; else marks.push(mark);
  return true;
}
