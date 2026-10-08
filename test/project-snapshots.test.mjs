import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { workspaceStore } from '../lib/workspaces.mjs';
import { createServer } from '../server.mjs';
import { fixture, zip } from './fixture.mjs';

const source = { connectionId: 'synthetic-dev', solutionRef: 'example_solution' };
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-snapshot-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('wiki-snapshot-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, projects: projectStore(directory) };
}

test('Source imports pin independent bytes, parsed index and coverage across selection, reparse and restart', async t => {
  const { directory, projects } = await setup(t), first = await fixture(), second = await fixture({ fieldCode: 'changed' });
  const p = await projects.createSource('alice', first, source);
  const s1 = (await projects.listSnapshots(p.id, 'alice')).snapshots[0];
  const before = await projects.readSnapshot(p.id, 'alice', s1.id);
  const s2 = await projects.appendSource(p.id, 'alice', second, source, s1.id);
  assert.notEqual(s1.id, s2.id); assert.notEqual(s1.parserRevision, s2.parserRevision);
  assert.deepEqual(await projects.snapshotOriginal(p.id, 'alice', s1.id), first);
  assert.deepEqual(await projects.original(p.id, 'alice'), second);
  assert.equal((await projects.read(p.id, 'alice')).entities[0].fields[0].code, 'changed');
  await projects.reparse(p.id, 'alice');
  const restarted = projectStore(directory);
  assert.deepEqual(await restarted.readSnapshot(p.id, 'alice', s1.id), before);
  assert.deepEqual((await restarted.listSnapshots(p.id, 'alice')).snapshots, [s1, s2]);
  await restarted.selectSnapshot(p.id, 'alice', s1.id, s2.id);
  assert.deepEqual(await restarted.original(p.id, 'alice'), first);
  assert.deepEqual(await restarted.read(p.id, 'alice'), before);
  assert.deepEqual(await restarted.snapshotOriginal(p.id, 'alice', s2.id), second);
  assert.equal((await restarted.readSnapshot(p.id, 'alice', s2.id)).entities[0].fields[0].code, 'changed');
  await restarted.delete(p.id, 'alice');
  await assert.rejects(restarted.snapshotOriginal(p.id, 'alice', s1.id), /Проект не найден/);
});

test('manual uploads remain separate; legacy reparse freezes the original parser revision', async t => {
  const { directory, projects } = await setup(t), bytes = await fixture();
  const a = await projects.create('alice', bytes), b = await projects.create('alice', bytes);
  assert.notEqual(a.id, b.id);
  await assert.rejects(projects.appendSource(a.id, 'alice', bytes, source, a.id), error => error.statusCode === 409);
  const filename = path.join(directory, 'projects', a.id, 'project.json');
  const legacy = JSON.parse(await fs.readFile(filename, 'utf8'));
  delete legacy.snapshots; delete legacy.currentSnapshotId;
  await fs.writeFile(filename, JSON.stringify(legacy));
  const snapshot = (await projects.listSnapshots(a.id, 'alice')).snapshots[0];
  await projects.reparse(a.id, 'alice');
  const after = await projects.get(a.id, 'alice');
  assert.notEqual(after.activeRevision, snapshot.parserRevision);
  assert.deepEqual((await projects.listSnapshots(a.id, 'alice')).snapshots, [snapshot]);
  assert.deepEqual(await projects.original(a.id, 'alice'), bytes);
});

test('failed exports, mismatched references and stale/concurrent writes create no successful snapshot', async t => {
  const { projects } = await setup(t), bytes = await fixture(), p = await projects.createSource('alice', bytes, source);
  const s1 = (await projects.listSnapshots(p.id, 'alice')).snapshots[0];
  for (const reference of [{ ...source, connectionId: 'different' }, { ...source, solutionRef: 'different' }, { ...source, token: 'TEST_SECRET' }, { ...source, connectionId: 'https://user:TEST_SECRET@example.test' }])
    await assert.rejects(projects.appendSource(p.id, 'alice', bytes, reference, s1.id));
  await assert.rejects(projects.appendSource(p.id, 'alice', Buffer.from('not ZIP'), source, s1.id));
  await assert.rejects(projects.appendSource(p.id, 'alice', await fixture({ code: 'different' }), source, s1.id));
  assert.deepEqual((await projects.listSnapshots(p.id, 'alice')).snapshots, [s1]);
  const result = await Promise.allSettled([projects.appendSource(p.id, 'alice', bytes, source, s1.id), projects.appendSource(p.id, 'alice', bytes, source, s1.id)]);
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(result.find(row => row.status === 'rejected').reason.statusCode, 409);
  const s2 = result.find(row => row.status === 'fulfilled').value;
  await assert.rejects(projects.selectSnapshot(p.id, 'alice', s1.id, s1.id), error => error.statusCode === 409);
  assert.equal((await projects.listSnapshots(p.id, 'alice')).currentSnapshotId, s2.id);
  for (const operation of [() => projects.listSnapshots(p.id, 'bob'), () => projects.readSnapshot(p.id, 'bob', s1.id), () => projects.snapshotOriginal(p.id, 'bob', s1.id), () => projects.selectSnapshot(p.id, 'bob', s1.id, s2.id), () => projects.appendSource(p.id, 'bob', bytes, source, s2.id)])
    await assert.rejects(operation, /Проект не найден/);
  await assert.rejects(projects.readSnapshot(p.id, 'alice', '../project.json'), error => error.statusCode === 404);
});

