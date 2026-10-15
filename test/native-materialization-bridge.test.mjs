import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { bridgeStore, MATERIALIZE_PAYLOAD_KEYS } from '../lib/bridge.mjs';
import * as bridgeModule from '../lib/native-materialization-bridge.mjs';
import { configuredMaterializationAdapter, isConfiguredMaterializationAdapter } from '../lib/native-materialization-bridge.mjs';
import { materializeServer, call, sha, WORKER_REVISION } from './bridge-worker-fixture.mjs';

// Transport of `materialize` jobs over the operator bridge with a synthetic HTTP worker. The envelope is a
// stand-in: E1 request/receipt validation is exercised end to end in native-materialization.test.mjs.
const ORIGINALS = new Map([['base', Buffer.from('synthetic base archive')], ['change', Buffer.from('synthetic change archive')]]);
const envelope = () => ({ contract: { id: 'elma365-native-materialization', version: 1 }, request: { inputs: { solution: 'synthetic_contracts' } },
  originals: [...ORIGINALS].map(([artifactId, bytes]) => ({ artifactId, sha256: sha(bytes), size: bytes.length })) });
const OUTPUT = Buffer.from('synthetic native output archive');
const receipt = { status: 'validated', marker: 'synthetic-receipt' };
const jobRecords = async (directory, bridgeId) => {
  const dir = path.join(directory, 'delivery', 'bridges', bridgeId, 'jobs');
  const names = (await fs.readdir(dir).catch(() => [])).filter(name => name.endsWith('.json'));
  return Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))));
};
const settled = promise => promise.then(value => ({ value }), error => ({ error }));

test('not configured by default: no adapter, so materializeNative keeps returning unavailable', async t => {
  const { adapter } = await materializeServer(t, { configure: false });
  assert.equal(adapter, null);
  const bridges = bridgeStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-config-')));
  const full = { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: '00000000-0000-4000-8000-000000000000', WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'synthetic-owner',
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER_REVISION };
  const logged = [], log = message => logged.push(message), configure = env => configuredMaterializationAdapter({ env, bridges, log });
  assert.equal(configure({}), null); assert.deepEqual(logged, [], 'no variables: silently unavailable');
  assert.ok(configure(full));
  for (const key of Object.keys(full)) assert.equal(configure({ ...full, [key]: '' }), null, key);
  assert.equal(configure({ ...full, WIKI_NATIVE_MATERIALIZATION_REVISION: 'main' }), null);
  assert.equal(configure({ ...full, WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: '../other' }), null);
  assert.equal(logged.length, 5);
  assert.match(logged[0], /disabled: missing WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID$/);
  const configured = configure(full);
  assert.deepEqual(configured.contract, { id: 'elma365-native-materialization', version: 1 });
  assert.equal(configured.nativeRevision, WORKER_REVISION); assert.equal(typeof configured.deployCandidate, 'undefined');
});

test('invalid timeout or output limit disables the adapter at startup with a secret-free reason', async t => {
  const bridges = bridgeStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-limits-')));
  const owner = 'owner-' + 'q'.repeat(12);
  const full = { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: '00000000-0000-4000-8000-000000000000', WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: owner,
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER_REVISION };
  for (const [key, value] of [['TIMEOUT_MS', '-5'], ['TIMEOUT_MS', '0'], ['TIMEOUT_MS', '1.5'], ['TIMEOUT_MS', 'soon'], ['TIMEOUT_MS', String(2 ** 31)],
    ['MAX_OUTPUT_BYTES', '-1'], ['MAX_OUTPUT_BYTES', '0'], ['MAX_OUTPUT_BYTES', '1e3'], ['MAX_OUTPUT_BYTES', String(256 * 1024 * 1024 + 1)]]) {
    const logged = [];
    assert.equal(configuredMaterializationAdapter({ env: { ...full, ['WIKI_NATIVE_MATERIALIZATION_' + key]: value }, bridges, log: message => logged.push(message) }), null, key + '=' + value);
    assert.equal(logged.length, 1); assert.match(logged[0], new RegExp('WIKI_NATIVE_MATERIALIZATION_' + key));
    // The reason names the variable, never a configured value.
    assert.ok(!logged[0].includes(owner) && !logged[0].includes(full.WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID) && !logged[0].includes(' ' + value + ' '), logged[0]);
  }
  const ok = configuredMaterializationAdapter({ env: { ...full, WIKI_NATIVE_MATERIALIZATION_TIMEOUT_MS: '1000', WIKI_NATIVE_MATERIALIZATION_MAX_OUTPUT_BYTES: '1024' }, bridges, log: assert.fail });
  assert.ok(ok);
  assert.equal(isConfiguredMaterializationAdapter(ok), true);
  // The factory taking a caller revision is not exported; a stub store is not a bridge store.
  assert.equal('bridgeMaterializationAdapter' in bridgeModule, false);
  const stub = { enqueue: async () => ({}), get: async () => ({}) }, stubLog = [];
  assert.equal(configuredMaterializationAdapter({ env: full, bridges: stub, log: message => stubLog.push(message) }), null);
  assert.match(stubLog[0], /no bridge store/);
  assert.equal(isConfiguredMaterializationAdapter({ ...ok }), false);
});

