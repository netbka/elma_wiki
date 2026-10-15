import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readArchive } from './e365.mjs';
import { isDeepStrictEqual } from 'node:util';
import { guardPresetDeploy, allows, ownerKey } from './target-presets.mjs';
import { READ_BACK_POLICY, canonicalInventory, inventoryHash, compareReadBack } from './delivery-verification.mjs';
import { IMPORT_NORMALIZED_POLICY, compareImportNormalizedReadBack, importNormalizedMetadataPaths, readBackMetadataFiles } from './delivery-import-normalization.mjs';
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
// Key-sorted JSON, so an evidence digest depends on content and never on key order.
export const canonicalJson = value => JSON.stringify(value, (_, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested);
export const environments = ['dev', 'test', 'prod'];
// Compatibility export: the strict policy never excludes a file by its name.
export const volatilePath = () => false;
export const bootId = crypto.randomUUID();

// Read-back policy selection (#37, PLAN-01 P8). Only the coordinator chooses, from server
// configuration: import-normalized-v1 for a candidate the owner designated for the predefined
// DEV2 Target, exact-solution-inventory-v1 for every other delivery. No request field selects it.
export const exactPolicy = { id: READ_BACK_POLICY, version: 1, selectedBy: 'default' };
export function selectReadBackPolicy(connection, sha256) {
  const preset = connection?.preset;
  return preset?.id === 'preset-dev2' && preset.available === true && preset.designatedCandidates?.includes(String(sha256 || '').toLowerCase())
    ? { id: IMPORT_NORMALIZED_POLICY, version: 1, selectedBy: 'dev2-designated-candidate' } : { ...exactPolicy };
}
// A verified comparison counts only under the exact policy or the normalized policy the attempt recorded.
const verifiedUnderPolicy = record => record.evidence?.comparison?.match === true &&
  (record.evidence.comparison.policy === READ_BACK_POLICY || (record.evidence.comparison.policy === IMPORT_NORMALIZED_POLICY && record.readBackPolicy?.id === IMPORT_NORMALIZED_POLICY));

export async function inventoryOf(bytes) {
  const files = await readArchive(bytes);
  return canonicalInventory([...files.entries()].map(([archivePath, content]) => ({ path: archivePath, sha256: hash(content) })));
}

// Synthetic adapter. `scenario` chooses the behaviour the tests and Storybook need to show truthfully:
// apply (import changes the target), unapplied (import "succeeds" but nothing changes), fail, timeout, drift,
// partial (composed receipts), diverge (a partial install: the Target ends in neither the previous nor the
// candidate state) and lost-response (the import applies, but its answer never arrives). `sequence` lists the
// scenario of each successive deploy call (the last one repeats), so a retry can behave differently.
// `reimport: 'idempotent'` declares a synthetic idempotent re-import capability; no live adapter declares it.
export function syntheticAdapter({ identity = { host: 'test.example.invalid', version: '2025.10.97', company: 'synthetic' }, inventory = [], scenario = 'apply', sequence = null, reimport = null, calls = [] } = {}) {
  let state = { inventory: structuredClone(inventory), version: 1 }, inspections = 0, deploys = 0;
  const steps = Array.isArray(sequence) && sequence.length ? sequence : [scenario];
  return {
    name: 'synthetic',
    async capabilities() { return { inspect: true, deploy: true, readBack: true, unitReceipts: true, rollbackReference: 'previous-export-only', ...(reimport === 'idempotent' ? { reimport } : {}) }; },
    async health() { return { ok: true, identity: { ...identity } }; },
    async inspectSolution() {
      inspections++;
      if (scenario === 'drift' && inspections > 1) state = { inventory: [...state.inventory, { path: 'widgets/drifted.json', sha256: hash('drift' + inspections) }], version: state.version + 1 };
      return { inventory: structuredClone(state.inventory), version: state.version };
    },
    // Test-only: another actor changes the Target outside this coordinator.
    simulateExternalChange(label = 'external') { state = { inventory: [...state.inventory, { path: `widgets/${label}.json`, sha256: hash(label + state.version) }], version: state.version + 1 }; },
    async deployCandidate(candidate, { signal } = {}) {
      const step = steps[Math.min(deploys++, steps.length - 1)];
      calls.push({ sha256: candidate.sha256, at: Date.now(), scenario: step, ...(candidate.units ? { units: [...candidate.units] } : {}) });
      if (step === 'fail') fail('Импорт отклонён целевой системой: unresolved dependency', 502);
      if (step === 'timeout') await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(Error('timeout'), { code: 'TIMEOUT' })), { once: true }));
      if (step === 'diverge') {
        const rows = await inventoryOf(candidate.bytes);
        rows[rows.length - 1] = { ...rows[rows.length - 1], sha256: hash('partially-applied' + state.version) };
        state = { inventory: rows, version: state.version + 1 };
        fail('Импорт прерван: часть изменений применена', 502);
      }
      // `partial`: the first native unit reports applied, later units fail; the Target does not hold the candidate.
      if (!['unapplied', 'partial'].includes(step)) state = { inventory: await inventoryOf(candidate.bytes), version: state.version + 1 };
      if (step === 'lost-response') throw Object.assign(Error('response lost'), { code: 'TIMEOUT' });
      const receipts = candidate.units?.map((unitId, index) => ({ unitId, status: step === 'unapplied' ? 'skipped' : step === 'partial' && index > 0 ? 'failed' : 'applied', operationId: crypto.randomUUID() }));
      return { ok: true, operationId: crypto.randomUUID(), nativeResult: step === 'unapplied' ? 'exit 0 (no history change: import skipped)' : 'exit 0', ...(receipts ? { receipts } : {}) };
    },
    async readBack() { return { inventory: structuredClone(state.inventory), version: state.version }; }
  };
}

