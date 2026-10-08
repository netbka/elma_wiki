import { mountRelease } from '../../web/releases/render.js';
import { releaseView } from '../../web/releases/model.js';

const fixture = state => {
  const snapshot = { filename: 'synthetic.e365', importedAt: '2026-10-07T12:00:00Z', checksum: 'a'.repeat(64), code: 'example', coverage: 'structural', projectId: 'synthetic-project', inventory: [{ path: 'widgets/form.json', sha256: 'a'.repeat(64), size: 10 }], report: { diagnostics: [] }, entities: [] };
  const record = { id: 'synthetic-release', synthetic: true, title: 'Учебная доставка релиза', intent: 'Проверить результат операции отдельно от сообщения об успехе.', targetIntent: 'Учебный TEST', source: snapshot, baseline: snapshot, revision: 4, reviews: {}, limitations: '', notes: '', candidate: { id: 'candidate', sha256: 'a'.repeat(64) }, approval: { revision: 4, actor: 'Учебный аналитик', reason: 'Локальная передача' }, history: [] };
  const connection = { id: 'synthetic-connection', name: 'Учебный TEST', role: 'target', environment: 'test', adapter: 'synthetic', probe: { ok: true, protectedHost: state === 'protected-target', identity: { host: state === 'protected-target' ? 'prod.example.invalid' : 'test.example.invalid', version: 'synthetic' } } };
  const absent = ['unavailable', 'ready', 'load-error', 'protected-target'].includes(state);
  const attempt = absent ? null : { id: 'synthetic-attempt', state: state === 'stale' ? 'verified' : state, solutionCode: 'example', releaseRevision: state === 'stale' ? 3 : 4, candidateId: 'candidate', sha256: 'a'.repeat(64), connection, targetIdentity: connection.probe.identity,
    history: [{ state: state === 'stale' ? 'verified' : state, at: '2026-10-07T12:00:00Z', note: 'Учебное состояние, не доказательство работы ELMA' }],
    evidence: { operation: ['verified', 'deployed-unverified', 'verification-failed', 'stale'].includes(state) ? { nativeResult: 'Учебная операция сообщила об успехе' } : null, comparison: ['verified', 'verification-failed', 'stale'].includes(state) ? { policy: 'exact-solution-inventory-v1', match: state !== 'verification-failed', compared: 1, volatile: [], missing: [], different: state === 'verification-failed' ? ['widgets/form.json'] : [], unexpected: state === 'verification-failed' ? ['permissionsSettings/extra.json'] : [] } : null } };
  const delivery = { attempts: attempt ? 1 : 0, latest: attempt && { ...attempt, connectionName: connection.name, adapter: 'synthetic' } };
  return { release: releaseView(record, delivery), data: { capabilities: { mode: state === 'unavailable' ? 'unavailable' : 'synthetic', liveDelivery: false }, connections: [connection], attempts: attempt ? [attempt] : [] } };
};
// Operator bridge states: the service never connects to ELMA; a worker next to elma365pm polls for jobs.
const bridgeFixture = state => {
  const base = fixture(state === 'bridge-deploying' ? 'deploying' : 'ready');
  const bridge = { id: 'synthetic-bridge', name: 'Рабочее место оператора', createdAt: '2026-10-07T11:00:00Z', lastSeen: state === 'bridge-offline' ? null : '2026-10-07T12:01:00Z', online: state !== 'bridge-offline', identity: state === 'bridge-offline' ? null : { host: 'test.example.invalid', version: 'elma365pm 1.19.0 / ELMA 2025.5' }, worker: state === 'bridge-offline' ? null : 'elma-dev bridge @ operator-pc → test' };
  const connection = { id: 'bridge-connection', name: 'TEST через мост', role: 'target', environment: 'test', adapter: 'bridge', adapterOptions: { bridgeId: bridge.id }, probe: state === 'bridge-offline' ? { ok: false, protectedHost: false, identity: null } : { ok: true, protectedHost: false, identity: bridge.identity } };
  const attempts = base.data.attempts.map(attempt => ({ ...attempt, connection, targetIdentity: bridge.identity, history: [{ state: 'prepared', at: '2026-10-07T12:00:00Z', note: 'Личность Target и состояние решения до доставки зафиксированы' }, { state: 'deploying', at: '2026-10-07T12:01:00Z', note: 'Подтверждено владельцем; операция передана адаптеру' }] }));
  const latest = attempts.at(-1) || null;
  return { release: releaseView(base.release, { attempts: attempts.length, latest: latest && { ...latest, connectionName: connection.name, adapter: 'bridge' } }), data: { capabilities: { mode: 'bridge', liveDelivery: false, bridge: true, adapters: ['bridge'] }, connections: [connection], attempts, bridges: state === 'bridge-no-bridge' ? [] : [bridge] } };
};
function story(state) {
  const { release, data } = state.startsWith('bridge-') ? bridgeFixture(state) : fixture(state === 'target-reserved' ? 'ready' : state);
  const unavailable = async () => { throw Error('Учебное состояние Storybook: выберите другую story. Здесь операции не запускаются.'); };
  const act = state === 'target-reserved' ? async () => { throw Object.assign(Error('На этом Target уже есть незавершённая доставка. Завершите, проверьте или отмените её подготовку.'), { status: 409 }); } : unavailable;
  return mountRelease({ release, open: unavailable, change: unavailable, preview: unavailable, download: unavailable,
    deliveryClient: { load: async () => { if (state === 'load-error') throw Error('Учебная ошибка загрузки состояния'); return data; }, act, refresh: async () => release, createConnection: unavailable, probeConnection: unavailable, removeConnection: unavailable, createBridge: unavailable, removeBridge: unavailable } });
}
export default { id: 'delivery', title: 'Аналитик/Доставка', parameters: { layout: 'fullscreen' } };
export const Unavailable = { render: () => story('unavailable') };
export const Ready = { render: () => story('ready') };
export const TargetReserved = { render: () => story('target-reserved'), play: async ({ canvasElement }) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const prepare = [...canvasElement.querySelectorAll('button')].find(button => button.textContent === 'Подготовить учебную доставку' && !button.disabled);
    if (prepare) {
      prepare.click();
      for (let observation = 0; observation < 50; observation++) {
        if (canvasElement.querySelector('[role="alert"]')?.textContent.includes('На этом Target уже есть незавершённая доставка')) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw Error('Target reservation message was not displayed');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Target reservation fixture did not load');
} };
export const Prepared = { render: () => story('prepared') };
export const Deploying = { render: () => story('deploying') };
export const Unverified = { render: () => story('deployed-unverified') };
export const Verified = { render: () => story('verified') };
export const Mismatch = { render: () => story('verification-failed') };
export const Unknown = { render: () => story('unknown-outcome') };
export const Failed = { render: () => story('failed') };
export const Blocked = { render: () => story('blocked') };
export const Cancelled = { render: () => story('cancelled') };
export const Stale = { render: () => story('stale') };
export const LoadError = { render: () => story('load-error') };
export const ProtectedTarget = { render: () => story('protected-target') };
export const BridgeNoBridge = { render: () => story('bridge-no-bridge') };
export const BridgeOffline = { render: () => story('bridge-offline') };
export const BridgeDeploying = { render: () => story('bridge-deploying') };
