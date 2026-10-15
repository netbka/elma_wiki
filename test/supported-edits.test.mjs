import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectStore } from '../lib/projects.mjs';
import { workspaceStore } from '../lib/workspaces.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { createServer } from '../server.mjs';
import { releaseView } from '../web/releases/model.js';
import { deliveryPanelView } from '../web/releases/delivery-model.js';
import { installSyntheticProfile } from './compiler-fixture.mjs';
import { zip } from './fixture.mjs';

// Synthetic AR-05 fixtures only: no customer export, credentials or live ELMA.
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const alice = { id: 'alice', login: 'alice@example.test', provider: 'local' };
const bob = { id: 'bob', login: 'bob@example.test', provider: 'local' };
const details = { title: 'Правка формы', intent: 'Исправить текст заголовка', targetIntent: 'Учебный оператор TEST' };
const source = { connectionId: 'synthetic-dev', solutionRef: 'synthetic_edit' };
const bundle = (client, extra = []) => zip([
  ['package.json', { code: 'synthetic_edit', title: 'Учебный пакет', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'synthetic.records', kind: 'WIDGET', path: 'form' }, { code: 'flow', namespace: 'synthetic.records', kind: 'PROCESS', path: 'flow' }] }],
  ['widgets/form', { descriptor: { fields: [{ code: 'title', type: 'STRING' }], clientScripts: client, serverScripts: '' } }],
  ['widgets/flow', { descriptor: { clientScripts: 'Context.data.title;' } }],
  ['untouched.bin', Buffer.from([7, 8, 9])], ...extra
]);
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-edits-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('e365-edits-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const projects = projectStore(directory), workspaces = workspaceStore(projects), editor = workspaceStore(projects, { actor: alice, action: 'save' });
  const releases = releaseStore(directory, projects, { workspaces });
  const baseline = await projects.create('local', await bundle('function onOpen() { Context.data.title; }'));
  const bytes = await bundle('function onOpen() { const t: string = Context.data.title; }');
  const project = await projects.createSource('local', bytes, source);
  await installSyntheticProfile({ directory, projects, project, object: 'object-0' });
  let release = await releases.create('local', { ...details, sourceProjectId: project.id, baselineProjectId: baseline.id }, alice);
  for (const row of release.changes) release = await releases.change(release.id, 'local', { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Проверено' }, bob);
  if (release.blockers.length) release = await releases.change(release.id, 'local', { ...details, revision: release.revision, action: 'details', limitations: 'Синтетический снимок; Target не проверен', notes: '' }, bob);
  return { directory, projects, workspaces, editor, releases, project, bytes, release };
}
async function checkedEdit(editor, project, text = 'function onOpen() { const t: string = Context.data.title; Context.data.title = t.trim(); }') {
  const initial = await editor.read(project.id, 'local', 'object-0');
  const saved = await editor.save(project.id, 'local', 'object-0', { revision: initial.revision, files: { ...initial.files, 'client.ts': text } });
  const checked = await editor.check(project.id, 'local', 'object-0', { revision: saved.revision });
  assert.equal(checked.check.elmaCompiler, 'passed', JSON.stringify(checked.check.diagnostics));
  return checked;
}
const attach = (releases, release, actor = alice) => releases.change(release.id, 'local', { revision: release.revision, action: 'attach-edit', archivePath: 'widgets/form' }, actor);
const reviewEdit = (releases, release, decision = 'accepted', actor = bob) => releases.change(release.id, 'local', { revision: release.revision, action: 'review-edit', editId: release.edits[0].id, decision, reason: 'Проверен diff и runtime' }, actor);

test('supported edit round trip: compiled edit is attributed, kept separate from the original and enters a candidate only after review', async t => {
  let { directory, projects, editor, releases, project, bytes, release } = await setup(t);
  assert.equal(release.blockers.length, 0, release.blockers.join());
  // Without a passing Check of the exact workspace revision nothing is attached.
  const initial = await editor.read(project.id, 'local', 'object-0');
  await editor.save(project.id, 'local', 'object-0', { revision: initial.revision, files: { ...initial.files, 'client.ts': 'function onOpen() { Context.data.title = "x"; }' } });
  await assert.rejects(attach(releases, release), e => e.statusCode === 409 || e.status === 409);
  await assert.rejects(releases.change(release.id, 'local', { revision: release.revision, action: 'attach-edit', archivePath: 'widgets/form' }), e => e.statusCode === 401);
  const checked = await checkedEdit(editor, project);
  release = await attach(releases, release);
  const [edit] = release.edits;
  assert.equal(edit.status, 'current'); assert.equal(edit.actor.id, 'alice'); assert.equal(edit.baseChecksum, release.source.checksum);
  assert.equal(edit.workspaceRevision, checked.revision); assert.equal(edit.materialization, 'unavailable');
  assert.equal(edit.files[0].name, 'client.ts'); assert.notEqual(edit.files[0].originalSha256, edit.files[0].editedSha256);
  assert.equal(release.candidate, null); assert.ok(release.blockers.includes('Не приняты правки: 1'));
  assert.equal(release.checks.find(c => c.id === 'compiler').result, 'pass');
  assert.equal(release.checks.find(c => c.id === 'materialization').result, 'unsupported');
  // The reviewed original file loses its earlier review: its candidate bytes changed.
  assert.equal(release.reviews['widgets/form'], undefined);
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'review', path: 'widgets/form', decision: 'accepted', reason: 'Проверено снова' }, bob);
  // Generated artifact is separate; the pinned original and project bytes are unchanged.
  const root = path.join(directory, 'releases', release.id);
  const artifact = JSON.parse(await fs.readFile(path.join(root, edit.generated.file), 'utf8'));
  assert.equal(sha(await fs.readFile(path.join(root, edit.generated.file))), edit.generated.sha256);
  assert.match(artifact.original['client.ts'], /const t: string = Context\.data\.title; }$/);
  assert.match(artifact.files['client.ts'], /trim\(\)/); assert.match(artifact.runtime['client.ts'].scripts, /System\.register/);
  assert.equal(sha(await fs.readFile(path.join(root, 'source.e365'))), release.source.checksum);
  assert.deepEqual(await projects.original(project.id, 'local'), bytes);
  await assert.rejects(releases.change(release.id, 'local', { revision: release.revision, action: 'freeze' }, bob), e => e.statusCode === 409);
  release = await reviewEdit(releases, release);
  assert.equal(release.edits[0].review.independent, true); assert.equal(release.blockers.length, 0, release.blockers.join());
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'freeze' }, bob);
  assert.equal(release.candidate.provenance, 'supported-edit'); assert.equal(release.candidate.originalSha256, release.source.checksum);
  assert.notEqual(release.candidate.sha256, release.source.checksum); assert.equal(release.candidate.deployable, false);
  assert.deepEqual(release.candidate.edits, [{ id: edit.id, archivePath: 'widgets/form', sha256: edit.generated.sha256 }]);
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'approve', reason: 'Правка рассмотрена' }, bob);
  assert.equal(release.state, 'edited-review-only'); assert.equal(release.approval.scope, 'edited-review-only'); assert.equal(release.deliverable, false);
  assert.equal((await releases.list('local'))[0].state, 'edited-review-only');
  // The delivery panel never offers preparation of an edited candidate.
  const panel = deliveryPanelView(release, { capabilities: { mode: 'synthetic', liveDelivery: false } });
  assert.equal(panel.canPrepare, false); assert.match(panel.next, /elma365#60/);
  // Fail closed: no native package exists for an edited candidate.
  await assert.rejects(releases.bundle(release.id, 'local', release.revision, bob), /нативная сборка/);
  await assert.rejects(releases.candidateArtifact(release.id, 'local'), /нативная сборка/);
  await assert.rejects(releases.withCandidate(release.id, 'local', () => assert.fail('must not run')), /нативная сборка/);
  // Restart keeps the edit, its attribution and status derivation.
  const restarted = releaseStore(directory, projectStore(directory), { workspaces: workspaceStore(projectStore(directory)) });
  const again = await restarted.get(release.id, 'local');
  assert.equal(again.edits[0].status, 'current'); assert.equal(again.state, 'edited-review-only');
  // Tampering with the generated artifact blocks the release.
  await fs.writeFile(path.join(root, edit.generated.file), '{}');
  const tampered = await restarted.get(release.id, 'local');
  assert.equal(tampered.edits[0].status, 'corrupt'); assert.ok(tampered.blockers.some(b => /устарела/.test(b)));
  // Approval stops counting once edit evidence is not current.
  assert.equal(tampered.state, 'candidate'); assert.equal((await restarted.list('local'))[0].state, 'candidate');
});

