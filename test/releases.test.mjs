import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { compareSnapshots } from '../web/releases/comparison.js';
import { createServer } from '../server.mjs';
import { readArchive } from '../lib/e365.mjs';
import { zip } from './fixture.mjs';
export const releaseFixture = (required = false, extra = []) => zip([
  ['package.json', { code: 'synthetic_release', title: 'Учебный пакет', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
  ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }], ...extra
]);
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-release-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('e365-release-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const projects = projectStore(directory), releases = releaseStore(directory, projects);
  return { directory, projects, releases };
}
const details = { title: 'Новый релиз', intent: 'Проверить обязательность заголовка', targetIntent: 'Передать оператору TEST' };
async function createReview(projects, releases, owner = 'alice', extra = []) {
  const baseline = await projects.create(owner, await releaseFixture()), bytes = await releaseFixture(true, extra), source = await projects.create(owner, bytes);
  return { baseline, source, bytes, release: await releases.create(owner, { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id }) };
}
async function acceptAll(releases, release, owner = 'alice') {
  for (const row of release.changes) release = await releases.change(release.id, owner, { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Проверено назначение изменения' });
  if (release.blockers.length) release = await releases.change(release.id, owner, { ...details, revision: release.revision, action: 'details', limitations: 'Неинтерпретируемый файл проверен как текст; ELMA/Target не проверены', notes: '' });
  return release;
}
test('release freezes owner-scoped original and baseline; restart/reparse/delete do not alter review', async t => {
  const { directory, projects, releases } = await setup(t);
  let { source, baseline, release } = await createReview(projects, releases);
  assert.equal(release.changes.length, 1); assert.equal(release.changes[0].impact, 'required');
  const pinned = structuredClone(release.source);
  await projects.reparse(source.id, 'alice'); await projects.delete(source.id, 'alice'); await projects.delete(baseline.id, 'alice');
  const restarted = releaseStore(directory, projectStore(directory));
  assert.deepEqual((await restarted.get(release.id, 'alice')).source, pinned);
  assert.equal((await restarted.preview(release.id, 'alice', 'widgets/form.json', 'source')).text.includes('true'), true);
  assert.equal((await restarted.list('bob')).length, 0);
  for (const read of [() => restarted.get(release.id, 'bob'), () => restarted.preview(release.id, 'bob', 'package.json', 'source'), () => restarted.bundle(release.id, 'bob', 1), () => restarted.change(release.id, 'bob', { revision: 1, action: 'freeze' })]) await assert.rejects(read, error => error.statusCode === 404);
  await assert.rejects(restarted.create('bob', { ...details, sourceProjectId: source.id }), /Проект не найден/);
});
test('review, freeze, approval and bundle bind exact bytes; edits and competing tabs invalidate acceptance', async t => {
  const { projects, releases } = await setup(t);
  let { release, bytes } = await createReview(projects, releases);
  await assert.rejects(releases.change(release.id, 'alice', { revision: release.revision, action: 'approve', reason: 'Да' }), /кандидат/);
  const oldRevision = release.revision;
  release = await acceptAll(releases, release);
  await assert.rejects(releases.change(release.id, 'alice', { revision: oldRevision, action: 'freeze' }), error => error.statusCode === 409);
  release = await releases.change(release.id, 'alice', { revision: release.revision, action: 'freeze' });
  assert.equal(release.candidate.deployable, false); assert.equal(release.state, 'candidate');
  release = await releases.change(release.id, 'alice', { revision: release.revision, action: 'approve', reason: 'Принимаю только передачу неизменённого архива' });
  assert.equal(release.state, 'prepared'); assert.equal(release.checks.find(c => c.id === 'target').result, 'not-run');
  const bundle = await readArchive(await releases.bundle(release.id, 'alice', release.revision));
  assert.deepEqual(bundle.get('candidate.e365'), bytes);
  const manifest = JSON.parse(bundle.get('manifest.json'));
  assert.equal(manifest.artifact.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.deploymentAuthorized, false); assert.equal(manifest.verified, false);
  assert.equal((await releases.get(release.id, 'alice')).state, 'handed-off');
  release = await releases.change(release.id, 'alice', { ...details, revision: release.revision, action: 'details', targetIntent: 'Другой оператор', limitations: '', notes: '' });
  assert.equal(release.approval, null); assert.equal(release.candidate, null); assert.equal(release.state, 'review');
  assert.equal(release.history.find(event => event.action === 'approve').approval.sha256, manifest.artifact.sha256);
  assert.match(release.history.find(event => event.action === 'approve').reason, /только/);
  await assert.rejects(releases.bundle(release.id, 'alice', release.revision), /принятия/);
});
test('all file changes remain in scope; rejection, parser holes, absent baseline and corruption block gates', async t => {
  const { directory, projects, releases } = await setup(t);
  let { release } = await createReview(projects, releases, 'alice', [['unknown.txt', 'Unclassified bytes']]);
  assert.equal(release.changes.length, 2);
  release = await releases.change(release.id, 'alice', { revision: 1, action: 'review', path: 'unknown.txt', decision: 'rejected', reason: 'Неясное назначение' });
  await assert.rejects(releases.change(release.id, 'alice', { revision: release.revision, action: 'freeze' }), /замечания/);
  const noBaseline = await releases.create('alice', { ...details, sourceProjectId: release.source.projectId });
  assert.ok(noBaseline.blockers.some(b => b.includes('Нет базовой')));
  const broken = await projects.create('alice', await zip([['package.json', { code: 'synthetic_release' }], ['widgets/manifest.json', { entities: [{ path: 'absent' }] }]]));
  const blocked = await releases.create('alice', { ...details, sourceProjectId: broken.id });
  assert.ok(blocked.blockers.some(b => b.includes('absent')));
  await fs.writeFile(path.join(directory, 'releases', release.id, 'source.e365'), 'corrupt');
  await assert.rejects(releases.get(release.id, 'alice'), /Контрольная/);
  await assert.rejects(releases.bundle(release.id, 'alice', release.revision));
});
test('simultaneous decisions cannot overwrite each other; restart resumes saved reasons', async t => {
  const { directory, projects, releases } = await setup(t);
  const { release } = await createReview(projects, releases);
  const payload = { revision: 1, action: 'review', path: release.changes[0].path, decision: 'accepted', reason: 'Первое решение' };
  const result = await Promise.allSettled([releases.change(release.id, 'alice', payload), releases.change(release.id, 'alice', { ...payload, decision: 'rejected' })]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.statusCode, 409);
  assert.equal((await releaseStore(directory, projects).get(release.id, 'alice')).reviews[payload.path].reason, payload.reason);
});
test('comparison reports removals, opaque hashes and rights/process impact without suppressing bytes', () => {
  const source = { inventory: [{ path: 'permissions/rights', sha256: 'new' }, { path: 'processor/process', sha256: 'new' }], entities: [] };
  const baseline = { inventory: [{ path: 'permissions/rights', sha256: 'old' }, { path: 'opaque', sha256: 'old' }], entities: [] };
  const changes = compareSnapshots(source, baseline);
  assert.equal(changes.find(r => r.path === 'permissions/rights').impact, 'rights');
  assert.equal(changes.find(r => r.path === 'opaque').type, 'removed');
  assert.equal(changes.find(r => r.path === 'processor/process').impact, 'process');
});

test('native permission files are identified for review while unsupported parsing still blocks handoff', async t => {
  const { projects, releases } = await setup(t);
  const fixture = role => releaseFixture(false, [
    ['permissionsSettings/manifest.json', { entities: [{ code: 'roles', namespace: 'example.records', path: 'roles.json' }] }],
    ['permissionsSettings/roles.json', { roles: [role] }]
  ]);
  const baseline = await projects.create('alice', await fixture('reader'));
  const source = await projects.create('alice', await fixture('writer'));
  let release = await releases.create('alice', { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id });
  assert.equal(release.changes.find(row => row.path === 'permissionsSettings/roles.json').impact, 'rights');
  release = await acceptAll(releases, release);
  assert.ok(release.blockers.some(reason => reason.includes('permissionsSettings')));
  await assert.rejects(releases.change(release.id, 'alice', { revision: release.revision, action: 'freeze' }), error => error.statusCode === 409);
});

test('parsed optional field additions/removals are structural; mandatory field additions/removals change required rules', async t => {
  const { projects, releases } = await setup(t);
  const fixture = fields => zip([
    ['package.json', { code: 'synthetic_release', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
    ['widgets/form.json', { descriptor: { fields } }]
  ]);
  const empty = await projects.create('alice', await fixture([]));
  for (const required of [false, true]) {
    const populated = await projects.create('alice', await fixture([{ code: 'note', type: 'STRING', required }]));
    for (const [source, baseline] of [[populated, empty], [empty, populated]]) {
      const release = await releases.create('alice', { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id });
      assert.equal(release.changes.length, 1);
      assert.equal(release.changes[0].impact, required ? 'required' : 'structure');
      assert.equal(release.changes[0].fields[0].code, 'note');
    }
  }
});
test('same expanded content is a no-op; different solution identity never passes the candidate gate', async t => {
  const { projects, releases } = await setup(t);
  const first = await projects.create('alice', await releaseFixture()), second = await projects.create('alice', await releaseFixture());
  const release = await releases.create('alice', { ...details, sourceProjectId: second.id, baselineProjectId: first.id });
  assert.equal(release.changes.length, 0); assert.equal(release.blockers.length, 0);
  const candidate = await releases.change(release.id, 'alice', { revision: 1, action: 'freeze' });
  assert.equal(candidate.candidate.sha256, second.checksum);
  const unrelated = await projects.create('alice', await zip([['package.json', { code: 'another_solution' }], ['widgets/manifest.json', { entities: [] }]]));
  const mismatch = await releases.create('alice', { ...details, sourceProjectId: second.id, baselineProjectId: unrelated.id });
  assert.ok(mismatch.blockers.some(reason => reason.includes('Код решения')));
  await assert.rejects(releases.change(mismatch.id, 'alice', { revision: 1, action: 'freeze' }), /замечания/);
});
test('release HTTP routes enforce auth, ownership, CSRF, JSON, version binding and bundle method', async t => {
  const { directory, projects, releases } = await setup(t);
  const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (route, options) => fetch(`http://127.0.0.1:${server.address().port}${route}`, options), headers = { 'X-Elma-Wiki-Request': '1' };
  const auth = await request('/auth/local', { method: 'POST', headers }), cookie = auth.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await request('/api/releases')).status, 401);
  assert.equal((await request('/releases', { redirect: 'manual' })).status, 302);
  const { release: foreign } = await createReview(projects, releases, 'foreign');
  for (const route of [`/api/releases/${foreign.id}`, `/api/releases/${foreign.id}/preview?side=source&path=package.json`]) assert.equal((await request(route, { headers: { cookie } })).status, 404);
  for (const action of ['change', 'bundle']) assert.equal((await request(`/api/releases/${foreign.id}/${action}`, { method: 'POST', headers: { ...headers, cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  const { source, baseline } = await createReview(projects, releases, 'local');
  const input = { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id };
  assert.equal((await request('/api/releases', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status, 403);
  const response = await request('/api/releases', { method: 'POST', headers: { ...headers, cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 201); const release = await response.json();
  assert.equal((await request(`/api/releases/${release.id}/bundle`, { headers: { cookie } })).status, 405);
  assert.equal((await request(`/api/releases/${release.id}/change`, { method: 'POST', headers: { ...headers, cookie }, body: '{}' })).status, 415);
  assert.equal((await request(`/api/releases/${release.id}/bundle`, { method: 'POST', headers: { ...headers, cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1 }) })).status, 409);
});
