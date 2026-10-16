import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryPanelView } from '../web/releases/delivery-model.js';
import { deliveryTargetResult } from '../web/releases/model.js';

const release = { revision: 4, approval: { revision: 4 }, candidate: { id: 'candidate', sha256: 'a'.repeat(64) }, blockers: [] };
const capabilities = { mode: 'synthetic', liveDelivery: false };
const connection = { id: 'target', role: 'target', environment: 'test', adapter: 'synthetic', probe: { ok: true, identity: { host: 'test.example.invalid' } } };
const attempt = state => ({ id: 'attempt', releaseRevision: 4, candidateId: 'candidate', sha256: 'a'.repeat(64), solutionCode: 'example', connection, state });

test('delivery controls follow server states; unavailable and uncertain outcomes never offer confirmation', () => {
  const view = state => deliveryPanelView(release, { capabilities, connections: [connection], attempts: [attempt(state)] });
  assert.equal(deliveryPanelView(release).canPrepare, false);
  assert.equal(deliveryPanelView(release, { capabilities }).canPrepare, true);
  assert.equal(view('prepared').canConfirm, true); assert.equal(view('prepared').canCancel, true);
  assert.equal(view('deployed-unverified').canVerify, true); assert.equal(view('deployed-unverified').canPrepare, false);
  assert.equal(view('unknown-outcome').canVerify, true); assert.equal(view('unknown-outcome').canConfirm, false);
  assert.match(view('unknown-outcome').next, /не повторяйте/);
  // Composed multi-unit partial outcome: read-back only, no confirmation, cancel or new preparation.
  for (const key of ['canConfirm', 'canCancel', 'canPrepare']) assert.equal(view('partial-outcome')[key], false);
  assert.equal(view('partial-outcome').canVerify, true); assert.match(view('partial-outcome').next, /повтор операции запрещён/);
  assert.equal(deliveryTargetResult(release, attempt('partial-outcome')), 'not-run');
  // An unobserved read-back failure keeps the unresolved state: still read-back only, never a new preparation.
  for (const state of ['deployed-unverified', 'unknown-outcome', 'partial-outcome']) {
    const failed = deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt(state), evidence: { verificationError: { statusCode: 502 } } }] });
    assert.equal(failed.canPrepare, false); assert.equal(failed.canConfirm, false); assert.equal(failed.canVerify, true);
  }
  assert.equal(view('deploying').canConfirm, false); assert.equal(view('deploying').canCancel, false);
  assert.equal(view('verified').canVerify, false); assert.match(view('verified').next, /не доказательство/);
  for (const state of ['verification-failed', 'blocked', 'cancelled']) assert.equal(view(state).canPrepare, true);
  // MR-08: an operation error and a diverged read-back are unreconciled: read-back only, no new preparation.
  assert.equal(view('failed').canPrepare, false); assert.equal(view('failed').canVerify, true); assert.match(view('failed').next, /Сначала прочитайте/);
  const partial = deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt('verification-failed'), evidence: { reconciliation: { outcome: 'diverged' } } }] });
  assert.equal(partial.canPrepare, false); assert.equal(partial.canVerify, true); assert.match(partial.next, /частичную установку/);
  const notApplied = deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt('verification-failed'), evidence: { reconciliation: { outcome: 'not-applied' } } }] });
  assert.equal(notApplied.canPrepare, true);
  // A stale unresolved attempt offers only the reconcile-only read-back, never verification.
  for (const state of ['failed', 'unknown-outcome', 'partial-outcome', 'deployed-unverified']) {
    const stale = deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt(state), releaseRevision: 3 }] });
    assert.equal(stale.canReconcile, true, state); assert.equal(stale.canVerify, false); assert.equal(stale.canPrepare, false); assert.match(stale.next, /не сверен/);
  }
  const staleDiverged = deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt('verification-failed'), releaseRevision: 3, evidence: { reconciliation: { outcome: 'stale-applied', mode: 'reconcile-only' } } }] });
  assert.equal(staleDiverged.canReconcile, true); assert.equal(staleDiverged.canPrepare, false);
  for (const state of ['verified', 'cancelled', 'blocked', 'prepared']) assert.equal(deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt(state), releaseRevision: 3 }] }).canReconcile, false, state);
  assert.equal(view('failed').canReconcile, false, 'a current attempt uses the verifying read-back');
  assert.equal(view('prepared').confirmation, 'DEPLOY example aaaaaaaaaaaa');
  assert.equal(deliveryPanelView({ ...release, approval: null }, { capabilities }).canPrepare, false);
});

