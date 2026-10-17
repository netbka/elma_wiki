// Synthetic: no SSH, no network, fictional values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRuntimeSettings, readRuntimeSettings, RUNTIME_SETTINGS } from '../tools/prod-settings.mjs';

const valid = {
  WIKI_TARGET_DEV2_URL: 'https://dev2.example.test',
  WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: `${'d'.repeat(64)},${'e'.repeat(64)}`,
  WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: '0b0e5c1a-1111-4222-8333-444455556666',
  WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: `vk:${'ab'.repeat(32)}`,
  WIKI_NATIVE_MATERIALIZATION_REVISION: 'c'.repeat(40),
  WIKI_NATIVE_TARGET_PROFILE_TARGET: 'dev2'
};
const text = settings => Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n');

test('accepts exactly the allowlisted settings in their production formats', () => {
  assert.deepEqual(Object.keys(RUNTIME_SETTINGS).sort(), Object.keys(valid).sort());
  assert.deepEqual(parseRuntimeSettings(`# comment\n${text(valid)}\n`), valid);
  assert.deepEqual(parseRuntimeSettings('WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER=email:' + '0'.repeat(64)),
    { WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'email:' + '0'.repeat(64) });
});

test('refuses other keys and malformed values, naming only the key', () => {
  const bad = [
    ['VK_BOT_AUTH_TOKEN', 'synthetic'], ['PUBLIC_BASE_URL', 'https://other.example.org'], ['WIKI_TARGET_DEV_URL', 'https://dev.example.test'],
    ['WIKI_TARGET_DEV2_URL', 'http://dev2.example.test'], ['WIKI_TARGET_DEV2_URL', 'https://dev2.example.test/path'],
    ['WIKI_TARGET_DEV2_URL', 'https://user:pass@dev2.example.test'], ['WIKI_TARGET_DEV2_URL', '"https://dev2.example.test\\nX=1"'],
    ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES', 'D'.repeat(64)], ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES', 'contracts'],
    ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES', `${'d'.repeat(64)}, ${'e'.repeat(64)}`], ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES', `${'d'.repeat(64)},`],
    ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES', ''],
    ['WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID', 'not-a-uuid'], ['WIKI_NATIVE_MATERIALIZATION_REVISION', 'A'.repeat(40)],
    ['WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER', 'local'], ['WIKI_NATIVE_TARGET_PROFILE_TARGET', 'main-dev'],
    ['WIKI_NATIVE_TARGET_PROFILE_TARGET', '']
  ];
  for (const [key, value] of bad) {
    assert.throws(() => parseRuntimeSettings(`${key}=${value}`), error => {
      assert.match(error.message, new RegExp(key));
      if (value.length > 3) assert.ok(!error.message.includes(value));
      return true;
    });
  }
});

test('a missing settings file means no change', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-settings-'));
  assert.deepEqual(readRuntimeSettings(path.join(directory, 'prod-runtime-settings.env')), {});
  fs.writeFileSync(path.join(directory, 'prod-runtime-settings.env'), text({ WIKI_TARGET_DEV2_URL: valid.WIKI_TARGET_DEV2_URL }));
  assert.deepEqual(readRuntimeSettings(path.join(directory, 'prod-runtime-settings.env')), { WIKI_TARGET_DEV2_URL: valid.WIKI_TARGET_DEV2_URL });
});
