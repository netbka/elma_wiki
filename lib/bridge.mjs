import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Operator bridge: the Wiki never connects to ELMA itself. An operator runs a bridge process next to
// `elma365pm` and the ELMA tokens; it polls this service for jobs with a bearer token that is issued once
// and stored here only as a SHA-256 hash. Jobs carry no credentials; the Target host is configured on the
// bridge side and reported back as identity, which the delivery guards check against protected hosts.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const text = (value, label, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Заполните ${label} (до ${max} символов)`); return value.trim(); };
export const jobKinds = ['health', 'inspect', 'deploy', 'readBack'];

export function bridgeStore(directory, { now = () => new Date().toISOString(), onlineMs = 90000, maxWaitMs = 25000, healthTimeoutMs = 30000 } = {}) {
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
  const resolvers = new Map(); // jobId -> { resolve, reject }
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
      for (const job of await listJobs(id)) resolvers.get(job.id)?.reject(Object.assign(Error('Мост удалён'), { statusCode: 410 }));
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
    async poll(bridge, { identity = null, worker = null, waitMs = 0 } = {}) {
      const take = () => serial(async () => {
        const record = await readBridge(bridge.id);
        record.lastSeen = now();
        if (identity && typeof identity === 'object') record.identity = { host: String(identity.host || '').slice(0, 200), version: identity.version ? String(identity.version).slice(0, 80) : null };
        if (worker) record.worker = String(worker).slice(0, 120);
        await writeJson(bridgeFile(bridge.id), record);
        const job = (await listJobs(bridge.id)).find(j => j.state === 'queued');
        if (!job) return null;
        job.state = 'taken'; job.takenAt = now();
        await writeJson(jobFile(bridge.id, job.id), job);
        return { id: job.id, kind: job.kind, payload: job.payload, hasArtifact: !!job.artifact };
      });
      const first = await take();
      if (first || !waitMs) return first;
      await new Promise(resolve => { const timer = setTimeout(resolve, Math.min(Number(waitMs) || 0, maxWaitMs)); const list = waiters.get(bridge.id) || []; list.push(() => { clearTimeout(timer); resolve(); }); waiters.set(bridge.id, list); });
      return take();
    },
    async artifact(bridge, jobId) {
      const job = await readJson(jobFile(bridge.id, jobId), 'Задание не найдено');
      if (!job.artifact || job.state !== 'taken') fail('Артефакт недоступен', 404);
      const bytes = await fs.readFile(path.join(jobDir(bridge.id), jobId + '.e365'));
      if (hash(bytes) !== job.artifact.sha256) fail('Контрольная сумма артефакта не совпадает', 409);
      return bytes;
    },
    complete(bridge, jobId, input) { return serial(async () => {
      const job = await readJson(jobFile(bridge.id, jobId), 'Задание не найдено');
      if (job.state !== 'taken') fail(`Задание уже в состоянии «${job.state}»`, 409);
      if (JSON.stringify(input).length > 2 * 1024 * 1024) fail('Результат задания слишком большой');
      job.state = input?.ok ? 'done' : 'failed'; job.finishedAt = now();
      job.result = input?.ok ? input.result ?? null : null; job.error = input?.ok ? null : String(input?.error || 'Мост сообщил об ошибке').slice(0, 4000);
      await writeJson(jobFile(bridge.id, jobId), job);
      await fs.rm(path.join(jobDir(bridge.id), jobId + '.e365'), { force: true });
      const resolver = resolvers.get(jobId); resolvers.delete(jobId);
      if (resolver) job.state === 'done' ? resolver.resolve(job.result) : resolver.reject(Object.assign(Error(job.error), { statusCode: 502 }));
      return { ok: true, state: job.state };
    }); },
    // Adapter side ------------------------------------------------------------------------------------
    enqueue(bridgeId, kind, payload, { signal, artifact } = {}) { return new Promise((resolve, reject) => { serial(async () => {
      if (!jobKinds.includes(kind)) fail('Неизвестный вид задания');
      const job = { schemaVersion: 1, id: crypto.randomUUID(), bridgeId, kind, payload, state: 'queued', createdAt: now(), takenAt: null, finishedAt: null, result: null, error: null, artifact: artifact ? { sha256: hash(artifact), bytes: artifact.length } : null };
      if (artifact) { await fs.mkdir(jobDir(bridgeId), { recursive: true, mode: 0o700 }); await fs.writeFile(path.join(jobDir(bridgeId), job.id + '.e365'), artifact, { mode: 0o600 }); }
      await writeJson(jobFile(bridgeId, job.id), job);
      resolvers.set(job.id, { resolve, reject });
      signal?.addEventListener('abort', () => { if (resolvers.delete(job.id)) reject(Object.assign(Error('timeout'), { code: 'TIMEOUT' })); }, { once: true });
      wake(bridgeId);
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
          try { const result = await store.enqueue(bridgeId, 'health', {}, { signal: controller.signal }); return { ok: !!result?.ok, identity: result?.identity || bridge.identity, reason: result?.reason || null }; }
          catch (error) { return { ok: false, identity: bridge.identity, reason: error.code === 'TIMEOUT' ? 'Мост не ответил на проверку' : error.message }; }
          finally { clearTimeout(timer); }
        },
        async inspectSolution(code, { signal } = {}) { await readBridge(bridgeId, connection?.owner); return store.enqueue(bridgeId, 'inspect', { code }, { signal }); },
        async deployCandidate(candidate, { signal } = {}) { await readBridge(bridgeId, connection?.owner); return store.enqueue(bridgeId, 'deploy', { code: candidate.code, sha256: candidate.sha256 }, { signal, artifact: candidate.bytes }); },
        async readBack(code, { signal } = {}) { await readBridge(bridgeId, connection?.owner); return store.enqueue(bridgeId, 'readBack', { code }, { signal }); }
      };
    }
  };
  return store;
}
