// Synthetic: no SSH, no network, fictional values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRuntimeSettings, parseUpdateArgs, readRuntimeSettings, RUNTIME_SETTINGS } from '../tools/prod-settings.mjs';

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
  assert.deepEqual(Object.keys(RUNTIME_SETTINGS).sort(), [...Object.keys(valid), 'WIKI_TARGET_DEV2_DESIGNATIONS'].sort());
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

test('an empty candidate list withdraws every designation; other keys still refuse empty values', () => {
  assert.deepEqual(parseRuntimeSettings('WIKI_TARGET_DEV2_DEPLOY_CANDIDATES='), { WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: '' });
  assert.deepEqual(parseRuntimeSettings('WIKI_TARGET_DEV2_DEPLOY_CANDIDATES=""'), { WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: '' });
  for (const value of [' ', ',', `,${'d'.repeat(64)}`, `${'d'.repeat(64)},,${'e'.repeat(64)}`, 'd'.repeat(63), 'd'.repeat(65)])
    assert.throws(() => parseRuntimeSettings(`WIKI_TARGET_DEV2_DEPLOY_CANDIDATES="${value}"`), /invalid format: WIKI_TARGET_DEV2_DEPLOY_CANDIDATES$/);
  for (const key of Object.keys(RUNTIME_SETTINGS).filter(key => key !== 'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES'))
    assert.throws(() => parseRuntimeSettings(`${key}=`), new RegExp(`invalid format: ${key}$`));
});

test('a missing settings file means no change', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-settings-'));
  assert.deepEqual(readRuntimeSettings(path.join(directory, 'prod-runtime-settings.env')), {});
  fs.writeFileSync(path.join(directory, 'prod-runtime-settings.env'), text({ WIKI_TARGET_DEV2_URL: valid.WIKI_TARGET_DEV2_URL }));
  assert.deepEqual(readRuntimeSettings(path.join(directory, 'prod-runtime-settings.env')), { WIKI_TARGET_DEV2_URL: valid.WIKI_TARGET_DEV2_URL });
});

test('file designation mode is adopted explicitly, only as `file` and only with an empty startup candidate list', () => {
  assert.deepEqual(parseRuntimeSettings('WIKI_TARGET_DEV2_DESIGNATIONS=file\nWIKI_TARGET_DEV2_DEPLOY_CANDIDATES='),
    { WIKI_TARGET_DEV2_DESIGNATIONS: 'file', WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: '' });
  for (const value of ['env', 'FILE', 'file,env', ''])
    assert.throws(() => parseRuntimeSettings(`WIKI_TARGET_DEV2_DESIGNATIONS="${value}"`), /invalid format: WIKI_TARGET_DEV2_DESIGNATIONS$/);
  assert.throws(() => parseRuntimeSettings(`WIKI_TARGET_DEV2_DESIGNATIONS=file\nWIKI_TARGET_DEV2_DEPLOY_CANDIDATES=${'d'.repeat(64)}`), error => {
    assert.match(error.message, /requires an empty WIKI_TARGET_DEV2_DEPLOY_CANDIDATES/);
    assert.ok(!error.message.includes('d'.repeat(64)));
    return true;
  });
});

test('designation arguments carry only an action and exact digests; anything else is refused without echoing it', () => {
  const [d, e] = ['d'.repeat(64), 'e'.repeat(64)];
  assert.deepEqual(parseUpdateArgs([]), { check: false, designation: null });
  assert.deepEqual(parseUpdateArgs(['--check']), { check: true, designation: null });
  assert.deepEqual(parseUpdateArgs([`--designate-grant=${d},${e}`]), { check: false, designation: { action: 'grant', candidates: [d, e] } });
  assert.deepEqual(parseUpdateArgs(['--check', `--designate-withdraw=${e}`]), { check: true, designation: { action: 'withdraw', candidates: [e] } });
  assert.deepEqual(parseUpdateArgs(['--designate-withdraw-all', '--check']), { check: true, designation: { action: 'withdraw-all', candidates: [] } });
  const bad = [['--designate-grant='], [`--designate-grant=${d.toUpperCase()}`], [`--designate-grant=${d}, ${e}`], [`--designate-grant=${d},${d}`],
    [`--designate-grant=${d},`], ['--designate-grant=*'], [`--designate-grant=${d}\n`], ['--designate-withdraw-all=1'], [`--designate-grant=${d}`, `--designate-withdraw=${e}`],
    ['--designate-withdraw-all', '--designate-withdraw-all'], ['--check', '--check'], ['--designate-path=/etc/passwd'], ['--designate-grant', d], ['--host=other.example.invalid'],
    [`--designate-grant=${Array.from({ length: 33 }, (_, i) => i.toString(16).padStart(64, '0')).join(',')}`], ['--settings=WIKI_TARGET_DEV2_URL=https://x.example.invalid']];
  for (const args of bad) assert.throws(() => parseUpdateArgs(args), error => {
    for (const value of args.map(arg => arg.split('=').slice(1).join('=')).filter(value => value.length > 3))
      assert.ok(!error.message.includes(value), 'no argument value is echoed');
    return true;
  });
});
