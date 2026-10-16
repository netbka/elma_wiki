import { mountRelease } from '../../web/releases/render.js';
import { releaseView } from '../../web/releases/model.js';

const fixture = state => {
  const snapshot = { filename: 'synthetic.e365', importedAt: '2026-10-07T12:00:00Z', checksum: 'a'.repeat(64), code: 'example', coverage: 'structural', projectId: 'synthetic-project', inventory: [{ path: 'widgets/form.json', sha256: 'a'.repeat(64), size: 10 }], report: { diagnostics: [] }, entities: [] };
  const record = { id: 'synthetic-release', synthetic: true, title: 'Учебная доставка релиза', intent: 'Проверить результат операции отдельно от сообщения об успехе.', targetIntent: 'Учебный TEST', source: snapshot, baseline: snapshot, revision: 4, reviews: {}, limitations: '', notes: '', candidate: { id: 'candidate', sha256: 'a'.repeat(64) }, approval: { revision: 4, actor: 'Учебный аналитик', reason: 'Локальная передача' }, history: [] };
  const connection = { id: 'synthetic-connection', name: 'Учебный TEST', role: 'target', environment: 'test', adapter: 'synthetic', probe: { ok: true, protectedHost: state === 'protected-target', identity: { host: state === 'protected-target' ? 'prod.example.invalid' : 'test.example.invalid', version: 'synthetic' } } };
  const absent = ['unavailable', 'ready', 'load-error', 'protected-target'].includes(state);
  const attempt = absent ? null : { id: 'synthetic-attempt', state: state === 'stale' ? 'verified' : state, solutionCode: 'example', releaseRevision: state === 'stale' ? 3 : 4, candidateId: 'candidate', sha256: 'a'.repeat(64), connection, targetIdentity: connection.probe.identity,
    history: [{ state: state === 'stale' ? 'verified' : state, at: '2026-10-07T12:00:00Z', note: 'Учебное состояние, не доказательство работы ELMA' }],
    evidence: { operation: ['verified', 'deployed-unverified', 'verification-failed', 'stale'].includes(state) ? { nativeResult: 'Учебная операция сообщила об успехе' } : null, comparison: ['verified', 'verification-failed', 'stale'].includes(state) ? { policy: 'exact-solution-inventory-v1', match: state !== 'verification-failed', compared: 1, volatile: [], missing: [], different: state === 'verification-failed' ? ['widgets/form.json'] : [], unexpected: state === 'verification-failed' ? ['permissionsSettings/extra.json'] : [] } : null,
      // Synthetic composed candidate: per-unit adapter receipts in import order, not a verified result.
      ...(state === 'partial-outcome' ? { units: [{ unitId: 'contract-fields', status: 'applied', operationId: 'synthetic-1' }, { unitId: 'contract-approval', status: 'failed', operationId: 'synthetic-2' }, { unitId: 'contract-forms', status: 'unreported', operationId: null }] } : {}) } };
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
// Predefined Targets from WIKI_TARGET_* configuration: read-only DEV, DEV2 with one designated
// candidate and the actor's matching bridge, plus the reason shown when a variable is missing.
const presetFixture = state => {
  const base = bridgeFixture('bridge-ready');
  const sha = 'a'.repeat(64), identity = { host: 'dev2.example.invalid', version: 'elma365pm 1.19.0 / ELMA 2025.5' };
  const preset = (id, name, environmentRole, bridgeTarget, host, allowedOperations, extra = {}) => ({ id, name, role: 'target', environment: 'dev', adapter: 'bridge', adapterOptions: { bridgeTarget, host }, probe: null,
    preset: { id, name, environmentRole, bridgeTarget, baseUrl: host && 'https://' + host, host, allowedOperations, designatedCandidates: [], available: true, reason: null, ...extra } });
  const dev = preset('preset-dev', 'DEV', 'shared-business', 'main-dev', 'dev.example.invalid', ['health', 'inspect', 'export']);
  const dev2 = state === 'bridge-presets-unconfigured'
    ? preset('preset-dev2', 'DEV2', 'technical', 'dev2', null, [], { available: false, reason: 'Не задан WIKI_TARGET_DEV2_URL: адрес DEV2 не угадывается' })
    : { ...preset('preset-dev2', 'DEV2', 'technical', 'dev2', identity.host, ['health', 'inspect', 'export', 'readBack', 'deploy'], { designatedCandidates: [sha] }), probe: { ok: true, protectedHost: false, hostMatches: true, identity } };
  const bridge = { ...base.data.bridges[0], identity, worker: 'elma-dev bridge @ operator-pc → dev2' };
  return { release: base.release, data: { ...base.data, connections: [dev, dev2], bridges: [bridge] } };
};
// MR-08 promotion, reconciliation and retry states on synthetic Targets. PROD appears only as refused.
const promotionStates = { applied: 'verified', 'promotion-drift': 'verified', 'prod-refused': 'verified', promoted: 'prepared', 'not-applied': 'verification-failed', 'forward-recovery': 'verification-failed' };
const promotionFixture = state => {
  const base = fixture(promotionStates[state]), [source] = base.data.connections, attempt = base.data.attempts[0];
  const second = { ...source, id: 'synthetic-connection-2', name: 'Учебный TEST 2', probe: { ok: true, protectedHost: false, identity: { host: 'test-2.example.invalid', version: 'synthetic' } } };
  const prod = { ...source, id: 'synthetic-prod', name: 'PROD', environment: 'prod', probe: { ok: true, protectedHost: false, identity: { host: 'prod.example.invalid', version: 'synthetic' } } };
  const connections = state === 'prod-refused' ? [source, prod] : [source, second, prod];
  if (state === 'promoted') Object.assign(attempt, { connection: second, targetIdentity: second.probe.identity, promotion: { fromAttemptId: 'synthetic-verified', idempotencyKey: 'synthetic', fromConnection: { id: source.id, name: source.name, environment: 'test', adapter: 'synthetic' }, fromTargetIdentity: source.probe.identity } });
  else if (attempt.state === 'verified') Object.assign(attempt, { verificationCurrent: true, candidateStatus: 'current' });
  const outcome = { 'not-applied': 'not-applied', 'forward-recovery': 'diverged' }[state] || (attempt.state === 'verified' ? 'applied' : null);
  if (outcome) attempt.evidence.reconciliation = { outcome, fromState: 'deployed-unverified', readBackInventoryHash: 'b'.repeat(64) };
  // Synthetic adapter that declares an idempotent re-import: no live adapter declares it.
  if (state === 'forward-recovery') attempt.capabilities = { deploy: true, readBack: true, reimport: 'idempotent' };
  return { release: releaseView(base.release, { attempts: 1, latest: { ...attempt, connectionName: attempt.connection.name, adapter: 'synthetic' } }), data: { ...base.data, connections } };
};
function story(state) {
  const { release, data } = state in promotionStates ? promotionFixture(state) : state.startsWith('bridge-presets') ? presetFixture(state) : state.startsWith('bridge-') ? bridgeFixture(state) : fixture(state === 'target-reserved' ? 'ready' : state === 'partial-install' ? 'verification-failed' : state === 'stale-unresolved' ? 'failed' : state);
  // MR-08 synthetic partial install: the read-back matches neither the previous state nor the candidate.
  if (state === 'partial-install') data.attempts[0].evidence.reconciliation = { outcome: 'diverged', fromState: 'failed', readBackInventoryHash: 'b'.repeat(64) };
  // MR-08: the operation failed and the release was then edited; only a reconcile-only read-back is offered.
  if (state === 'stale-unresolved') data.attempts[0].releaseRevision = 3;
  const unavailable = async () => { throw Error('Учебное состояние Storybook: выберите другую story. Здесь операции не запускаются.'); };
  const act = state === 'target-reserved' ? async () => { throw Object.assign(Error('На этом Target уже есть незавершённая доставка. Завершите, проверьте или отмените её подготовку.'), { status: 409 }); }
    // MR-08: the coordinator inspects the destination afresh and refuses a drifted state before any attempt exists.
    : state === 'promotion-drift' ? async (_id, input) => { if (input.action !== 'promote' || input.connectionId !== 'synthetic-connection-2') return unavailable(); throw Object.assign(Error('Состояние назначения отличается от состояния, на котором кандидат проверен (drift). Продвижение заблокировано'), { status: 409 }); }
    : unavailable;
  return mountRelease({ release, open: unavailable, change: unavailable, preview: unavailable, download: unavailable,
    deliveryClient: { load: async () => { if (state === 'load-error') throw Error('Учебная ошибка загрузки состояния'); return data; }, act, refresh: async () => release, createConnection: unavailable, probeConnection: unavailable, removeConnection: unavailable, createBridge: unavailable, removeBridge: unavailable } });
}
export default { id: 'delivery', title: 'Аналитик/Доставка', parameters: { layout: 'fullscreen' } };
export const Unavailable = { render: () => story('unavailable') };
export const Ready = { render: () => story('ready') };
export const TargetReserved = { render: () => story('target-reserved'), play: async ({ canvasElement }) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const picker = [...canvasElement.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'synthetic-connection'));
    if (picker && !picker.value) { picker.value = 'synthetic-connection'; picker.dispatchEvent(new Event('change', { bubbles: true })); }
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
export const PartialOutcome = { render: () => story('partial-outcome') };
export const Failed = { render: () => story('failed') };
export const PartialInstall = { render: () => story('partial-install') };
export const StaleUnresolved = { render: () => story('stale-unresolved') };
export const Applied = { render: () => story('applied') };
export const NotApplied = { render: () => story('not-applied') };
export const ForwardRecovery = { render: () => story('forward-recovery') };
export const PromotionDrift = { render: () => story('promotion-drift'), play: async ({ canvasElement }) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const picker = canvasElement.querySelector('[aria-label="Продвижение проверенного кандидата"] select');
    if (picker) {
      if ([...picker.options].find(option => option.value === 'synthetic-prod')?.disabled !== true) throw Error('PROD must not be a selectable promotion destination');
      if (!picker.value) { picker.value = 'synthetic-connection-2'; picker.dispatchEvent(new Event('change', { bubbles: true })); }
      const promote = [...canvasElement.querySelectorAll('button')].find(button => button.textContent === 'Подготовить продвижение на Target назначения' && !button.disabled);
      if (promote) {
        promote.click();
        for (let observation = 0; observation < 50; observation++) {
          if (canvasElement.querySelector('[role="alert"]')?.textContent.includes('(drift)')) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw Error('Promotion drift refusal was not displayed');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Promotion fixture did not load');
} };
export const Promoted = { render: () => story('promoted') };
export const ProdRefused = { render: () => story('prod-refused') };
export const Blocked = { render: () => story('blocked') };
export const Cancelled = { render: () => story('cancelled') };
export const Stale = { render: () => story('stale') };
export const LoadError = { render: () => story('load-error') };
export const ProtectedTarget = { render: () => story('protected-target') };
export const BridgeNoBridge = { render: () => story('bridge-no-bridge') };
export const BridgeOffline = { render: () => story('bridge-offline') };
export const BridgeDeploying = { render: () => story('bridge-deploying') };
export const BridgePresets = { render: () => story('bridge-presets') };
export const BridgePresetsUnconfigured = { render: () => story('bridge-presets-unconfigured') };
