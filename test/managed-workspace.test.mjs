import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from './fixture.mjs';
import { parseManagedArtifact, createManagedWorkspace, previewManagedChange, acceptManagedChange,
  previewReconciliation, acceptReconciliation, setManagedWorkspaceArchived } from '../lib/managed-workspace.mjs';

const definition = (code, value = code) => ({ code, value });
async function artifact(id, scope, definitions, { solution = 'synthetic_solution', extra = [], reverse = false } = {}) {
  const entries = definitions.map(({ code, value, path = code + '.json', namespace = 'synthetic.records', name = code }) => ({
    record: { code, namespace, name, kind: 'WIDGET', path }, path,
    raw: { descriptor: { fields: [{ code: 'title', type: 'STRING' }], clientScripts: `const value = ${JSON.stringify(value)};` } }
  }));
  if (reverse) entries.reverse();
  const bytes = await zip([['package.json', { code: solution, type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: entries.map(entry => entry.record) }],
    ...entries.map(entry => ['widgets/' + entry.path, entry.raw]), ...extra]);
  return parseManagedArtifact(bytes, { id, scope });
}
const workspace = a => createManagedWorkspace(a, { name: 'Synthetic workspace', baselineOwner: 'Korus', id: 'workspace-1' });
const change = (s, a, options = {}) => acceptManagedChange(s, a, { expectedRevision: s.revision,
  reviewedDigest: a.scope === 'partial' && !s.artifacts.some(row => row.id === a.id) && a.solution === s.solution
    ? previewManagedChange(s, a, { team: options.team || 'Internal' }).artifactDigest : '',
  team: 'Internal', taskRef: 'TASK-1', ...options });
const accept = (s, a, options = {}) => acceptReconciliation(s, a, { expectedRevision: s.revision,
  reviewedDigest: previewReconciliation(s, a).artifactDigest, baselineOwner: 'Korus', ...options });

test('managed first use requires explicit full scope and preserves artifact provenance', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  assert.throws(() => workspace({ ...a, scope: 'partial' }), /full snapshot/);
  await assert.rejects(() => parseManagedArtifact(Buffer.from('x')), /scope/);
  const s = workspace(a);
  assert.equal(s.baselineId, 'base'); assert.equal(s.id, 'workspace-1');
  assert.equal(s.artifacts[0].checksum, a.checksum); assert.equal(s.current[0].team, 'Korus');
  assert.ok(Object.isFrozen(s.artifacts[0].components));
  assert.deepEqual(workspace(a), s);
});

test('identity survives manifest reorder, parser array IDs and entity path movement', async () => {
  const a = await artifact('base', 'full', [definition('a'), definition('b')]);
  const b = await artifact('later', 'full', [{ ...definition('a'), path: 'moved.json' }, definition('b')], { reverse: true });
  assert.deepEqual(a.components.map(row => [row.key, row.digest]), b.components.map(row => [row.key, row.digest]));
  assert.ok(previewReconciliation(workspace(a), b).rows.every(row => row.classification === 'unchanged'));
});

test('additive partial changes preserve absent baseline components and baseline ownership', async () => {
  const a = await artifact('base', 'full', [definition('a'), definition('b')]);
  const b = await artifact('partial', 'partial', [definition('x')]);
  const s = workspace(a), before = JSON.stringify(s), next = change(s, b);
  assert.equal(next.current.length, 3); assert.equal(JSON.stringify(s), before);
  assert.equal(next.current.find(row => row.code === 'a').team, 'Korus');
  assert.equal(next.current.find(row => row.code === 'x').team, 'Internal');
  assert.equal(next.changes[0].rows[0].boundaryCrossing, false);
  assert.equal(next.changes[0].rows[0].classification, 'intervention-added');
  assert.deepEqual(next.artifacts[0], a);
});

test('baseline modification requires explicit review; untouched components retain responsibility', async () => {
  const a = await artifact('base', 'full', [definition('a'), definition('b')]);
  const b = await artifact('partial', 'partial', [definition('a', 'modified')]);
  const s = workspace(a), p = previewManagedChange(s, b, { team: 'Internal' });
  assert.equal(p.rows[0].baselineClassification, 'baseline-modified');
  assert.throws(() => change(s, b), /boundary crossing/);
  const next = change(s, b, { reviewedBoundaryKeys: [b.components[0].key] });
  assert.equal(next.current.find(row => row.code === 'a').team, 'Internal');
  assert.equal(next.current.find(row => row.code === 'b').team, 'Korus');
});