test('materialize job: originals by sha256, output upload bound to sha256 and size, receipt returned; never an import', async t => {
  const env = await materializeServer(t);
  const capabilities = { jobKinds: ['health', 'materialize', 'unknown-kind'], materialize: { contract: { id: 'elma365-native-materialization', version: 1 },
    nativeRevision: WORKER_REVISION, targetProfileDigest: 'a'.repeat(64), compilerProfileDigest: 'not-a-digest' } };
  const worker = env.worker({ capabilities, handle: async ({ job, originals }) => {
    // A deploy-style candidate download is refused for a materialize job.
    assert.equal((await call(env.base, `/api/bridge/jobs/${job.id}/artifact`, { token: env.token })).status, 404);
    assert.deepEqual([...originals.keys()].sort(), ['base', 'change']);
    return { receipt, bytes: OUTPUT };
  } });
  const result = await env.adapter.materialize({ envelope: envelope(), originals: ORIGINALS });
  assert.deepEqual(result.receipt, receipt);
  assert.equal(result.artifacts.length, 1); assert.equal(result.artifacts[0].solution, 'synthetic_contracts'); assert.ok(result.artifacts[0].bytes.equals(OUTPUT));

  const [job] = worker.seen;
  assert.equal(job.kind, 'materialize'); assert.equal(job.imports, false); assert.equal(job.hasArtifact, false);
  assert.deepEqual(Object.keys(job.payload).sort(), [...MATERIALIZE_PAYLOAD_KEYS].sort());
  assert.deepEqual(job.payload.originals, envelope().originals);
  assert.deepEqual(job.inputs.map(row => row.sha256).sort(), envelope().originals.map(row => row.sha256).sort());
  assert.equal(job.outputLimitBytes, 256 * 1024 * 1024);
  assert.deepEqual(job.upload.body, { ok: true, sha256: sha(OUTPUT), size: OUTPUT.length });

  const [record] = await jobRecords(env.directory, env.bridge.id);
  assert.equal(record.state, 'done'); assert.deepEqual(record.result.receipt, receipt);
  assert.deepEqual({ sha256: record.result.output.sha256, size: record.result.output.size }, { sha256: sha(OUTPUT), size: OUTPUT.length });
  // Job-scoped bytes leave with the job; nothing about it persists beyond the record.
  await assert.rejects(fs.access(path.join(env.directory, 'delivery', 'bridges', env.bridge.id, 'jobs', record.id)), { code: 'ENOENT' });
  assert.equal((await call(env.base, `/api/bridge/jobs/${record.id}/inputs/${envelope().originals[0].sha256}`, { token: env.token })).status, 404);

  // Advertised capabilities are recorded as reported and marked untrusted; malformed values are dropped.
  const bridge = await bridgeStore(env.directory).get(env.bridge.id, 'synthetic-owner');
  assert.deepEqual(bridge.capabilities.jobKinds, ['health', 'materialize']);
  assert.equal(bridge.capabilities.trusted, false);
  assert.deepEqual(bridge.capabilities.materialize, { contract: { id: 'elma365-native-materialization', version: 1 }, nativeRevision: WORKER_REVISION,
    targetProfileDigest: 'a'.repeat(64), compilerProfileDigest: null });
});

