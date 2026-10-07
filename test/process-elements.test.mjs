import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from './fixture.mjs';
import { parseManagedArtifact, createManagedWorkspace, previewManagedChange, acceptManagedChange,
  previewReconciliation, acceptReconciliation } from '../lib/managed-workspace.mjs';
import { processElementEvidence } from '../lib/process-elements.mjs';

const source = () => ({ process: { items: { y: { id: 'y', name: 'Existing condition', condition: 'baseline' } },
  transitions: {}, lanes: {} }, context: [{ code: 'old', type: 'STRING' }] });
const added = () => { const raw = source(); raw.process.items.x = { id: 'x', name: 'Added task' };
  raw.context.push({ code: 'one', type: 'STRING' }, { code: 'two', type: 'BOOLEAN' }); return raw; };
const partId = (kind, code) => JSON.stringify([kind, code]);
const part = (state, kind, code) => state.current[0].responsibility.elements.find(row => row.id === partId(kind, code));
async function artifact(id, scope, raw, filename = 'approval.json') {
  return parseManagedArtifact(await zip([['package.json', { code: 'synthetic', type: 'SOLUTION' }],
    ['processor/manifest.json', { entities: [{ code: 'approval', namespace: 'synthetic', kind: 'PROCESS', path: filename }] }],
    ['processor/' + filename, raw]]), { id, scope });
}
const state = async () => createManagedWorkspace(await artifact('baseline', 'full', source()), { name: 'Synthetic', baselineOwner: 'Korus' });
const accept = (s, a, options = {}) => acceptManagedChange(s, a, { expectedRevision: s.revision,
  reviewedDigest: previewManagedChange(s, a, { team: options.team || 'Internal' }).artifactDigest, team: 'Internal', taskRef: 'TASK-31', ...options });
const reconcile = (s, a, options = {}) => acceptReconciliation(s, a, { expectedRevision: s.revision,
  reviewedDigest: previewReconciliation(s, a).artifactDigest, baselineOwner: 'Korus', ...options });

