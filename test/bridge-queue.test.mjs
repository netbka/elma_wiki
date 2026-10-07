import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { bridgeStore } from '../lib/bridge.mjs';

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-queue-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = bridgeStore(directory), { bridge, token } = await store.create('alice', { name: 'Synthetic operator' });
  const worker = await store.authenticate(`Bearer ${token}`);
  const jobs = path.join(directory, 'delivery', 'bridges', bridge.id, 'jobs');
  const records = async () => (await fs.readdir(jobs).catch(e => { if (e.code === 'ENOENT') return []; throw e; }))
    .filter(name => name.endsWith('.json'));
  const enqueue = signal => {
    const result = store.enqueue(bridge.id, 'deploy', { code: 'synthetic' }, { signal, artifact: Buffer.from('synthetic') });
    result.catch(() => {});
    return result;
  };
  return { directory, store, bridge, worker, jobs, records, enqueue };
}

test('queued abort cannot dispatch later and discards candidate bytes', async t => {
  const { store, bridge, worker, jobs, enqueue } = await setup(t);
  const controller = new AbortController(), result = enqueue(controller.signal);
  // poll and enqueue use the same serialized store; a second create is a persistence barrier.
  await store.create('alice', { name: 'Queue barrier' });
  controller.abort();
  await assert.rejects(result, { code: 'TIMEOUT' });
  assert.equal(await store.poll(worker), null);
  const files = await fs.readdir(jobs);
  assert.equal(files.some(name => name.endsWith('.e365')), false);
  const record = JSON.parse(await fs.readFile(path.join(jobs, files.find(n => n.endsWith('.json'))), 'utf8'));
  assert.equal(record.bridgeId, bridge.id); assert.equal(record.state, 'cancelled');
});

test('already aborted input and removed bridge cannot create dispatchable jobs', async t => {
  const { store, bridge, worker, enqueue, records } = await setup(t);
  await assert.rejects(enqueue(AbortSignal.abort()), { code: 'TIMEOUT' });
  assert.deepEqual(await records(), []);
  await store.remove(bridge.id, 'alice');
  await assert.rejects(enqueue(), { statusCode: 404 });
  await assert.rejects(store.poll(worker), { statusCode: 404 });
  assert.deepEqual(await records(), []);
});

test('claimed abort denies artifact; late worker result is evidence, never redispatch', async t => {
  const { store, worker, enqueue, jobs } = await setup(t);
  const controller = new AbortController(), result = enqueue(controller.signal);
  const job = await store.poll(worker);
  assert.equal(job.kind, 'deploy');
  controller.abort();
  await assert.rejects(result, { code: 'TIMEOUT' });
  await assert.rejects(store.artifact(worker, job.id), { statusCode: 404 });
  assert.equal(JSON.parse(await fs.readFile(path.join(jobs, job.id + '.json'), 'utf8')).state, 'unknown-outcome');
  assert.deepEqual(await store.complete(worker, job.id, { ok: true, result: { imported: true } }), { ok: true, state: 'done' });
  const record = JSON.parse(await fs.readFile(path.join(jobs, job.id + '.json'), 'utf8'));
  assert.equal(record.lateCompletion, true);
  assert.deepEqual(record.result, { imported: true });
  assert.equal(await store.poll(worker), null);
  await assert.rejects(store.complete(worker, job.id, { ok: true }), { statusCode: 409 });
});

for (const taken of [false, true]) test(`restart never reauthorizes ${taken ? 'claimed' : 'queued'} jobs`, async t => {
  const { store, directory, worker, enqueue, jobs, records } = await setup(t);
  const controller = new AbortController(), pending = enqueue(controller.signal);
  await store.create('alice', { name: 'Queue barrier' });
  const job = taken ? await store.poll(worker) : null;
  const restarted = bridgeStore(directory);
  assert.equal(await restarted.poll(worker), null);
  const record = JSON.parse(await fs.readFile(path.join(jobs, (await records())[0]), 'utf8'));
  assert.equal(record.state, taken ? 'unknown-outcome' : 'cancelled');
  if (taken) {
    await assert.rejects(restarted.artifact(worker, job.id), { statusCode: 404 });
    await restarted.complete(worker, job.id, { ok: false, error: 'Worker outcome' });
  }
  controller.abort(); await assert.rejects(pending, { code: 'TIMEOUT' });
});

for (const state of ['queued', 'taken']) test(`abort during ${state} persistence cannot return a job`, async t => {
  const { store, worker, enqueue } = await setup(t);
  const controller = new AbortController(), original = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, data, ...args) => {
    const result = await original(file, data, ...args);
    if (String(file).includes(`${path.sep}jobs${path.sep}`) && String(data).includes(`"state":"${state}"`)) controller.abort();
    return result;
  });
  const result = enqueue(controller.signal);
  assert.equal(await store.poll(worker), null);
  await assert.rejects(result, { code: 'TIMEOUT' });
});

test('abort during artifact read withholds bytes', async t => {
  const { store, worker, enqueue } = await setup(t);
  const controller = new AbortController(), result = enqueue(controller.signal), job = await store.poll(worker);
  const original = fs.readFile;
  t.mock.method(fs, 'readFile', async (file, ...args) => {
    const bytes = await original(file, ...args);
    if (String(file).endsWith('.e365')) controller.abort();
    return bytes;
  });
  await assert.rejects(store.artifact(worker, job.id), { statusCode: 404 });
  await assert.rejects(result, { code: 'TIMEOUT' });
});

test('ordinary completion and bridge removal settle callers', async t => {
  const { store, bridge, worker, enqueue } = await setup(t);
  const controller = new AbortController(), result = enqueue(controller.signal), job = await store.poll(worker);
  assert.equal((await store.artifact(worker, job.id)).toString(), 'synthetic');
  await store.complete(worker, job.id, { ok: true, result: { imported: true } });
  assert.deepEqual(await result, { imported: true });
  controller.abort();
  const removed = enqueue();
  await store.remove(bridge.id, 'alice');
  await assert.rejects(removed, { statusCode: 410 });
});

test('abort during result persistence retains late evidence without resolving an expired request', async t => {
  const { store, worker, enqueue, jobs } = await setup(t);
  const controller = new AbortController(), result = enqueue(controller.signal), job = await store.poll(worker);
  const original = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, data, ...args) => {
    const saved = await original(file, data, ...args);
    if (String(data).includes('"state":"done"')) controller.abort();
    return saved;
  });
  await store.complete(worker, job.id, { ok: true, result: { imported: true } });
  await assert.rejects(result, { code: 'TIMEOUT' });
  const record = JSON.parse(await fs.readFile(path.join(jobs, job.id + '.json'), 'utf8'));
  assert.equal(record.state, 'done'); assert.equal(record.lateCompletion, true);
  assert.equal(await store.poll(worker), null);
});
