import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.mjs';
import { Coordinator, digest } from '../core.mjs';
import { ciPolicy, observeCi, refreshCi } from '../ci.mjs';
import { prBranch, prMarker, GitHubClient } from '../adapters.mjs';
import { createApp, startLoops } from '../server.mjs';

const BASE = 'a'.repeat(40), HEAD = 'b'.repeat(40);
const policy = () => ({ workflows: [{ id: 10, path: '.github/workflows/test.yml', jobs: ['unit', 'browser'] }], maxRepairs: 0 });
function setup(t, maxRepairs = 0) {
  const store = new Store(':memory:'); t.after(() => store.close());
  const project = { repository: 'fixture/wiki', taskKind: 'wiki_code', baseRef: 'main', ci: { ...policy(), maxRepairs } };
  const config = { projects: { wiki: project }, bindings: [{ actor: 'alice', chat: 'chat', projects: ['wiki'] }],
    workers: [{ id: 'agent', kinds: ['triage','implement'], projects: ['wiki'] }, { id: 'publisher', kinds: ['publish'], projects: ['wiki'] }] };
  let tick = 10000;
  const core = new Coordinator(store, config, () => ++tick);
  const id = core.ingest('test', [{ id: '1', type: 'message', actor: 'alice', chat: 'chat', text: '/task wiki New text' }])[0].requestId;
  const worker = config.workers[0], j = core.claim(worker);
  core.complete(worker, j.id, j.leaseToken, { type: 'specification', summary: 'New text', criteria: ['Text is visible'], scope: ['Text only'] });
  core.ingest('test', [{ id: '2', type: 'message', actor: 'alice', chat: 'chat', text: `/approve ${id} 1` }]);
  const implementation = core.claim(worker);
  core.complete(worker, implementation.id, implementation.leaseToken, { type: 'patch_ready', artifactId: 'fixture', sha256: 'c'.repeat(64), baseSha: BASE });
  const publication = core.claim(config.workers[1]);
  core.complete(config.workers[1], publication.id, publication.leaseToken, { type: 'pull_request', number: 42, headSha: HEAD }, { number: 42, headSha: HEAD, repository: project.repository });
  const r = store.request(id), root = '/repos/fixture/wiki';
  const pr = { number: 42, state: 'open', body: prMarker(r.id, 1),
    head: { sha: HEAD, ref: prBranch(r), repo: { full_name: project.repository } },
    base: { sha: BASE, ref: 'main', repo: { full_name: project.repository } } };
  const run = { id: 100, workflow_id: 10, path: project.ci.workflows[0].path, head_sha: HEAD, head_branch: pr.head.ref,
    event: 'pull_request', status: 'completed', conclusion: 'success', run_attempt: 1, updated_at: '2026-01-01T00:00:00Z',
    head_repository: { full_name: project.repository }, pull_requests: [{ number: 42, head: { sha: HEAD }, base: { sha: BASE } }] };
  const jobs = ['unit', 'browser'].map((name, i) => ({ id: 200+i, run_id: 100, name, status: 'completed', conclusion: 'success', steps: [] }));
  const f = { core, store, config, project, id, pr, run, runs: [run], jobs, calls: [], readHook: null };
  const fetchImpl = async (url, options) => {
    const u = new URL(url); f.calls.push(u.pathname + u.search); assert.equal(options.method, 'GET');
    if (f.readHook) await f.readHook(u);
    const json = x => new Response(JSON.stringify(x));
    if (u.pathname === root + '/pulls/42') return json(pr);
    if (u.pathname === root + '/actions/runs') return json(f.runResponse || { total_count: f.runs.length, workflow_runs: f.runs });
    if (u.pathname.includes('/attempts/')) return json(f.jobResponse || { total_count: jobs.length, jobs });
    throw Error('Unexpected request');
  };
  f.github = new GitHubClient({ token: () => 'fixture' }, fetchImpl);
  f.read = () => observeCi(f.github, store.request(id), project);
  f.refresh = () => refreshCi(core, f.github);
  f.fail = () => { run.conclusion = 'failure'; jobs[0].conclusion = 'failure'; jobs[0].steps = [{ name: 'assert greeting', conclusion: 'failure' }]; };
  return f;
}