test('contextual server freshness outranks equal revision/hash and historical verified', () => {
  const historical = { ...attempt('verified'), candidateStatus: 'stale', verificationCurrent: false };
  const view = deliveryPanelView(release, { capabilities, connections: [connection], attempts: [historical] });
  assert.equal(view.current, false); assert.match(view.next, /прежнему/);
  assert.equal(deliveryTargetResult(release, historical), 'stale');
  assert.equal(deliveryTargetResult(release, { ...historical, candidateStatus: 'current' }), 'stale');
  assert.equal(deliveryTargetResult(release, { ...historical, candidateStatus: 'current', verificationCurrent: true }), 'pass');
  const stale = { ...release, associationStatus: 'stale' };
  assert.equal(deliveryPanelView(stale, { capabilities }).canPrepare, false);
  assert.equal(deliveryTargetResult(stale, attempt('verified')), 'stale');
});

test('unprobed, unhealthy, protected, removed and offline connections cannot confirm', () => {
  for (const target of [null, { ...connection, probe: null }, { ...connection, probe: { ...connection.probe, ok: false } },
    { ...connection, environment: 'prod' }, { ...connection, probe: { ...connection.probe, protectedHost: true } },
    { ...connection, adapter: 'bridge', adapterOptions: { bridgeId: 'offline' } }]) {
    const view = deliveryPanelView(release, { capabilities: { ...capabilities, bridge: true }, connections: target ? [target] : [], attempts: [attempt('prepared')], bridges: [{ id: 'offline', online: false }] });
    assert.equal(view.usable(target), false); assert.equal(view.canConfirm, false); assert.equal(view.canCancel, true);
  }
});

test('stale attempts keep history and cancellation while never authorizing current confirmation or verification', () => {
  for (const old of [{ releaseRevision: 3 }, { candidateId: 'old' }, { sha256: 'b'.repeat(64) }]) {
    const view = deliveryPanelView(release, { capabilities, attempts: [{ ...attempt('prepared'), ...old }] });
    assert.equal(view.current, false); assert.equal(view.canConfirm, false); assert.equal(view.canCancel, true);
    assert.equal(view.canPrepare, false); assert.match(view.next, /прежнему/);
  }
  assert.equal(deliveryPanelView({ ...release, revision: 5 }, { capabilities, attempts: [attempt('deployed-unverified')] }).canVerify, false);
});

test('predefined DEV is never selectable for delivery; DEV2 needs a configured preset and a matching probed host', () => {
  const bridgeCapabilities = { mode: 'bridge', liveDelivery: false, bridge: true };
  const preset = (id, allowedOperations, probe, extra = {}) => ({ id, role: 'target', environment: 'dev', adapter: 'bridge', probe, preset: { id, available: true, allowedOperations, ...extra } });
  const probe = { ok: true, hostMatches: true, identity: { host: 'dev2.example.invalid' } };
  const dev = preset('preset-dev', ['health', 'inspect', 'export'], { ...probe, identity: { host: 'dev.example.invalid' } });
  const dev2 = preset('preset-dev2', ['health', 'inspect', 'export', 'readBack', 'deploy'], probe);
  const view = deliveryPanelView(release, { capabilities: bridgeCapabilities, connections: [dev, dev2] });
  assert.equal(view.selectable(dev), false); assert.equal(view.usable(dev), false);
  assert.equal(view.selectable(dev2), true); assert.equal(view.usable(dev2), true);
  assert.equal(view.usable({ ...dev2, probe: { ...probe, hostMatches: false } }), false);
  assert.equal(view.selectable({ ...dev2, preset: { ...dev2.preset, available: false } }), false);
});

