export function comparisonFixture(mode = 'compared') {
  const source = { connectionId: 'synthetic-dev', solutionRef: 'synthetic-contracts' };
  const capture = (artifactId, checksum) => ({ artifactId, checksum: checksum.repeat(64), scope: 'full', snapshot: { source } });
  const key = JSON.stringify(['widgets', 'synthetic', 'contract']);
  const sourceHistory = [{ id: 'synthetic-comparison', status: mode === 'source-ambiguous' ? 'ambiguous' : mode === 'first-capture' ? 'first-capture' : 'compared',
    before: capture('synthetic-before', 'a'), after: capture('synthetic-after', 'b'),
    review: { rows: [{ key, baselineDigest: 'a'.repeat(64), incomingDigest: 'b'.repeat(64) },
      { key: JSON.stringify(['widgets', 'synthetic', 'unchanged']), baselineDigest: 'c'.repeat(64), incomingDigest: 'c'.repeat(64) }] } }];
  const release = { id: 'synthetic-release', revision: 2, candidate: { id: 'synthetic-candidate', sha256: 'b'.repeat(64) }, approval: { revision: 2 } };
  const connection = { id: 'preset-dev2', name: 'DEV2 · synthetic', adapter: 'synthetic', role: 'target' };
  const record = { id: 'synthetic-observation', createdAt: '2026-10-17T10:00:00Z', connection,
    targetIdentity: { host: 'dev2.example.invalid' }, proposed: { candidateId: release.candidate.id, sha256: release.candidate.sha256, releaseRevision: release.revision },
    comparison: { status: mode, evidenceBasis: 'synthetic', businessAcceptance: 'not-established',
      before: { candidate: { sha256: 'a'.repeat(64) } }, delta: { missing: ['widgets/added.json'], different: ['widgets/contract.json'], unexpected: ['widgets/removed.json'] } } };
  if (mode === 'stale') { record.comparison.status = 'compared'; record.proposed.sha256 = 'd'.repeat(64); }
  let records = mode === 'unknown-base' ? [] : [record];
  if (mode === 'verified-after-comparison') records = [
    { id: 'synthetic-delivery', connection, createdAt: '2026-10-17T10:00:00Z', installedObservation: {
      candidate: record.proposed, at: '2026-10-17T12:00:00Z', sequence: 1, evidenceBasis: 'synthetic' } },
    { ...record, createdAt: '2026-10-17T11:00:00Z', comparison: { status: 'unresolved-outcome' } }
  ];
  return { sourceHistory, release, connections: [connection], record, client: {
    installedHistory: async () => { if (mode === 'load-error') throw Error('Synthetic'); return structuredClone(records); },
    installedAction: async (_id, input) => {
      if (mode === 'response-lost') throw Error('Synthetic');
      const result = structuredClone(record); result.comparison.status = input.action === 'reconcileInstalled' ? 'reconciled' : 'compared'; records = [result]; return result;
    }
  } };
}
