import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readArchive } from './e365.mjs';

// Target connections, delivery attempts and read-back verification (AR-04 foundation, issue #11).
// Connection references never hold credentials; execution goes through a named adapter.
// The only adapter shipped here is the synthetic one for tests/Storybook. It is disabled on a hosted service
// unless the operator explicitly enables it, so no hosted release can be "verified" against a fake target.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const text = (value, label, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Заполните ${label} (до ${max} символов)`); return value.trim(); };
const credentialKey = /token|password|passwd|secret|cookie|authorization|apikey|api_key|credential/i;
export const environments = ['dev', 'test', 'prod'];
export const volatilePath = archivePath => /(^|\/)(manifest|package)\.json$/.test(archivePath);
export const bootId = crypto.randomUUID();

export async function inventoryOf(bytes) {
  const files = await readArchive(bytes);
  return [...files.entries()].map(([archivePath, content]) => ({ path: archivePath, sha256: hash(content) })).sort((a, b) => a.path.localeCompare(b.path));
}
export const inventoryHash = inventory => hash(JSON.stringify(inventory.map(row => [row.path, row.sha256])));

// Verified means: every non-volatile candidate file is present on the Target with the same bytes.
// Manifest/package files legitimately change on import (history, versions) and are reported, not compared.
export function compareReadBack(expected, actual) {
  const present = new Map(actual.map(row => [row.path, row.sha256]));
  const missing = [], different = [], volatile = [];
  for (const row of expected) {
    if (volatilePath(row.path)) { volatile.push(row.path); continue; }
    if (!present.has(row.path)) missing.push(row.path);
    else if (present.get(row.path) !== row.sha256) different.push(row.path);
  }
  const compared = expected.length - volatile.length;
  return { match: compared > 0 && !missing.length && !different.length, compared, missing, different, volatile };
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

export function deliveryStore(directory, releases, { now = () => new Date().toISOString(), adapters = {}, protectedHosts = [], timeoutMs = 120000 } = {}) {
  const root = path.resolve(directory, 'delivery');
  const protectedSet = new Set(protectedHosts.map(host => host.trim().toLowerCase()).filter(Boolean));
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const connectionFile = id => { if (!uuid.test(id)) fail('Подключение не найдено', 404); return path.join(root, 'connections', id + '.json'); };
  const attemptDir = releaseId => { if (!uuid.test(releaseId)) fail('Релиз не найден', 404); return path.join(root, 'attempts', releaseId); };
  const attemptFile = (releaseId, id) => { if (!uuid.test(id)) fail('Попытка доставки не найдена', 404); return path.join(attemptDir(releaseId), id + '.json'); };
  const writeJson = async (file, record) => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(temp, file);
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
    if (!instances.has(key)) instances.set(key, factory(connection.adapterOptions || {}));
    return instances.get(key);
  };
  const guardTarget = (connection, identity) => {
    if (connection.role !== 'target') fail('Подключение не является Target', 403);
    if (connection.environment === 'prod') fail('PROD не разрешён для доставки: отдельное разрешение и проверки AR-06 отсутствуют', 403);
    const host = String(identity?.host || '').toLowerCase();
    if (!host) fail('Личность Target не подтверждена: доставка остановлена', 409);
    if (protectedSet.has(host)) fail(`Target «${connection.name}» фактически указывает на защищённый узел; доставка запрещена`, 403);
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
      await writeJson(attemptFile(record.releaseId, record.id), record);
    }
    return record;
  };
  const readAttempt = async (releaseId, id, owner) => { const record = await readJson(attemptFile(releaseId, id), 'Попытка доставки не найдена'); if (record.owner !== owner) fail('Попытка доставки не найдена', 404); return reconcile(record); };
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
  const publicAttempt = ({ owner, bootId: _boot, ...record }) => record;
  const transition = (record, state, extra = {}) => { record.state = state; record.history.push({ at: now(), state, ...extra }); };
  const withTimeout = async operation => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await operation(controller.signal); } finally { clearTimeout(timer); }
  };
  const ensureCurrent = async (release, record) => {
    if (release.approval?.revision !== release.revision || release.revision !== record.releaseRevision || release.candidate?.id !== record.candidateId || release.candidate.sha256 !== record.sha256)
      fail('Релиз, кандидат или принятие изменились после подготовки доставки. Подготовьте доставку заново.', 409);
  };
  return {
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
        record.probe = { at: now(), ok: !!health.ok, identity: health.identity || null, capabilities, protectedHost: protectedSet.has(String(health.identity?.host || '').toLowerCase()) };
        await writeJson(connectionFile(id), record);
        return publicConnection(record);
      }); }
    },
    async list(releaseId, owner) { await releases.authorize(releaseId, owner); return (await listAttempts(releaseId, owner)).map(publicAttempt); },
    async get(releaseId, id, owner) { await releases.authorize(releaseId, owner); return publicAttempt(await readAttempt(releaseId, id, owner)); },
    // Summary consumed by the release view: the `target` check reflects the latest attempt truthfully.
    async summary(releaseId, owner) {
      const attempts = await listAttempts(releaseId, owner), latest = attempts.at(-1) || null;
      return { attempts: attempts.length, latest: latest && { id: latest.id, state: latest.state, connectionName: latest.connection.name, adapter: latest.connection.adapter, releaseRevision: latest.releaseRevision, candidateId: latest.candidateId, sha256: latest.sha256, at: latest.history.at(-1).at } };
    },
    prepare(releaseId, owner, input) { return serial(async () => {
      const release = await releases.candidateArtifact(releaseId, owner);
      if (!Number.isInteger(input.revision) || input.revision !== release.revision) fail('Релиз изменился в другой вкладке. Обновите страницу.', 409);
      if (!release.candidate || release.approval?.revision !== release.revision) fail('Доставка требует принятого неизменяемого кандидата', 409);
      const connection = await readConnection(input.connectionId, owner), adapter = adapterFor(connection);
      const health = await adapter.health();
      if (!health.ok) fail('Target недоступен: доставка не подготовлена', 503);
      guardTarget(connection, health.identity);
      const others = await listAttempts(releaseId, owner);
      if (others.some(a => active(a.state))) fail('Уже есть незавершённая доставка этого релиза. Завершите или проверьте её.', 409);
      const capabilities = await adapter.capabilities();
      if (!capabilities.deploy || !capabilities.readBack) fail('Адаптер не поддерживает доставку с read-back', 503);
      const before = await adapter.inspectSolution(release.code);
      const record = { schemaVersion: 1, id: crypto.randomUUID(), releaseId, owner, releaseRevision: release.revision, candidateId: release.candidate.id, sha256: release.candidate.sha256, solutionCode: release.code,
        connection: { id: connection.id, name: connection.name, environment: connection.environment, adapter: connection.adapter }, targetIdentity: health.identity, capabilities,
        createdAt: now(), state: 'prepared', idempotencyKey: null, bootId: null,
        evidence: { candidateInventoryHash: inventoryHash(await inventoryOf(release.bytes)), preDeploy: { at: now(), version: before.version ?? null, inventoryHash: inventoryHash(before.inventory), files: before.inventory.length }, operation: null, readBack: null, comparison: null, rollbackReference: null }, history: [] };
      transition(record, 'prepared', { note: 'Личность Target и состояние решения до доставки зафиксированы' });
      await writeJson(attemptFile(releaseId, record.id), record);
      return publicAttempt(record);
    }); },
    cancel(releaseId, id, owner) { return serial(async () => {
      await releases.authorize(releaseId, owner);
      const record = await readAttempt(releaseId, id, owner);
      if (record.state !== 'prepared') fail('Можно отменить только подготовку до запуска операции', 409);
      transition(record, 'cancelled', { note: 'Подготовка отменена владельцем; операция не запускалась' });
      await writeJson(attemptFile(releaseId, id), record);
      return publicAttempt(record);
    }); },
    confirm(releaseId, id, owner, input) { return serial(async () => {
      const release = await releases.candidateArtifact(releaseId, owner), record = await readAttempt(releaseId, id, owner);
      const key = text(input.idempotencyKey, 'ключ подтверждения', 120);
      if (record.state !== 'prepared') { if (record.idempotencyKey === key) return publicAttempt(record); fail(`Доставка уже ${record.state === 'deploying' ? 'выполняется' : 'выполнена'}; повторный запуск запрещён`, 409); }
      await ensureCurrent(release, record);
      if (input.confirmation !== `DEPLOY ${record.solutionCode} ${record.sha256.slice(0, 12)}`) fail('Подтверждение должно повторить код решения и начало SHA-256 кандидата', 400);
      const connection = await readConnection(record.connection.id, owner), adapter = adapterFor(connection);
      const health = await adapter.health();
      guardTarget(connection, health.identity);
      if (JSON.stringify(health.identity) !== JSON.stringify(record.targetIdentity)) { transition(record, 'blocked', { note: 'Личность Target изменилась после подготовки' }); await writeJson(attemptFile(releaseId, id), record); fail('Личность Target изменилась после подготовки; доставка заблокирована', 409); }
      const current = await adapter.inspectSolution(record.solutionCode);
      if (inventoryHash(current.inventory) !== record.evidence.preDeploy.inventoryHash) { transition(record, 'blocked', { note: 'Решение на Target изменилось после подготовки (drift)' }); await writeJson(attemptFile(releaseId, id), record); fail('Решение на Target изменилось после подготовки. Подготовьте доставку заново.', 409); }
      record.idempotencyKey = key; record.bootId = bootId;
      record.evidence.rollbackReference = { kind: 'previous-target-state', inventoryHash: record.evidence.preDeploy.inventoryHash, version: record.evidence.preDeploy.version, note: 'Ссылка на состояние до доставки; восстановление данных/экземпляров процессов не гарантируется' };
      transition(record, 'deploying', { note: 'Подтверждено владельцем; операция передана адаптеру' });
      await writeJson(attemptFile(releaseId, id), record); // persisted before the side effect
      const startedAt = now();
      try {
        const result = await withTimeout(signal => adapter.deployCandidate({ bytes: release.bytes, sha256: record.sha256, code: record.solutionCode }, { signal }));
        record.evidence.operation = { startedAt, finishedAt: now(), result: 'returned', operationId: result.operationId || null, nativeResult: String(result.nativeResult || '') };
        transition(record, 'deployed-unverified', { note: 'Операция завершилась без ошибки. Это не подтверждение результата — требуется read-back.' });
      } catch (error) {
        const timeout = error.code === 'TIMEOUT';
        record.evidence.operation = { startedAt, finishedAt: now(), result: timeout ? 'timeout' : 'error', error: timeout ? 'Нет ответа в отведённое время' : String(error.message) };
        transition(record, timeout ? 'unknown-outcome' : 'failed', { note: timeout ? 'Результат неизвестен: выполните read-back прежде чем повторять' : 'Операция завершилась ошибкой' });
      }
      await writeJson(attemptFile(releaseId, id), record);
      return publicAttempt(record);
    }); },
    verify(releaseId, id, owner) { return serial(async () => {
      const release = await releases.candidateArtifact(releaseId, owner), record = await readAttempt(releaseId, id, owner);
      if (!['deployed-unverified', 'unknown-outcome', 'verification-failed'].includes(record.state)) fail(`Read-back невозможен в состоянии «${record.state}»`, 409);
      if (release.candidate?.sha256 !== record.sha256) fail('Кандидат релиза изменился; результат read-back нельзя связать с доставкой', 409);
      const connection = await readConnection(record.connection.id, owner), adapter = adapterFor(connection);
      const after = await adapter.readBack(record.solutionCode), expected = await inventoryOf(release.bytes), comparison = compareReadBack(expected, after.inventory);
      record.evidence.readBack = { at: now(), version: after.version ?? null, inventoryHash: inventoryHash(after.inventory), files: after.inventory.length };
      record.evidence.comparison = comparison;
      const unchanged = record.evidence.readBack.inventoryHash === record.evidence.preDeploy.inventoryHash;
      transition(record, comparison.match ? 'verified' : 'verification-failed', { note: comparison.match ? `Read-back совпал: ${comparison.compared} файлов, служебные файлы (${comparison.volatile.length}) не сравнивались` : unchanged ? 'Target не изменился после операции: импорт не применён' : `Расхождения: отсутствуют ${comparison.missing.length}, отличаются ${comparison.different.length}` });
      await writeJson(attemptFile(releaseId, id), record);
      return publicAttempt(record);
    }); }
  };
}