export function deliveryStore(directory, releases, { now = () => new Date().toISOString(), adapters = {}, protectedHosts = [], timeoutMs = 120000, confirmGraceMs = 2000, solutionHandoffs = null, composedCandidates = null, presets = [], presetAdapter = null, productionPromotions = [] } = {}) {
  const root = path.resolve(directory, 'delivery');
  const protectedSet = new Set(protectedHosts.map(host => targetHost({ host })).filter(Boolean));
  // MR-08 PROD promotion grants. Only trusted server code can supply them; server.mjs supplies none,
  // so PROD stays refused by default. A grant is an owner record bound to one exact candidate SHA-256,
  // one destination connection and observed host, with an expiry. It never covers a protected host.
  const grants = Object.freeze((Array.isArray(productionPromotions) ? productionPromotions : []).filter(grant =>
    grant && typeof grant.authorizationRef === 'string' && grant.authorizationRef.trim() && /^[0-9a-f]{64}$/.test(grant.sha256 ?? '') &&
    typeof grant.connectionId === 'string' && targetHost({ host: grant.host }) && Number.isFinite(Date.parse(grant.expiresAt)))
    .map(grant => Object.freeze({ authorizationRef: grant.authorizationRef.trim(), sha256: grant.sha256, connectionId: grant.connectionId, host: targetHost({ host: grant.host }), expiresAt: grant.expiresAt })));
  // A grant applies only to a promotion of verified non-production evidence, never to a direct preparation.
  const productionGrant = (connection, identity, sha256, promotion) => connection?.environment !== 'prod' || !promotion ? null
    : grants.find(grant => grant.sha256 === sha256 && grant.connectionId === connection.id && grant.host === targetHost(identity) && Date.parse(grant.expiresAt) > Date.parse(now())) ?? null;
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const connectionFile = id => { if (!uuid.test(id)) fail('Подключение не найдено', 404); return path.join(root, 'connections', id + '.json'); };
  // Only server code constructs a contextual reference. Never fall back across
  // roots, even when a legacy release and shared handoff have the same UUID.
  // Contextual providers: a shared unchanged original and a frozen composed
  // candidate (PLAN-01 P7) use one guarded interface, this queue and these reservations.
  const contextual = { solution: solutionHandoffs, composed: composedCandidates };
  const contextualRoot = { solution: 'solutions', composed: 'composed' };
  const reference = value => {
    if (typeof value === 'string' && uuid.test(value)) return { id: value, namespace: 'legacy' };
    if (value && Object.hasOwn(contextual, value.namespace) && contextual[value.namespace] && uuid.test(value.id) && uuid.test(value.solutionId) &&
        Object.keys(value).every(key => ['namespace', 'id', 'solutionId'].includes(key)))
      return value;
    fail('Delivery candidate not found', 404);
  };
  const storedReference = record => record.candidateSource ?? record.releaseId;
  const candidates = {
    authorize(value, owner) { const ref = reference(value); return ref.namespace === 'legacy' ? releases.authorize(ref.id, owner) : contextual[ref.namespace].authorize(ref.solutionId, ref.id); },
    candidateArtifact(value, owner) { const ref = reference(value); return ref.namespace === 'legacy' ? releases.candidateArtifact(ref.id, owner) : contextual[ref.namespace].withCandidate(ref.solutionId, ref.id, candidate => candidate); },
    withCandidate(value, owner, operation) { const ref = reference(value); return ref.namespace === 'legacy' ? releases.withCandidate(ref.id, owner, operation) : contextual[ref.namespace].withCandidate(ref.solutionId, ref.id, operation); }
  };
  const attemptDir = value => { const ref = reference(value); return path.join(root, 'attempts', ...(ref.namespace === 'legacy' ? [] : [contextualRoot[ref.namespace]]), ref.id); };
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
  // Predefined DEV/DEV2 Targets are virtual, identical for every actor and never stored;
  // only an actor's own probe result is kept. Execution uses that actor's own bridge.
  const presetById = new Map(presets.map(preset => [preset.id, preset]));
  const presetProbeFile = (id, owner) => path.join(root, 'connections', 'presets', `${ownerKey(owner)}-${id}.json`);
  const presetConnection = async (preset, owner) => {
    let probe = null;
    try { probe = JSON.parse(await fs.readFile(presetProbeFile(preset.id, owner), 'utf8')).probe; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { schemaVersion: 1, id: preset.id, owner, name: preset.name, role: 'target', environment: 'dev', adapter: 'bridge',
      adapterOptions: { bridgeTarget: preset.bridgeTarget, host: preset.host }, preset: structuredClone(preset), createdAt: '', probe };
  };
  const saveConnection = (record, owner) => record.preset ? writeJson(presetProbeFile(record.id, owner), { probe: record.probe }) : writeJson(connectionFile(record.id), record);
  const readConnection = async (id, owner) => { if (presetById.has(id)) return presetConnection(presetById.get(id), owner); const record = await readJson(connectionFile(id), 'Подключение не найдено'); if (record.owner !== owner) fail('Подключение не найдено', 404); return record; };
  const publicConnection = ({ owner, ...record }) => record;
  // One adapter instance per connection for the lifetime of the process (a real adapter is a client; the synthetic one keeps its target state).
  const instances = new Map();
  const adapterFor = connection => {
    if (connection.preset) {
      if (!connection.preset.available) fail(`${connection.preset.name} недоступен: ${connection.preset.reason}`, 503);
      if (!presetAdapter) fail('Мост оператора недоступен на этом сервисе', 503);
      const key = connection.id + ':' + connection.owner;
      if (!instances.has(key)) instances.set(key, presetAdapter(connection.preset, { id: connection.id, owner: connection.owner, name: connection.name, environment: connection.environment }));
      return instances.get(key);
    }
    const factory = adapters[connection.adapter];
    if (!factory) fail(`Адаптер «${connection.adapter}» недоступен на этом сервисе`, 503);
    const key = connection.id + ':' + JSON.stringify(connection.adapterOptions || {});
    if (!instances.has(key)) instances.set(key, factory(connection.adapterOptions || {}, { id: connection.id, owner: connection.owner, name: connection.name, environment: connection.environment }));
    return instances.get(key);
  };
  const guardTarget = (connection, identity, grant = null) => {
    if (connection.role !== 'target') fail('Подключение не является Target', 403);
    if (connection.environment === 'prod' && !(grant && grant.connectionId === connection.id && grant.host === targetHost(identity)))
      fail('PROD не разрешён для доставки: отдельное разрешение и проверки AR-06 отсутствуют', 403);
    const host = targetHost(identity);
    if (!host) fail('Личность Target не подтверждена: доставка остановлена', 409);
    if (protectedSet.has(host)) fail(`Target «${connection.name}» фактически указывает на защищённый узел; доставка запрещена`, 403);
    // A predefined Target is bound to its configured host: a bridge pointed elsewhere
    // (for DEV2, the shared DEV or a PROD host) never supplies its identity.
    if (connection.preset && host !== connection.preset.host) fail(`Target «${connection.name}» фактически указывает на ${host}, а не на настроенный узел; операция остановлена`, 409);
  };
  const observeTarget = async (connection, adapter, expectedIdentity, grant = null) => {
    const health = await adapter.health();
    if (health?.ok !== true) fail('Target недоступен: состояние не подтверждено', 503);
    guardTarget(connection, health.identity, grant);
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
      for (const unit of record.evidence?.units ?? []) if (['pending', 'dispatched'].includes(unit.status)) unit.status = 'unreported';
      record.history.push({ at: now(), state: record.state, note: 'Процесс сервиса перезапущен во время доставки. Результат неизвестен до read-back.' });
      await writeJson(attemptFile(storedReference(record), record.id), record);
    }
    // Old name-based exclusions cannot continue to present a passing check.
    // Retain evidence/history, but require a fresh comparison under this policy.
    if (record.state === 'verified' && !verifiedUnderPolicy(record)) {
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
  const active = state => ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome', 'partial-outcome'].includes(state);
  // The single service queue reserves a host across releases, owners and connection aliases.
  // Use durable attempts rather than an in-memory index so restart retains unresolved reservations.
  const ensureTargetAvailable = async (identity, excludingFile = null) => {
    let directories;
    try { directories = await fs.readdir(path.join(root, 'attempts'), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const roots = directories.filter(entry => entry.isDirectory() && uuid.test(entry.name)).map(entry => path.join(root, 'attempts', entry.name));
    for (const name of Object.values(contextualRoot)) if (directories.some(entry => entry.isDirectory() && entry.name === name)) {
      for (const entry of await fs.readdir(path.join(root, 'attempts', name), { withFileTypes: true }))
        if (entry.isDirectory() && uuid.test(entry.name)) roots.push(path.join(root, 'attempts', name, entry.name));
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
      return { ...publicAttempt(record), candidateStatus: current ? 'current' : 'stale', verificationCurrent: current && record.state === 'verified' && verifiedUnderPolicy(record) };
    });
  };
  // Composed candidates: synthetic evidence reaches only a synthetic training
  // Target, the observed platform must equal the bound profile, and more than
  // one native unit requires an adapter that reports per-unit receipts.
  const guardComposed = (composed, connection, identity, capabilities) => {
    if (!(composed.evidenceBasis === 'native' && composed.releaseEligible === true) && connection.adapter !== 'synthetic')
      fail('Composed candidate has no native release evidence; only a synthetic training Target may receive it', 409);
    if (!identity?.version || identity.version !== composed.targetProfile?.platformVersion)
      fail('Target platform differs from the composed candidate profile', 409);
    if (composed.units.length > 1 && capabilities.unitReceipts !== true) fail('Adapter does not report per-unit receipts for a multi-unit candidate', 503);
  };
  // Truthful per-unit receipts: only units the adapter reports are recorded and an
  // unreported unit stays unknown. Never redispatched; read-back decides the state.
  // A timeout or a single-unit operation error never proves which unit applied:
  // a timeout keeps the outcome unknown; the only unit inherits the reported error.
  const composedOutcome = (record, receipts, { errored = false, timeout = false } = {}) => {
    if (errored && !timeout && !Array.isArray(receipts) && record.composed.units.length === 1) receipts = [{ unitId: record.composed.units[0].id, status: 'failed' }];
    const reported = new Map((Array.isArray(receipts) ? receipts : []).filter(row => typeof row?.unitId === 'string').map(row => [row.unitId, row]));
    record.evidence.units = record.composed.units.map(unit => {
      const row = reported.get(unit.id);
      return { unitId: unit.id, status: ['applied', 'failed', 'skipped'].includes(row?.status) ? row.status : 'unreported',
        operationId: typeof row?.operationId === 'string' ? row.operationId.slice(0, 200) : null };
    });
    const statuses = record.evidence.units.map(unit => unit.status), applied = statuses.filter(status => status === 'applied').length;
    const partial = applied && applied < statuses.length;
    if (timeout && !partial) return transition(record, 'unknown-outcome', { note: 'Нет ответа в отведённое время: результат по единицам установки неизвестен. Выполните read-back, не повторяя операцию' });
    if (applied === statuses.length) return transition(record, 'deployed-unverified', { note: 'Все единицы установки сообщили о применении. Это не подтверждение результата — требуется read-back.' });
    if (statuses.every(status => status === 'unreported')) return transition(record, 'unknown-outcome', { note: 'Результат по единицам установки неизвестен: выполните read-back, не повторяя операцию' });
    if (!applied && !statuses.includes('unreported')) return statuses.includes('failed') || errored
      ? transition(record, 'failed', { note: 'Ни одна единица установки не применена по ответу адаптера' })
      : transition(record, 'deployed-unverified', { note: 'Адаптер сообщил, что единицы установки пропущены. Требуется read-back.' });
    transition(record, 'partial-outcome', { note: `Частичный результат: применено ${applied} из ${statuses.length}. Выполните read-back; повтор запрещён` });
  };
  // MR-08 per-destination evidence packet. It binds the exact candidate inputs and the observed
  // destination environment profile; its digest changes with any of them. It never claims native
  // business acceptance and marks synthetic evidence as such.
  const packetOf = (record, candidateStatus) => {
    const synthetic = record.connection.adapter === 'synthetic' || (record.composed && record.composed.evidenceBasis !== 'native');
    const inputs = { reference: structuredClone(record.candidateSource ?? { namespace: 'legacy', id: record.releaseId }), releaseRevision: record.releaseRevision,
      candidateId: record.candidateId, sha256: record.sha256, solutionCode: record.solutionCode, candidateInventoryHash: record.evidence.candidateInventoryHash,
      sourceAssociationDigest: record.sourceAssociation ? hash(canonicalJson(record.sourceAssociation)) : null, composed: record.composed ? structuredClone(record.composed) : null };
    const environmentProfile = { connection: structuredClone(record.connection), host: targetHost(record.targetIdentity), targetIdentity: structuredClone(record.targetIdentity),
      platformVersion: record.targetIdentity?.version ?? null, capabilities: structuredClone(record.capabilities ?? {}), readBackPolicy: structuredClone(record.readBackPolicy ?? exactPolicy) };
    const verificationCurrent = candidateStatus === 'current' && record.state === 'verified' && verifiedUnderPolicy(record);
    const packet = { schema: 'delivery-evidence-packet-v1', attemptId: record.id, createdAt: record.createdAt,
      inputs, inputsDigest: hash(canonicalJson(inputs)), environmentProfile, environmentDigest: hash(canonicalJson(environmentProfile)),
      evidence: { preDeploy: record.evidence.preDeploy ?? null, operation: record.evidence.operation ?? null, units: record.evidence.units ?? null,
        readBack: record.evidence.readBack ?? null, comparison: record.evidence.comparison ?? null, reconciliation: record.evidence.reconciliation ?? null,
        verificationError: record.evidence.verificationError ?? null, rollbackReference: record.evidence.rollbackReference ?? null },
      lineage: { promotion: record.promotion ?? null, retryOf: record.retryOf ?? null, retriedBy: record.retriedBy ?? null },
      outcome: { state: record.state, candidateStatus, verificationCurrent },
      evidenceBasis: synthetic ? 'synthetic' : 'adapter-reported',
      notEstablished: [...(synthetic ? ['live-delivery'] : []), 'native-business-acceptance'], history: structuredClone(record.history) };
    return { ...packet, packetDigest: hash(canonicalJson(packet)) };
  };
  // Classify an observed read-back: the only basis for any later retry or recovery. A unit receipt
  // reporting `applied` contradicts an unchanged inventory, so that combination is never `not-applied`.
  const reconcileOutcome = (record, comparison, readBackHash) => comparison.match ? 'applied'
    : readBackHash === record.evidence.preDeploy.inventoryHash && !(record.evidence.units ?? []).some(unit => unit.status === 'applied') ? 'not-applied' : 'diverged';
  const candidateCurrent = (release, record) => !!release && release.approval?.revision === release.revision && release.revision === record.releaseRevision &&
    release.candidate?.id === record.candidateId && release.candidate.sha256 === record.sha256 &&
    (!record.sourceAssociation || isDeepStrictEqual(release.sourceAssociation, record.sourceAssociation));
  const currentRelease = async (releaseId, owner) => {
    try { return await candidates.candidateArtifact(releaseId, owner); }
    catch (error) { if ([404, 409, 422].includes(error.statusCode)) return null; throw error; }
  };
  // A promotion source is verified, current, non-production evidence on another Target.
  const ensurePromotable = (source, release) => {
    if (source.state !== 'verified' || !verifiedUnderPolicy(source)) fail('Продвижение требует проверенной (verified) доставки этого кандидата на другом Target', 409);
    if (!candidateCurrent(release, source)) fail('Кандидат, ревизия или принятие изменились после проверки: доказательства для продвижения устарели', 409);
    if (source.connection.environment === 'prod') fail('Продвижение начинается только с проверенной непроизводственной среды', 409);
  };
  // Shared preparation of a direct delivery, an MR-08 promotion or a reconciled retry: one set of
  // guards, reservations and durable records. `check` adds the promotion/retry preconditions after
  // the fresh destination inspection; `afterWrite` persists lineage inside the same candidate guard.
  const createAttempt = async (releaseId, owner, release, connection, { promotion = null, retryOf = null, check = null, afterWrite = null } = {}) => {
    if (connection.preset) guardPresetDeploy(connection.preset, release.candidate.sha256);
    const adapter = adapterFor(connection), health = await adapter.health();
    if (health?.ok !== true) fail('Target недоступен: доставка не подготовлена', 503);
    const grant = productionGrant(connection, health.identity, release.candidate.sha256, promotion);
    guardTarget(connection, health.identity, grant);
    const others = await listAttempts(releaseId, owner);
    if (others.some(a => active(a.state))) fail('Уже есть незавершённая доставка этого релиза. Завершите или проверьте её.', 409);
    await ensureTargetAvailable(health.identity);
    const capabilities = await adapter.capabilities();
    if (!capabilities.deploy || !capabilities.readBack) fail('Адаптер не поддерживает доставку с read-back', 503);
    if (release.composed) guardComposed(release.composed, connection, health.identity, capabilities);
    const before = await timedRead(signal => adapter.inspectSolution(release.code, { signal }));
    check?.({ identity: health.identity, before, capabilities });
    const ref = reference(releaseId), composed = release.composed;
    const record = { schemaVersion: 1, id: crypto.randomUUID(), releaseId: ref.id, ...(ref.namespace !== 'legacy' ? { candidateSource: structuredClone(ref), sourceAssociation: structuredClone(release.sourceAssociation), executionActorId: owner } : {}),
      ...(composed ? { composed: { units: composed.units.map(unit => ({ id: unit.id, adapter: unit.adapter })), targetProfile: structuredClone(composed.targetProfile), evidenceBasis: composed.evidenceBasis, releaseEligible: composed.releaseEligible } } : {}),
      ...(promotion ? { promotion: { ...structuredClone(promotion), ...(grant ? { production: { authorizationRef: grant.authorizationRef, expiresAt: grant.expiresAt } } : {}) } } : {}),
      ...(retryOf ? { retryOf: structuredClone(retryOf) } : {}),
      owner, releaseRevision: release.revision, candidateId: release.candidate.id, sha256: release.candidate.sha256, solutionCode: release.code,
      connection: { id: connection.id, name: connection.name, environment: connection.environment, adapter: connection.adapter }, targetIdentity: health.identity, capabilities,
      readBackPolicy: selectReadBackPolicy(connection, release.candidate.sha256),
      createdAt: now(), state: 'prepared', idempotencyKey: null, bootId: null,
      evidence: { candidateInventoryHash: inventoryHash(await inventoryOf(release.bytes)), preDeploy: { at: now(), version: before.version ?? null, inventoryHash: inventoryHash(before.inventory), files: before.inventory.length }, operation: null, readBack: null, comparison: null, rollbackReference: null,
        ...(composed ? { units: composed.units.map(unit => ({ unitId: unit.id, status: 'pending', operationId: null })) } : {}) }, history: [] };
    transition(record, 'prepared', { note: promotion && !retryOf ? `Продвижение проверенного кандидата с Target «${promotion.fromConnection.name}»: состояние назначения совпадает с проверенным` :
      retryOf ? `Повтор после сверки read-back (${retryOf.reconciliation}) попытки ${retryOf.attemptId}` : 'Личность Target и состояние решения до доставки зафиксированы' });
    await candidates.withCandidate(releaseId, owner, async current => {
      await ensureCurrent(current, record);
      await writeJson(attemptFile(releaseId, record.id), record);
      await afterWrite?.(record);
    });
    return record;
  };
  const store = {
    adapterNames: Object.keys(adapters),
    connections: {
      async list(owner) {
        let names = [];
        try { names = await fs.readdir(path.join(root, 'connections')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const records = [];
        for (const name of names) { if (!name.endsWith('.json')) continue; try { records.push(publicConnection(await readConnection(name.slice(0, -5), owner))); } catch (error) { if (error.statusCode !== 404) throw error; } }
        const predefined = await Promise.all(presets.map(async preset => publicConnection(await presetConnection(preset, owner))));
        return [...predefined, ...records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))];
      },
      create(owner, input) { return serial(async () => {
        rejectCredentials(input);
        const record = { schemaVersion: 1, id: crypto.randomUUID(), owner, name: text(input.name, 'название подключения', 120), role: input.role, environment: input.environment, adapter: text(input.adapter, 'адаптер', 40), adapterOptions: input.adapterOptions && typeof input.adapterOptions === 'object' && !Array.isArray(input.adapterOptions) ? input.adapterOptions : {}, createdAt: now(), probe: null };
        if (!['source', 'target'].includes(record.role)) fail('Роль подключения: source или target');
        if (!environments.includes(record.environment)) fail('Среда подключения: dev, test или prod');
        if (JSON.stringify(record.adapterOptions).length > 4096) fail('Параметры адаптера слишком длинные');
        if (!adapters[record.adapter]) fail(`Адаптер «${record.adapter}» недоступен на этом сервисе`, 503);
        if ((await this.list(owner)).filter(record => !record.preset).length >= 20) fail('Максимум 20 подключений');
        await writeJson(connectionFile(record.id), record);
        return publicConnection(record);
      }); },
      async get(id, owner) { return publicConnection(await readConnection(id, owner)); },
      remove(id, owner) { return serial(async () => { if ((await readConnection(id, owner)).preset) fail('Предопределённую конфигурацию Target нельзя удалить', 403); await fs.rm(connectionFile(id), { force: true }); return { ok: true }; }); },
      // Read-only: health and capabilities. Records the observed identity so misleading names are visible.
      probe(id, owner) { return serial(async () => {
        const record = await readConnection(id, owner), adapter = adapterFor(record);
        const health = await adapter.health(), capabilities = await adapter.capabilities();
        record.probe = { at: now(), ok: !!health.ok, identity: health.identity || null, capabilities, protectedHost: protectedSet.has(targetHost(health.identity)),
          ...(record.preset ? { hostMatches: targetHost(health.identity) === record.preset.host, reason: health.reason || null } : {}) };
        if (record.preset && health.identity && !record.probe.hostMatches) record.probe.ok = false;
        await saveConnection(record, owner);
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
      return publicAttempt(await createAttempt(releaseId, owner, release, await readConnection(input.connectionId, owner)));
    }); },
    // MR-08 promotion: the exact verified candidate of a non-production attempt goes to a further
    // destination. The destination is freshly inspected; it must be in the state the source evidence
    // was verified from, on the same platform version. The new attempt then follows the normal
    // typed confirmation, drift check, dispatch and read-back. Same key replays the stored attempt.
    promote(releaseId, sourceId, owner, input) { return serial(async () => {
      const key = text(input.idempotencyKey, 'ключ продвижения', 120);
      const existing = (await listAttempts(releaseId, owner)).find(row => row.promotion?.fromAttemptId === sourceId && row.promotion.idempotencyKey === key);
      if (existing) return publicAttempt(existing);
      const release = await candidates.candidateArtifact(releaseId, owner), source = await readAttempt(releaseId, sourceId, owner);
      if (!Number.isInteger(input.revision) || input.revision !== release.revision) fail('Релиз изменился в другой вкладке. Обновите страницу.', 409);
      ensurePromotable(source, release);
      const connection = await readConnection(input.connectionId, owner);
      if (connection.id === source.connection.id) fail('Продвижение требует другого Target назначения', 409);
      const promotion = { fromAttemptId: source.id, idempotencyKey: key, fromConnection: structuredClone(source.connection), fromTargetIdentity: structuredClone(source.targetIdentity),
        fromEvidence: { preDeployInventoryHash: source.evidence.preDeploy.inventoryHash, readBackInventoryHash: source.evidence.readBack.inventoryHash,
          comparisonPolicy: source.evidence.comparison.policy, verifiedAt: source.evidence.readBack.at, packetDigest: packetOf(source, 'current').packetDigest } };
      return publicAttempt(await createAttempt(releaseId, owner, release, connection, { promotion,
        check: ({ identity, before }) => {
          if (targetHost(identity) === targetHost(source.targetIdentity)) fail('Назначение продвижения фактически совпадает с исходным Target', 409);
          if (!identity?.version || identity.version !== source.targetIdentity?.version) fail('Версия платформы назначения отличается от проверенного профиля среды', 409);
          const state = inventoryHash(before.inventory);
          if (state === promotion.fromEvidence.readBackInventoryHash) fail('Назначение уже содержит этот кандидат: выполните проверку, не повторяя импорт', 409);
          if (state !== promotion.fromEvidence.preDeployInventoryHash) fail('Состояние назначения отличается от состояния, на котором кандидат проверен (drift). Продвижение заблокировано', 409);
        } }));
    }); },
    // MR-08 retry and partial-install recovery. Only an attempt whose outcome an observed read-back
    // reconciled may be retried: `not-applied` retries, `diverged` (a partial install) only when the
    // adapter declares an idempotent re-import. The retry is a new prepared attempt on the same
    // Target that still needs typed confirmation; nothing is redispatched automatically.
    retry(releaseId, id, owner, input) { return serial(async () => {
      const key = text(input.idempotencyKey, 'ключ повтора', 120);
      const release = await candidates.candidateArtifact(releaseId, owner), source = await readAttempt(releaseId, id, owner);
      if (source.retriedBy) {
        if (source.retryKey === key) return publicAttempt(await readAttempt(releaseId, source.retriedBy, owner));
        fail('Для этой попытки повтор уже создан', 409);
      }
      if (source.state === 'verified') fail('Попытка уже проверена: повтор не нужен', 409);
      if (['prepared', 'blocked', 'cancelled'].includes(source.state)) fail('Операция не запускалась: подготовьте доставку заново', 409);
      const reconciliation = source.evidence.reconciliation;
      if (!['verification-failed'].includes(source.state) || !reconciliation)
        fail('Результат не сверен: сначала выполните read-back, не повторяя операцию', 409);
      if (!candidateCurrent(release, source)) fail('Релиз, кандидат или принятие изменились: подготовьте доставку заново', 409);
      const connection = await readConnection(source.connection.id, owner);
      return publicAttempt(await createAttempt(releaseId, owner, release, connection, { promotion: source.promotion ?? null,
        retryOf: { attemptId: source.id, reconciliation: reconciliation.outcome, mode: reconciliation.outcome === 'diverged' ? 'forward-recovery' : 'retry' },
        check: ({ identity, before, capabilities }) => {
          if (!isDeepStrictEqual(identity, source.targetIdentity)) fail('Личность Target изменилась после сверки; повтор заблокирован', 409);
          if (reconciliation.outcome === 'diverged' && capabilities.reimport !== 'idempotent')
            fail('Частичная установка: адаптер не подтверждает идемпотентный повторный импорт. Требуется восстановление по утверждённому плану', 409);
          if (!['not-applied', 'diverged'].includes(reconciliation.outcome)) fail('Сверка не допускает повтор', 409);
          if (inventoryHash(before.inventory) !== reconciliation.readBackInventoryHash) fail('Target изменился после сверки (drift): выполните read-back заново', 409);
        },
        afterWrite: created => {
          source.retriedBy = created.id; source.retryKey = key;
          source.history.push({ at: now(), state: source.state, note: `Создан повтор ${created.id} после сверки (${reconciliation.outcome}); требуется отдельное подтверждение` });
          return writeJson(attemptFile(releaseId, source.id), source);
        } }));
    }); },
    // MR-08 evidence packet of one destination attempt.
    async packet(releaseId, id, owner) {
      await candidates.authorize(releaseId, owner);
      const record = await readAttempt(releaseId, id, owner);
      return packetOf(record, candidateCurrent(await currentRelease(releaseId, owner), record) ? 'current' : 'stale');
    },
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
      const connection = await readConnection(record.connection.id, owner);
      // The configuration is re-read: a removed designation or changed preset refuses dispatch.
      if (connection.preset) guardPresetDeploy(connection.preset, record.sha256);
      const adapter = adapterFor(connection);
      const block = async (note, error) => { transition(record, 'blocked', { note }); await writeJson(attemptFile(releaseId, id), record); throw error; };
      // PROD: the grant is re-evaluated now (an expired or withdrawn grant refuses dispatch) and a
      // separate typed production confirmation naming the observed host is required.
      const grant = productionGrant(connection, record.targetIdentity, record.sha256, record.promotion);
      if (connection.environment === 'prod') {
        if (!grant) await block('PROD: действующее разрешение владельца на продвижение отсутствует', Object.assign(Error('PROD не разрешён для доставки: отдельное разрешение и проверки AR-06 отсутствуют'), { statusCode: 403 }));
        if (input.productionConfirmation !== `PROMOTE PROD ${record.solutionCode} ${record.sha256.slice(0, 12)} ${targetHost(record.targetIdentity)}`)
          fail('Продвижение в PROD требует отдельного подтверждения с кодом решения, SHA-256 и узлом назначения', 400);
      }
      try { await observeTarget(connection, adapter, record.targetIdentity, grant); }
      catch (error) { await block('Доступность или личность Target не подтверждены; доставка заблокирована', error); }
      // Also guard legacy preparations created before host reservations were enforced.
      await ensureTargetAvailable(record.targetIdentity, attemptFile(releaseId, id));
      const current = await timedRead(signal => adapter.inspectSolution(record.solutionCode, { signal }));
      if (inventoryHash(current.inventory) !== record.evidence.preDeploy.inventoryHash) { transition(record, 'blocked', { note: 'Решение на Target изменилось после подготовки (drift)' }); await writeJson(attemptFile(releaseId, id), record); fail('Решение на Target изменилось после подготовки. Подготовьте доставку заново.', 409); }
      // A promotion dispatches only while its source evidence is still verified and current.
      if (record.promotion) {
        let source = null;
        try { source = await readAttempt(releaseId, record.promotion.fromAttemptId, owner); ensurePromotable(source, release); }
        catch (error) { await block('Доказательства исходной проверки больше не действуют; продвижение заблокировано', Object.assign(Error(error.statusCode === 409 ? error.message : 'Исходная проверенная доставка недоступна'), { statusCode: 409 })); }
        if (source.evidence.readBack.inventoryHash !== record.promotion.fromEvidence.readBackInventoryHash)
          await block('Исходная проверка заменена другой; продвижение заблокировано', Object.assign(Error('Исходная проверка изменилась после подготовки продвижения'), { statusCode: 409 }));
      }
      return candidates.withCandidate(releaseId, owner, async finalCandidate => {
        await ensureCurrent(finalCandidate, record);
        record.idempotencyKey = key; record.bootId = bootId;
        record.evidence.rollbackReference = { kind: 'previous-target-state', inventoryHash: record.evidence.preDeploy.inventoryHash, version: record.evidence.preDeploy.version, note: 'Ссылка на состояние до доставки; восстановление данных/экземпляров процессов не гарантируется' };
        // In flight: units are no longer "not started" once the adapter receives them.
        for (const unit of record.evidence.units ?? []) unit.status = 'dispatched';
        transition(record, 'deploying', { note: 'Подтверждено владельцем; операция передана адаптеру' });
        await writeJson(attemptFile(releaseId, id), record); // persisted before the side effect
        const startedAt = now();
        // Start once while the final candidate guard is held, but return its
        // promise inside an object: never hold store queues through native work.
        const dispatch = withTimeout(signal => adapter.deployCandidate({ bytes: finalCandidate.bytes, sha256: record.sha256, code: record.solutionCode,
          ...(record.composed ? { units: record.composed.units.map(unit => unit.id) } : {}) }, { signal }));
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
        if (record.composed) return composedOutcome(record, result?.receipts);
        transition(record, 'deployed-unverified', { note: 'Операция завершилась без ошибки. Это не подтверждение результата — требуется read-back.' });
      }, error => {
        const timeout = error.code === 'TIMEOUT';
        record.evidence.operation = { startedAt, finishedAt: now(), result: timeout ? 'timeout' : 'error', error: timeout ? 'Нет ответа в отведённое время' : String(error.message) };
        // An error without per-unit receipts cannot prove that an earlier unit did not apply.
        if (record.composed) return composedOutcome(record, error.receipts, { errored: true, timeout });
        transition(record, timeout ? 'unknown-outcome' : 'failed', { note: timeout ? 'Результат неизвестен: выполните read-back прежде чем повторять' : 'Операция завершилась ошибкой' });
      }).then(() => serial(() => writeJson(attemptFile(releaseId, id), record))).then(() => publicAttempt(record));
      finished.catch(() => {});
      return Promise.race([finished, new Promise(resolve => setTimeout(() => resolve(publicAttempt(structuredClone(record))), confirmGraceMs).unref?.())]);
    }); },
    verify(releaseId, id, owner) { return serial(async () => {
      const release = await candidates.candidateArtifact(releaseId, owner), record = await readAttempt(releaseId, id, owner);
      // `failed` is readable too: an adapter error never proves that nothing applied (MR-08).
      if (!['deployed-unverified', 'unknown-outcome', 'partial-outcome', 'verification-failed', 'failed'].includes(record.state)) fail(`Read-back невозможен в состоянии «${record.state}»`, 409);
      await ensureCurrent(release, record);
      if (hash(release.bytes) !== record.sha256) fail('Байты кандидата не совпадают с SHA-256 попытки доставки', 409);
      const connection = await readConnection(record.connection.id, owner);
      if (connection.preset && !allows(connection.preset, 'readBack')) fail(`${connection.preset.name}: read-back не разрешён конфигурацией`, 403);
      const adapter = adapterFor(connection);
      // The recorded policy applies only while the configuration still selects it; otherwise
      // the exact policy does. Neither the request nor the adapter can broaden it.
      const recorded = record.readBackPolicy ?? exactPolicy, selected = selectReadBackPolicy(connection, record.sha256);
      const policy = recorded.id === IMPORT_NORMALIZED_POLICY && selected.id === IMPORT_NORMALIZED_POLICY ? recorded : { ...exactPolicy };
      if (policy.id !== recorded.id) record.history.push({ at: now(), state: record.state, note: `Назначение кандидата для DEV2 больше не действует: read-back проверяется политикой ${policy.id}` });
      // Read-back of a PROD promotion still needs a current owner grant; without it the attempt stays unresolved.
      const grant = productionGrant(connection, record.targetIdentity, record.sha256, record.promotion);
      let observed = false;
      try {
        const expected = await inventoryOf(release.bytes);
        const metadataPaths = policy.id === IMPORT_NORMALIZED_POLICY ? importNormalizedMetadataPaths(expected) : null;
        await observeTarget(connection, adapter, record.targetIdentity, grant);
        const after = await timedRead(signal => adapter.readBack(record.solutionCode, { signal, ...(metadataPaths ? { metadata: { policy: policy.id, paths: metadataPaths } } : {}) }));
        let comparison;
        if (!metadataPaths) comparison = compareReadBack(expected, after?.inventory);
        else {
          // Bytes only for the files this policy inspects, bound to the reported inventory hashes.
          const actualFiles = readBackMetadataFiles(metadataPaths, after?.inventory, after?.metadataFiles), candidateFiles = await readArchive(release.bytes);
          comparison = compareImportNormalizedReadBack(expected, after.inventory, { expectedFiles: new Map(metadataPaths.map(name => [name, candidateFiles.get(name)])), actualFiles });
        }
        // A changing connection must not supply evidence for the previous Target.
        const identity = await observeTarget(connection, adapter, record.targetIdentity, grant);
        observed = true;
        // Delivery -> Solution -> release. Hold the final guard through the
        // evidence write; callbacks never re-enter these queues.
        await candidates.withCandidate(releaseId, owner, async current => {
          await ensureCurrent(current, record);
          record.evidence.readBack = { at: now(), version: after.version ?? null, inventoryHash: inventoryHash(after.inventory), files: after.inventory.length, targetIdentity: identity, policy: policy.id, policyVersion: policy.version };
          record.evidence.comparison = comparison;
          delete record.evidence.verificationError;
          const unchanged = record.evidence.readBack.inventoryHash === record.evidence.preDeploy.inventoryHash;
          // MR-08: the observed read-back reconciles the outcome; retry and recovery depend only on it.
          record.evidence.reconciliation = { at: now(), fromState: record.state, outcome: reconcileOutcome(record, comparison, record.evidence.readBack.inventoryHash), readBackInventoryHash: record.evidence.readBack.inventoryHash };
          transition(record, comparison.match ? 'verified' : 'verification-failed', { note: comparison.match ? `Read-back совпал: ${comparison.compared} файлов, включая package.json и manifest.json` : unchanged ? 'Target не изменился после операции: импорт не применён' : `Расхождения: отсутствуют ${comparison.missing.length}, отличаются ${comparison.different.length}, лишние ${comparison.unexpected.length}` });
          await writeJson(attemptFile(releaseId, id), record);
        });
      } catch (error) {
        record.evidence.readBack = null;
        record.evidence.comparison = null;
        delete record.evidence.reconciliation;
        record.evidence.verificationError = { at: now(), policy: policy.id, policyVersion: policy.version, statusCode: error.statusCode || 502, ...(error.code === 'READ_BACK_METADATA' ? { reason: error.reason } : {}) };
        // Until a well-formed read-back of the same Target is observed, an
        // unresolved outcome keeps its state and Target reservation, so a
        // failed read cannot open the way to redispatch onto applied units.
        const unresolved = active(record.state) || record.state === 'failed';
        if (error.code === 'READ_BACK_METADATA' && unresolved) record.history.push({ at: now(), state: record.state, note: `Read-back без проверяемых байтов package.json/manifest.json для политики ${policy.id}: ${error.reason}. Не подтверждено; состояние и резервирование Target сохранены. Обновите мост и повторите чтение, не повторяя операцию` });
        else if (!observed && unresolved) record.history.push({ at: now(), state: record.state, note: 'Read-back не выполнен: Target не наблюдался. Состояние и резервирование Target сохранены; повторите чтение, не повторяя операцию' });
        else transition(record, 'verification-failed', { note: 'Read-back не подтверждён: проверьте личность Target, структуру ответа и актуальность кандидата' });
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
        cancel: (id, attemptId, owner) => store.cancel(ref(id), attemptId, owner),
        promote: (id, attemptId, owner, input) => store.promote(ref(id), attemptId, owner, input),
        retry: (id, attemptId, owner, input) => store.retry(ref(id), attemptId, owner, input),
        packet: (id, attemptId, owner) => store.packet(ref(id), attemptId, owner)
      };
    },
    // Frozen composed candidates of one server-selected Solution (PLAN-01 P7).
    forComposed(solutionId) {
      if (!composedCandidates || !uuid.test(solutionId)) fail('Composed delivery unavailable', 404);
      const ref = id => reference({ namespace: 'composed', solutionId, id });
      return {
        list: (id, owner) => store.list(ref(id), owner),
        get: (id, attemptId, owner) => store.get(ref(id), attemptId, owner),
        prepare: (id, owner, input) => store.prepare(ref(id), owner, input),
        confirm: (id, attemptId, owner, input) => store.confirm(ref(id), attemptId, owner, input),
        verify: (id, attemptId, owner) => store.verify(ref(id), attemptId, owner),
        cancel: (id, attemptId, owner) => store.cancel(ref(id), attemptId, owner),
        promote: (id, attemptId, owner, input) => store.promote(ref(id), attemptId, owner, input),
        retry: (id, attemptId, owner, input) => store.retry(ref(id), attemptId, owner, input),
        packet: (id, attemptId, owner) => store.packet(ref(id), attemptId, owner)
      };
    }
  };
  return store;
}
