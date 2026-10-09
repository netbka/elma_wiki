import { solutionHandoffFixture } from './handoff-fixtures.js';

// Synthetic contextual evidence only; never contacts ELMA or publishes a release.
export function solutionDeliveryFixture(state = 'ready') {
  const model = solutionHandoffFixture('prepared'), release = model.handoff;
  const connection = { id: 'synthetic-target', name: 'Учебный TEST', role: 'target', environment: 'test', adapter: 'synthetic',
    probe: { ok: state !== 'connection-unavailable', identity: { host: 'test.example.invalid', version: 'synthetic' } } };
  const absent = ['ready', 'unavailable', 'connection-unavailable', 'load-error', 'journey'].includes(state);
  const attemptState = state === 'stale' ? 'verified' : state === 'verification-error' ? 'verification-failed' : state === 'lost-response' ? 'prepared' : state;
  const attempt = absent ? null : { id: 'synthetic-attempt', state: attemptState, solutionCode: release.source.code, releaseRevision: release.revision,
    candidateId: release.candidate.id, sha256: release.candidate.sha256, connection, targetIdentity: connection.probe.identity,
    candidateStatus: state === 'stale' ? 'stale' : 'current', verificationCurrent: attemptState === 'verified' && state !== 'stale',
    evidence: { comparison: ['verified', 'verification-failed'].includes(attemptState) && state !== 'verification-error' ? {
      policy: 'exact-solution-inventory-v1', match: attemptState === 'verified', compared: 3, missing: [], different: attemptState === 'verification-failed' ? ['widgets/form.json'] : [], unexpected: []
    } : null, verificationError: state === 'verification-error' ? 'Учебный Target не ответил' : null },
    history: [{ at: '2026-10-09T12:00:00Z', state: attemptState, note: 'Синтетическое состояние' }] };
  const data = { capabilities: { mode: state === 'unavailable' ? 'unavailable' : 'synthetic', liveDelivery: false }, connections: [connection], attempts: attempt ? [attempt] : [], bridges: [] };
  return { model, data, connection };
}