test('partial imports preserve opaque bytes; corruption cannot be selected or downloaded', async t => {
  const { directory, projects } = await setup(t), p = await projects.createSource('alice', await fixture(), source);
  const bytes = await zip([['package.json', { code: source.solutionRef }], ['data', Buffer.from([0, 1, 2])]]);
  const s2 = await projects.appendSource(p.id, 'alice', bytes, source, p.id);
  assert.equal(s2.coverage, 'opaque');
  assert.equal((await projects.readSnapshot(p.id, 'alice', s2.id, 'inventory')).some(row => row.path === 'data'), true);
  assert.deepEqual(await projects.snapshotOriginal(p.id, 'alice', s2.id), bytes);
  await projects.selectSnapshot(p.id, 'alice', p.id, s2.id);
  await fs.writeFile(path.join(directory, 'projects', p.id, 'revisions', s2.parserRevision, 'original.e365'), 'corrupt');
  await assert.rejects(projects.selectSnapshot(p.id, 'alice', s2.id, p.id), error => error.statusCode === 409);
  await assert.rejects(projects.snapshotOriginal(p.id, 'alice', s2.id), error => error.statusCode === 409);
  assert.equal((await projects.listSnapshots(p.id, 'alice')).currentSnapshotId, p.id);
});

test('release pinning uses selected bytes; old workspace evidence cannot follow a different snapshot', async t => {
  const { directory, projects } = await setup(t), first = await fixture(), second = await fixture({ fieldCode: 'changed' });
  const p = await projects.createSource('alice', first, source), workspaces = workspaceStore(projects);
  const object = (await projects.read(p.id, 'alice')).entities[0].id;
  const workspace = await workspaces.read(p.id, 'alice', object);
  await workspaces.save(p.id, 'alice', object, { revision: workspace.revision, files: { ...workspace.files, 'client.ts': workspace.files['client.ts'] + '\n// Synthetic local edit' } });
  const s2 = await projects.appendSource(p.id, 'alice', second, source, p.id);
  await assert.rejects(workspaces.read(p.id, 'alice', object), /snapshot/);
  const releases = releaseStore(directory, projects);
  const release = await releases.create('alice', { title: 'Synthetic', intent: 'Snapshot capture', targetIntent: 'Offline only', sourceProjectId: p.id });
  assert.equal(release.source.checksum, s2.checksum);
  assert.equal(release.source.snapshotId, s2.id);
  assert.equal(release.source.importedAt, s2.createdAt);
  await projects.selectSnapshot(p.id, 'alice', p.id, s2.id);
  assert.equal((await releases.get(release.id, 'alice')).source.checksum, s2.checksum);
  assert.deepEqual(await fs.readFile(path.join(directory, 'releases', release.id, 'source.e365')), second);
});

test('snapshot HTTP routes share authenticated content and enforce JSON, CSRF and selection revision', async t => {
  const { directory, projects } = await setup(t), server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (route, options) => fetch(`http://127.0.0.1:${server.address().port}${route}`, options);
  const headers = { 'X-Elma-Wiki-Request': '1' };
  const login = await request('/auth/local', { method: 'POST', headers }), cookie = login.headers.getSetCookie()[0].split(';')[0];
  const bytes = await fixture(), p = await projects.createSource('local', bytes, source), foreign = await projects.create('foreign', bytes);
  const base = `/api/projects/${p.id}/snapshots`, select = `${base}/${p.id}/select`, jsonHeaders = { ...headers, cookie, 'Content-Type': 'application/json' };
  for (const route of [base, `${base}/${p.id}/original`, `${base}/${p.id}/data`]) assert.equal((await request(route)).status, 404);
  for (const route of [`/api/projects/${foreign.id}/snapshots`, `/api/projects/${foreign.id}/snapshots/${foreign.id}/inventory`]) assert.equal((await request(route, { headers: { cookie } })).status, 200);
  assert.equal((await request(`/api/projects/${foreign.id}/snapshots/${foreign.id}/select`, { method: 'POST', headers: jsonHeaders, body: '{}' })).status, 409);
  const list = await (await request(base, { headers: { cookie } })).json();
  assert.equal(list.currentSnapshotId, p.id); assert.equal(JSON.stringify(list).includes('owner'), false);
  for (const kind of ['data', 'report', 'inventory', 'original']) assert.equal((await request(`${base}/${p.id}/${kind}`, { headers: { cookie } })).status, 200);
  assert.deepEqual(Buffer.from(await (await request(`${base}/${p.id}/original`, { headers: { cookie } })).arrayBuffer()), bytes);
  assert.equal((await request(select, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await request(select, { method: 'POST', headers: { ...jsonHeaders, Origin: 'https://foreign.test' }, body: '{}' })).status, 403);
  assert.equal((await request(select, { method: 'POST', headers: { ...headers, cookie }, body: '{}' })).status, 415);
  for (const body of ['null', '[]']) assert.equal((await request(select, { method: 'POST', headers: jsonHeaders, body })).status, 400);
  assert.equal((await request(select, { method: 'POST', headers: jsonHeaders, body: '{}' })).status, 409);
  assert.equal((await request(select, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ expectedSnapshotId: p.id }) })).status, 200);
  assert.equal((await request(base, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ source }) })).status, 405);
  assert.equal((await request(`${base}/../source`, { method: 'POST', headers: jsonHeaders, body: '{}' })).status, 404);
});
