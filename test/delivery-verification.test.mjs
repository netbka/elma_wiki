import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_BACK_POLICY, canonicalInventory, compareReadBack, inventoryHash } from '../lib/delivery-verification.mjs';

const row = (path, hash = 'a') => ({ path, sha256: hash.repeat(64) });
const expected = [row('package.json'), row('widgets/manifest.json', 'b'), row('widgets/form.json', 'c')];

test('complete exact match requires all files and records the policy', () => {
  const result = compareReadBack(expected, expected);
  assert.equal(result.match, true);
  assert.equal(result.policy, READ_BACK_POLICY);
  assert.equal(result.compared, 3);
  for (const key of ['missing', 'different', 'unexpected', 'volatile']) assert.deepEqual(result[key], []);
});

test('changed package identity, manifests and history are not ignored', () => {
  for (let index = 0; index < expected.length; index++) {
    const actual = expected.map((item, i) => i === index ? row(item.path, 'd') : item);
    const result = compareReadBack(expected, actual);
    assert.equal(result.match, false, expected[index].path);
    assert.deepEqual(result.different, [expected[index].path]);
  }
});

test('missing metadata cannot be mistaken for a successful import', () => {
  const result = compareReadBack(expected, [expected[2]]);
  assert.equal(result.match, false);
  assert.deepEqual(result.missing, ['package.json', 'widgets/manifest.json']);
});

test('unexpected files including stale target permissions fail the whole-scope comparison', () => {
  for (const name of ['permissionsSettings/old.json', 'other/manifest.json', 'other/package.json']) {
    const result = compareReadBack(expected, [...expected, row(name, 'd')]);
    assert.equal(result.match, false);
    assert.deepEqual(result.unexpected, [name]);
  }
});

test('empty inputs are never verification evidence', () => {
  assert.equal(compareReadBack([], []).match, false);
  assert.equal(compareReadBack([], expected).match, false);
  assert.equal(compareReadBack(expected, []).match, false);
});

test('exact metadata-only scopes are compared, not excluded', () => {
  const metadata = expected.slice(0, 2);
  assert.equal(compareReadBack(metadata, metadata).match, true);
  assert.equal(compareReadBack(metadata, []).match, false);
});

test('ordering and locale do not alter fingerprints or comparison; inputs stay unchanged', () => {
  const input = [row('z'), row('A'), row('a'), row('\u00e4'), row('Z')];
  const before = structuredClone(input);
  const reverse = [...input].reverse();
  assert.equal(inventoryHash(input), inventoryHash(reverse));
  assert.deepEqual(canonicalInventory(input).map(item => item.path), ['A', 'Z', 'a', 'z', '\u00e4']);
  assert.equal(compareReadBack(input, reverse).match, true);
  assert.deepEqual(input, before);
});

test('duplicate paths are rejected on both sides even with identical hashes', () => {
  for (const repeated of [row('package.json'), row('package.json', 'e')]) {
    const duplicate = [...expected, repeated];
    assert.throws(() => compareReadBack(duplicate, expected), { statusCode: 502 });
    assert.throws(() => compareReadBack(expected, duplicate), { statusCode: 502 });
    assert.throws(() => inventoryHash(duplicate), { statusCode: 502 });
  }
});

test('malformed inventory, paths and digests cannot yield a pass or fingerprint', () => {
  const bad = [null, {}, 'inventory', [null], [['file', 'a']], [{}], [row('')],
    ...['/absolute', '../file', 'a/../file', './file', 'a//b', 'a/', 'C:/file', 'a\\b', 'a\u0000b'].map(name => [row(name)]),
    [{ path: 'file', sha256: 'a' }], [{ path: 'file', sha256: 42 }],
    [{ path: 'file', sha256: 'g'.repeat(64) }], [{ path: 'file', sha256: 'A'.repeat(64) }],
    [row('x'.repeat(4097))], Array(25001).fill(row('file'))];
  for (const input of bad) {
    assert.throws(() => compareReadBack(expected, input), { statusCode: 502 });
    assert.throws(() => compareReadBack(input, expected), { statusCode: 502 });
    assert.throws(() => inventoryHash(input), { statusCode: 502 });
  }
});

test('case and valid Unicode differences remain visible; no path folding', () => {
  const wanted = [row('Forms/name'), row('forms/\u00e9')];
  const actual = [row('forms/name'), row('forms/e\u0301')];
  const result = compareReadBack(wanted, actual);
  assert.equal(result.match, false);
  assert.equal(result.missing.length, 2);
  assert.equal(result.unexpected.length, 2);
});