test('tampered or oversized uploads are refused and never reach the caller', async t => {
  const env = await materializeServer(t, { maxOutputBytes: 64 });
  const answers = [{ receipt, bytes: OUTPUT, declaredSha256: sha(Buffer.from('other bytes')) }, { receipt, bytes: Buffer.alloc(65, 1) }];
  const worker = env.worker({ handle: async () => answers.shift() });
  const tampered = await env.adapter.materialize({ envelope: envelope(), originals: ORIGINALS });
  assert.equal(worker.seen[0].upload.status, 422); assert.deepEqual(tampered.artifacts, []);
  const oversized = await env.adapter.materialize({ envelope: envelope(), originals: ORIGINALS });
  assert.equal(worker.seen[1].outputLimitBytes, 64);
  assert.equal(worker.seen[1].upload.status, 413); assert.deepEqual(oversized.artifacts, []);
  for (const record of await jobRecords(env.directory, env.bridge.id)) assert.equal(record.result.output, null);
});

test('store binds the uploaded bytes to the declared size and accepts one output per job', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-output-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = bridgeStore(directory), { bridge, token } = await store.create('synthetic-owner', { name: 'Synthetic' });
  const worker = await store.authenticate(`Bearer ${token}`);
  const pending = settled(store.enqueue(bridge.id, 'materialize', { contract: {}, envelope: {}, originals: envelope().originals }, { inputs: [...ORIGINALS.values()] }));
  const job = await store.poll(worker);
  await assert.rejects(store.output(worker, job.id, { sha256: sha(OUTPUT), size: OUTPUT.length + 1, bytes: OUTPUT }), { statusCode: 422 });
  await assert.rejects(store.output(worker, job.id, { sha256: sha(OUTPUT), size: OUTPUT.length, bytes: Buffer.concat([OUTPUT.subarray(1), Buffer.from('x')]) }), { statusCode: 422 });
  await assert.rejects(store.output(worker, job.id, { sha256: 'nothex', size: OUTPUT.length, bytes: OUTPUT }), { statusCode: 400 });
  assert.deepEqual(await store.output(worker, job.id, { sha256: sha(OUTPUT), size: OUTPUT.length, bytes: OUTPUT }), { ok: true, sha256: sha(OUTPUT), size: OUTPUT.length });
  await assert.rejects(store.output(worker, job.id, { sha256: sha(OUTPUT), size: OUTPUT.length, bytes: OUTPUT }), { statusCode: 409 });
  await store.complete(worker, job.id, { ok: true, result: { receipt } });
  const { value } = await pending;
  assert.ok(value.output.bytes.equals(OUTPUT)); assert.equal(value.output.size, OUTPUT.length);
});