test('adding a process step and variables retains responsibility for all unchanged baseline parts', async () => {
  const s = await state(), a = await artifact('addition', 'partial', added());
  const review = previewManagedChange(s, a, { team: 'Internal' });
  assert.equal(review.rows[0].boundaryCrossing, false); assert.equal(review.rows[0].conflict, false);
  assert.equal(review.rows[0].elements.complete, true);
  const next = accept(s, a);
  for (const [kind, code] of [['node','y'], ['variable','old']]) assert.equal(part(next, kind, code).team, 'Korus');
  for (const [kind, code] of [['node','x'], ['variable','one'], ['variable','two']]) assert.equal(part(next, kind, code).team, 'Internal');
  assert.equal(next.current[0].responsibility.baselineTeam, 'Korus');
  assert.equal(s.current[0].responsibility.elements.length, 2, 'baseline remains immutable');
  const second = added(); second.process.items.z = { id: 'z', name: 'Independent addition' };
  const b = await artifact('second-team', 'partial', second), separate = accept(next, b, { team: 'Korus' });
  assert.equal(part(separate, 'node', 'x').team, 'Internal'); assert.equal(part(separate, 'node', 'z').team, 'Korus');
});
test('modifying an existing condition requires boundary review without transferring untouched nodes', async () => {
  const s = await state(), raw = added(); raw.process.items.y.condition = 'modified';
  const a = await artifact('modified', 'partial', raw), review = previewManagedChange(s, a, { team: 'Internal' });
  assert.equal(review.rows[0].boundaryCrossing, true);
  assert.deepEqual(review.rows[0].elements.rows.filter(row => row.boundaryCrossing).map(row => row.code), ['y']);
  assert.throws(() => accept(s, a), /boundary crossing/);
  const next = accept(s, a, { reviewedBoundaryKeys: [a.components[0].key] });
  assert.equal(part(next, 'node', 'y').team, 'Internal'); assert.equal(part(next, 'variable', 'old').team, 'Korus');
});
test('later team overlap identifies the exact part and still requires a whole-file reconciliation choice', async () => {
  const s = accept(await state(), await artifact('internal', 'partial', added())), raw = added();
  raw.process.items.x.name = 'Korus revision';
  const partial = await artifact('other-partial', 'partial', raw), review = previewManagedChange(s, partial, { team: 'Korus' });
  assert.equal(review.rows[0].conflict, true);
  assert.deepEqual(review.rows[0].elements.rows.filter(row => row.conflict).map(row => row.code), ['x']);
  assert.throws(() => accept(s, partial, { team: 'Korus' }), /overlap/);
  const full = await artifact('other-full', 'full', raw), combined = previewReconciliation(s, full);
  assert.equal(combined.rows[0].classification, 'conflict');
  assert.deepEqual(combined.rows[0].elements.rows.filter(row => row.conflict).map(row => row.code), ['x']);
  assert.throws(() => reconcile(s, full), /Resolve/);
  const taken = reconcile(s, full, { resolutions: { [full.components[0].key]: 'take-snapshot' } });
  assert.equal(part(taken, 'node', 'x').team, 'Korus'); assert.equal(part(taken, 'variable', 'one').team, 'Internal');
});
test('incorporation, exact restoration, removal and restart retain declared element responsibility', async () => {
  let s = accept(await state(), await artifact('internal', 'partial', added()));
  s = reconcile(s, await artifact('incorporated', 'full', added()));
  assert.equal(part(s, 'node', 'x').team, 'Internal');
  const raw = added(); raw.process.items.y.condition = 'changed again';
  const changed = await artifact('changed', 'partial', raw);
  s = accept(JSON.parse(JSON.stringify(s)), changed, { reviewedBoundaryKeys: [changed.components[0].key] });
  s = accept(s, await artifact('restored', 'partial', added()), { reviewedBoundaryKeys: [changed.components[0].key] });
  assert.equal(part(s, 'node', 'y').team, 'Korus'); assert.equal(part(s, 'node', 'x').team, 'Internal');
  const removed = added(); delete removed.process.items.y;
  const removal = await artifact('removal', 'partial', removed);
  s = accept(s, removal, { reviewedBoundaryKeys: [removal.components[0].key] });
  assert.equal(s.current[0].responsibility.removed[0].team, 'Internal');
  assert.equal(s.current[0].responsibility.removed[0].code, 'y');
});
test('unknown, duplicates, residual edits and legacy evidence keep the conservative object-level gate', async () => {
  for (const edit of [raw => { raw.process.items.duplicate = { ...raw.process.items.y }; },
    raw => { raw.process.items = [{ name: 'No stable identity' }]; }, raw => { delete raw.process.items; }]) {
    const raw = source(); edit(raw); const a = await artifact('unknown', 'partial', raw);
    const review = previewManagedChange(await state(), a, { team: 'Internal' });
    assert.equal(review.rows[0].elements.complete, false); assert.equal(review.rows[0].boundaryCrossing, true);
  }
  const raw = added(); raw.scripts = 'changed script';
  assert.equal(previewManagedChange(await state(), await artifact('script', 'partial', raw), { team: 'Internal' }).rows[0].boundaryCrossing, true);
  const legacy = JSON.parse(JSON.stringify(await state())); delete legacy.current[0].structure; delete legacy.current[0].responsibility;
  delete legacy.artifacts[0].components[0].structure;
  const a = await artifact('legacy-addition', 'partial', added()), review = previewManagedChange(legacy, a, { team: 'Internal' });
  assert.equal(review.rows[0].elements.complete, false);
  const next = accept(legacy, a, { reviewedBoundaryKeys: [a.components[0].key] });
  assert.equal(next.current[0].responsibility.status, 'unknown'); assert.equal(part(next, 'node', 'y').team, null);
});
test('path changes and JSON property order never invent changed parts; context wrapper changes remain residual evidence', async () => {
  const s = await state(), raw = source(); raw.process.items.y = { condition: 'baseline', name: 'Existing condition', id: 'y' };
  const review = previewManagedChange(s, await artifact('move', 'partial', raw, 'moved.json'), { team: 'Internal' });
  assert.ok(review.rows[0].elements.rows.every(row => row.classification === 'unchanged'));
  assert.equal(review.rows[0].boundaryCrossing, false);
  const evidence = processElementEvidence({ process: { items: {} }, context: { fields: [], other: 'preserved' } }, 'source', {}, []);
  assert.notEqual(evidence.residualDigest, processElementEvidence({ process: { items: {} }, context: { fields: [], other: 'changed' } }, 'source', {}, []).residualDigest);
  const rawLinks = added(); rawLinks.process.transitions.link = { id: 'link', source: 'y', target: 'x', condition: 'not evaluated' };
  const links = processElementEvidence(rawLinks, 'processor/source.json', {}, []).elements.filter(row => row.kind === 'transition');
  assert.deepEqual(links.map(row => [row.from,row.to]), [['y','x']]); assert.equal(JSON.stringify(links).includes('not evaluated'), false);
});
