import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { bridgeStore } from '../lib/bridge.mjs';
import { E1_SOURCE } from '../lib/native-materialization-e1.mjs';

// Synthetic stand-ins for the operator bridge transport of `materialize` jobs. Everything runs on
// 127.0.0.1 against a temporary directory; no ELMA host, token or native tool is involved.
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const WORKER_REVISION = E1_SOURCE.revision;

/** A Wiki server whose native materialization is explicitly configured for one owner's bridge. */
export async function materializeServer(t, { owner = 'synthetic-owner', adapterOwner = owner, timeoutMs = 5000, maxOutputBytes, configure = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-materialize-'));
  const setupStore = bridgeStore(directory);
  const { bridge, token } = await setupStore.create(owner, { name: 'Synthetic materializer' });
  const other = await setupStore.create('other-owner', { name: 'Other operator' });
  const materializationEnv = configure ? { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: bridge.id, WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: adapterOwner,
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER_REVISION, WIKI_NATIVE_MATERIALIZATION_TIMEOUT_MS: String(timeoutMs),
    ...(maxOutputBytes ? { WIKI_NATIVE_MATERIALIZATION_MAX_OUTPUT_BYTES: String(maxOutputBytes) } : {}) } : {};
  const server = createServer({ directory, allowLocal: true, materializationEnv });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, workers = [];
  // Teardown order: stop every worker first, so nothing writes into the directory while it is removed.
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.stop()));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const worker = options => { const started = httpWorker({ base, token, ...options }); workers.push(started); return started; };
  return { directory, server, base, bridge, token, otherToken: other.token, adapter: server.nativeMaterialization, worker };
}

export const bearer = token => ({ Authorization: `Bearer ${token}` });
export async function call(base, route, { token, method = 'GET', json, bytes, headers = {} } = {}) {
  const response = await fetch(base + route, { method, headers: { 'X-Elma-Wiki-Request': '1', ...(token ? bearer(token) : {}), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(bytes ? { 'Content-Type': 'application/octet-stream' } : {}), ...headers }, body: json !== undefined ? JSON.stringify(json) : bytes });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}

/** Polling worker over the HTTP routes. For each materialize job it downloads every original by sha256,
 * verifies sha256 and size, asks `handle` for {receipt, bytes} and uploads the output before the receipt.
 * `handle` may return {skip: true} to keep the job claimed without answering (lost worker). */
export function httpWorker({ base, token, handle, capabilities, profile = null, evidence = null }) {
  let running = true, lastReport = null;
  const seen = [];
  const loop = (async () => {
    while (running) {
      let polled;
      try { polled = await call(base, '/api/bridge/poll', { token, method: 'POST', json: { identity: { host: 'worker.example.invalid', version: '2025.4' }, worker: 'synthetic-materializer', waitMs: 100, ...(capabilities ? { capabilities } : {}) } }); }
      catch { if (!running) return; await new Promise(resolve => setTimeout(resolve, 25)); continue; }
      const job = polled.body?.job;
      if (!running || !job) continue;
      seen.push(job);
      // A read-only targetProfile job is answered with `profile(payload)` as the report, when given.
      if (job.kind === 'targetProfile' && profile) { lastReport = profile(job.payload); await call(base, `/api/bridge/jobs/${job.id}/result`, { token, method: 'POST', json: { ok: true, result: { report: lastReport } } }); continue; }
      // A read-only buildEvidence job is answered with `evidence(payload, lastReport)` as the result body, when given.
      if (job.kind === 'buildEvidence' && evidence) { await call(base, `/api/bridge/jobs/${job.id}/result`, { token, method: 'POST', json: { ok: true, result: await evidence(job.payload, lastReport) } }); continue; }
      if (job.kind !== 'materialize') { await call(base, `/api/bridge/jobs/${job.id}/result`, { token, method: 'POST', json: { ok: true, result: { ok: true } } }); continue; }
      const originals = new Map();
      for (const row of job.payload.originals) {
        const got = await call(base, `/api/bridge/jobs/${job.id}/inputs/${row.sha256}`, { token });
        if (got.status !== 200 || sha(got.body) !== row.sha256 || got.body.length !== row.size || got.headers.get('x-content-sha256') !== row.sha256) throw Error('input verification failed');
        originals.set(row.artifactId, got.body);
      }
      const answer = await handle({ job, envelope: job.payload.envelope, originals });
      if (answer.skip) continue;
      if (answer.bytes) {
        const uploaded = await call(base, `/api/bridge/jobs/${job.id}/output`, { token, method: 'PUT', bytes: answer.bytes, headers: { 'X-Content-Sha256': answer.declaredSha256 ?? sha(answer.bytes) } });
        job.upload = uploaded;
      }
      await call(base, `/api/bridge/jobs/${job.id}/result`, { token, method: 'POST', json: answer.result ?? { ok: true, result: { receipt: answer.receipt } } });
    }
  })();
  return { seen, stop: async () => { running = false; await loop.catch(() => {}); } };
}