test('MR-08 promotion targets another usable non-production Target on the same platform version; PROD is only refused', () => {
  const source = { ...connection, probe: { ok: true, identity: { host: 'test.example.invalid', version: '2025.5' } } };
  const verified = { ...attempt('verified'), connection: source, targetIdentity: source.probe.identity, verificationCurrent: true, evidence: { reconciliation: { outcome: 'applied' } } };
  const second = { ...connection, id: 'test-2', probe: { ok: true, identity: { host: 'test-2.example.invalid', version: '2025.5' } } };
  const otherVersion = { ...second, id: 'test-3', probe: { ok: true, identity: { host: 'test-3.example.invalid', version: '2026.1' } } };
  const sameHost = { ...second, id: 'alias', probe: { ok: true, identity: { host: 'test.example.invalid', version: '2025.5' } } };
  const unprobed = { ...second, id: 'test-4', probe: null };
  const prod = { ...second, id: 'prod', environment: 'prod', probe: { ok: true, identity: { host: 'prod.example.invalid', version: '2025.5' } } };
  const view = deliveryPanelView(release, { capabilities, connections: [source, second, otherVersion, sameHost, unprobed, prod], attempts: [verified] });
  assert.equal(view.promotable, true); assert.equal(view.canPromote, true); assert.equal(view.prodRefused, true);
  assert.deepEqual(view.promotionDestinations.map(c => c.id), ['test-2', 'test-3', 'alias', 'test-4', 'prod']);
  assert.deepEqual(view.promotionDestinations.filter(view.promotionTarget).map(c => c.id), ['test-2']);
  assert.equal(view.promotionTarget(prod), false, 'PROD is never a promotion destination from the UI');
  // Stale, historical, unverified, PROD-sourced or edited evidence never offers promotion.
  for (const [candidate, data] of [[release, { attempts: [{ ...verified, releaseRevision: 3 }] }], [release, { attempts: [{ ...verified, verificationCurrent: false }] }],
    [release, { attempts: [{ ...verified, state: 'deployed-unverified' }] }], [release, { attempts: [{ ...verified, connection: { ...source, environment: 'prod' } }] }],
    [{ ...release, candidate: { ...release.candidate, provenance: 'supported-edit' } }, { attempts: [verified] }], [release, { attempts: [verified, attempt('prepared')] }]]) {
    const refused = deliveryPanelView(candidate, { capabilities, connections: [source, second, prod], ...data });
    assert.equal(refused.canPromote, false); assert.equal(refused.promotionTarget(second), false);
  }
  assert.equal(deliveryPanelView(release, { connections: [source, second], attempts: [verified] }).canPromote, false, 'delivery disabled');
});

test('MR-08 retry follows only an observed reconciliation of a current attempt', () => {
  const reconciled = (outcome, extra = {}) => deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt('verification-failed'), evidence: { reconciliation: { outcome } }, ...extra }] });
  assert.equal(reconciled('not-applied').canRetry, true); assert.equal(reconciled('not-applied').canRecover, false);
  assert.equal(reconciled('diverged').canRetry, false); assert.equal(reconciled('diverged').canRecover, false); assert.equal(reconciled('diverged').recoveryRefused, true);
  assert.equal(reconciled('diverged', { capabilities: { reimport: 'idempotent' } }).canRecover, true);
  assert.equal(reconciled('diverged', { capabilities: { reimport: 'idempotent' } }).recoveryRefused, false);
  // A retry already created, a stale candidate or a reconcile-only read-back never offers another.
  for (const view of [reconciled('not-applied', { retriedBy: 'retry' }), reconciled('not-applied', { releaseRevision: 3 }),
    deliveryPanelView(release, { capabilities, connections: [connection], attempts: [{ ...attempt('verification-failed'), evidence: { reconciliation: { outcome: 'not-applied', mode: 'reconcile-only' } } }] })]) {
    assert.equal(view.canRetry, false); assert.equal(view.canRecover, false);
  }
  // Unreconciled outcomes read back first.
  for (const state of ['failed', 'unknown-outcome', 'partial-outcome', 'deployed-unverified', 'verified', 'prepared']) {
    const view = deliveryPanelView(release, { capabilities, connections: [connection], attempts: [attempt(state)] });
    assert.equal(view.canRetry, false, state); assert.equal(view.canRecover, false, state);
  }
  assert.equal(deliveryPanelView(release, { connections: [connection], attempts: [{ ...attempt('verification-failed'), evidence: { reconciliation: { outcome: 'not-applied' } } }] }).canRetry, false, 'delivery disabled');
});
