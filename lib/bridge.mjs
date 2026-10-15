import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { allows, guardPresetDeploy, hostOf, workerTarget } from './target-presets.mjs';

// Operator bridge: the Wiki never connects to ELMA itself. An operator runs a bridge process next to
// `elma365pm` and the ELMA tokens; it polls this service for jobs with a bearer token that is issued once
// and stored here only as a SHA-256 hash. Jobs carry no credentials; the Target host is configured on the
// bridge side and reported back as identity, which the delivery guards check against protected hosts.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const text = (value, label, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Заполните ${label} (до ${max} символов)`); return value.trim(); };
export const jobKinds = ['health', 'inspect', 'deploy', 'readBack', 'materialize', 'targetProfile'];
// `materialize` (#94 MR-03, elma365#60) runs the worker's offline native toolchain on job-scoped inputs and
// uploads one output archive. It never imports: it carries no deploy candidate, no solution code and no
// Target operation, and a result reporting anything but an E1 receipt is refused.
export const MATERIALIZE_PAYLOAD_KEYS = Object.freeze(['contract', 'envelope', 'originals', 'output']);
const MATERIALIZE_RESULT_KEYS = ['receipt'];
// `targetProfile` (#94 MR-05, elma365#60 P5) is the read-only observation of the bridge's own configured
// Target: the worker reports an `elma365-dependency-receipt@1` Target profile report with the installed
// Solutions and the dependency receipts derived from them. It carries no artifact, input, solution code
// or Target operation, and a result reporting anything but that report is refused. Wiki accepts native
// dependency receipts only through this path (lib/native-materialization-bridge.mjs).
export const TARGET_PROFILE_PAYLOAD_KEYS = Object.freeze(['contract', 'runId', 'targetId', 'environment', 'requirements']);
const TARGET_PROFILE_RESULT_KEYS = ['report'];
const HEX64 = /^[0-9a-f]{64}$/, HEX40 = /^[0-9a-f]{40}$/;
const short = (value, max) => typeof value === 'string' && value.length && value.length <= max ? value : null;
// Worker-advertised capabilities are recorded as reported, never trusted: eligibility comes only from the
// receipt rules (validateE1Receipt) and the existing delivery guards.
function advertised(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const kinds = Array.isArray(input.jobKinds) ? [...new Set(input.jobKinds.filter(kind => jobKinds.includes(kind)))].sort() : [];
  const row = input.materialize && typeof input.materialize === 'object' ? input.materialize : null;
  const contract = row?.contract && short(row.contract.id, 80) && Number.isInteger(row.contract.version) ? { id: row.contract.id, version: row.contract.version } : null;
  return { jobKinds: kinds, materialize: row ? { contract, nativeRevision: HEX40.test(row.nativeRevision ?? '') ? row.nativeRevision : null,
    targetProfileDigest: HEX64.test(row.targetProfileDigest ?? '') ? row.targetProfileDigest : null,
    compilerProfileDigest: HEX64.test(row.compilerProfileDigest ?? '') ? row.compilerProfileDigest : null } : null, trusted: false };
}

// Stores created by bridgeStore() in this process. Native evidence paths accept only these, never a
// caller-built object with the same methods.
const STORES = new WeakSet();
/** True only for a store returned by bridgeStore(). */
export const isBridgeStore = value => !!value && typeof value === 'object' && STORES.has(value);

