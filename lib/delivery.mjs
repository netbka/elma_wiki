import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readArchive } from './e365.mjs';
import { isDeepStrictEqual } from 'node:util';
import { READ_BACK_POLICY, canonicalInventory, inventoryHash, compareReadBack } from './delivery-verification.mjs';
export { inventoryHash, compareReadBack } from './delivery-verification.mjs';

// Target connections, delivery attempts and read-back verification (AR-04 foundation, issue #11).
// Connection references never hold credentials; execution goes through a named adapter.
// The only adapter shipped here is the synthetic one for tests/Storybook. It is disabled on a hosted service
// unless the operator explicitly enables it, so no hosted release can be "verified" against a fake target.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const text = (value, label, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Заполните ${label} (до ${max} символов)`); return value.trim(); };
const targetHost = identity => String(identity?.host || '').trim().toLowerCase().replace(/\.$/, '');
const credentialKey = /token|password|passwd|secret|cookie|authorization|apikey|api_key|credential/i;
export const environments = ['dev', 'test', 'prod'];
// Compatibility export: the strict policy never excludes a file by its name.
export const volatilePath = () => false;
export const bootId = crypto.randomUUID();

export async function inventoryOf(bytes) {
  const files = await readArchive(bytes);
  return canonicalInventory([...files.entries()].map(([archivePath, content]) => ({ path: archivePath, sha256: hash(content) })));
}

// Synthetic adapter. `scenario` chooses the behaviour the tests and Storybook need to show truthfully:
// apply (import changes the target), unapplied (import "succeeds" but nothing changes), fail, timeout, drift.
export function syntheticAdapter({ identity = { host: 'test.example.invalid', version: '2025.10.97', company: 'synthetic' }, inventory = [], scenario = 'apply', calls = [] } = {}) {
  let state = { inventory: structuredClone(inventory), version: 1 }, inspections = 0;
  return {
    name: 'synthetic',
    async capabilities() { return { inspect: true, deploy: true, readBack: true, rollbackReference: 'previous-export-only' }; },
    async health() { return { ok: true, identity: { ...identity } }; },
    async inspectSolution() {
      inspections++;
      if (scenario === 'drift' && inspections > 1) state = { inventory: [...state.inventory, { path: 'widgets/drifted.json', sha256: hash('drift' + inspections) }], version: state.version + 1 };
      return { inventory: structuredClone(state.inventory), version: state.version };
    },
    async deployCandidate(candidate, { signal } = {}) {
      calls.push({ sha256: candidate.sha256, at: Date.now() });
      if (scenario === 'fail') fail('Импорт отклонён целевой системой: unresolved dependency', 502);
      if (scenario === 'timeout') await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(Error('timeout'), { code: 'TIMEOUT' })), { once: true }));
      if (scenario !== 'unapplied') state = { inventory: await inventoryOf(candidate.bytes), version: state.version + 1 };
      return { ok: true, operationId: crypto.randomUUID(), nativeResult: scenario === 'unapplied' ? 'exit 0 (no history change: import skipped)' : 'exit 0' };
    },
    async readBack() { return { inventory: structuredClone(state.inventory), version: state.version }; }
  };
}

