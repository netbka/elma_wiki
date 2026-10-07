import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { projectStore } from '../lib/projects.mjs';
import { parseProject } from '../lib/project-parser.mjs';
import { fixture, zip } from './fixture.mjs';
const headers = {'X-Elma-Wiki-Request':'1'};
async function instance(t,options={}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'e365-project-test-'));
  const server = createServer({directory,clientId:'',clientSecret:'',...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{ await new Promise(resolve=>server.close(resolve)); assert.equal(path.dirname(directory),path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('e365-project-test-')); await fs.rm(directory,{recursive:true,force:true}); });
  return {directory,server,base:`http://127.0.0.1:${server.address().port}`,request:(route,options)=>fetch(`http://127.0.0.1:${server.address().port}`+route,options)};
}
async function login(request) { const r=await request('/auth/local',{method:'POST',headers}); assert.equal(r.status,200); return r.headers.getSetCookie()[0].split(';')[0]; }
async function upload(request,cookie,bytes) { bytes ||= await fixture(); return request('/api/projects?filename=example.e365',{method:'POST',headers:{...headers,cookie,'Content-Type':'application/octet-stream'},body:bytes}); }
test('public synthetic showcase; upload only, no empty portal or repository API',async t=>{
  const {request}=await instance(t);
  assert.equal((await request('/')).status,200);
  const demo=await (await request('/p/showcase/data.json')).json(); assert.equal(demo.synthetic,true); assert.equal(demo.entities.length,6);
  assert.equal((await request('/api/projects')).status,401);
  for (const route of ['/api/portals','/api/github/inspect']) assert.equal((await request(route,{method:'POST',headers,body:'{}'})).status,404);
  const cookie=await login(request); assert.equal((await request('/api/projects',{method:'POST',headers:{...headers,cookie,'Content-Type':'application/json'},body:'{}'})).status,415);
});
test('duplicate uploads have separate UUIDs; original, report, reparse, restart and delete',async t=>{
  const {request,directory}=await instance(t),cookie=await login(request),bytes=await fixture();
  const a=await (await upload(request,cookie,bytes)).json(),b=await (await upload(request,cookie,bytes)).json();
  assert.notEqual(a.id,b.id); assert.match(a.id,/^[0-9a-f-]{36}$/);
  const original=Buffer.from(await (await request(`/api/projects/${a.id}/original`,{headers:{cookie}})).arrayBuffer()); assert.deepEqual(original,bytes);
  const store=projectStore(directory); assert.equal((await store.list('local')).length,2); assert.equal((await store.read(a.id,'local')).entities.length,1);
  const restarted=createServer({directory,clientId:'',clientSecret:'',allowLocal:true});
  await new Promise(resolve=>restarted.listen(0,'127.0.0.1',resolve));
  try { const again=(route,options)=>fetch(`http://127.0.0.1:${restarted.address().port}`+route,options),newCookie=await login(again); assert.equal((await (await again('/api/projects',{headers:{cookie:newCookie}})).json()).length,2); }
  finally { await new Promise(resolve=>restarted.close(resolve)); }
  const r=await request(`/api/projects/${a.id}/reparse`,{method:'POST',headers:{...headers,cookie}}); assert.equal(r.status,200);
  assert.equal((await request(`/api/projects/${a.id}`,{method:'DELETE',headers:{...headers,cookie}})).status,200);
  assert.equal((await store.list('local')).length,1); assert.equal((await request(`/api/projects/${a.id}/original`,{headers:{cookie}})).status,404);
  assert.deepEqual(await store.original(b.id,'local'),bytes);
});
test('all project surfaces check owner, including mutation and original bytes',async t=>{
  const {request,directory}=await instance(t),cookie=await login(request),p=await projectStore(directory).create('github:999',await fixture());
  for (const route of [`/p/${p.id}/`,`/p/${p.id}/data.json`,...['data','report','original','preview?path=package.json','diagnostic-summary'].map(s=>`/api/projects/${p.id}/${s}`)]) {
    for (const auth of [{},{cookie}]) assert.equal((await request(route,{headers:auth})).status,404,route);
  }
  assert.equal((await request(`/api/projects/${p.id}/reparse`,{method:'POST',headers:{...headers,cookie}})).status,404);
  assert.equal((await request(`/api/projects/${p.id}`,{method:'DELETE',headers:{...headers,cookie}})).status,404);
  assert.equal((await (await request('/api/projects',{headers:{cookie}})).json()).length,0);
});
test('mixed archive keeps known objects and original unknown/malformed fragments',async()=>{
  const bytes=await zip([
    ['package.json',{code:'example',serverVersion:'2026.7.23',solution:{isAuthor:false}}],
    ['widgets/manifest.json',{entities:[{code:'good',namespace:'example.records',path:'good'},{code:'bad',namespace:'example.records',path:'bad'},{code:'missing',namespace:'example.records',path:'absent'}]}],
    ['widgets/good',{descriptor:{fields:[{code:'title',type:'STRING'}]},future:{x:1}}],['widgets/bad','{invalid'],
    ['future/manifest.json',{unexpected:true}],['extra.html','<script>globalThis.pwned=true</script>']
  ]);
  const parsed=await parseProject(bytes); assert.equal(parsed.data.entities.length,1); assert.equal(parsed.report.status,'partial');
  for (const status of ['malformed','missing','unknown','unindexed']) assert.ok(parsed.report.diagnostics.some(d=>d.status===status),status);
  assert.equal(parsed.data.provenance.isAuthor.value,false); assert.equal(parsed.data.provenance.isAuthor.source,'package.json#/solution/isAuthor');
  assert.ok(parsed.report.diagnostics.every(d=>d.path && d.reason && d.parserVersion)); assert.ok(parsed.files.has('extra.html'));
});
test('opaque data does not pretend to be an editable or empty successful project',async()=>{
  const parsed=await parseProject(await zip([['package.json',{code:'example',solution:{isAuthor:'false'}}],['data',Buffer.from([0,1,2])]]));
  assert.equal(parsed.report.status,'opaque');assert.equal(parsed.data.provenance.isAuthor.status,'unknown');assert.equal(parsed.data.entities.length,0);assert.ok(parsed.report.diagnostics.some(d=>d.path==='data' && d.status==='opaque'));
});
test('unsafe encryption, symlink and corrupted CRC reject the archive before project creation',async t=>{
  const {directory}=await instance(t),store=projectStore(directory),original=await fixture();
  const central=original.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);
  for (const mutate of [b=>b.writeUInt16LE(b.readUInt16LE(central+8)|1,central+8),b=>b.writeUInt32LE((0xa1ff<<16)>>>0,central+38),b=>b.writeUInt32LE((b.readUInt32LE(central+16)^1)>>>0,central+16)]) {
    const bytes=Buffer.from(original);mutate(bytes);await assert.rejects(store.create('local',bytes));
  }
  assert.deepEqual(await store.list('local'),[]);
});
test('failed reparse preserves previous index and verifies immutable checksum',async t=>{
  const {directory}=await instance(t),store=projectStore(directory),p=await store.create('local',await fixture());
  const before=await store.read(p.id,'local'); await fs.writeFile(path.join(directory,'projects',p.id,'original.e365'),'corruption');
  await assert.rejects(store.reparse(p.id,'local'),/Контрольная/); assert.deepEqual(await store.read(p.id,'local'),before);
});
test('invalid archive creates no project; preview is private JSON text and diagnostic export has no paths',async t=>{
  const {request}=await instance(t),cookie=await login(request);
  assert.equal((await upload(request,cookie,Buffer.from('not ZIP'))).status,400);
  assert.deepEqual(await (await request('/api/projects',{headers:{cookie}})).json(),[]);
  const bytes=await zip([['package.json',{code:'example'}],['extra.html','<script>globalThis.pwned=true</script>']]),p=await (await upload(request,cookie,bytes)).json();
  const preview=await request(`/api/projects/${p.id}/preview?path=extra.html`,{headers:{cookie}}); assert.match(preview.headers.get('content-type'),/application\/json/); assert.equal((await preview.json()).text,'<script>globalThis.pwned=true</script>');
  const summary=await (await request(`/api/projects/${p.id}/diagnostic-summary`,{headers:{cookie}})).json(); assert.deepEqual(Object.keys(summary).sort(),['counts','files','indexedEntities','parserVersion','status']);
  assert.equal((await request(`/api/projects/${p.id}/preview?path=../../project.json`,{headers:{cookie}})).status,400);
});
test('CSRF and host restrictions apply to every write',async t=>{
  const {request,base}=await instance(t),cookie=await login(request),bytes=await fixture();
  for (const extra of [{}, {...headers,Origin:'https://other.example'}]) assert.equal((await request('/api/projects',{method:'POST',headers:{cookie,'Content-Type':'application/octet-stream',...extra},body:bytes})).status,403);
  const status=await new Promise((resolve,reject)=>{ const req=http.request(base,{headers:{Host:'attacker.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(); });assert.equal(status,403);
});
test('GitHub OAuth requests identity only and replay is rejected',async t=>{
  const calls=[];
  const {request}=await instance(t,{clientId:'example-client',clientSecret:'example-secret',fetchImpl:async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>url.endsWith('/user')?{id:42,login:'example-user'}:{access_token:'synthetic-token'}};}});
  const first=await request('/auth/github',{redirect:'manual'}),target=new URL(first.headers.get('location'));
  assert.equal(target.searchParams.get('scope'),'read:user'); assert.equal(target.searchParams.get('code_challenge_method'),'S256');
  const cookie=first.headers.getSetCookie()[0].split(';')[0],callback='/auth/github/callback?code=example&state='+target.searchParams.get('state');
  const result=await request(callback,{headers:{cookie},redirect:'manual'});assert.equal(result.status,302);assert.equal(calls.length,2);
  const session=await (await request('/api/session',{headers:{cookie:result.headers.getSetCookie().find(s=>s.startsWith('elma_session=')).split(';')[0]}})).json(); assert.equal(session.user.id,'github:42');assert.ok(!JSON.stringify(session).includes('synthetic-token'));
  assert.equal((await request(callback,{headers:{cookie},redirect:'manual'})).status,400);
});
test('legacy owner indexes remain accessible and are explicitly marked without originals',async t=>{
  const {request,directory}=await instance(t),cookie=await login(request),id='10000000-0000-4000-8000-000000000000';
  await fs.writeFile(path.join(directory,'portals.json'),JSON.stringify([{id,owner:'local',name:'Legacy'}]));await fs.mkdir(path.join(directory,'portals',id),{recursive:true});await fs.writeFile(path.join(directory,'portals',id,'data.json'),JSON.stringify({readOnly:true,servers:{local:{entities:[],solutions:[]}}}));
  const list=await (await request('/api/projects',{headers:{cookie}})).json();assert.equal(list[0].legacy,true);
  assert.equal((await (await request(`/p/${id}/data.json`,{headers:{cookie}})).json()).legacy,true);
  assert.equal((await request(`/api/projects/${id}/original`,{headers:{cookie}})).status,404);
});
