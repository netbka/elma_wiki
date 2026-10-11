// Synthetic: no SSH, no network, no real key material.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectAuth, PASSWORD_FALLBACK_UNTIL } from '../tools/prod-auth.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-repo-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-key-'));
const keyFile = path.join(outside, 'synthetic-deploy-key');
fs.writeFileSync(keyFile, 'synthetic placeholder, not a key');

test('key file outside the repository selects key mode and never returns a password', () => {
  const auth = selectAuth({ PROD_SSH_KEY_FILE: keyFile, PROD_PASS: 'left-over' }, root);
  assert.equal(auth.mode, 'key');
  assert.equal(auth.keyFile, keyFile);
  assert.equal(auth.password, null);
  assert.match(auth.warnings.join('\n'), /PROD_PASS is still set but no longer used/);
});

test('ssh-agent mode needs no key path', () => {
  const auth = selectAuth({ PROD_SSH_AGENT: '1' }, root);
  assert.deepEqual([auth.mode, auth.keyFile, auth.useAgent, auth.password], ['key', null, true, null]);
  assert.deepEqual(auth.warnings, []);
});

test('a key inside the repository is refused', () => {
  const inside = path.join(root, 'deploy-key');
  fs.writeFileSync(inside, 'synthetic');
  assert.throws(() => selectAuth({ PROD_SSH_KEY_FILE: inside }, root), /outside the repository/);
  assert.throws(() => selectAuth({ PROD_SSH_KEY_FILE: 'deploy-key' }, root), /outside the repository/);
});

test('a missing key file or a multi-line value is refused', () => {
  assert.throws(() => selectAuth({ PROD_SSH_KEY_FILE: path.join(outside, 'missing') }, root), /does not point to a key file/);
  assert.throws(() => selectAuth({ PROD_SSH_KEY_FILE: `${keyFile}\nX` }, root), /single file path/);
});

test('password-only configuration is a deprecated, dated fallback', () => {
  const auth = selectAuth({ PROD_PASS: 'synthetic' }, root);
  assert.equal(auth.mode, 'password');
  assert.equal(auth.password, 'synthetic');
  assert.match(auth.warnings.join('\n'), new RegExp(`deprecated.*${PASSWORD_FALLBACK_UNTIL}`));
});

test('no credential configuration asks for a key, not a password', () => {
  assert.throws(() => selectAuth({}, root), /Set PROD_SSH_KEY_FILE \(or PROD_SSH_AGENT=1\)/);
});
