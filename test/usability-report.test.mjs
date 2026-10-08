import test from 'node:test';
import assert from 'node:assert/strict';
import { usabilityReport } from '../tools/usability-report.mjs';

const completed = () => {
  const source = { revision: 'a'.repeat(40), dirty: false };
  const session = { synthetic: true, source, startedAt: '2026-10-08T12:00:00.000Z', participants: [{ login: 'PRIVATE_SIGNED_LINK' }] };
  const observations = { synthetic: true, source: { ...source }, sessionStartedAt: session.startedAt,
    participants: ['elma-familiar', 'new-to-repository'].map(role => ({ role, performed: true, coachingGiven: false,
      outcome: 'pass', tasks: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1),
        { outcome: 'pass', coachingGiven: false, actions: 'PRIVATE_OBSERVER_WORDS' }])),
      hesitation: [], wrongClicks: [], misunderstoodLabels: [], materialFindings: [] })),
    independentVisualReview: { performed: true, independent: true, outcome: 'pass', sourceRevision: source.revision, materialFindings: [] },
    ownerDecision: { outcome: 'accepted' } };
  return { session, observations };
};

test('observer declarations prepare owner review without inventing acceptance or exposing private notes', () => {
  const { session, observations } = completed(), before = JSON.stringify(observations);
  const report = usabilityReport(session, observations);
  assert.equal(report.status, 'ready-for-owner-walkthrough');
  assert.equal(report.productAccepted, false); assert.equal(report.deploymentAuthorized, false);
  assert.equal(report.nativeElmaObserved, false);
  assert.ok(report.participants.every(row => row.status === 'reported-pass'));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  assert.equal(JSON.stringify(observations), before);
});

test('availability, coaching, incomplete tasks, defects and mismatched revision cannot pass human evidence', () => {
  const changes = [
    o => { o.participants[0].performed = false; },
    o => { o.participants[0].coachingGiven = true; },
    o => { o.participants[0].tasks['3'].coachingGiven = true; },
    o => { delete o.participants[1].tasks['10']; },
    o => { o.participants[1].tasks['2'].actions = ''; },
    o => { o.participants[1].materialFindings.push('PRIVATE_DEFECT'); },
    o => { o.participants[1].role = 'elma-familiar'; },
    o => { o.source.revision = 'b'.repeat(40); },
    o => { o.sessionStartedAt = 'another-session'; },
    o => { o.independentVisualReview.independent = false; },
    o => { o.independentVisualReview.sourceRevision = 'b'.repeat(40); }
  ];
  for (const change of changes) {
    const { session, observations } = completed(); change(observations);
    assert.equal(usabilityReport(session, observations).status, 'incomplete-or-needs-changes');
  }
  const { session, observations } = completed(); session.source.dirty = true;
  assert.ok(usabilityReport(session, observations).blockers.includes('clean-source-revision-required'));
  const legacy = usabilityReport({ synthetic: true }, { synthetic: true, participants: [] });
  assert.equal(legacy.sourceRevision, null); assert.equal(legacy.productAccepted, false);
  assert.ok(legacy.blockers.includes('clean-source-revision-required'));
});