test('two-team overlap blocks acceptance; identical evidence is not a conflict', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const b = await artifact('internal', 'partial', [definition('x', 'internal')]);
  const c = await artifact('other', 'partial', [definition('x', 'other')]);
  const s = change(workspace(a), b);
  assert.equal(previewManagedChange(s, c, { team: 'Korus' }).rows[0].conflict, true);
  assert.throws(() => change(s, c, { team: 'Korus' }), /Cross-team overlap/);
  const same = await artifact('same', 'partial', [definition('x', 'internal')]);
  const next = change(s, same, { team: 'Korus' });
  assert.equal(next.current.find(row => row.code === 'x').team, 'Internal');
});

test('later full snapshot distinguishes vendor-only changes and retains pending internal additions', async () => {
  const a = await artifact('base', 'full', [definition('a'), definition('b')]);
  const b = await artifact('internal', 'partial', [definition('x')]);
  const c = await artifact('vendor', 'full', [definition('a', 'vendor'), definition('b'), definition('y')]);
  const s = change(workspace(a), b), p = previewReconciliation(s, c);
  assert.equal(p.rows.find(row => row.key === b.components[0].key).classification, 'known-change-retained');
  assert.equal(p.rows.filter(row => row.classification === 'external-change').length, 2);
  const next = accept(s, c);
  assert.equal(next.baselineId, 'vendor'); assert.equal(next.current.length, 4);
  assert.equal(next.current.find(row => row.code === 'x').team, 'Internal');
  assert.equal(next.current.find(row => row.code === 'a').team, 'Korus');
  assert.equal(s.baselineId, 'base'); assert.equal(next.reconciliations[0].previousBaselineId, 'base');
});

test('incorporated change becomes baseline evidence while immutable intervention history remains', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const b = await artifact('internal', 'partial', [definition('x')]);
  const c = await artifact('vendor', 'full', [definition('a'), definition('x')]);
  const s = change(workspace(a), b);
  assert.equal(previewReconciliation(s, c).rows.find(row => row.key === b.components[0].key).classification, 'known-change-incorporated');
  const next = accept(s, c);
  assert.equal(next.current.find(row => row.code === 'x').interventionId, null);
  assert.deepEqual(next.changes, s.changes);
  const later = await artifact('later', 'full', [definition('a'), definition('x')]);
  assert.ok(previewReconciliation(next, later).rows.every(row => row.classification === 'unchanged'));
});

test('divergent full snapshot needs explicit conflict decisions and exact reviewed evidence', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const b = await artifact('internal', 'partial', [definition('a', 'ours')]);
  const c = await artifact('vendor', 'full', [definition('a', 'theirs')]);
  const key = b.components[0].key, s = change(workspace(a), b, { reviewedBoundaryKeys: [key] });
  assert.equal(previewReconciliation(s, c).rows[0].classification, 'conflict');
  assert.throws(() => accept(s, c), /Resolve each conflict/);
  assert.throws(() => accept(s, c, { reviewedDigest: 'different' }), /reviewed full snapshot/);
  assert.throws(() => accept(s, c, { resolutions: { [key]: 'auto-merge' } }), /Resolve each conflict/);
  const ours = accept(s, c, { resolutions: { [key]: 'keep-working' } });
  const theirs = accept(s, c, { resolutions: { [key]: 'take-snapshot' } });
  assert.equal(ours.current[0].digest, b.components[0].digest); assert.equal(ours.current[0].team, 'Internal');
  assert.equal(theirs.current[0].digest, c.components[0].digest); assert.equal(theirs.current[0].team, 'Korus');
});

test('absence in a full snapshot can remove baseline content and conflicts with a modified component', async () => {
  const a = await artifact('base', 'full', [definition('a'), definition('b')]);
  const c = await artifact('vendor', 'full', [definition('b')]);
  const s = workspace(a), p = previewReconciliation(s, c);
  assert.equal(p.rows.find(row => row.removed).classification, 'external-change');
  assert.equal(accept(s, c).current.length, 1);
  const b = await artifact('internal', 'partial', [definition('a', 'modified')]);
  const changed = change(s, b, { reviewedBoundaryKeys: [b.components[0].key] });
  assert.equal(previewReconciliation(changed, c).rows.find(row => row.removed).classification, 'conflict');
});

test('missing and duplicate identities are ambiguous, even if display names match', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const unknown = await artifact('unknown', 'partial', [{ code: '', value: 'x', name: 'a' }]);
  const duplicate = await artifact('duplicate', 'partial', [definition('x'), { ...definition('x'), path: 'second.json' }]);
  assert.equal(unknown.components.length, 0); assert.ok(unknown.ambiguities.some(row => row.reason === 'unproven-identity'));
  assert.equal(duplicate.components.length, 0); assert.ok(duplicate.ambiguities.some(row => row.reason === 'duplicate-identity'));
  assert.throws(() => change(workspace(a), duplicate), /Ambiguous/);
});

