import test from 'node:test';
import assert from 'node:assert/strict';
import { managedFixture } from '../web/managed/fixtures.js';
import { acceptedFullBases, baseEvidence, scopeEvidence, scopeCandidates, preparationFields, exactKey, draftKey } from '../web/managed/change-base.js';

const key = code => JSON.stringify(['widgets', 'synthetic.records', code]);

test('only accepted explicitly full artifacts with a recorded revision are offered, historical bases included', () => {
  const state = managedFixture('change-base').workspace, bases = acceptedFullBases(state);
  assert.deepEqual(bases.map(row => [row.artifactId, row.revision, row.current]), [['synthetic-update', 2, true], ['synthetic-baseline', 0, false]]);
  assert.equal(bases[1].checksum, 'a'.repeat(64));
  // Pending/partial, unrecorded acceptance and checksum drift are never selectable.
  state.artifacts.push({ id: 'partial', scope: 'partial', checksum: 'f'.repeat(64), snapshot: { checksum: 'f'.repeat(64) }, scopeDeclaration: { scope: 'partial' } });
  state.artifacts.push({ ...structuredClone(state.artifacts[0]), id: 'unrecorded' });
  state.artifacts.push({ ...structuredClone(state.artifacts[0]), id: 'drift', checksum: '0'.repeat(64) });
  state.history.push({ type: 'baseline-accepted', id: 'drift', revision: 4 });
  assert.deepEqual(acceptedFullBases(state).map(row => row.artifactId), ['synthetic-update', 'synthetic-baseline']);
  assert.deepEqual(acceptedFullBases(null), []);
});

test('declared ancestry is never presented as verified and unknown bases stay unknown', () => {
  const declared = baseEvidence({ status: 'declared', revision: 0, checksum: 'a'.repeat(64), ancestryVerified: false });
  assert.equal(declared.ancestry, 'declared'); assert.match(declared.detail, /не проверено/);
  assert.equal(baseEvidence({ status: 'unknown', method: 'not-declared' }).ancestry, 'unknown');
  assert.match(baseEvidence(undefined).title, /не зафиксирована/);
  assert.match(baseEvidence({ status: 'unknown', method: 'not-declared' }).title, /не указана/);
  const scoped = scopeEvidence(managedFixture('base-declared').review.changeScopeDeclaration);
  assert.deepEqual(scoped.members.map(row => [row.name, row.inChange]), [['approval', false], ['contract', true]]);
  assert.match(scoped.detail, /остаётся без изменений/);
  assert.equal(scopeEvidence({ status: 'unknown', method: 'not-recorded' }).status, 'unknown');
});

test('scope candidates are exact captured keys from the base and the replaced capture, never labels', () => {
  const [, initial] = acceptedFullBases(managedFixture('change-base').workspace);
  const rows = scopeCandidates(initial, { rows: [{ key: key('category'), classification: 'intervention-added' },
    { key: key('contract'), classification: 'component-modified' }, { key: key('gone'), classification: 'component-deleted' }, { key: 'category', classification: 'intervention-added' }] });
  assert.deepEqual(rows.map(row => [row.key, row.inBase, row.inPrevious]), [
    [key('approval'), true, false], [key('category'), false, true], [key('contract'), true, true]]);
  assert.equal(exactKey(key('x')), true);
  for (const value of ['contract', '["widgets"]', '[1,2]', '[ "widgets", "x" ]', '{}']) assert.equal(exactKey(value), false, value);
});

test('request fields require explicit confirmation and exact unique members, and never request deletions', () => {
  const bases = acceptedFullBases(managedFixture('change-base').workspace), historical = bases[1].artifactId;
  assert.deepEqual(preparationFields({ partial: true, bases }), { fields: {} }, 'omitted base remains unknown legacy behavior');
  assert.match(preparationFields({ partial: true, bases, scopeEnabled: true }).error, /требует явно выбранной базы/);
  assert.match(preparationFields({ partial: true, bases, baseId: historical }).error, /Подтвердите/);
  assert.match(preparationFields({ partial: true, bases, baseId: 'foreign', baseConfirmed: true }).error, /больше не входит/);
  assert.deepEqual(preparationFields({ partial: true, bases, baseId: historical, baseConfirmed: true }).fields,
    { base: { artifactId: historical, revision: 0, confirmed: true } });
  const scoped = { partial: true, bases, baseId: historical, baseConfirmed: true, scopeEnabled: true, scopeName: ' Категория ', selected: [key('contract')] };
  assert.deepEqual(preparationFields({ ...scoped, extra: `\n${key('category')}\n` }).fields.changeScope,
    { name: 'Категория', members: [key('contract'), key('category')], deletions: [], confirmed: true });
  assert.match(preparationFields({ ...scoped, extra: key('contract') }).error, /дважды/);
  assert.match(preparationFields({ ...scoped, extra: `${key('a')}\n${key('a')}` }).error, /дважды/);
  assert.match(preparationFields({ ...scoped, extra: 'category' }).error, /точным ключом/);
  assert.match(preparationFields({ ...scoped, scopeName: ' ' }).error, /Назовите/);
  assert.match(preparationFields({ ...scoped, selected: [] }).error, /хотя бы один/);
  assert.equal(preparationFields({ ...scoped, partial: false }).fields.changeScope, undefined, 'full updates declare only a base');
  assert.notEqual(draftKey('/api/solutions', 'a', 'change', 'x'), draftKey('/api/solutions', 'a', 'change', ''));
});
