import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { READ_BACK_POLICY, compareReadBack } from '../lib/delivery-verification.mjs';
import { IMPORT_NORMALIZED_POLICY, compareImportNormalizedReadBack } from '../lib/delivery-import-normalization.mjs';

// Synthetic package shaped like an elma365pm export; no customer content.
const entry = n => ({ version: `00000000-0000-4000-8000-00000000000${n}`, updatedAt: `2026-10-0${n}T00:00:00Z` });
const dependency = (extra = {}) => ({ code: 'provider', data: { namespace: 'example_module.records', code: 'target' }, ...extra });
const basePackage = () => ({ code: 'example_solution', title: 'Синтетическое решение', type: 'SOLUTION', history: [entry(1), entry(2)],
  dependencies: { widgets: [dependency({ version: '1' })] }, sysDependencies: { namespaces: [{ code: '_system_catalogs' }] } });
const baseManifest = () => ({ entities: [
  { code: 'form', namespace: 'example_module.records', kind: 'widget', path: 'form.json', history: [entry(1)] },
  { code: 'view', namespace: 'example_module.records', kind: 'widget', path: 'view.json', history: [entry(1), entry(2)] }
] });
const baseForm = () => ({ code: 'form', descriptor: { clientScripts: '' } });

const bytes = value => Buffer.from(JSON.stringify(value, null, 2));
function snapshot(edit = files => files) {
  const files = edit(new Map([['package.json', basePackage()], ['widgets/manifest.json', baseManifest()], ['widgets/form.json', baseForm()]]));
  const contents = new Map([...files].map(([path, value]) => [path, Buffer.isBuffer(value) ? value : bytes(value)]));
  return { files: contents, inventory: [...contents].map(([path, content]) => ({ path, sha256: crypto.createHash('sha256').update(content).digest('hex') })) };
}
const candidate = snapshot();
const compare = actual => compareImportNormalizedReadBack(candidate.inventory, actual.inventory, { expectedFiles: candidate.files, actualFiles: actual.files });
const change = (path, mutate) => snapshot(files => { const value = structuredClone(files.get(path)); mutate(value); return files.set(path, value); });
const imported = () => snapshot(files => {
  const pkg = structuredClone(files.get('package.json')), manifest = structuredClone(files.get('widgets/manifest.json'));
  pkg.history.push(entry(3)); manifest.entities[0].history.push(entry(2));
  pkg.dependencies.widgets[0].version = '2';
  return files.set('package.json', pkg).set('widgets/manifest.json', manifest);
});
const rejectsOnly = (result, path) => {
  assert.equal(result.match, false);
  assert.deepEqual(result.different, [path]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].path, path);
};

test('the exact policy stays the default and rejects an import history append', () => {
  assert.equal(READ_BACK_POLICY, 'exact-solution-inventory-v1');
  const result = compareReadBack(candidate.inventory, imported().inventory);
  assert.equal(result.policy, READ_BACK_POLICY);
  assert.equal(result.match, false);
  assert.deepEqual(result.different, ['package.json', 'widgets/manifest.json']);
  assert.equal('normalized' in result, false);
});

test('an identical read-back matches with nothing normalized', () => {
  const result = compare(candidate);
  assert.equal(result.policy, IMPORT_NORMALIZED_POLICY);
  assert.equal(result.match, true);
  assert.equal(result.compared, 3);
  for (const key of ['missing', 'different', 'unexpected', 'normalized', 'rejected', 'volatile']) assert.deepEqual(result[key], []);
});

test('appended import history and rewritten dependency metadata match and are each reported', () => {
  const result = compare(imported());
  assert.equal(result.match, true);
  for (const key of ['missing', 'different', 'unexpected', 'rejected']) assert.deepEqual(result[key], []);
  assert.deepEqual(result.normalized, [
    { path: 'package.json', kind: 'appended-history', pointer: '/history/2' },
    { path: 'package.json', kind: 'rewritten-dependency', pointer: '/dependencies/widgets/0/version' },
    { path: 'widgets/manifest.json', kind: 'appended-history', pointer: '/entities/0/history/1' }
  ]);
});

test('a dependency record may gain rewritten metadata but keeps its identity', () => {
  const added = compare(change('package.json', pkg => { pkg.history.push(entry(3)); pkg.sysDependencies.namespaces[0].version = '5'; }));
  assert.equal(added.match, true);
  assert.deepEqual(added.normalized.map(item => item.pointer), ['/history/2', '/sysDependencies/namespaces/0/version']);
  for (const mutate of [
    pkg => { pkg.dependencies.widgets[0].code = 'other'; },
    pkg => { pkg.dependencies.widgets[0].data.code = 'other_target'; },
    pkg => { pkg.dependencies.widgets[0].data.namespace = 'other.records'; },
    pkg => { pkg.dependencies.widgets.push(dependency()); },
    pkg => { pkg.dependencies.widgets = []; },
    pkg => { pkg.dependencies.processes = []; },
    pkg => { pkg.optionalDependencies = { widgets: [] }; },
    pkg => { delete pkg.sysDependencies; },
    pkg => { pkg.dependencies.widgets.unshift(pkg.sysDependencies.namespaces[0]); pkg.dependencies.widgets.pop(); }
  ]) rejectsOnly(compare(change('package.json', mutate)), 'package.json');
});

