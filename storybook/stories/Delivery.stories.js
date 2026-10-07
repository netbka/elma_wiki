import { mountRelease } from '../../web/releases/render.js';
import { releaseView } from '../../web/releases/model.js';
const sha = ch => ch.repeat(64);
const metadata = required => ({ projectId: '10000000-0000-4000-8000-000000000001', checksum: sha(required ? 'a' : 'b'), filename: required ? 'new-dev.e365' : 'previous-dev.e365', importedAt: '2026-10-07T09:00:00Z', parserVersion: '2.0.0', code: 'example_solution', coverage: 'structural', inventory: [{ path: 'widgets/form.json', sha256: sha(required ? 'a' : 'b'), size: 180 }], report: { status: 'structural', diagnostics: [] }, entities: [{ archivePath: 'widgets/form.json', name: 'Учебная форма договора', fields: [{ code: 'title', required, type: 'STRING' }] }] });
const approvedRelease = () => ({ id: 'synthetic-release', synthetic: true, title: 'Уточнение формы договора', intent: 'Заголовок должен быть заполнен перед отправкой.', targetIntent: 'Учебный TEST', createdAt: '2026-10-07T09:00:00Z', source: metadata(true), baseline: metadata(false), revision: 3, reviews: { 'widgets/form.json': { decision: 'accepted', reason: 'Проверено обязательное поле', actor: 'Учебный аналитик' } }, history: [], limitations: '', notes: '', candidate: { id: 'synthetic-candidate', sha256: sha('a'), deployable: false }, approval: { revision: 3, actor: 'Учебный аналитик', reason: 'Только локальная передача' } });
const connection = (extra = {}) => ({ id: 'synthetic-connection', name: 'TEST (учебный)', role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { scenario: 'apply' }, createdAt: '2026-10-07T09:30:00Z', probe: { at: '2026-10-07T09:31:00Z', ok: true, identity: { host: 'test.example.invalid', version: '2025.10.97' }, protectedHost: false }, ...extra });
function attempt(state) {
  const base = { id: 'synthetic-attempt', releaseId: 'synthetic-release', releaseRevision: 3, candidateId: 'synthetic-candidate', sha256: sha('a'), solutionCode: 'example_solution', connection: { id: 'synthetic-connection', name: 'TEST (учебный)', environment: 'test', adapter: 'synthetic' }, targetIdentity: { host: 'test.example.invalid', version: '2025.10.97' }, createdAt: '2026-10-07T09:40:00Z', state, idempotencyKey: null,
    evidence: { candidateInventoryHash: sha('c'), preDeploy: { at: '2026-10-07T09:40:00Z', version: 1, inventoryHash: sha('d'), files: 3 }, operation: null, readBack: null, comparison: null, rollbackReference: null }, history: [{ at: '2026-10-07T09:40:00Z', state: 'prepared', note: 'Личность Target и состояние решения до доставки зафиксированы' }] };
  if (state === 'prepared') return base;
  base.evidence.rollbackReference = { kind: 'previous-target-state', inventoryHash: sha('d'), version: 1, note: 'Ссылка на состояние до доставки; восстановление данных/экземпляров процессов не гарантируется' };
  base.history.push({ at: '2026-10-07T09:41:00Z', state: 'deploying', note: 'Подтверждено владельцем; операция передана адаптеру' });
  if (state === 'unknown-outcome') { base.evidence.operation = { startedAt: '2026-10-07T09:41:00Z', finishedAt: '2026-10-07T09:43:00Z', result: 'timeout', error: 'Нет ответа в отведённое время' }; base.history.push({ at: '2026-10-07T09:43:00Z', state, note: 'Результат неизвестен: выполните read-back прежде чем повторять' }); return base; }
  base.evidence.operation = { startedAt: '2026-10-07T09:41:00Z', finishedAt: '2026-10-07T09:41:20Z', result: 'returned', operationId: 'synthetic-operation', nativeResult: state === 'verification-failed' ? 'exit 0 (no history change: import skipped)' : 'exit 0' };
  base.history.push({ at: '2026-10-07T09:41:20Z', state: 'deployed-unverified', note: 'Операция завершилась без ошибки. Это не подтверждение результата — требуется read-back.' });
  if (state === 'deployed-unverified') return base;
  const match = state === 'verified';
  base.evidence.readBack = { at: '2026-10-07T09:42:00Z', version: match ? 2 : 1, inventoryHash: match ? sha('c') : sha('d'), files: 3 };
  base.evidence.comparison = match ? { match: true, compared: 1, missing: [], different: [], volatile: ['package.json', 'widgets/manifest.json'] } : { match: false, compared: 1, missing: [], different: ['widgets/form.json'], volatile: ['package.json', 'widgets/manifest.json'] };
  base.history.push({ at: '2026-10-07T09:42:00Z', state, note: match ? 'Read-back совпал: 1 файлов, служебные файлы (2) не сравнивались' : 'Target не изменился после операции: импорт не применён' });
  return base;
}
const refuse = async () => { throw Error('Синтетический сценарий: действия не выполняются. Настоящая доставка доступна только в приватном сервисе с настроенным адаптером.'); };
const bridge = (extra = {}) => ({ id: 'synthetic-bridge', name: 'Рабочее место оператора', createdAt: '2026-10-07T09:20:00Z', lastSeen: '2026-10-07T09:44:00Z', online: true, identity: { host: 'test.example.invalid', version: 'elma365pm 1.19.0 / ELMA 2025.5' }, worker: 'elma-dev bridge @ operator-pc → test', ...extra });
function story({ adapters = ['synthetic'], connections = [connection()], attempts = [], bridges = [] } = {}) {
  const record = approvedRelease();
  const latest = attempts.at(-1) || null;
  const release = releaseView(record, { attempts: attempts.length, latest: latest && { id: latest.id, state: latest.state, connectionName: latest.connection.name, at: latest.history.at(-1).at } });
  return mountRelease({ release, change: refuse, preview: refuse, download: refuse, open: refuse, delivery: { connections, attempts, adapters, bridges, api: { createConnection: refuse, probe: refuse, removeConnection: refuse, createBridge: refuse, removeBridge: refuse, prepare: refuse, confirm: refuse, verify: refuse } } });
}
export default { id: 'delivery', title: 'Аналитик/Доставка на Target', parameters: { layout: 'fullscreen' } };
export const NoAdapter = { render: () => story({ adapters: [], connections: [] }) };
export const ReadyToPrepare = { render: () => story() };
export const ProtectedTarget = { render: () => story({ connections: [connection({ name: 'TEST', probe: { at: '2026-10-07T09:31:00Z', ok: true, identity: { host: 'prod.example.invalid', version: '2025.10.97' }, protectedHost: true } })] }) };
export const Prepared = { render: () => story({ attempts: [attempt('prepared')] }) };
export const DeployedUnverified = { render: () => story({ attempts: [attempt('deployed-unverified')] }) };
export const UnknownOutcome = { render: () => story({ attempts: [attempt('unknown-outcome')] }) };
export const Verified = { render: () => story({ attempts: [attempt('verified')] }) };
export const VerificationFailed = { render: () => story({ attempts: [attempt('verification-failed')] }) };
// Operator bridge: the service itself never connects to ELMA; the worker next to elma365pm polls for jobs.
export const BridgeOffline = { render: () => story({ adapters: ['bridge'], bridges: [bridge({ lastSeen: null, online: false, identity: null, worker: null })], connections: [connection({ adapter: 'bridge', adapterOptions: { bridgeId: 'synthetic-bridge' }, name: 'TEST через мост', probe: { at: '2026-10-07T09:31:00Z', ok: false, identity: null, protectedHost: false } })] }) };
export const BridgeDeploying = { render: () => story({ adapters: ['bridge'], bridges: [bridge()], connections: [connection({ adapter: 'bridge', adapterOptions: { bridgeId: 'synthetic-bridge' }, name: 'TEST через мост' })], attempts: [{ ...attempt('deployed-unverified'), state: 'deploying', connection: { id: 'synthetic-connection', name: 'TEST через мост', environment: 'test', adapter: 'bridge' }, evidence: { ...attempt('prepared').evidence, rollbackReference: attempt('deployed-unverified').evidence.rollbackReference }, history: attempt('deployed-unverified').history.slice(0, 2) }] }) };
