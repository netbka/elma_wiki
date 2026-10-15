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
  const auth = selectAuth({ PROD_PASS: 'synthetic' }, root, new Date(2026, 9, 15));
  assert.equal(auth.mode, 'password');
  assert.equal(auth.password, 'synthetic');
  assert.match(auth.warnings.join('\n'), new RegExp(`deprecated.*${PASSWORD_FALLBACK_UNTIL}`));
});

test('the password fallback is allowed through its last local day and refused afterwards', () => {
  for (const day of [new Date(2026, 10, 29, 23, 59, 59), new Date(2026, 10, 30, 0, 0, 0), new Date(2026, 10, 30, 23, 59, 59)]) {
    assert.equal(selectAuth({ PROD_PASS: 'synthetic' }, root, day).mode, 'password', day.toString());
  }
  for (const day of [new Date(2026, 11, 1, 0, 0, 0), new Date(2027, 5, 1)]) {
    assert.throws(() => selectAuth({ PROD_PASS: 'synthetic' }, root, day), /Password SSH login ended after 2026-11-30/, day.toString());
  }
  // Key mode is unaffected by the date.
  assert.equal(selectAuth({ PROD_SSH_AGENT: '1', PROD_PASS: 'left-over' }, root, new Date(2027, 0, 1)).password, null);
});

test('no credential configuration asks for a key, not a password', () => {
  assert.throws(() => selectAuth({}, root), /Set PROD_SSH_KEY_FILE \(or PROD_SSH_AGENT=1\)/);
});