test('output uploads stream to disk and hold one slot per job: a concurrent upload is refused', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-stream-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = bridgeStore(directory), { bridge, token } = await store.create('synthetic-owner', { name: 'Synthetic' });
  const worker = await store.authenticate(`Bearer ${token}`);
  // A negative requested limit never becomes a negative job limit.
  const pending = settled(store.enqueue(bridge.id, 'materialize', { contract: {}, envelope: {}, originals: envelope().originals, output: { maxBytes: -1 } }, { inputs: [...ORIGINALS.values()] }));
  const job = await store.poll(worker);
  assert.equal(job.outputLimitBytes, 256 * 1024 * 1024);
  // A large output arrives in chunks; the first upload holds the slot while it streams.
  const chunk = Buffer.alloc(1024 * 1024, 7), chunks = 4, whole = Buffer.concat(Array(chunks).fill(chunk));
  const source = new PassThrough();
  const first = store.writeOutput(worker, job.id, { sha256: sha(whole), size: whole.length }, source);
  source.write(chunk);
  await new Promise(resolve => setTimeout(resolve, 50));
  const tempFiles = (await fs.readdir(path.join(directory, 'delivery', 'bridges', bridge.id, 'jobs', job.id))).filter(name => name.endsWith('.tmp'));
  assert.equal(tempFiles.length, 1, 'the body streams into a private temp file');
  await assert.rejects(store.writeOutput(worker, job.id, { sha256: sha(whole), size: whole.length }, Readable.from([whole])), { statusCode: 409 });
  await assert.rejects(store.output(worker, job.id, { sha256: sha(whole), size: whole.length, bytes: whole }), { statusCode: 409 });
  for (let index = 1; index < chunks; index++) source.write(chunk);
  source.end();
  assert.deepEqual(await first, { ok: true, sha256: sha(whole), size: whole.length });
  const files = await fs.readdir(path.join(directory, 'delivery', 'bridges', bridge.id, 'jobs', job.id));
  assert.deepEqual(files.filter(name => name !== 'inputs').sort(), ['output']);
  // The slot is now taken by the committed output.
  await assert.rejects(store.output(worker, job.id, { sha256: sha(whole), size: whole.length, bytes: whole }), { statusCode: 409 });
  await store.complete(worker, job.id, { ok: true, result: { receipt } });
  assert.ok((await pending).value.output.bytes.equals(whole));

  // A short or tampered stream leaves no temp file and frees the slot for a retry.
  const again = settled(store.enqueue(bridge.id, 'materialize', { contract: {}, envelope: {}, originals: envelope().originals }, { inputs: [...ORIGINALS.values()] }));
  const next = await store.poll(worker);
  await assert.rejects(store.writeOutput(worker, next.id, { sha256: sha(whole), size: whole.length }, Readable.from([chunk])), { statusCode: 422 });
  await assert.rejects(store.writeOutput(worker, next.id, { sha256: sha(whole), size: whole.length }, Readable.from([Buffer.alloc(whole.length, 1)])), { statusCode: 422 });
  assert.deepEqual((await fs.readdir(path.join(directory, 'delivery', 'bridges', bridge.id, 'jobs', next.id))).filter(name => name !== 'inputs'), []);
  assert.equal((await store.writeOutput(worker, next.id, { sha256: sha(whole), size: whole.length }, Readable.from([whole]))).ok, true);
  await store.complete(worker, next.id, { ok: true, result: { receipt } });
  await again;
});

test('timeout or a lost worker is an unknown outcome, never success; a late result stays evidence only', async t => {
  const env = await materializeServer(t, { timeoutMs: 400 });
  const worker = env.worker({ handle: async () => ({ skip: true }) });
  await assert.rejects(env.adapter.materialize({ envelope: envelope(), originals: ORIGINALS }), { code: 'NATIVE_OUTCOME_UNKNOWN', detail: 'timeout' });
  const [job] = worker.seen;
  // The fenced job releases nothing more and refuses an output.
  assert.equal((await call(env.base, `/api/bridge/jobs/${job.id}/inputs/${job.inputs[0].sha256}`, { token: env.token })).status, 404);
  assert.equal((await call(env.base, `/api/bridge/jobs/${job.id}/output`, { token: env.token, method: 'PUT', bytes: OUTPUT, headers: { 'X-Content-Sha256': sha(OUTPUT) } })).status, 404);
  let [record] = await jobRecords(env.directory, env.bridge.id);
  assert.equal(record.state, 'unknown-outcome');
  assert.equal((await call(env.base, `/api/bridge/jobs/${job.id}/result`, { token: env.token, method: 'POST', json: { ok: true, result: { receipt } } })).status, 200);
  [record] = await jobRecords(env.directory, env.bridge.id);
  assert.equal(record.lateCompletion, true); assert.equal(record.result.output, null);
});

