import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { zip } from './fixture.mjs';
import { readConfiguration } from '../lib/e365.mjs';
import { configAcquisitions, configSourceClient } from '../lib/config-source.mjs';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { createServer } from '../server.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const actor = { id: 'synthetic', login: 'synthetic', provider: 'local' };
const native = async code => zip([['package.json', { code, type: 'SOLUTION', dependencies: { widgets: [{ code: 'paid', data: { namespace: 'paid', code: 'external' } }] } }],
  ['widgets.zip', await zip([['manifest.json', { entities: [{ code: 'form', namespace: code + '.records', path: 'form.json', kind: 'WIDGET' }] }],
    ['form.json', { descriptor: { fields: [{ code: 'value', type: 'STRING' }], clientScripts: 'const x = 1;' } }],
    ['unknown.bin', Buffer.from([0, 255])]])]]);
const bundle = async (members, extra = []) => zip([['config-bundle.json', { format: 'elma-config-bundle', schemaVersion: 1, deployable: false,
  dependencyEvidence: { schemaVersion: 1, catalog: [{ code: 'paid', paid: true, version: '1.0', namespaces: ['paid'], observedAt: '2026-10-09T00:00:00Z' }] },
  solutions: [...members.map(([code, bytes]) => ({ code, status: 'exported', path: 'solutions/' + code + '.e365', sha256: sha(bytes), bytes: bytes.length })), { code: 'paid', status: 'excluded-paid' }] }],
  ...members.map(([code, bytes]) => ['solutions/' + code + '.e365', bytes]), ...extra]);

test('native and full configuration preserve members; paid exclusions never become editable', async () => {
  const a = await native('alpha'), b = await native('beta'), bytes = await bundle([['alpha', a], ['beta', b]]);
  const parsed = await readConfiguration(bytes);
  assert.deepEqual(parsed.solutions.map(row => row.code), ['alpha', 'beta']);
  assert.deepEqual(parsed.solutions[0].bytes, a);
  assert.equal(parsed.exclusions[0].status, 'excluded-paid');
  assert.equal((await readConfiguration(a)).format, 'native-e365');
  await assert.rejects(readConfiguration(await bundle([['wrong', a]])), /solution|limit/);
  await assert.rejects(readConfiguration(await bundle([['alpha', a], ['alpha', a]])), /duplicate|повтор|повреждён/i);
  await assert.rejects(readConfiguration(await bundle([['alpha', a]], [['unlisted', 'extra']])), /Unlisted/);
  const wrong = await zip([['config-bundle.json', { format: 'elma-config-bundle', schemaVersion: 1, deployable: false,
    solutions: [{ code: 'alpha', status: 'exported', path: 'solutions/alpha.e365', sha256: '0'.repeat(64), bytes: a.length }] }], ['solutions/alpha.e365', a]]);
  await assert.rejects(readConfiguration(wrong), /checksum/);
});

test('acquisition validates all members, retains originals and attribution, resumes once across restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'config-source-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const a = await native('alpha'), bytes = await bundle([['alpha', a]]);
  let artifactCalls = 0, ready = false;
  const client = { start: async () => ({ id: crypto.randomUUID() }), status: async () => ready ? { state: 'ready', result: { sha256: sha(bytes), bytes: bytes.length } } : { state: 'running' },
    artifact: async () => { artifactCalls++; return bytes; } };
  let solutions = solutionStore(directory), acquisitions = configAcquisitions(directory, solutions.uploads, client);
  const job = await acquisitions.start({ server: 'dev2' }, actor); assert.equal(job.remoteId, undefined);
  assert.equal((await acquisitions.get(job.id)).state, 'exporting');
  solutions = solutionStore(directory); acquisitions = configAcquisitions(directory, solutions.uploads, client); ready = true;
  const [first, second] = await Promise.all([acquisitions.get(job.id), acquisitions.get(job.id)]);
  assert.equal(first.solutions[0].dependencies.rows[0].status, 'paid-source-unavailable');
  assert.equal(first.state, 'ready'); assert.deepEqual(first, second); assert.equal(artifactCalls, 1);
  assert.deepEqual(await acquisitions.original(job.id), bytes);
  const snapshot = await solutions.uploads.snapshot(first.solutions[0].project.id, SOLUTION_CATALOG, first.solutions[0].project.currentSnapshotId);
  assert.deepEqual(snapshot.metadata.source, { connectionId: 'config-api-dev2', solutionRef: 'alpha' });
  assert.equal(snapshot.metadata.uploadedBy.id, actor.id);
  const manual = await acquisitions.upload(a, actor);
  assert.equal(manual.solutions[0].project.source, undefined);
  const invalid = await bundle([['alpha', a], ['beta', Buffer.from('invalid')]]);
  const before = (await solutions.uploads.list(SOLUTION_CATALOG)).length;
  await assert.rejects(acquisitions.upload(invalid, actor));
  assert.equal((await solutions.uploads.list(SOLUTION_CATALOG)).length, before);
  await assert.rejects(acquisitions.start({ server: 'dev', url: 'http://bad' }, actor));
  await fs.writeFile(path.join(directory, 'config-acquisitions', job.id, 'original.e365'), 'corrupted');
  await assert.rejects(acquisitions.original(job.id), /сумма/);
});

test('configured HTTP adapter keeps token local, refuses redirects and checks remote errors', async () => {
  let request;
  const client = configSourceClient({ url: 'http://source.invalid', token: 'synthetic-secret', fetcher: async (url, options) => {
    request = { url, options }; return new Response(JSON.stringify({ servers: [] })); } });
  await client.servers(); assert.equal(request.options.redirect, 'error'); assert.equal(request.options.headers.Authorization, 'Bearer synthetic-secret');
  assert.equal(configSourceClient({}), null);
  assert.throws(() => configSourceClient({ url: 'http://source.invalid' }), /both/);
  assert.throws(() => configSourceClient({ url: 'http://user:password@host', token: 'x' }));
  const failed = configSourceClient({ url: 'http://source.invalid', token: 'x', fetcher: async () => new Response('secret', { status: 500 }) });
  await assert.rejects(failed.servers(), error => !error.message.includes('secret') && error.statusCode === 502);
});

test('Wiki API acquisition requires session and same-origin writes; Source selection cannot forge credentials', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'config-api-http-'));
  const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined, configSource: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/api/config-source/servers')).status, 401);
  const login = await fetch(base + '/auth/local', { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1' } }); assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const headers = { cookie, 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' };
  const bytes = await native('alpha');
  const upload = await fetch(base + '/api/config-source/uploads', { method: 'POST', headers, body: bytes }); assert.equal(upload.status, 201);
  const record = await upload.json(); assert.equal(record.state, 'ready');
  assert.equal((await fetch(base + '/api/config-source/acquisitions/' + record.id)).status, 401);
  const original = await fetch(base + '/api/config-source/acquisitions/' + record.id + '/original', { headers: { cookie } });
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
  assert.equal((await fetch(base + '/api/config-source/uploads', { method: 'POST', headers: { ...headers, Origin: 'https://bad.invalid' }, body: bytes })).status, 403);
  const invalid = await fetch(base + '/api/config-source/exports', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ server: 'dev', token: 'forged' }) });
  assert.equal(invalid.status, 400);
});