test('other files, invalid JSON and formatting-only changes fail', () => {
  rejectsOnly(compare(change('widgets/form.json', form => { form.descriptor.clientScripts = 'x'; })), 'widgets/form.json');
  rejectsOnly(compare(change('widgets/form.json', form => { form.history = [entry(1)]; })), 'widgets/form.json');
  rejectsOnly(compare(snapshot(files => files.set('package.json', Buffer.from('{not json')))), 'package.json');
  rejectsOnly(compare(snapshot(files => files.set('package.json', Buffer.from(JSON.stringify(basePackage()))))), 'package.json');
  const nested = snapshot(files => files.set('widgets/nested/manifest.json', baseManifest()));
  const nestedImported = snapshot(files => { const manifest = baseManifest(); manifest.entities[0].history.push(entry(2)); return files.set('widgets/nested/manifest.json', manifest); });
  const result = compareImportNormalizedReadBack(nested.inventory, nestedImported.inventory, { expectedFiles: nested.files, actualFiles: nestedImported.files });
  assert.deepEqual(result.different, ['widgets/nested/manifest.json']);
});

test('other package and manifest fields fail even beside an accepted history append', () => {
  for (const mutate of [pkg => { pkg.title = 'Другое'; }, pkg => { pkg.serverVersion = '2025.4'; }, pkg => { pkg.solution = { isAuthor: false }; }, pkg => { delete pkg.type; }])
    rejectsOnly(compare(change('package.json', pkg => { pkg.history.push(entry(3)); mutate(pkg); })), 'package.json');
  for (const mutate of [
    manifest => { manifest.entities[0].path = 'other.json'; },
    manifest => { manifest.entities[0].resources = []; },
    manifest => { manifest.entities.push({ code: 'extra', path: 'extra.json', history: [] }); },
    manifest => { manifest.entities.reverse(); },
    manifest => { manifest.services = ['widgets']; }
  ]) rejectsOnly(compare(change('widgets/manifest.json', manifest => { manifest.entities[0].history.push(entry(2)); mutate(manifest); })), 'widgets/manifest.json');
});

test('removed, reordered, edited or several appended history entries fail', () => {
  for (const mutate of [
    pkg => { pkg.history.pop(); },
    pkg => { pkg.history.shift(); pkg.history.push(entry(3)); },
    pkg => { pkg.history.reverse(); },
    pkg => { pkg.history.reverse(); pkg.history.push(entry(3)); },
    pkg => { pkg.history[0].updatedAt = '2026-10-14T00:00:00Z'; pkg.history.push(entry(3)); },
    pkg => { pkg.history.push(entry(3), entry(4)); },
    pkg => { pkg.history.unshift(entry(3)); },
    pkg => { pkg.history.push('not-an-entry'); },
    pkg => { pkg.history = []; },
    pkg => { delete pkg.history; }
  ]) rejectsOnly(compare(change('package.json', mutate)), 'package.json');
  rejectsOnly(compare(change('widgets/manifest.json', manifest => { manifest.entities[1].history.reverse(); })), 'widgets/manifest.json');
  rejectsOnly(compare(change('widgets/manifest.json', manifest => { manifest.entities[1].history.pop(); })), 'widgets/manifest.json');
});

test('extra and missing files fail with the normalization still reported', () => {
  const extra = snapshot(files => { const pkg = structuredClone(files.get('package.json')); pkg.history.push(entry(3)); return files.set('package.json', pkg).set('dependency/manifest.json', baseManifest()); });
  const result = compare(extra);
  assert.equal(result.match, false);
  assert.deepEqual(result.unexpected, ['dependency/manifest.json']);
  assert.deepEqual(result.normalized, [{ path: 'package.json', kind: 'appended-history', pointer: '/history/2' }]);
  const missing = snapshot(files => { files.delete('widgets/form.json'); return files; });
  const absent = compare(missing);
  assert.equal(absent.match, false);
  assert.deepEqual(absent.missing, ['widgets/form.json']);
  const empty = compareImportNormalizedReadBack([], [], { expectedFiles: new Map(), actualFiles: new Map() });
  assert.equal(empty.match, false);
});

test('differing metadata needs content bound to the compared hashes', () => {
  const actual = imported();
  assert.throws(() => compareImportNormalizedReadBack(candidate.inventory, actual.inventory), { statusCode: 502 });
  assert.throws(() => compareImportNormalizedReadBack(candidate.inventory, actual.inventory, { expectedFiles: candidate.files, actualFiles: new Map() }), { statusCode: 502 });
  const forged = new Map(actual.files).set('package.json', candidate.files.get('package.json'));
  assert.throws(() => compareImportNormalizedReadBack(candidate.inventory, actual.inventory, { expectedFiles: candidate.files, actualFiles: forged }), { statusCode: 502 });
  const duplicate = [...actual.inventory, actual.inventory[0]];
  assert.throws(() => compareImportNormalizedReadBack(candidate.inventory, duplicate, { expectedFiles: candidate.files, actualFiles: actual.files }), { statusCode: 502 });
});
