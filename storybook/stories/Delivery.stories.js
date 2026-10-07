import { mountRelease } from '../../web/releases/render.js';
import { releaseView } from '../../web/releases/model.js';

const fixture = state => {
  const snapshot = { filename: 'synthetic.e365', importedAt: '2026-10-07T12:00:00Z', checksum: 'a'.repeat(64), code: 'example', coverage: 'structural', projectId: 'synthetic-project', inventory: [{ path: 'widgets/form.json', sha256: 'a'.repeat(64), size: 10 }], report: { diagnostics: [] }, entities: [] };
  const record = { id: 'synthetic-release', synthetic: true, title: 'Учебная доставка релиза', intent: 'Проверить результат операции отдельно от сообщения об успехе.', targetIntent: 'Учебный TEST', source: snapshot, baseline: snapshot, revision: 4, reviews: {}, limitations: '', notes: '', candidate: { id: 'candidate', sha256: 'a'.repeat(64) }, approval: { revision: 4, actor: 'Учебный аналитик', reason: 'Локальная передача' }, history: [] };
  const connection = { id: 'synthetic-connection', name: 'Учебный TEST', role: 'target', environment: 'test', adapter: 'synthetic', probe: { ok: true, protectedHost: state === 'protected-target', identity: { host: state === 'protected-target' ? 'prod.example.invalid' : 'test.example.invalid', version: 'synthetic' } } };
  const absent = ['unavailable', 'ready', 'load-error', 'protected-target'].includes(state);
  const attempt = absent ? null : { id: 'synthetic-attempt', state: state === 'stale' ? 'verified' : state, solutionCode: 'example', releaseRevision: state === 'stale' ? 3 : 4, candidateId: 'candidate', sha256: 'a'.repeat(64), connection, targetIdentity: connection.probe.identity,
    history: [{ state: state === 'stale' ? 'verified' : state, at: '2026-10-07T12:00:00Z', note: 'Учебное состояние, не доказательство работы ELMA' }],
    evidence: { operation: ['verified', 'deployed-unverified', 'verification-failed', 'stale'].includes(state) ? { nativeResult: 'Учебная операция сообщила об успехе' } : null, comparison: ['verified', 'verification-failed', 'stale'].includes(state) ? { compared: 1, volatile: ['package.json'], missing: [], different: state === 'verification-failed' ? ['widgets/form.json'] : [] } : null } };
  const delivery = { attempts: attempt ? 1 : 0, latest: attempt && { ...attempt, connectionName: connection.name, adapter: 'synthetic' } };
  return { release: releaseView(record, delivery), data: { capabilities: { mode: state === 'unavailable' ? 'unavailable' : 'synthetic', liveDelivery: false }, connections: [connection], attempts: attempt ? [attempt] : [] } };
};
function story(state) {
  const { release, data } = fixture(state);
  const unavailable = async () => { throw Error('Учебное состояние Storybook: выберите другую story. Здесь операции не запускаются.'); };
  return mountRelease({ release, open: unavailable, change: unavailable, preview: unavailable, download: unavailable,
    deliveryClient: { load: async () => { if (state === 'load-error') throw Error('Учебная ошибка загрузки состояния'); return data; }, act: unavailable, refresh: async () => release, createConnection: unavailable, probeConnection: unavailable, removeConnection: unavailable } });
}
export default { id: 'delivery', title: 'Аналитик/Доставка', parameters: { layout: 'fullscreen' } };
export const Unavailable = { render: () => story('unavailable') };
export const Ready = { render: () => story('ready') };
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
