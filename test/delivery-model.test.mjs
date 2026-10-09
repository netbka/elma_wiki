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
  assert.equal(view('deploying').canConfirm, false); assert.equal(view('deploying').canCancel, false);
  assert.equal(view('verified').canVerify, false); assert.match(view('verified').next, /не доказательство/);
  for (const state of ['verification-failed', 'failed', 'blocked', 'cancelled']) assert.equal(view(state).canPrepare, true);
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