export function bridgeStore(directory, { now = () => new Date().toISOString(), onlineMs = 90000, maxWaitMs = 25000, healthTimeoutMs = 30000, maxOutputBytes = 256 * 1024 * 1024 } = {}) {
  const root = path.resolve(directory, 'delivery', 'bridges');
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const bridgeFile = id => { if (!uuid.test(id)) fail('Мост не найден', 404); return path.join(root, id + '.json'); };
  const jobDir = bridgeId => path.join(root, bridgeId, 'jobs');
  const jobFile = (bridgeId, jobId) => { if (!uuid.test(jobId)) fail('Задание не найдено', 404); return path.join(jobDir(bridgeId), jobId + '.json'); };
  const writeJson = async (file, record) => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(temp, file);
  };
  const readJson = async (file, missing) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') fail(missing, 404); throw error; } };
  const readBridge = async (id, owner) => { const record = await readJson(bridgeFile(id), 'Мост не найден'); if (owner !== undefined && record.owner !== owner) fail('Мост не найден', 404); return record; };
  const publicBridge = ({ owner, tokenHash, ...record }) => ({ ...record, online: !!record.lastSeen && Date.now() - Date.parse(record.lastSeen) < onlineMs });
  const waiters = new Map(); // bridgeId -> resolve functions of long-polls
  // ponytail: one store/process per directory; multiple coordinators need durable fenced leases.
  const resolvers = new Map(); // Current-process dispatch grants, never restored from disk.
  const uploading = new Set(); // Materialize jobs with an output upload in progress (single-output slot).
  const timeout = () => Object.assign(Error('timeout'), { code: 'TIMEOUT' });
  const authorized = job => { const grant = resolvers.get(job.id); return !!grant && !grant.signal?.aborted; };
  const settle = (id, error, value) => {
    const grant = resolvers.get(id);
    if (!grant) return;
    resolvers.delete(id); grant.cleanup();
    error ? grant.reject(error) : grant.resolve(value);
  };
  // Job-scoped binary files: the deploy candidate, materialize inputs (by sha256) and the materialize output.
  const filesDir = job => path.join(jobDir(job.bridgeId), job.id);
  const discardArtifact = async job => {
    await fs.rm(path.join(jobDir(job.bridgeId), job.id + '.e365'), { force: true });
    await fs.rm(filesDir(job), { recursive: true, force: true });
  };
  const fence = async job => {
    if (['queued', 'taken'].includes(job.state)) {
      job.state = job.state === 'queued' ? 'cancelled' : 'unknown-outcome';
      job.abandonedAt = now(); job.error = 'Dispatch grant expired; reconcile any claimed operation';
      await writeJson(jobFile(job.bridgeId, job.id), job);
      await discardArtifact(job);
    }
    settle(job.id, timeout());
  };
  const listJobs = async bridgeId => {
    let names = [];
    try { names = await fs.readdir(jobDir(bridgeId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const jobs = [];
    for (const name of names) if (name.endsWith('.json')) jobs.push(JSON.parse(await fs.readFile(path.join(jobDir(bridgeId), name), 'utf8')));
    return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };
  const wake = bridgeId => { for (const resolve of waiters.get(bridgeId) || []) resolve(); waiters.delete(bridgeId); };
  const store = {
    async list(owner) {
      let names = [];
      try { names = await fs.readdir(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const records = [];
      for (const name of names) { if (!name.endsWith('.json')) continue; try { records.push(publicBridge(await readBridge(name.slice(0, -5), owner))); } catch (error) { if (error.statusCode !== 404) throw error; } }
      return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async get(id, owner) { return publicBridge(await readBridge(id, owner)); },
    // The token is returned exactly once; only its hash is stored.
    create(owner, input) { return serial(async () => {
      const name = text(input?.name, 'название моста', 120);
      if ((await this.list(owner)).length >= 10) fail('Максимум 10 мостов');
      const token = 'wb_' + crypto.randomBytes(32).toString('base64url');
      const record = { schemaVersion: 1, id: crypto.randomUUID(), owner, name, tokenHash: hash(token), createdAt: now(), lastSeen: null, identity: null, worker: null };
      await writeJson(bridgeFile(record.id), record);
      return { bridge: publicBridge(record), token };
    }); },
    remove(id, owner) { return serial(async () => {
      await readBridge(id, owner);
      for (const job of await listJobs(id)) settle(job.id, Object.assign(Error('Мост удалён'), { statusCode: 410 }));
      await fs.rm(path.join(root, id), { recursive: true, force: true });
      await fs.rm(bridgeFile(id), { force: true });
      wake(id);
      return { ok: true };
    }); },
    // Worker side -------------------------------------------------------------------------------------
    async authenticate(header) {
      const token = /^Bearer\s+(wb_[A-Za-z0-9_-]{20,})$/.exec(header || '')?.[1];
      if (!token) fail('Требуется токен моста', 401);
      const digest = Buffer.from(hash(token), 'hex');
      let names = [];
      try { names = await fs.readdir(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const record = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
        if (crypto.timingSafeEqual(digest, Buffer.from(record.tokenHash, 'hex'))) return record;
      }
      fail('Токен моста не принят', 401);
    },
    async poll(bridge, { identity = null, worker = null, waitMs = 0, capabilities = undefined } = {}) {
      const take = () => serial(async () => {
        const record = await readBridge(bridge.id);
        record.lastSeen = now();
        if (identity && typeof identity === 'object') record.identity = { host: String(identity.host || '').slice(0, 200), version: identity.version ? String(identity.version).slice(0, 80) : null };
        if (worker) record.worker = String(worker).slice(0, 120);
        if (capabilities !== undefined) { const row = advertised(capabilities); record.capabilities = row && { ...row, reportedAt: now() }; }
        await writeJson(bridgeFile(bridge.id), record);
        for (const job of await listJobs(bridge.id)) {
          if (!['queued', 'taken'].includes(job.state)) continue;
          if (!authorized(job)) { await fence(job); continue; }
          if (job.state !== 'queued') continue;
          job.state = 'taken'; job.takenAt = now();
          await writeJson(jobFile(bridge.id, job.id), job);
          if (!authorized(job)) { await fence(job); continue; }
          return { id: job.id, kind: job.kind, payload: job.payload, hasArtifact: !!job.artifact,
            ...(job.kind === 'materialize' ? { imports: false, inputs: job.inputs, outputLimitBytes: job.outputLimitBytes } : {}) };
        }
        return null;
      });
      const first = await take();
      if (first || !waitMs) return first;
      await new Promise(resolve => { const timer = setTimeout(resolve, Math.min(Number(waitMs) || 0, maxWaitMs)); const list = waiters.get(bridge.id) || []; list.push(() => { clearTimeout(timer); resolve(); }); waiters.set(bridge.id, list); });
      return take();
    },
    artifact(bridge, jobId) { return serial(async () => {
      await readBridge(bridge.id);
      const job = await readJson(jobFile(bridge.id, jobId), 'Задание не найдено');
      if (!authorized(job)) { await fence(job); fail('Артефакт недоступен', 404); }
      if (job.kind === 'materialize' || !job.artifact || job.state !== 'taken') fail('Артефакт недоступен', 404);
      const bytes = await fs.readFile(path.join(jobDir(bridge.id), jobId + '.e365'));
      if (!authorized(job)) { await fence(job); fail('Артефакт недоступен', 404); }
      if (hash(bytes) !== job.artifact.sha256) fail('Контрольная сумма артефакта не совпадает', 409);
      return bytes;
    }); },
    // Materialize inputs: job-scoped, only while the job is taken under a live grant; the stored bytes are
    // re-hashed before they leave so the worker receives exactly the declared sha256 and size.
    input(bridge, jobId, sha256) { return serial(async () => {
      await readBridge(bridge.id);
      const job = await readJson(jobFile(bridge.id, jobId), 'Задание не найдено');
      if (!authorized(job)) { await fence(job); fail('Входной файл недоступен', 404); }
      const row = job.kind === 'materialize' && job.state === 'taken' && HEX64.test(sha256 ?? '') ? job.inputs.find(item => item.sha256 === sha256) : null;
      if (!row) fail('Входной файл недоступен', 404);
      const bytes = await fs.readFile(path.join(filesDir(job), 'inputs', sha256));
      if (!authorized(job)) { await fence(job); fail('Входной файл недоступен', 404); }
      if (hash(bytes) !== row.sha256 || bytes.length !== row.size) fail('Контрольная сумма входного файла не совпадает', 409);
      return { bytes, sha256: row.sha256, size: row.size };
    }); },
    // Checked before the body is read, so an unauthorized, oversized or concurrent upload is refused
    // without reading it.
    async outputSlot(bridge, jobId, { sha256, size } = {}) {
      await readBridge(bridge.id);
      const job = await readJson(jobFile(bridge.id, jobId), 'Задание не найдено');
      if (job.kind !== 'materialize' || !authorized(job)) fail('Задание не найдено', 404);
      if (job.state !== 'taken') fail(`Задание уже в состоянии «${job.state}»`, 409);
      if (job.output) fail('Результат уже загружен', 409);
      if (uploading.has(job.id)) fail('Результат уже загружается', 409);
      if (!HEX64.test(sha256 ?? '')) fail('Требуется X-Content-Sha256', 400);
      if (!Number.isInteger(size) || size < 1) fail('Требуется Content-Length', 411);
      if (size > job.outputLimitBytes) fail('Архив превышает лимит задания', 413);
      return job;
    },
    // One immutable output per materialize job, bound to the declared sha256 and size. The body is streamed
    // to a private temp file with an incremental sha256 and byte count, never buffered in memory; the slot
    // is reserved under the store queue, so a concurrent upload to the same job is refused with 409.
    async writeOutput(bridge, jobId, { sha256, size }, source) {
      const { temp, dir } = await serial(async () => {
        const job = await store.outputSlot(bridge, jobId, { sha256, size });
        uploading.add(job.id);
        await fs.mkdir(filesDir(job), { recursive: true, mode: 0o700 });
        return { dir: filesDir(job), temp: path.join(filesDir(job), 'output.' + crypto.randomUUID() + '.tmp') };
      });
      try {
        const digest = crypto.createHash('sha256');
        let received = 0;
        const meter = new Transform({ transform(chunk, _, done) {
          received += chunk.length;
          if (received > size) return done(Object.assign(Error('Размер архива не совпадает с Content-Length'), { statusCode: 422 }));
          digest.update(chunk); done(null, chunk);
        } });
        await pipeline(source, meter, createWriteStream(temp, { mode: 0o600 }));
        if (received !== size) fail('Размер архива не совпадает с Content-Length', 422);
        if (digest.digest('hex') !== sha256) fail('Контрольная сумма архива не совпадает', 422);
        return await serial(async () => {
          const job = await readJson(jobFile(bridge.id, jobId), 'Задание не найдено');
          if (!authorized(job) || job.state !== 'taken' || job.output) fail('Задание не найдено', 404);
          await fs.rename(temp, path.join(dir, 'output'));
          job.output = { sha256, size, uploadedAt: now() };
          await writeJson(jobFile(bridge.id, jobId), job);
          return { ok: true, sha256, size };
        });
      } finally {
        uploading.delete(jobId);
        await fs.rm(temp, { force: true }).catch(() => {});
      }
    },
    output(bridge, jobId, { sha256, size, bytes }) {
      return store.writeOutput(bridge, jobId, { sha256, size }, Readable.from(Buffer.isBuffer(bytes) ? [bytes] : []));
    },
    complete(bridge, jobId, input) { return serial(async () => {
      await readBridge(bridge.id);
      const job = await readJson(jobFile(bridge.id, jobId), 'Задание не найдено');
      if (!['taken', 'unknown-outcome'].includes(job.state)) fail(`Задание уже в состоянии «${job.state}»`, 409);
      if (JSON.stringify(input).length > 2 * 1024 * 1024) fail('Результат задания слишком большой');
      if (!authorized(job)) await fence(job);
      job.lateCompletion = job.state === 'unknown-outcome';
      // A materialize result is only an E1 receipt; anything else (an import report, a Target identity, a
      // deploy result) is a protocol violation and fails the job. Its output bytes go to the caller once.
      let ok = !!input?.ok, error = ok ? null : String(input?.error || 'Мост сообщил об ошибке').slice(0, 4000), delivered = ok ? input.result ?? null : null;
      if (job.kind === 'targetProfile' && ok) {
        const result = input.result;
        if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).some(key => !TARGET_PROFILE_RESULT_KEYS.includes(key)) || !result.report) {
          ok = false; error = 'target-profile-result-invalid'; delivered = null;
        }
      }
      if (job.kind === 'materialize' && ok) {
        const result = input.result;
        if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).some(key => !MATERIALIZE_RESULT_KEYS.includes(key)) || !result.receipt) {
          ok = false; error = 'materialize-result-invalid'; delivered = null;
        } else {
          const bytes = job.output ? await fs.readFile(path.join(filesDir(job), 'output')).catch(() => null) : null;
          if (job.output && (!bytes || hash(bytes) !== job.output.sha256 || bytes.length !== job.output.size)) { ok = false; error = 'materialize-output-lost'; delivered = null; }
          else delivered = { receipt: result.receipt, output: job.output ? { sha256: job.output.sha256, size: job.output.size, bytes } : null };
        }
      }
      job.state = ok ? 'done' : 'failed'; job.finishedAt = now();
      job.result = ok ? (job.kind === 'materialize' ? { receipt: delivered.receipt, output: job.output } : delivered) : null; job.error = error;
      await writeJson(jobFile(bridge.id, jobId), job);
      await discardArtifact(job);
      if (!authorized(job) && !job.lateCompletion) {
        job.lateCompletion = true; await writeJson(jobFile(bridge.id, jobId), job);
      }
      settle(jobId, job.lateCompletion ? timeout() : job.state === 'failed' ? Object.assign(Error(job.error), { statusCode: 502 }) : null, job.kind === 'materialize' ? delivered : job.result);
      return { ok: true, state: job.state };
    }); },
    // Adapter side ------------------------------------------------------------------------------------
    enqueue(bridgeId, kind, payload, { signal, artifact, inputs } = {}) { return new Promise((resolve, reject) => { serial(async () => {
      if (!jobKinds.includes(kind)) fail('Неизвестный вид задания');
      const materialize = kind === 'materialize';
      // Hard refusal of deploy semantics: a materialize job never carries a candidate or a solution code,
      // and only materialize jobs carry job-scoped inputs.
      if (materialize && (artifact || !payload || typeof payload !== 'object' || Object.keys(payload).some(key => !MATERIALIZE_PAYLOAD_KEYS.includes(key))))
        fail('Задание materialize не может нести кандидата на импорт', 422);
      if (!materialize && inputs) fail('Входные файлы допускаются только для materialize', 422);
      if (kind === 'targetProfile' && (artifact || !payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some(key => !TARGET_PROFILE_PAYLOAD_KEYS.includes(key))))
        fail('Задание targetProfile только читает профиль Target и не может нести кандидата на импорт', 422);
      const files = materialize ? (inputs ?? []).map(bytes => Buffer.from(bytes)) : [];
      if (materialize && !files.length) fail('Задание materialize требует входные файлы', 422);
      const inputRows = [...new Map(files.map(bytes => [hash(bytes), { sha256: hash(bytes), size: bytes.length }])).values()];
      const declared = materialize ? payload.originals : null;
      if (materialize && (!Array.isArray(declared) || declared.some(row => !inputRows.some(item => item.sha256 === row?.sha256 && item.size === row?.size))))
        fail('Входные файлы не совпадают с объявленными оригиналами', 422);
      if (signal?.aborted) throw timeout();
      await readBridge(bridgeId);
      if (signal?.aborted) throw timeout();
      const job = { schemaVersion: 1, id: crypto.randomUUID(), bridgeId, kind, payload, state: 'queued', createdAt: now(), takenAt: null, finishedAt: null, result: null, error: null, artifact: artifact ? { sha256: hash(artifact), bytes: artifact.length } : null,
        ...(materialize ? { inputs: inputRows, outputLimitBytes: Number.isSafeInteger(payload.output?.maxBytes) && payload.output.maxBytes > 0 ? Math.min(payload.output.maxBytes, maxOutputBytes) : maxOutputBytes, output: null } : {}) };
      const abort = () => { serial(async () => {
        if (!resolvers.has(job.id)) return;
        await fence(await readJson(jobFile(bridgeId, job.id), 'Задание не найдено'));
      }).catch(error => settle(job.id, error)); };
      resolvers.set(job.id, { resolve, reject, signal, cleanup: () => signal?.removeEventListener('abort', abort) });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (artifact) { await fs.mkdir(jobDir(bridgeId), { recursive: true, mode: 0o700 }); await fs.writeFile(path.join(jobDir(bridgeId), job.id + '.e365'), artifact, { mode: 0o600 }); }
        if (files.length) {
          await fs.mkdir(path.join(filesDir(job), 'inputs'), { recursive: true, mode: 0o700 });
          for (const bytes of files) await fs.writeFile(path.join(filesDir(job), 'inputs', hash(bytes)), bytes, { mode: 0o600 });
        }
        await writeJson(jobFile(bridgeId, job.id), job);
        if (!authorized(job)) { await fence(job); return; }
        wake(bridgeId);
      } catch (error) {
        settle(job.id, error);
        await discardArtifact(job);
        throw error;
      }
    }).catch(reject); }); },
    adapter(options, connection) {
      const bridgeId = String(options?.bridgeId || '');
      return {
        name: 'bridge',
        async capabilities() { return { inspect: true, deploy: true, readBack: true, rollbackReference: 'previous-export-only' }; },
        async health() {
          let bridge; try { bridge = await readBridge(bridgeId, connection?.owner); } catch { return { ok: false, identity: null, reason: 'Мост не найден или принадлежит другому владельцу' }; }
          const view = publicBridge(bridge);
          if (!view.online) return { ok: false, identity: bridge.identity, reason: 'Мост не выходил на связь' };
          const controller = new AbortController(), timer = setTimeout(() => controller.abort(), healthTimeoutMs);
          try { const result = await store.enqueue(bridgeId, 'health', {}, { signal: controller.signal }); return { ok: !!result?.ok, identity: result?.identity || bridge.identity, reason: result?.reason || null, capabilities: bridge.capabilities ?? null }; }
          catch (error) { return { ok: false, identity: bridge.identity, reason: error.code === 'TIMEOUT' ? 'Мост не ответил на проверку' : error.message }; }
          finally { clearTimeout(timer); }
        },
        async inspectSolution(code, { signal } = {}) { await readBridge(bridgeId, connection?.owner); return store.enqueue(bridgeId, 'inspect', { code }, { signal }); },
        async deployCandidate(candidate, { signal } = {}) { await readBridge(bridgeId, connection?.owner); return store.enqueue(bridgeId, 'deploy', { code: candidate.code, sha256: candidate.sha256 }, { signal, artifact: candidate.bytes }); },
        // import-normalized-v1 asks for the bytes of exactly these package/manifest paths; the delivery
        // coordinator verifies them. A worker that ignores the request returns hashes only and fails closed.
        async readBack(code, { signal, metadata } = {}) {
          await readBridge(bridgeId, connection?.owner);
          return store.enqueue(bridgeId, 'readBack', { code, ...(metadata ? { readBackPolicy: metadata.policy, metadataPaths: [...metadata.paths] } : {}) }, { signal });
        }
      };
    },
    // Predefined DEV/DEV2 Target: no stored bridge reference. Each call uses the actor's own
    // online bridge whose worker runs the mapped `--target` against the configured host.
    presetAdapter(preset, connection) {
      const select = async () => {
        if (!connection?.owner || !preset.available) return null;
        const matching = (await store.list(connection.owner)).filter(bridge => bridge.online && workerTarget(bridge.worker) === preset.bridgeTarget && hostOf(bridge.identity?.host) === preset.host);
        return matching.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0] || null;
      };
      const missing = `Нет моста оператора на связи для ${preset.name}: запустите elma-dev bridge --target=${preset.bridgeTarget} на машине с доступом к ${preset.host || 'настроенному узлу'}`;
      const via = async (operation, run) => {
        if (!allows(preset, operation)) fail(`${preset.name}: операция ${operation} не разрешена`, 403);
        const bridge = await select();
        if (!bridge) fail(missing, 503);
        return run(store.adapter({ bridgeId: bridge.id }, connection));
      };
      return {
        name: 'bridge',
        async capabilities() { return { inspect: allows(preset, 'inspect'), deploy: allows(preset, 'deploy'), readBack: allows(preset, 'readBack'), rollbackReference: 'previous-export-only' }; },
        async health() {
          if (!allows(preset, 'health')) return { ok: false, identity: null, reason: preset.reason || `${preset.name}: проверка не разрешена` };
          const bridge = await select();
          return bridge ? store.adapter({ bridgeId: bridge.id }, connection).health() : { ok: false, identity: null, reason: missing };
        },
        inspectSolution: (code, options) => via('inspect', adapter => adapter.inspectSolution(code, options)),
        deployCandidate: (candidate, options) => { guardPresetDeploy(preset, candidate.sha256); return via('deploy', adapter => adapter.deployCandidate(candidate, options)); },
        readBack: (code, options) => via('readBack', adapter => adapter.readBack(code, options))
      };
    }
  };
  STORES.add(store);
  return store;
}