test('opaque/incomplete full snapshots never establish deletion or an accepted baseline', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const broken = await artifact('broken', 'full', [], { extra: [['data', 'opaque']] });
  assert.throws(() => workspace(broken), /Ambiguous/);
  const p = previewReconciliation(workspace(a), broken);
  assert.equal(p.rows[0].classification, 'ambiguous');
  assert.equal(p.rows[0].removed, null);
  assert.throws(() => accept(workspace(a), broken), /Ambiguous/);
});

test('side script and declared resource bytes participate in component change evidence', async () => {
  const build = async (id, script, resource) => parseManagedArtifact(await zip([
    ['package.json', { code: 'synthetic_solution' }], ['widgets/manifest.json', { entities: [{
      namespace: 'synthetic.records', code: 'a', kind: 'WIDGET', path: 'a.json', resources: [{ path: 'a.po' }]
    }] }], ['widgets/a.json', { descriptor: { fields: [] } }], ['widgets/a.json.client.ts', script], ['widgets/a.po', resource]
  ]), { id, scope: 'full' });
  const a = await build('base', 'const x = 1;', 'one');
  const b = await build('script', 'const x = 2;', 'one');
  const c = await build('resource', 'const x = 1;', 'two');
  assert.notEqual(a.components[0].digest, b.components[0].digest);
  assert.notEqual(a.components[0].digest, c.components[0].digest);
  assert.equal(a.components[0].evidence.length, 3);
});

test('unclassified bytes stay explicit evidence without inventing component ownership', async () => {
  const a = await artifact('base', 'full', [definition('a')], { extra: [['widgets/extra.txt', 'uninterpreted']] });
  assert.equal(a.unclassifiedFiles[0].path, 'widgets/extra.txt');
  assert.equal(a.components.length, 1);
  assert.equal(a.unclassifiedFiles[0].sha256.length, 64);
  assert.throws(() => workspace(a), /Ambiguous/);
});

test('stale decisions, mixed solutions, full-as-change and duplicate artifact IDs fail closed', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const b = await artifact('partial', 'partial', [definition('x')]);
  const s = workspace(a), next = change(s, b);
  assert.throws(() => change(next, b), /already belongs/);
  assert.throws(() => change(s, b, { expectedRevision: -1 }), /revision changed/);
  assert.throws(() => change(s, b, { reviewedDigest: 'another-artifact' }), /reviewed partial change/);
  assert.throws(() => change(s, a), /partial artifact/);
  const other = await artifact('foreign', 'partial', [definition('x')], { solution: 'another_solution' });
  assert.throws(() => change(s, other), /different solution/);
});

test('archive/reopen preserves baseline, changes and history and blocks archived writes', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const b = await artifact('partial', 'partial', [definition('x')]);
  const s = workspace(a), archived = setManagedWorkspaceArchived(s, true, 0);
  assert.throws(() => change(archived, b), /Reopen/);
  assert.throws(() => setManagedWorkspaceArchived(archived, false, 0), /current revision/);
  const reopened = setManagedWorkspaceArchived(archived, false, 1);
  assert.equal(reopened.baselineId, s.baselineId); assert.deepEqual(reopened.current, s.current);
  assert.equal(reopened.history.at(-1).type, 'reopened'); assert.equal(change(reopened, b).current.length, 2);
});

test('empty explicit full snapshot removes components; JSON round trip preserves deterministic reconciliation', async () => {
  const a = await artifact('base', 'full', [definition('a')]);
  const b = await artifact('empty', 'full', []), s = workspace(a);
  assert.equal(b.ambiguities.length, 0);
  assert.deepEqual(previewReconciliation(JSON.parse(JSON.stringify(s)), b), previewReconciliation(s, b));
  const next = accept(s, b);
  assert.equal(next.current.length, 0); assert.equal(next.artifacts[0].components.length, 1);
  const c = await artifact('partial', 'partial', [definition('x')]);
  const newer = change(s, c);
  assert.throws(() => accept(newer, b, { expectedRevision: s.revision }), /revision changed/);
});

test('missing resources and unproven resource schema block component acceptance', async () => {
  for (const resources of [[{ path: 'missing.po' }], { path: 'missing.po' }]) {
    const a = await parseManagedArtifact(await zip([
      ['package.json', { code: 'synthetic_solution' }], ['widgets/manifest.json', { entities: [{
        code: 'a', namespace: 'synthetic.records', kind: 'WIDGET', path: 'a.json', resources
      }] }], ['widgets/a.json', { descriptor: { fields: [] } }]
    ]), { id: 'broken', scope: 'full' });
    assert.ok(a.ambiguities.length); assert.throws(() => workspace(a), /Ambiguous/);
  }
});
