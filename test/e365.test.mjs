import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, interpretFiles, updateEnvironment, safePath, serverKey, limits } from '../lib/e365.mjs';
import { fixture, zip } from './fixture.mjs';
import { demoData } from '../lib/demo.mjs';

test('nested services and extracted layouts produce the same metadata', async () => {
  const a = await interpret(await fixture(), 'development'), b = await interpret(await fixture({ nested: false }), 'development');
  assert.deepEqual(a.entities, b.entities);
  assert.equal(a.entities[0].fields[0].code, 'title');
  assert.deepEqual(a.entities[0].functions, ['check', 'onOpen']);
  assert.deepEqual(a.entities[0].rpcFunctions, ['check']);
  assert.equal(a.entities[0].lifecycle.onInit.name, 'onOpen');
  assert.equal(a.entities[0].variableUsage['ViewContext.data.title'], 1);
  assert.ok(!JSON.stringify(a).includes('TEST_SENTINEL_VALUE_NOT_A_REAL_SECRET'));
  assert.ok(!JSON.stringify(a).includes('const ignored'));
  assert.ok(!JSON.stringify(a).includes('TEST_LITERAL'));
  assert.ok(!JSON.stringify(a).includes('TEST_COMMENT'));
  assert.ok(!Object.hasOwn(a.entities[0], 'runtime'));
});
test('leading slashes used in platform exports are normalized', async () => {
  const buffer = await zip([
    ['xpackage.json', { code: 'leading' }],
    ['xwidgets/manifest.json', { entities: [{ code: 'form', namespace: 'example', path: '/form.json' }] }],
    ['xwidgets/form.json', { descriptor: { fields: [] } }]
  ]);
  // Replace filenames in local headers and central directory without changing lengths.
  const rewritten = Buffer.from(buffer.toString('latin1').replaceAll('xpackage', '/package').replaceAll('xwidgets', '/widgets'), 'latin1');
  assert.equal(safePath('/widgets/form.json'), 'widgets/form.json');
  assert.equal((await interpret(rewritten, 'local')).entities[0].source, 'widgets/form.json');
});
test('invalid archives and unsafe keys are rejected without raw JSON contents', async () => {
  await assert.rejects(interpret(Buffer.from('not zip'), 'local'), /ZIP/);
  for (const key of ['../bad', '__proto__', 'constructor', '', 'production:80']) assert.throws(() => serverKey(key));
  for (const p of ['../../file', '/safe/../file', 'C:/secret', 'a\0b', 'a//b']) assert.throws(() => safePath(p));
  await assert.rejects(interpret(await zip([['package.json', '{invalid secret text']]), 'local'), /JSON/);
  const files = new Map([['package.json', Buffer.from('{"code":"test"}')], ['../bad', Buffer.from('bad')]]);
  assert.throws(() => interpretFiles(files, 'local'));
});
test('opaque container is visible and never decrypted', async () => {
  const result = await interpret(await zip([['package.json', { code: 'opaque_example', paidPackage: true }], ['data', 'not readable']]), 'local');
  assert.equal(result.solution.status, 'opaque'); assert.equal(result.entities.length, 0); assert.equal(result.solution.warnings.length, 1);
});
test('merge replaces one package, isolates environments and resolves dependencies', async () => {
  let data = { servers: {}, readOnly: true };
  data = updateEnvironment(data, 'development', await interpret(await fixture({ code: 'consumer', target: 'form' }), 'development'));
  data = updateEnvironment(data, 'development', await interpret(await fixture({ code: 'provider' }), 'development'));
  assert.equal(data.servers.development.solutions[0].dependencies[0].status, 'ambiguous');
  data = updateEnvironment(data, 'staging', await interpret(await fixture({ code: 'provider' }), 'staging'));
  assert.equal(data.servers.development.entities.length, 2); assert.equal(data.servers.staging.entities.length, 1);
  data = updateEnvironment(data, 'development', await interpret(await fixture({ code: 'provider', fieldCode: 'changed' }), 'development'));
  assert.equal(data.servers.development.entities.length, 2); assert.equal(data.servers.development.stats.fields, 2);
  assert.equal(data.servers.development.entities.find(e => e.solution === 'provider').fields[0].code, 'changed');
});
test('size metadata limits reject an entry before inflation', async () => {
  const buffer = await zip([['package.json', { code: 'example' }]]), modified = Buffer.from(buffer);
  const central = modified.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  modified.writeUInt32LE(limits.entry + 1, central + 24);
  await assert.rejects(interpret(modified, 'local'), /ограничения/);
});
test('showcase is synthetic and contains no script bodies', () => {
  const data = demoData(), s = data.servers.showcase;
  assert.deepEqual(s.stats, { catalog: 1, exported: 1, entities: 6, modules: 1, fields: 12, functions: 5 });
  assert.equal(s.solutions[0].dependencies[0].status, 'present');
  assert.ok(!JSON.stringify(data).includes('function onOpen()'));
});