test('unsupported entities stay read-only and cannot be attached', async t => {
  const { releases, release, directory } = await setup(t);
  await assert.rejects(releases.change(release.id, 'local', { revision: release.revision, action: 'attach-edit', archivePath: 'widgets/flow' }, alice), e => (e.status ?? e.statusCode) === 422);
  await assert.rejects(releases.change(release.id, 'local', { revision: release.revision, action: 'attach-edit', archivePath: 'untouched.bin' }, alice), e => (e.status ?? e.statusCode) === 404);
  await assert.rejects(releases.change(release.id, 'local', { revision: release.revision, action: 'attach-edit', archivePath: '../widgets/form' }, alice), e => (e.status ?? e.statusCode) === 404);
  // Unchanged workspace content is not an edit.
  await assert.rejects(attach(releases, release), e => (e.status ?? e.statusCode) === 409 || (e.status ?? e.statusCode) === 422);
  // Without a configured workspace capability the boundary is closed.
  const closed = releaseStore(directory, projectStore(directory));
  await assert.rejects(closed.change(release.id, 'local', { revision: release.revision, action: 'attach-edit', archivePath: 'widgets/form' }, alice), e => e.statusCode === 422);
  const current = await releases.get(release.id, 'local');
  assert.deepEqual(current.edits, []); assert.equal(current.checks.find(c => c.id === 'compiler').result, 'not-run');
});