test('CI pass is a read-only exact workflow/job/SHA receipt, not task completion; repeated scans do not spam', async t => {
  const f = setup(t); await f.refresh();
  const first = f.store.request(f.id), messages = f.store.all('SELECT * FROM outbox').length;
  assert.equal(first.ci.status, 'passed'); assert.equal(first.state, 'PR_READY');
  await f.refresh(); assert.equal(f.store.all('SELECT * FROM outbox').length, messages);
  assert.ok(f.store.request(f.id).ci.observedAt > first.ci.observedAt);
  assert.ok(f.calls.some(x => x.includes('/attempts/1/jobs')));
});
for (const value of ['skipped', 'neutral', 'cancelled', 'timed_out', 'action_required']) test(`CI ${value} is not pass or an automatic code repair`, async t => {
  const f = setup(t, 2); f.jobs[0].conclusion = value; f.run.conclusion = value;
  await f.refresh(); const r=f.store.request(f.id);
  assert.equal(r.ci.status, 'blocked'); assert.equal(r.state, 'PR_READY'); assert.equal(r.iteration, undefined);
});
test('missing configured run is waiting; missing/duplicate required job blocks', async t => {
  const f=setup(t); f.runs=[]; assert.equal((await f.read()).status,'waiting');
  f.runs=[f.run]; f.jobs.pop(); assert.equal((await f.read()).status,'blocked');
  f.jobs.push({...f.jobs[0],id:203}); assert.equal((await f.read()).status,'blocked');
});
test('latest rerun wins over an earlier successful run; pending retry invalidates success', async t => {
  const f=setup(t); f.runs.push({...f.run,id:101,status:'in_progress',conclusion:null});
  assert.equal((await f.read()).status,'waiting');
});
for (const [label, mutate] of [
  ['wrong head',f=>f.run.head_sha=BASE], ['wrong branch',f=>f.run.head_branch='main'],
  ['wrong path',f=>f.run.path='.github/workflows/other.yml'], ['wrong event',f=>f.run.event='push'],
  ['wrong repository',f=>f.run.head_repository.full_name='attacker/wiki'], ['wrong PR',f=>f.run.pull_requests[0].number=99],
  ['old base',f=>f.run.pull_requests[0].base.sha=HEAD], ['base drift',f=>f.pr.base.sha=HEAD],
  ['edited PR',f=>f.pr.head.sha=BASE], ['job from another run',f=>f.jobs[0].run_id=999],
  ['incomplete page',f=>f.runResponse={total_count:2,workflow_runs:[f.run]}],
  ['excessive page count',f=>f.runResponse={total_count:301,workflow_runs:[f.run]}],
  ['duplicate rows',f=>f.runs.push({...f.run})]
]) test(`CI ${label} never passes and never queues repair`,async t=>{
  const f=setup(t,2); mutate(f); await f.refresh();
  assert.equal(f.store.request(f.id).ci.status,'unavailable'); assert.equal(f.store.request(f.id).iteration,undefined);
});
test('run attempt changes while reading invalidate the receipt',async t=>{
  const f=setup(t); f.readHook=u=>{if(u.pathname.includes('/attempts/'))f.run.run_attempt=2;};
  await f.refresh(); assert.equal(f.store.request(f.id).ci.status,'unavailable');
});
test('failure queues exactly one repair under same approved specification; cancellation fences it',async t=>{
  const f=setup(t,2), before=f.store.request(f.id); f.fail();
  await Promise.all([f.refresh(),f.refresh()]); await f.refresh();
  const r=f.store.request(f.id); assert.equal(r.iteration,1); assert.equal(r.revision,1); assert.equal(r.state,'QUEUED');
  assert.deepEqual(r.spec,before.spec); assert.deepEqual(r.approval,before.approval);
  assert.equal(r.repairFrom.pr.number,42); assert.equal(r.previousPrs.length,1);
  const j=f.core.claim(f.config.workers[0]); assert.equal(j.iteration,1); assert.equal(j.kind,'implement');
  f.core.ingest('test',[{id:'3',type:'message',actor:'alice',chat:'chat',text:`/cancel ${f.id}`}]);
  assert.throws(()=>f.core.complete(f.config.workers[0],j.id,j.leaseToken,{type:'patch_ready',artifactId:'x',sha256:'c'.repeat(64),baseSha:BASE}));
});
test('repair disabled by default; exhausted budget waits for user rather than an infinite loop',async t=>{
  const f=setup(t); f.fail(); await f.refresh(); assert.equal(f.store.request(f.id).state,'PR_READY');
  const r=f.store.request(f.id); r.iteration=2; r.route.ci.maxRepairs=2; f.project.ci.maxRepairs=2; f.store.save(r);
  f.pr.head.ref=prBranch(r); f.pr.body=prMarker(r.id,1,2); f.run.head_branch=f.pr.head.ref;
  await f.refresh(); assert.equal(f.store.request(f.id).state,'PR_READY'); assert.equal(f.store.request(f.id).iteration,2);
});
test('policy changes cannot give already-approved requests new repair authority',async t=>{
  const f=setup(t); f.project.ci.maxRepairs=2; f.fail();
  await f.refresh(); assert.equal(f.store.request(f.id).iteration,undefined); assert.equal(f.store.request(f.id).ci,undefined);
});
test('revocation during CI read discards the late observation',async t=>{
  const f=setup(t,2); f.fail(); let done=false;
  f.readHook=()=>{if(!done){done=true;f.config.bindings=[];}};
  await f.refresh(); assert.equal(f.store.request(f.id).ci,undefined);
});
test('failed check without a matching failed required job is blocked',async t=>{
  const f=setup(t,2); f.run.conclusion='failure'; assert.equal((await f.read()).status,'blocked');
});
test('a lost observation clears a previous green status instead of preserving a false current pass',async t=>{
  const f=setup(t); await f.refresh(); f.readHook=()=>{throw Error('offline');}; await f.refresh();
  assert.equal(f.store.request(f.id).ci.status,'unavailable');
});
test('repair limit is visible before approving; /status shows the timestamp and no deployment claim',async t=>{
  const f=setup(t,2); assert.ok(f.store.all('SELECT payload FROM outbox').some(x=>x.payload.includes('CI repairs within this exact specification: 2')));
  await f.refresh(); f.core.ingest('test',[{id:'4',type:'message',actor:'alice',chat:'chat',text:`/status ${f.id}`}]);
  const text=JSON.parse(f.store.all("SELECT payload FROM outbox WHERE kind='vk' ORDER BY id DESC LIMIT 1")[0].payload).text;
  assert.match(text,/CI: PASSED/);assert.match(text,/observed/);assert.match(text,/NOT DEPLOYED/);
});
test('CI policy rejects arbitrary paths, extra keys, duplicates, missing jobs and excessive repair authority',()=>{
  for(const p of [{workflows:[]},{...policy(),maxRepairs:3},{...policy(),shell:'danger'},
    {workflows:[{id:10,path:'../../evil',jobs:['x']}]},{workflows:[{id:10,path:'.github/workflows/test.yml',jobs:[]}]},
    {workflows:[...policy().workflows,...policy().workflows]}])assert.throws(()=>ciPolicy(p));
});
test('schema migration preserves v1 active jobs and result receipts and supports distinct repair iterations',t=>{
  const dir=mkdtempSync(join(tmpdir(),'ci-migration-')),file=join(dir,'state.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const db=new DatabaseSync(file);
  db.exec(`CREATE TABLE requests(id TEXT PRIMARY KEY,project TEXT NOT NULL,owner TEXT NOT NULL,chat TEXT NOT NULL,record TEXT NOT NULL) STRICT;
    INSERT INTO requests VALUES('R','P','O','C','{}');
    CREATE TABLE jobs(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL REFERENCES requests(id),revision INTEGER NOT NULL,kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, worker TEXT,token TEXT,expires INTEGER,deadline INTEGER,result_hash TEXT,UNIQUE(request_id,revision,kind)) STRICT;
    CREATE INDEX jobs_queue ON jobs(status,kind,id);
    INSERT INTO jobs VALUES(7,'R',1,'implement','done',1,'worker','token',100,200,'receipt'); PRAGMA user_version=1;`);db.close();
  let s=new Store(file); assert.equal(s.get('SELECT * FROM jobs WHERE id=7').result_hash,'receipt');
  s.run("INSERT INTO jobs(request_id,revision,kind,iteration) VALUES('R',1,'implement',1)"); s.close();
  s=new Store(file); assert.equal(s.all('SELECT * FROM jobs').length,2);assert.equal(s.get('PRAGMA user_version').user_version,2);s.close();
});
test('operator endpoint and loop call the CI observer without opening a deployment route',async t=>{
  const f=setup(t); f.config.operatorTokenEnv='OPS'; const app=createApp(f.core,{github:f.github},{OPS:'o'.repeat(40)});
  await new Promise(r=>app.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>app.close(r)));
  const url=`http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(url+'/ops/reconcile',{method:'POST'})).status,401);
  const res=await fetch(url+'/ops/reconcile',{method:'POST',headers:{Authorization:'Bearer '+'o'.repeat(40)}});
  assert.equal(res.status,200); assert.equal(f.store.request(f.id).ci.status,'passed');
  const loops=startLoops(f.core,{github:f.github}); loops.stop(); await loops.checkCi();
  assert.equal((await fetch(url+'/deploy',{method:'POST'})).status,404);
});


test('stop during an in-flight CI read cannot enqueue a repair or publish a new observation', async t => {
  const f = setup(t, 2); f.fail(); const abort = new AbortController();
  f.readHook = () => abort.abort();
  assert.deepEqual(await refreshCi(f.core, f.github, abort.signal), { observed: 0 });
  assert.equal(f.store.request(f.id).ci, undefined);
  assert.equal(f.store.request(f.id).state, 'PR_READY');
  assert.equal(f.core.claim(f.config.workers[0]), null);
});
test('exhausted global job budget does not claim that a CI repair was queued', async t => {
  const f = setup(t, 2); f.core.maxJobs = 3; f.fail(); await f.refresh();
  const r = f.store.request(f.id);
  assert.equal(r.state, 'BLOCKED'); assert.equal(r.blocker, 'job_budget_exhausted');
  assert.equal(f.core.claim(f.config.workers[0]), null);
  assert.equal(f.store.all("SELECT event FROM audit ORDER BY id DESC LIMIT 1")[0].event, 'ci_repair_budget_exhausted');
});


test('revised requirements during CI read cannot receive the old repair or observation', async t => {
  const f = setup(t, 2); f.fail(); let once = false;
  f.readHook = () => {
    if (once) return; once = true;
    f.core.ingest('concurrent', [{ id: 'revise', type: 'message', actor: 'alice', chat: 'chat', text: `/changes ${f.id} Different wording` }]);
  };
  await f.refresh();
  const r = f.store.request(f.id);
  assert.equal(r.revision, 2); assert.equal(r.state, 'TRIAGING'); assert.equal(r.ci, undefined);
  assert.equal(r.approval, undefined); assert.equal(r.iteration, 0);
});
test('HTTP operator CI observation honors service shutdown, not just the timer loop', async t => {
  const f = setup(t, 2); f.fail(); const abort = new AbortController();
  f.config.operatorTokenEnv = 'OPS';
  const app = createApp(f.core, { github: f.github }, { OPS: 'o'.repeat(40) }, { signal: abort.signal });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => app.close(r)));
  f.readHook = () => abort.abort();
  const url = `http://127.0.0.1:${app.address().port}`;
  const res = await fetch(url + '/ops/reconcile', { method: 'POST', headers: { Authorization: 'Bearer ' + 'o'.repeat(40) } });
  assert.equal(res.status, 200); assert.equal(f.store.request(f.id).state, 'PR_READY');
  assert.equal(f.store.request(f.id).ci, undefined);
  assert.equal((await fetch(url + '/healthz')).status, 503);
});