export function deliveryStore(directory, releases, { now = () => new Date().toISOString(), adapters = {}, protectedHosts = [], timeoutMs = 120000, confirmGraceMs = 2000, solutionHandoffs = null } = {}) {
  const root = path.resolve(directory, 'delivery');
  const protectedSet = new Set(protectedHosts.map(host => targetHost({ host })).filter(Boolean));
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const connectionFile = id => { if (!uuid.test(id)) fail('Подключение не найдено', 404); return path.join(root, 'connections', id + '.json'); };
  // Only server code constructs a contextual reference. Never fall back across
  // roots, even when a legacy release and shared handoff have the same UUID.
  const reference = value => {
    if (typeof value === 'string' && uuid.test(value)) return { id: value, namespace: 'legacy' };
    if (value && value.namespace === 'solution' && uuid.test(value.id) && uuid.test(value.solutionId) &&
        Object.keys(value).every(key => ['namespace', 'id', 'solutionId'].includes(key)) && solutionHandoffs)
      return value;
    fail('Delivery candidate not found', 404);
  };
  const storedReference = record => record.candidateSource ?? record.releaseId;
  const candidates = {
    authorize(value, owner) { const ref = reference(value); return ref.namespace === 'legacy' ? releases.authorize(ref.id, owner) : solutionHandoffs.authorize(ref.solutionId, ref.id); },
    candidateArtifact(value, owner) { const ref = reference(value); return ref.namespace === 'legacy' ? releases.candidateArtifact(ref.id, owner) : solutionHandoffs.withCandidate(ref.solutionId, ref.id, candidate => candidate); },
    withCandidate(value, owner, operation) { const ref = reference(value); return ref.namespace === 'legacy' ? releases.withCandidate(ref.id, owner, operation) : solutionHandoffs.withCandidate(ref.solutionId, ref.id, operation); }
  };
  const attemptDir = value => { const ref = reference(value); return path.join(root, 'attempts', ...(ref.namespace === 'solution' ? ['solutions'] : []), ref.id); };
  const attemptFile = (releaseId, id) => { if (!uuid.test(id)) fail('Попытка доставки не найдена', 404); return path.join(attemptDir(releaseId), id + '.json'); };
  const writeJson = async (file, record) => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600 });
    // Windows readers can briefly retain a sharing handle after readFile.
    // Retry only the atomic rename, never an adapter side effect or whole job.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temp, file); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  };
  const readJson = async (file, missing) => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail(missing, 404); throw error; }
  };
  const readConnection = async (id, owner) => { const record = await readJson(connectionFile(id), 'Подключение не найдено'); if (record.owner !== owner) fail('Подключение не найдено', 404); return record; };
  const publicConnection = ({ owner, ...record }) => record;
  // One adapter instance per connection for the lifetime of the process (a real adapter is a client; the synthetic one keeps its target state).
  const instances = new Map();
  const adapterFor = connection => {
    const factory = adapters[connection.adapter];
    if (!factory) fail(`Адаптер «${connection.adapter}» недоступен на этом сервисе`, 503);
    const key = connection.id + ':' + JSON.stringify(connection.adapterOptions || {});
    if (!instances.has(key)) instances.set(key, factory(connection.adapterOptions || {}, { id: connection.id, owner: connection.owner, name: connection.name, environment: connection.environment }));
    return instances.get(key);
  };
  const guardTarget = (connection, identity) => {
    if (connection.role !== 'target') fail('Подключение не является Target', 403);
    if (connection.environment === 'prod') fail('PROD не разрешён для доставки: отдельное разрешение и проверки AR-06 отсутствуют', 403);
    const host = targetHost(identity);
    if (!host) fail('Личность Target не подтверждена: доставка остановлена', 409);
    if (protectedSet.has(host)) fail(`Target «${connection.name}» фактически указывает на защищённый узел; доставка запрещена`, 403);
  };
  const observeTarget = async (connection, adapter, expectedIdentity) => {
    const health = await adapter.health();
    if (health?.ok !== true) fail('Target недоступен: состояние не подтверждено', 503);
    guardTarget(connection, health.identity);
    if (expectedIdentity && !isDeepStrictEqual(health.identity, expectedIdentity))
      fail('Личность Target изменилась после подготовки; операция заблокирована', 409);
    return structuredClone(health.identity);
  };
  const rejectCredentials = (value, trail = 'input') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (credentialKey.test(key)) fail(`Поле «${trail}.${key}» похоже на учётные данные: подключение хранит только ссылку, не секреты`);
      if (typeof nested === 'string' && /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/i.test(nested)) fail('URL с учётными данными не допускается');
      rejectCredentials(nested, trail + '.' + key);
    }
  };
  // Restart reconciliation: an attempt left in `deploying` by a previous process has an unknown outcome.
  const reconcile = async record => {
    if (record.state === 'deploying' && record.bootId !== bootId) {
      record.state = 'unknown-outcome';
      record.history.push({ at: now(), state: record.state, note: 'Процесс сервиса перезапущен во время доставки. Результат неизвестен до read-back.' });
      await writeJson(attemptFile(storedReference(record), record.id), record);
    }
    // Old name-based exclusions cannot continue to present a passing check.
    // Retain evidence/history, but require a fresh comparison under this policy.
    if (record.state === 'verified' &&
        (record.evidence?.comparison?.policy !== READ_BACK_POLICY || record.evidence.comparison.match !== true)) {
      record.state = 'verification-failed';
      record.history.push({ at: now(), state: record.state, note: 'Прежняя проверка не покрывает полный состав пакета. Требуется повторный read-back.' });
      await writeJson(attemptFile(storedReference(record), record.id), record);
    }
    return record;
  };
  const readAttempt = async (releaseId, id, owner) => { const record = await readJson(attemptFile(releaseId, id), 'Попытка доставки не найдена'); if (record.owner !== owner || !isDeepStrictEqual(reference(storedReference(record)), reference(releaseId))) fail('Попытка доставки не найдена', 404); return reconcile(record); };
  const listAttempts = async (releaseId, owner) => {
    let names = [];
    try { names = await fs.readdir(attemptDir(releaseId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const records = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try { records.push(await readAttempt(releaseId, name.slice(0, -5), owner)); } catch (error) { if (error.statusCode !== 404) throw error; }
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };
  const active = state => ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome'].includes(state);
  // The single service queue reserves a host across releases, owners and connection aliases.
  // Use durable attempts rather than an in-memory index so restart retains unresolved reservations.
  const ensureTargetAvailable = async (identity, excludingFile = null) => {
    let directories;
    try { directories = await fs.readdir(path.join(root, 'attempts'), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const roots = directories.filter(entry => entry.isDirectory() && uuid.test(entry.name)).map(entry => path.join(root, 'attempts', entry.name));
    if (directories.some(entry => entry.isDirectory() && entry.name === 'solutions')) {
      for (const entry of await fs.readdir(path.join(root, 'attempts', 'solutions'), { withFileTypes: true }))
        if (entry.isDirectory() && uuid.test(entry.name)) roots.push(path.join(root, 'attempts', 'solutions', entry.name));
    }
    for (const directory of roots) {
      for (const name of await fs.readdir(directory)) {
        if (!name.endsWith('.json')) continue;
        if (!uuid.test(name.slice(0, -5))) continue;
        const record = await readJson(path.join(directory, name), 'Попытка доставки не найдена');
        if (path.join(directory, name) !== excludingFile && active(record.state) && targetHost(record.targetIdentity) === targetHost(identity))
          fail('На этом Target уже есть незавершённая доставка. Завершите, проверьте или отмените её подготовку.', 409);
      }
    }
  };
  const publicAttempt = ({ owner, bootId: _boot, ...record }) => record;
  const transition = (record, state, extra = {}) => { record.state = state; record.history.push({ at: now(), state, ...extra }); };
  const withTimeout = async operation => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await operation(controller.signal); } finally { clearTimeout(timer); }
  };
  // Read-only adapter calls (inspect/read-back) simply fail on timeout; only the deploy side effect needs the
  // `unknown-outcome` handling in `confirm`.
  const timedRead = operation => withTimeout(operation).catch(error => { if (error.code === 'TIMEOUT') fail('Target не ответил в отведённое время', 504); throw error; });
  const ensureCurrent = async (release, record) => {
    if (release.approval?.revision !== release.revision || release.revision !== record.releaseRevision || release.candidate?.id !== record.candidateId || release.candidate.sha256 !== record.sha256)
      fail('Релиз, кандидат или принятие изменились после подготовки доставки. Подготовьте доставку заново.', 409);
    if (record.sourceAssociation && !isDeepStrictEqual(release.sourceAssociation, record.sourceAssociation))
      fail('Solution review association changed after delivery preparation', 409);
  };
  const contextualAttempts = async (releaseId, owner, records) => {
    if (reference(releaseId).namespace === 'legacy') return records.map(publicAttempt);
    let candidate = null;
    try { candidate = await candidates.candidateArtifact(releaseId, owner); }
    catch (error) { if (![404, 409, 422].includes(error.statusCode)) throw error; }
    return records.map(record => {
      const current = !!candidate && candidate.revision === record.releaseRevision && candidate.candidate.id === record.candidateId && candidate.candidate.sha256 === record.sha256 && isDeepStrictEqual(candidate.sourceAssociation, record.sourceAssociation);
      return { ...publicAttempt(record), candidateStatus: current ? 'current' : 'stale', verificationCurrent: current && record.state === 'verified' && record.evidence?.comparison?.match === true && record.evidence.comparison.policy === READ_BACK_POLICY };
    });
  };
  const store = {
    adapterNames: Object.keys(adapters),
    connections: {
      async list(owner) {
        let names = [];
        try { names = await fs.readdir(path.join(root, 'connections')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const records = [];
        for (const name of names) { if (!name.endsWith('.json')) continue; try { records.push(publicConnection(await readConnection(name.slice(0, -5), owner))); } catch (error) { if (error.statusCode !== 404) throw error; } }
        return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
      create(owner, input) { return serial(async () => {
        rejectCredentials(input);
        const record = { schemaVersion: 1, id: crypto.randomUUID(), owner, name: text(input.name, 'название подключения', 120), role: input.role, environment: input.environment, adapter: text(input.adapter, 'адаптер', 40), adapterOptions: input.adapterOptions && typeof input.adapterOptions === 'object' && !Array.isArray(input.adapterOptions) ? input.adapterOptions : {}, createdAt: now(), probe: null };
        if (!['source', 'target'].includes(record.role)) fail('Роль подключения: source или target');
        if (!environments.includes(record.environment)) fail('Среда подключения: dev, test или prod');
        if (JSON.stringify(record.adapterOptions).length > 4096) fail('Параметры адаптера слишком длинные');
        if (!adapters[record.adapter]) fail(`Адаптер «${record.adapter}» недоступен на этом сервисе`, 503);
        if ((await this.list(owner)).length >= 20) fail('Максимум 20 подключений');
        await writeJson(connectionFile(record.id), record);
        return publicConnection(record);
      }); },
      async get(id, owner) { return publicConnection(await readConnection(id, owner)); },
      remove(id, owner) { return serial(async () => { await readConnection(id, owner); await fs.rm(connectionFile(id), { force: true }); return { ok: true }; }); },
      // Read-only: health and capabilities. Records the observed identity so misleading names are visible.
      probe(id, owner) { return serial(async () => {
        const record = await readConnection(id, owner), adapter = adapterFor(record);
        const health = await adapter.health(), capabilities = await adapter.capabilities();
        record.probe = { at: now(), ok: !!health.ok, identity: health.identity || null, capabilities, protectedHost: protectedSet.has(targetHost(health.identity)) };
        await writeJson(connectionFile(id), record);
        return publicConnection(record);
      }); }
    },
    async list(releaseId, owner) { await candidates.authorize(releaseId, owner); return contextualAttempts(releaseId, owner, await listAttempts(releaseId, owner)); },
    async get(releaseId, id, owner) { await candidates.authorize(releaseId, owner); return (await contextualAttempts(releaseId, owner, [await readAttempt(releaseId, id, owner)]))[0]; },
    // Summary consumed by the release view: the `target` check reflects the latest attempt truthfully.
    async summary(releaseId, owner) {
      const attempts = await listAttempts(releaseId, owner), latest = attempts.at(-1) || null;
      return { attempts: attempts.length, latest: latest && { id: latest.id, state: latest.state, connectionName: latest.connection.name, adapter: latest.connection.adapter, releaseRevision: latest.releaseRevision, candidateId: latest.candidateId, sha256: latest.sha256, at: latest.history.at(-1).at } };
    },
    prepare(releaseId, owner, input) { return serial(async () => {
      const release = await candidates.candidateArtifact(releaseId, owner);
      if (!Number.isInteger(input.revision) || input.revision !== release.revision) fail('Релиз изменился в другой вкладке. Обновите страницу.', 409);
      if (!release.candidate || release.approval?.revision !== release.revision) fail('Доставка требует принятого неизменяемого кандидата', 409);
      const connection = await readConnection(input.connectionId, owner), adapter = adapterFor(connection);
      const health = await adapter.health();
      if (health?.ok !== true) fail('Target недоступен: доставка не подготовлена', 503);
      guardTarget(connection, health.identity);
      const others = await listAttempts(releaseId, owner);
      if (others.some(a => active(a.state))) fail('Уже есть незавершённая доставка этого релиза. Завершите или проверьте её.', 409);
      await ensureTargetAvailable(health.identity);
      const capabilities = await adapter.capabilities();
      if (!capabilities.deploy || !capabilities.readBack) fail('Адаптер не поддерживает доставку с read-back', 503);
      const before = await timedRead(signal => adapter.inspectSolution(release.code, { signal }));
      const ref = reference(releaseId);
      const record = { schemaVersion: 1, id: crypto.randomUUID(), releaseId: ref.id, ...(ref.namespace === 'solution' ? { candidateSource: structuredClone(ref), sourceAssociation: structuredClone(release.sourceAssociation), executionActorId: owner } : {}), owner, releaseRevision: release.revision, candidateId: release.candidate.id, sha256: release.candidate.sha256, solutionCode: release.code,
        connection: { id: connection.id, name: connection.name, environment: connection.environment, adapter: connection.adapter }, targetIdentity: health.identity, capabilities,
        createdAt: now(), state: 'prepared', idempotencyKey: null, bootId: null,
        evidence: { candidateInventoryHash: inventoryHash(await inventoryOf(release.bytes)), preDeploy: { at: now(), version: before.version ?? null, inventoryHash: inventoryHash(before.inventory), files: before.inventory.length }, operation: null, readBack: null, comparison: null, rollbackReference: null }, history: [] };
      transition(record, 'prepared', { note: 'Личность Target и состояние решения до доставки зафиксированы' });
      await candidates.withCandidate(releaseId, owner, async current => {
        await ensureCurrent(current, record);
        await writeJson(attemptFile(releaseId, record.id), record);
      });
      return publicAttempt(record);
    }); },
    cancel(releaseId, id, owner) { return serial(async () => {
      await candidates.authorize(releaseId, owner);
      const record = await readAttempt(releaseId, id, owner);
      if (record.state !== 'prepared') fail('Можно отменить только подготовку до запуска операции', 409);
      transition(record, 'cancelled', { note: 'Подготовка отменена владельцем; операция не запускалась' });
      await writeJson(attemptFile(releaseId, id), record);
      return publicAttempt(record);
    }); },
    confirm(releaseId, id, owner, input) { return serial(async () => {
      const release = await candidates.candidateArtifact(releaseId, owner), record = await readAttempt(releaseId, id, owner);
      const key = text(input.idempotencyKey, 'ключ подтверждения', 120);
      if (record.state !== 'prepared') { if (record.idempotencyKey === key) return { done: publicAttempt(record) }; fail(`Доставка уже ${record.state === 'deploying' ? 'выполняется' : 'выполнена'}; повторный запуск запрещён`, 409); }
      await ensureCurrent(release, record);
      if (input.confirmation !== `DEPLOY ${record.solutionCode} ${record.sha256.slice(0, 12)}`) fail('Подтверждение должно повторить код решения и начало SHA-256 кандидата', 400);
      const connection = await readConnection(record.connection.id, owner), adapter = adapterFor(connection);
      try { await observeTarget(connection, adapter, record.targetIdentity); }
      catch (error) {
        transition(record, 'blocked', { note: 'Доступность или личность Target не подтверждены; доставка заблокирована' });
        await writeJson(attemptFile(releaseId, id), record);
        throw error;
      }
      // Also guard legacy preparations created before host reservations were enforced.
      await ensureTargetAvailable(record.targetIdentity, attemptFile(releaseId, id));
      const current = await timedRead(signal => adapter.inspectSolution(record.solutionCode, { signal }));
      if (inventoryHash(current.inventory) !== record.evidence.preDeploy.inventoryHash) { transition(record, 'blocked', { note: 'Решение на Target изменилось после подготовки (drift)' }); await writeJson(attemptFile(releaseId, id), record); fail('Решение на Target изменилось после подготовки. Подготовьте доставку заново.', 409); }
      return candidates.withCandidate(releaseId, owner, async finalCandidate => {
        await ensureCurrent(finalCandidate, record);
        record.idempotencyKey = key; record.bootId = bootId;
        record.evidence.rollbackReference = { kind: 'previous-target-state', inventoryHash: record.evidence.preDeploy.inventoryHash, version: record.evidence.preDeploy.version, note: 'Ссылка на состояние до доставки; восстановление данных/экземпляров процессов не гарантируется' };
        transition(record, 'deploying', { note: 'Подтверждено владельцем; операция передана адаптеру' });
        await writeJson(attemptFile(releaseId, id), record); // persisted before the side effect
        const startedAt = now();
        // Start once while the final candidate guard is held, but return its
        // promise inside an object: never hold store queues through native work.
        const dispatch = withTimeout(signal => adapter.deployCandidate({ bytes: finalCandidate.bytes, sha256: record.sha256, code: record.solutionCode }, { signal }));
        dispatch.catch(() => {});
        return { record, dispatch, startedAt };
      });
    }).then(({ done, record, dispatch, startedAt }) => {
      if (done) return done;
      // The side effect runs outside the serial queue: a real import takes minutes and must not block other
      // delivery operations. The HTTP caller gets the final state if it arrives within the grace period,
      // otherwise `deploying` — the record is finished in the background and re-read by the UI.
      const finished = dispatch.then(result => {
        record.evidence.operation = { startedAt, finishedAt: now(), result: 'returned', operationId: result.operationId || null, nativeResult: String(result.nativeResult || '').slice(0, 4000) };
        transition(record, 'deployed-unverified', { note: 'Операция завершилась без ошибки. Это не подтверждение результата — требуется read-back.' });
      }, error => {
        const timeout = error.code === 'TIMEOUT';
        record.evidence.operation = { startedAt, finishedAt: now(), result: timeout ? 'timeout' : 'error', error: timeout ? 'Нет ответа в отведённое время' : String(error.message) };
        transition(record, timeout ? 'unknown-outcome' : 'failed', { note: timeout ? 'Результат неизвестен: выполните read-back прежде чем повторять' : 'Операция завершилась ошибкой' });
      }).then(() => serial(() => writeJson(attemptFile(releaseId, id), record))).then(() => publicAttempt(record));
      finished.catch(() => {});
      return Promise.race([finished, new Promise(resolve => setTimeout(() => resolve(publicAttempt(structuredClone(record))), confirmGraceMs).unref?.())]);
    }); },
    verify(releaseId, id, owner) { return serial(async () => {
      const release = await candidates.candidateArtifact(releaseId, owner), record = await readAttempt(releaseId, id, owner);
      if (!['deployed-unverified', 'unknown-outcome', 'verification-failed'].includes(record.state)) fail(`Read-back невозможен в состоянии «${record.state}»`, 409);
      await ensureCurrent(release, record);
      if (hash(release.bytes) !== record.sha256) fail('Байты кандидата не совпадают с SHA-256 попытки доставки', 409);
      const connection = await readConnection(record.connection.id, owner), adapter = adapterFor(connection);
      try {
        await observeTarget(connection, adapter, record.targetIdentity);
        const after = await timedRead(signal => adapter.readBack(record.solutionCode, { signal }));
        const expected = await inventoryOf(release.bytes), comparison = compareReadBack(expected, after?.inventory);
        // A changing connection must not supply evidence for the previous Target.
        const identity = await observeTarget(connection, adapter, record.targetIdentity);
        // Delivery -> Solution -> release. Hold the final guard through the
        // evidence write; callbacks never re-enter these queues.
        await candidates.withCandidate(releaseId, owner, async current => {
          await ensureCurrent(current, record);
          record.evidence.readBack = { at: now(), version: after.version ?? null, inventoryHash: inventoryHash(after.inventory), files: after.inventory.length, targetIdentity: identity, policy: READ_BACK_POLICY };
          record.evidence.comparison = comparison;
          delete record.evidence.verificationError;
          const unchanged = record.evidence.readBack.inventoryHash === record.evidence.preDeploy.inventoryHash;
          transition(record, comparison.match ? 'verified' : 'verification-failed', { note: comparison.match ? `Read-back совпал: ${comparison.compared} файлов, включая package.json и manifest.json` : unchanged ? 'Target не изменился после операции: импорт не применён' : `Расхождения: отсутствуют ${comparison.missing.length}, отличаются ${comparison.different.length}, лишние ${comparison.unexpected.length}` });
          await writeJson(attemptFile(releaseId, id), record);
        });
      } catch (error) {
        record.evidence.readBack = null;
        record.evidence.comparison = null;
        record.evidence.verificationError = { at: now(), policy: READ_BACK_POLICY, statusCode: error.statusCode || 502 };
        transition(record, 'verification-failed', { note: 'Read-back не подтверждён: проверьте личность Target, структуру ответа и актуальность кандидата' });
        await writeJson(attemptFile(releaseId, id), record);
        throw error;
      }
      return publicAttempt(record);
    }); },
    // Server-selected context; the execution actor still owns connections and
    // attempts. All facades share this store's queue, adapters and reservations.
    forSolution(solutionId) {
      if (!solutionHandoffs || !uuid.test(solutionId)) fail('Solution delivery unavailable', 404);
      const ref = id => reference({ namespace: 'solution', solutionId, id });
      return {
        list: (id, owner) => store.list(ref(id), owner),
        get: (id, attemptId, owner) => store.get(ref(id), attemptId, owner),
        prepare: (id, owner, input) => store.prepare(ref(id), owner, input),
        confirm: (id, attemptId, owner, input) => store.confirm(ref(id), attemptId, owner, input),
        verify: (id, attemptId, owner) => store.verify(ref(id), attemptId, owner),
        cancel: (id, attemptId, owner) => store.cancel(ref(id), attemptId, owner)
      };
    }
  };
  return store;
}
