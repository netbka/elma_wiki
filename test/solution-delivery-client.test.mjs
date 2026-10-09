import test from 'node:test';
import assert from 'node:assert/strict';
import { solutionDeliveryClient } from '../web/managed/delivery-client.js';

test('Solution delivery pins both IDs, sends only explicit action inputs and reads actor-owned controls', async () => {
  const calls = [];
  const client = solutionDeliveryClient('solution/a', async (...args) => { calls.push(args); return []; });
  await client.load('handoff/b');
  assert.deepEqual(calls.map(c => c[0]), ['/api/delivery/capabilities', '/api/connections', '/api/solutions/solution%2Fa/handoffs/handoff%2Fb/delivery', '/api/bridges']);
  calls.length = 0;
  const input = { action: 'prepare', revision: 4, connectionId: 'target' };
  await client.act('handoff/b', input);
  assert.deepEqual(calls, [['/api/solutions/solution%2Fa/handoffs/handoff%2Fb/delivery', input], ['/api/solutions/solution%2Fa/handoffs/handoff%2Fb']]);
  await client.removeConnection('target/a');
  assert.deepEqual(calls.at(-1), ['/api/connections/target%2Fa', {}, false, 'DELETE']);
});

test('lost post-action read demands recovery without replay; known reservation is recoverable', async () => {
  let writes = 0;
  const client = solutionDeliveryClient('solution', async (url, input) => { if (input) { writes++; return {}; } throw Error('read failed'); });
  await assert.rejects(client.act('handoff', { action: 'confirm' }), error => error.requiresRefresh === true);
  assert.equal(writes, 1);
  const refused = solutionDeliveryClient('solution', async () => { throw Object.assign(Error('На этом Target уже есть незавершённая доставка'), { status: 409 }); });
  await assert.rejects(refused.act('handoff', { action: 'prepare' }), error => error.recoverable === true);
});
