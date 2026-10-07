import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryPanelView } from '../web/releases/delivery-model.js';

const release = { revision: 4, approval: { revision: 4 }, candidate: { id: 'candidate', sha256: 'a'.repeat(64) }, blockers: [] };
const capabilities = { mode: 'synthetic', liveDelivery: false };
const attempt = state => ({ id: 'attempt', releaseRevision: 4, candidateId: 'candidate', sha256: 'a'.repeat(64), solutionCode: 'example', state });

test('delivery controls follow server states; unavailable and uncertain outcomes never offer confirmation', () => {
  const view = state => deliveryPanelView(release, { capabilities, attempts: [attempt(state)] });
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

test('stale attempts keep history and cancellation while never authorizing current confirmation or verification', () => {
  for (const old of [{ releaseRevision: 3 }, { candidateId: 'old' }, { sha256: 'b'.repeat(64) }]) {
    const view = deliveryPanelView(release, { capabilities, attempts: [{ ...attempt('prepared'), ...old }] });
    assert.equal(view.current, false); assert.equal(view.canConfirm, false); assert.equal(view.canCancel, true);
    assert.equal(view.canPrepare, false); assert.match(view.next, /прежнему/);
  }
  assert.equal(deliveryPanelView({ ...release, revision: 5 }, { capabilities, attempts: [attempt('deployed-unverified')] }).canVerify, false);
});
