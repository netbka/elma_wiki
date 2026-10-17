// Synthetic: temporary data roots and fictional digests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { designationFile, designationReader, designationReasons, parseDesignations, withCurrentDesignations, MAX_RECORD_BYTES } from '../lib/target-designations.mjs';
import { targetPresets, guardPresetDeploy } from '../lib/target-presets.mjs';

const [A, B, C] = ['a', 'b', 'c'].map(letter => letter.repeat(64));
// The exact encoding deploy/prod-update.py writes (key-sorted, compact, newline).
const encode = (revision, candidates) => JSON.stringify({ candidates, revision, schema: 'wiki-dev2-designations', version: 1 }) + '\n';
const env = (extra = {}) => ({ WIKI_TARGET_DEV2_URL: 'https://dev2.example.invalid', ...extra });
function root(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-designations-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const write = (directory, text) => { fs.mkdirSync(path.dirname(designationFile(directory)), { recursive: true }); fs.writeFileSync(designationFile(directory), text); };
const symlink = (t, target, link, type) => {
  try { fs.symlinkSync(target, link, type); return true; }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('creating a symbolic link needs extra privileges on this Windows host'); return false; } throw error; }
};

test('the record schema is strict, versioned and has one encoding per set', () => {
  assert.deepEqual(parseDesignations(encode(3, [A, B])), { revision: 3, candidates: [A, B] });
  assert.deepEqual(parseDesignations(encode(1, [])), { revision: 1, candidates: [] });
  const invalid = ['', 'null', '[]', '{}', encode(0, []), encode(1.5, []), encode(-1, []), encode('1', []), encode(1, [B, A]), encode(1, [A, A]),
    encode(1, [A.toUpperCase()]), encode(1, ['*']), encode(1, A), encode(1, Array.from({ length: 33 }, (_, i) => i.toString(16).padStart(64, '0'))),
    JSON.stringify({ candidates: [], revision: 1, schema: 'wiki-dev2-designations', version: 2 }),
    JSON.stringify({ candidates: [], revision: 1, schema: 'other', version: 1 }),
    JSON.stringify({ candidates: [], revision: 1, schema: 'wiki-dev2-designations', version: 1, path: '/etc' }),
    JSON.stringify({ candidates: [], revision: 1, schema: 'wiki-dev2-designations' })];
  for (const text of invalid) assert.equal(parseDesignations(text), null, text.slice(0, 80));
});

test('a reader re-reads the record on every call: a grant or withdrawal takes effect without a restart', t => {
  const directory = root(t), read = designationReader(directory);
  assert.deepEqual(read(), { ok: false, reason: 'missing' });
  write(directory, encode(1, [A]));
  assert.deepEqual(read(), { ok: true, revision: 1, candidates: [A] });
  write(directory, encode(2, [A, B]));
  assert.deepEqual(read(), { ok: true, revision: 2, candidates: [A, B] });
  write(directory, encode(3, []));
  assert.deepEqual(read(), { ok: true, revision: 3, candidates: [] });
});

test('missing, invalid, oversized, unsafe or stale records designate nothing and report fixed reasons only', t => {
  const directory = root(t), read = designationReader(directory);
  write(directory, encode(5, [A]));
  assert.equal(read().ok, true);
  for (const text of ['{', encode(6, [B, A]), ' '.repeat(MAX_RECORD_BYTES + 1)]) {
    write(directory, text);
    assert.deepEqual(read(), { ok: false, reason: 'invalid' });
  }
  // An older revision than one already read (a restored backup) never resurrects a withdrawn digest.
  write(directory, encode(4, [A, C]));
  assert.deepEqual(read(), { ok: false, reason: 'stale' });
  write(directory, encode(5, [A]));
  assert.equal(read().ok, true);
  fs.rmSync(designationFile(directory));
  fs.mkdirSync(designationFile(directory));
  assert.deepEqual(read(), { ok: false, reason: 'unsafe' });
  fs.rmSync(path.dirname(designationFile(directory)), { recursive: true });
  fs.writeFileSync(path.dirname(designationFile(directory)), 'not a directory');
  assert.deepEqual(read(), { ok: false, reason: 'unsafe' });
  for (const reason of Object.values(designationReasons)) assert.ok(!reason.includes(directory) && !/[0-9a-f]{64}/.test(reason));
});

test('a linked record or record directory is refused, never followed out of the data root', t => {
  const directory = root(t), outside = root(t), read = designationReader(directory);
  write(outside, encode(1, [A]));
  if (!symlink(t, path.dirname(designationFile(outside)), path.dirname(designationFile(directory)), 'junction')) return;
  assert.deepEqual(read(), { ok: false, reason: 'unsafe' });
  fs.rmSync(path.dirname(designationFile(directory)), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(designationFile(directory)));
  if (!symlink(t, designationFile(outside), designationFile(directory), 'file')) return;
  assert.deepEqual(read(), { ok: false, reason: 'unsafe' });
});

test('file mode is adopted explicitly, ignores startup grants and fails closed; legacy mode is unchanged', t => {
  const directory = root(t), read = designationReader(directory);
  const legacy = targetPresets(env({ WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: A }))[1];
  assert.equal(withCurrentDesignations(legacy, read), legacy, 'legacy mode never reads the record');
  assert.doesNotThrow(() => guardPresetDeploy(legacy, A));

  const [dev, dev2] = targetPresets(env({ WIKI_TARGET_DEV_URL: 'https://dev.example.invalid', WIKI_TARGET_DEV2_DESIGNATIONS: 'file', WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: A }));
  assert.equal(dev2.available, true); assert.equal(dev2.designationMode, 'file');
  assert.deepEqual(dev2.designatedCandidates, [], 'a startup grant is never used in file mode');
  assert.equal(withCurrentDesignations(dev, read), dev);
  for (const value of ['env', 'FILE', 'file,env']) {
    const refused = targetPresets(env({ WIKI_TARGET_DEV2_DESIGNATIONS: value }))[1];
    assert.equal(refused.available, false); assert.match(refused.reason, /WIKI_TARGET_DEV2_DESIGNATIONS/);
  }
  // Missing record after adoption: nothing designated, the refusal names the fixed reason.
  let current = withCurrentDesignations(dev2, read);
  assert.deepEqual(current.designatedCandidates, []);
  assert.throws(() => guardPresetDeploy(current, A), error => error.statusCode === 403 && error.message.includes(designationReasons.missing));
  write(directory, encode(1, [B]));
  current = withCurrentDesignations(dev2, read);
  assert.deepEqual([current.designatedCandidates, current.designationRevision], [[B], 1]);
  assert.doesNotThrow(() => guardPresetDeploy(current, B));
  assert.throws(() => guardPresetDeploy(current, A), /назначенного владельцем/);
  write(directory, 'corrupted');
  current = withCurrentDesignations(dev2, read);
  assert.throws(() => guardPresetDeploy(current, B), error => error.statusCode === 403 && error.message.includes(designationReasons.invalid));
  // DEV stays read-only whatever the record holds.
  write(directory, encode(2, [A]));
  assert.throws(() => guardPresetDeploy(withCurrentDesignations(dev, read), A), /только чтение/);
});
