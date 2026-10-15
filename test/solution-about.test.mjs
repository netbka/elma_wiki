import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { zip } from './fixture.mjs';
import { actorDisplay } from '../lib/actors.mjs';

// UX-05: the purpose paragraph and module descriptions are explanations of
// their own scopes, generated from declared names only, saved with author and
// history through the existing explanation store. Synthetic archive; no ELMA.
const archive = () => zip([
  ['package.json', { code: 'synthetic_about', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [
    { code: 'contract', namespace: 'contract_management.contracts', kind: 'WIDGET', name: 'Договор', path: 'contract.json' },
    { code: 'card', namespace: 'partners', kind: 'WIDGET', name: 'Карточка контрагента', path: 'card.json' }] }],
  ['widgets/contract.json', { descriptor: { fields: [], clientScripts: 'const a = 1;' } }],
  ['widgets/card.json', { descriptor: { fields: [], clientScripts: 'const b = 1;' } }]
]);

test('UX-05: purpose and module descriptions are generated from names, saved with the actor and history, and never change the domain revision', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-about-'));
  const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, options = {}, cookie) => {
    const response = await fetch(base + route, { ...options, headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, body: type.includes('json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const { cookie } = await request('/auth/local', { method: 'POST', body: '{}' });
  const uploaded = await request('/api/solutions/uploads?sharedConfirmed=true', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await archive() }, cookie);
  assert.equal(uploaded.status, 201);
  const created = await request('/api/solutions', { method: 'POST', body: JSON.stringify({ name: 'Учебные договоры', baselineOwner: 'Vendor',
    snapshot: { projectId: uploaded.body.id, snapshotId: uploaded.body.currentSnapshotId, scope: 'full', scopeConfirmed: true } }) }, cookie);
  assert.equal(created.status, 201);
  const id = created.body.id, route = `/api/solutions/${id}/explanations`;

  const purpose = await request(route + '?scope=solution-purpose', {}, cookie);
  assert.equal(purpose.status, 200, JSON.stringify(purpose.body));
  assert.equal(purpose.body.key, 'solution-purpose'); assert.equal(purpose.body.version, 0); assert.equal(purpose.body.saved, null);
  assert.match(purpose.body.draft.text, /Решение объединяет модули «contract_management», «partners»/);
  assert.match(purpose.body.draft.text, /Экраны: Договор/); assert.match(purpose.body.draft.text, /Карточка контрагента/);
  assert.match(purpose.body.draft.text, /Работа в ELMA не наблюдалась/);
  assert.equal(purpose.body.draft.nativeObservation, 'absent'); assert.deepEqual(purpose.body.draft.sources, []);
  // Artifact parameters do not belong to the purpose scope; an unknown module is refused.
  assert.equal((await request(route + '?scope=solution-purpose&artifactId=x', {}, cookie)).status, 400);
  assert.equal((await request(route + '?scope=module&module=missing', {}, cookie)).status, 404);
  assert.equal((await request(route + '?scope=module', {}, cookie)).status, 400);

  const saved = await request(route, { method: 'POST', body: JSON.stringify({ scope: 'solution-purpose', text: 'Договоры и контрагенты для отдела продаж.',
    expectedRevision: purpose.body.expectedRevision, expectedVersion: 0, expectedFingerprint: purpose.body.fingerprint }) }, cookie);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.version, 1); assert.equal(saved.body.saved.text, 'Договоры и контрагенты для отдела продаж.'); assert.equal(saved.body.saved.sourceStatus, 'current');
  assert.equal(saved.body.history.length, 1); assert.equal(typeof saved.body.saved.actor.login, 'string');
  // A stale version is refused and the domain revision is untouched.
  const again = await request(route, { method: 'POST', body: JSON.stringify({ scope: 'solution-purpose', text: 'Другой текст', expectedRevision: purpose.body.expectedRevision, expectedVersion: 0, expectedFingerprint: purpose.body.fingerprint }) }, cookie);
  assert.equal(again.status, 409);
  const state = await request(`/api/solutions/${id}`, {}, cookie);
  assert.equal(state.body.revision, created.body.revision); assert.equal(state.body.audit.at(-1).action, 'explanation-saved');

  const module = await request(route + '?scope=module&module=partners', {}, cookie);
  assert.equal(module.status, 200, JSON.stringify(module.body));
  assert.equal(module.body.key, JSON.stringify(['module', 'partners'])); assert.equal(module.body.title, 'partners');
  assert.match(module.body.draft.text, /^Экраны: Карточка контрагента\./);
  const moduleSaved = await request(route, { method: 'POST', body: JSON.stringify({ scope: 'module', module: 'partners', text: 'Контрагенты и их реквизиты.',
    expectedRevision: module.body.expectedRevision, expectedVersion: 0, expectedFingerprint: module.body.fingerprint }) }, cookie);
  assert.equal(moduleSaved.status, 200, JSON.stringify(moduleSaved.body)); assert.equal(moduleSaved.body.saved.text, 'Контрагенты и их реквизиты.');
  // The module description does not leak into the purpose, and the solution overview keeps its related list for processes/steps only.
  assert.equal((await request(route + '?scope=solution-purpose', {}, cookie)).body.saved.text, 'Договоры и контрагенты для отдела продаж.');
  const overview = await request(route + '?scope=solution', {}, cookie);
  assert.equal(overview.status, 200); assert.deepEqual(overview.body.related, []);
});

test('UX-05: actor display shows a name with initials, never a bare letter, an id or an e-mail only', () => {
  assert.deepEqual(actorDisplay({ id: 'x', login: 'ivan.petrov@example.org', provider: 'email' }), { name: 'Ivan Petrov', initials: 'IP', login: 'ivan.petrov@example.org' });
  assert.deepEqual(actorDisplay({ id: 'y', login: 'Мария Сидорова', provider: 'vk-teams' }), { name: 'Мария Сидорова', initials: 'МС', login: 'Мария Сидорова' });
  assert.equal(actorDisplay({ id: 'z', login: 'p', provider: 'local' }).initials, 'P');
  assert.deepEqual(actorDisplay(null), { name: '', initials: '?', login: '' });
});