test('a changed snapshot base or compiler profile invalidates edit evidence', async t => {
  let { directory, projects, editor, releases, project, release } = await setup(t);
  await checkedEdit(editor, project);
  release = await reviewEdit(releases, await attach(releases, release));
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'review', path: 'widgets/form', decision: 'accepted', reason: 'Проверено' }, bob);
  assert.equal(release.blockers.length, 0, release.blockers.join());
  // Operator relocks the compiler profile: evidence bound to the old profile is stale.
  const profileFile = path.join(directory, 'projects', project.id, 'compiler', 'profile.json');
  const profile = JSON.parse(await fs.readFile(profileFile, 'utf8'));
  await fs.writeFile(profileFile, JSON.stringify({ ...profile, evidence: { ...profile.evidence, reference: 'Synthetic relock' } }));
  release = await releases.get(release.id, 'local');
  assert.equal(release.edits[0].status, 'stale'); assert.ok(release.blockers.some(b => /compiler/.test(b)));
  assert.equal(release.checks.find(c => c.id === 'compiler').result, 'stale');
  await assert.rejects(releases.change(release.id, 'local', { revision: release.revision, action: 'freeze' }, bob), e => e.statusCode === 409);
  await fs.writeFile(profileFile, JSON.stringify(profile));
  assert.equal((await releases.get(release.id, 'local')).edits[0].status, 'current');
  // A new Source snapshot moves the project base away from the pinned release snapshot.
  const current = (await projects.listSnapshots(project.id, 'local')).currentSnapshotId;
  await projects.appendSource(project.id, 'local', await bundle('function onOpen() { Context.data.title; }', [['extra.txt', 'next']]), source, current);
  release = await releases.get(release.id, 'local');
  assert.equal(release.edits[0].status, 'stale'); assert.ok(release.blockers.some(b => /снимк/.test(b)));
  await assert.rejects(releases.change(release.id, 'local', { revision: release.revision, action: 'freeze' }, bob), e => e.statusCode === 409);
  await assert.rejects(attach(releases, release), e => (e.status ?? e.statusCode) === 409);
  // Removing the stale edit returns to the unchanged-original path.
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'detach-edit', editId: release.edits[0].id }, alice);
  assert.deepEqual(release.edits, []);
});

