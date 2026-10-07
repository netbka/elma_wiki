import test from 'node:test';
import assert from 'node:assert/strict';
import { flowById } from '../web/flows/catalog.js';
import { startFlow, transition } from '../web/flows/model.js';
const walk = (id, actions) => { const flow = flowById(id); return actions.reduce((session, action) => transition(flow, session, action), startFlow(flow)); };
test('workspace separates TypeScript from offline ELMA checks and invalidates changes/restores', () => {
  const flow = flowById('workspace');
  let session = walk(flow.id, ['edit', 'save', 'typescript']);
  assert.equal(session.workspaceRevision, 1); assert.equal(session.workspaceCheck, 'TypeScript passed; ELMA not checked');
  session = transition(flow, session, 'profile'); assert.equal(session.workspaceCheck, 'ELMA compiler passed (offline)');
  session = transition(flow, session, 'change'); assert.equal(session.workspaceCheck, null);
  session = transition(flow, session, 'save'); assert.equal(session.workspaceRevision, 2);
  session = transition(flow, session, 'compiler'); session = transition(flow, session, 'checkpoint'); session = transition(flow, session, 'restore');
  assert.equal(session.workspaceRevision, 3); assert.equal(session.workspaceCheck, null);
});
test('approved current version skips duplicate; changed version requires new approval', () => {
  const flow = flowById('approval');
  let session = walk('approval', ['submit', 'approve']);
  assert.equal(session.approvedVersion, 1);
  assert.equal(transition(flow, session, 'skip').current, 'done');
  session = transition(flow, session, 'change'); session = transition(flow, session, 'resubmit');
  assert.equal(session.version, 2); assert.equal(session.approvedVersion, null); assert.equal(session.current, 'manager');
  assert.throws(() => transition(flow, { ...session, current: 'duplicate' }, 'skip'), /не согласована/);
  session = transition(flow, session, 'approve'); assert.equal(session.approvedVersion, 2);
});
test('return for rework never counts as approval', () => {
  const session = walk('approval', ['submit', 'return', 'resubmit']);
  assert.equal(session.version, 2); assert.equal(session.approvedVersion, null);
});
test('both unlink and flag removal clear correspondence projection', () => {
  for (const action of ['disable', 'unlink']) {
    const flow = flowById('correspondence'), shown = walk(flow.id, ['enable']);
    assert.equal(shown.topic, 'Проверка обращения');
    assert.equal(transition(flow, shown, action).topic, '');
  }
});
test('failed checks cannot deploy; sending never equals verified', () => {
  const flow = flowById('source-target');
  const failed = walk(flow.id, ['export', 'edit', 'error']);
  assert.throws(() => transition(flow, failed, 'confirm'), /недоступно/);
  const sent = walk(flow.id, ['export', 'edit', 'pass', 'confirm']); assert.equal(sent.current, 'sent');
  const mismatch = transition(flow, sent, 'mismatch'); assert.equal(mismatch.current, 'mismatch');
  assert.equal(transition(flow, sent, 'verify').current, 'verified');
});
