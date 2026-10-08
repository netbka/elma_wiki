import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startUsabilitySession } from '../tools/usability-session.mjs';

test('human session isolates originals, starts empty, retains distinct actors and records no invented acceptance', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-human-session-'));
  const directory = path.join(parent, 'session');
  const session = await startUsabilitySession(directory);
  t.after(async () => { await session.close(); await fs.rm(parent, { recursive: true, force: true }); });
  const anonymous = await fetch(session.base + '/api/solutions'); assert.equal(anonymous.status, 401);
  const login = async participant => {
    const response = await fetch(participant.login, { redirect: 'manual' }); assert.equal(response.status, 303);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const a = await login(session.participants[0]), b = await login(session.participants[1]);
  const get = (url, cookie) => fetch(session.base + url, { headers: { cookie } });
  const actor = async cookie => (await (await get('/api/session', cookie)).json()).user;
  assert.notEqual((await actor(a)).id, (await actor(b)).id);
  assert.deepEqual(await (await get('/api/solutions', a)).json(), []);
  const bytes = await fs.readFile(path.join(directory, '01-full.e365'));
  const upload = await fetch(session.base + '/api/solutions/uploads?sharedConfirmed=true', { method: 'POST',
    headers: { cookie: a, 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, body: bytes });
  assert.equal(upload.status, 201); const project = await upload.json();
  const created = await fetch(session.base + '/api/solutions', { method: 'POST', headers: { cookie: a,
    'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic user test',
      baselineOwner: 'Synthetic vendor', sharedConfirmed: true,
      snapshot: { projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'full', scopeConfirmed: true } }) });
  assert.equal(created.status, 201); const solution = await created.json();
  assert.equal((await get('/api/solutions/' + solution.id, b)).status, 200);
  assert.deepEqual(await fs.readFile(path.join(directory, '01-full.e365')), bytes);
  const observations = JSON.parse(await fs.readFile(path.join(directory, 'observations.local.json'), 'utf8'));
  assert.ok(observations.participants.every(p => !p.performed && p.outcome === null));
  assert.equal(observations.ownerDecision, null); assert.equal(observations.independentVisualReview, null);
  await assert.rejects(startUsabilitySession(directory), { code: 'EEXIST' });
});