test('editing after approval invalidates candidate, approval and the earlier edit review', async t => {
  let { editor, releases, project, release } = await setup(t);
  await checkedEdit(editor, project);
  release = await reviewEdit(releases, await attach(releases, release));
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'review', path: 'widgets/form', decision: 'accepted', reason: 'Проверено' }, bob);
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'freeze' }, bob);
  const frozen = release.candidate;
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'approve', reason: 'Принято' }, bob);
  assert.equal(release.state, 'edited-review-only');
  await checkedEdit(editor, project, 'function onOpen() { const t: string = Context.data.title; Context.data.title = t.toUpperCase(); }');
  release = await attach(releases, release);
  assert.equal(release.candidate, null); assert.equal(release.approval, null); assert.equal(release.state, 'review');
  assert.equal(release.edits.length, 1); assert.equal(release.edits[0].review, null); assert.equal(release.reviews['widgets/form'], undefined);
  assert.ok(release.blockers.includes('Не приняты правки: 1'));
  // A rejected edit blocks the candidate; the author's own acceptance is recorded as not independent.
  release = await reviewEdit(releases, release, 'rejected');
  assert.ok(release.blockers.includes('Не приняты правки: 1'));
  release = await reviewEdit(releases, release, 'accepted', alice);
  assert.equal(release.edits[0].review.independent, false);
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'review', path: 'widgets/form', decision: 'accepted', reason: 'Проверено' }, bob);
  release = await releases.change(release.id, 'local', { revision: release.revision, action: 'freeze' }, bob);
  assert.notEqual(release.candidate.sha256, frozen.sha256);
  assert.deepEqual(release.history.filter(e => e.action.endsWith('-edit')).map(e => e.action), ['attach-edit', 'review-edit', 'attach-edit', 'review-edit', 'review-edit']);
});

test('release API attaches edits only for authenticated actors and keeps unsupported objects read-only', async t => {
  const { directory, release, editor, project } = await setup(t);
  const server = createServer({ directory, allowLocal: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port, headers = { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' };
  const login = await fetch(base + '/auth/local', { method: 'POST', headers }), cookie = login.headers.getSetCookie()[0].split(';')[0];
  const post = input => fetch(`${base}/api/releases/${release.id}/change`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify(input) });
  assert.equal((await fetch(`${base}/api/releases/${release.id}/change`, { method: 'POST', headers, body: JSON.stringify({ revision: release.revision, action: 'attach-edit', archivePath: 'widgets/form' }) })).status, 404);
  assert.equal((await post({ revision: release.revision, action: 'attach-edit', archivePath: 'widgets/flow' })).status, 422);
  await checkedEdit(editor, project);
  const attached = await post({ revision: release.revision, action: 'attach-edit', archivePath: 'widgets/form' });
  assert.equal(attached.status, 200);
  const view = await attached.json();
  assert.equal(view.edits[0].actor.provider, 'local'); assert.equal(view.edits[0].status, 'current'); assert.equal(view.owner, undefined);
});

test('release view fails closed for edits without derived status and keeps unedited delivery available', () => {
  const snapshot = { checksum: 'a'.repeat(64), code: 'synthetic', inventory: [], report: { status: 'structural', diagnostics: [] }, entities: [] };
  const edit = { id: 'e', archivePath: 'widgets/form', generated: { sha256: 'b'.repeat(64) }, compiler: { compilerContract: 'c', platformVersion: 'p' },
    review: { decision: 'accepted', sha256: 'b'.repeat(64) } };
  const record = { id: 'r', revision: 2, source: snapshot, baseline: snapshot, reviews: {}, history: [], limitations: '',
    candidate: { id: 'c', sha256: 'c'.repeat(64), provenance: 'supported-edit' }, approval: { revision: 2 }, edits: [edit] };
  const unknown = releaseView(record);
  assert.equal(unknown.state, 'candidate'); assert.ok(unknown.blockers.some(b => /не проверены/.test(b)));
  assert.equal(releaseView({ ...record, edits: [{ ...edit, status: 'current' }] }).state, 'edited-review-only');
  const plain = releaseView({ ...record, candidate: { id: 'c', sha256: snapshot.checksum, provenance: 'unchanged-original' }, edits: [] });
  assert.equal(plain.state, 'prepared'); assert.equal(plain.deliverable, true);
  assert.equal(deliveryPanelView(plain, { capabilities: { mode: 'synthetic', liveDelivery: false } }).canPrepare, true);
});