test('job inputs and outputs are bearer- and job-scoped; another owner cannot use the bridge', async t => {
  const env = await materializeServer(t);
  let probe;
  const worker = env.worker({ handle: async ({ job }) => {
    const input = `/api/bridge/jobs/${job.id}/inputs/${job.inputs[0].sha256}`, output = `/api/bridge/jobs/${job.id}/output`;
    const local = await fetch(env.base + '/auth/local', { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' }, body: '{}' });
    const cookie = local.headers.get('set-cookie')?.split(';')[0];
    probe = {
      anonymous: (await call(env.base, input)).status,
      session: (await call(env.base, input, { headers: { Cookie: cookie } })).status,
      otherBridge: (await call(env.base, input, { token: env.otherToken })).status,
      otherUpload: (await call(env.base, output, { token: env.otherToken, method: 'PUT', bytes: OUTPUT, headers: { 'X-Content-Sha256': sha(OUTPUT) } })).status,
      unknownInput: (await call(env.base, `/api/bridge/jobs/${job.id}/inputs/${'0'.repeat(64)}`, { token: env.token })).status,
      noDigest: (await call(env.base, output, { token: env.token, method: 'PUT', bytes: OUTPUT })).status,
      wrongType: (await call(env.base, output, { token: env.token, method: 'PUT', json: {}, headers: { 'X-Content-Sha256': sha(OUTPUT) } })).status
    };
    return { receipt, bytes: OUTPUT };
  } });
  await env.adapter.materialize({ envelope: envelope(), originals: ORIGINALS });
  assert.deepEqual(probe, { anonymous: 401, session: 401, otherBridge: 404, otherUpload: 404, unknownInput: 404, noDigest: 400, wrongType: 415 });

  // An adapter configured for an owner who does not own the bridge never enqueues.
  const foreign = configuredMaterializationAdapter({ bridges: bridgeStore(env.directory), log: assert.fail, env: { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: env.bridge.id,
    WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'other-owner', WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER_REVISION } });
  const before = (await jobRecords(env.directory, env.bridge.id)).length;
  await assert.rejects(foreign.materialize({ envelope: envelope(), originals: ORIGINALS }), { statusCode: 404 });
  assert.equal((await jobRecords(env.directory, env.bridge.id)).length, before);
  // Originals that do not match the envelope are never sent.
  await assert.rejects(env.adapter.materialize({ envelope: envelope(), originals: new Map([...ORIGINALS, ['change', Buffer.from('altered')]]) }), /do not match/);
});

test('deploy semantics are refused for materialize jobs', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-refusal-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = bridgeStore(directory), { bridge, token } = await store.create('synthetic-owner', { name: 'Synthetic' });
  const worker = await store.authenticate(`Bearer ${token}`);
  const inputs = [...ORIGINALS.values()], payload = { contract: {}, envelope: {}, originals: envelope().originals };
  await assert.rejects(store.enqueue(bridge.id, 'materialize', payload, { inputs, artifact: OUTPUT }), { statusCode: 422 });
  await assert.rejects(store.enqueue(bridge.id, 'materialize', { ...payload, code: 'synthetic_contracts' }, { inputs }), { statusCode: 422 });
  await assert.rejects(store.enqueue(bridge.id, 'materialize', payload, {}), { statusCode: 422 });
  await assert.rejects(store.enqueue(bridge.id, 'materialize', { ...payload, originals: [{ artifactId: 'x', sha256: '0'.repeat(64), size: 1 }] }, { inputs }), { statusCode: 422 });
  await assert.rejects(store.enqueue(bridge.id, 'deploy', { code: 'synthetic' }, { artifact: OUTPUT, inputs }), { statusCode: 422 });
  assert.deepEqual(await jobRecords(directory, bridge.id), []);

  // A worker reporting an import, a Target identity or anything but a receipt fails the job.
  for (const result of [{ receipt, imported: true }, { receipt, identity: { host: 'target.example.invalid' } }, {}, null]) {
    const pending = settled(store.enqueue(bridge.id, 'materialize', payload, { inputs }));
    const job = await store.poll(worker);
    assert.equal(job.imports, false);
    await assert.rejects(store.artifact(worker, job.id), { statusCode: 404 });
    assert.deepEqual(await store.complete(worker, job.id, { ok: true, result }), { ok: true, state: 'failed' });
    const { error } = await pending;
    assert.equal(error.message, 'materialize-result-invalid');
  }
});
