import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectStore } from '../lib/projects.mjs';
import { workspaceStore } from '../lib/workspaces.mjs';
import { createServer } from '../server.mjs';
import { fixture, zip } from './fixture.mjs';

const headers={'X-Elma-Wiki-Request':'1','Content-Type':'application/json'};
async function setup(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'e365-workspace-test-'));
  const projects=projectStore(directory),workspaces=workspaceStore(projects),bytes=await fixture(),p=await projects.create('local',bytes);
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('e365-workspace-test-'));await fs.rm(directory,{recursive:true,force:true});});
  return {directory,projects,workspaces,bytes,p,object:'object-0'};
}
test('workspace preserves original and unknown artifacts; checkpoints survive restart; stale saves cannot overwrite',async t=>{
  const {directory,projects,workspaces,bytes,p,object}=await setup(t);
  const initial=await workspaces.read(p.id,'local',object);assert.equal(initial.revision,0);assert.equal(initial.capabilities.deploy,false);assert.match(initial.origins['client.ts'],/#\/descriptor\/clientScripts/);
  const changed={...initial.files,'client.ts':'function onOpen() { Context.data.title = "new"; }'};
  const saved=await workspaces.save(p.id,'local',object,{revision:0,files:changed});assert.equal(saved.revision,1);
  await assert.rejects(workspaces.save(p.id,'local',object,{revision:0,files:initial.files}),e=>e.status===409);
  const checkpoint=await workspaces.checkpoint(p.id,'local',object,{revision:1,label:'Проверка заголовка'});
  const again=workspaceStore(projectStore(directory));assert.deepEqual((await again.read(p.id,'local',object)).files,changed);
  let next=await again.save(p.id,'local',object,{revision:checkpoint.revision,files:{...changed,'client.ts':'const wrong: number = "text";'}});
  next=await again.restore(p.id,'local',object,{revision:next.revision,checkpoint:checkpoint.checkpoints[0].id});assert.deepEqual(next.files,changed);
  next=await again.restore(p.id,'local',object,{revision:next.revision,checkpoint:'original'});assert.deepEqual(next.files,initial.files);assert.equal(next.check,null);
  assert.deepEqual(await projects.original(p.id,'local'),bytes);
  const report=await projects.read(p.id,'local','report');assert.ok(report.diagnostics.some(d=>d.status==='unindexed'));
});
test('TypeScript reports field, RPC and type errors at editable source; lint stays separate; edits invalidate check',async t=>{
  const {workspaces,p,object}=await setup(t),initial=await workspaces.read(p.id,'local',object);
  let state=await workspaces.save(p.id,'local',object,{revision:0,files:{'client.ts':'async function onOpen() {\n Context.data.unknownField;\n await Server.rpc.missing();\n const n: number = "text";\n eval("1");\n}', 'server.ts':'async function check() { return Context.data.title; }'}});
  state=await workspaces.check(p.id,'local',object,{revision:state.revision});assert.equal(state.check.typescript,'failed');assert.equal(state.check.elmaCompiler,'unavailable');
  const diagnostics=state.check.diagnostics;assert.ok(diagnostics.some(d=>d.code==='TS2339' && d.startLineNumber===2));assert.ok(diagnostics.some(d=>d.code==='TS2339' && d.startLineNumber===3));assert.ok(diagnostics.some(d=>d.code==='TS2322' && d.startLineNumber===4));assert.ok(diagnostics.some(d=>d.category==='lint' && d.severity==='warning'));
  state=await workspaces.save(p.id,'local',object,{revision:state.revision,files:initial.files});assert.equal(state.check,null);
  state=await workspaces.check(p.id,'local',object,{revision:state.revision});assert.equal(state.check.typescript,'passed',JSON.stringify(state.check.diagnostics));assert.match(state.types.client,/"check"/);
  state=await workspaces.save(p.id,'local',object,{revision:state.revision,files:{...initial.files,'server.ts':'function check() { ViewContext.data.title; document.title; }'}});
  state=await workspaces.check(p.id,'local',object,{revision:state.revision});assert.ok(state.check.diagnostics.some(d=>d.file==='server.ts' && /ViewContext/.test(d.message)));assert.ok(state.check.diagnostics.some(d=>d.file==='server.ts' && /document/.test(d.message)));
});
test('workspace never resolves uploaded imports from filesystem or executes code',async t=>{
  const {workspaces,p,object}=await setup(t);
  const state=await workspaces.save(p.id,'local',object,{revision:0,files:{'client.ts':'import fs from "node:fs"; import x from "../../server.mjs"; globalThis.TEST_EXECUTED = true;', 'server.ts':'function check() { throw Error("uploaded code must never run"); }'}});
  const checked=await workspaces.check(p.id,'local',object,{revision:state.revision});assert.equal(checked.check.typescript,'failed');assert.ok(checked.check.diagnostics.some(d=>d.code==='TS2307'));assert.equal(globalThis.TEST_EXECUTED,undefined);
});
test('workspace API checks owner, mutation protections, source allowlist and conflicts',async t=>{
  const {directory,projects,p,object}=await setup(t),server=createServer({directory,clientId:'',clientSecret:''});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port,request=(route,options)=>fetch(base+route,options),endpoint=`/api/projects/${p.id}/workspace/${object}`;
  const login=await request('/auth/local',{method:'POST',headers}),cookie=login.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await request(endpoint)).status,404);assert.equal((await request(`/workspace/${p.id}/${object}`)).status,404);
  const initial=await (await request(endpoint,{headers:{cookie}})).json();assert.equal((await request(`/workspace/${p.id}/${object}`,{headers:{cookie}})).status,200);
  const payload=JSON.stringify({revision:0,files:initial.files});
  for(const bad of [{cookie,'Content-Type':'application/json'},{...headers,cookie,Origin:'https://attacker.example'}]) assert.equal((await request(endpoint+'/save',{method:'POST',headers:bad,body:payload})).status,403);
  assert.equal((await request(endpoint+'/save',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({revision:0,files:{...initial.files,'../runtime.js':'bad'}})})).status,400);
  const changed={...initial.files,'client.ts':'Context.data.title;'};
  assert.equal((await request(endpoint+'/save',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({revision:0,files:changed})})).status,200);
  assert.equal((await request(endpoint+'/save',{method:'POST',headers:{...headers,cookie},body:payload})).status,409);
  const other=await projects.create('other-owner',await fixture());
  for(const suffix of ['', '/save','/check','/checkpoint','/restore']) assert.equal((await request(`/api/projects/${other.id}/workspace/${object}`+suffix,suffix ? {method:'POST',headers:{...headers,cookie},body:payload} : {headers:{cookie}})).status,404);
  const unsupported=await projects.create('local',await zip([['package.json',{code:'fixture'}],['widgets/manifest.json',{entities:[{kind:'PROCESS',code:'process',namespace:'fixture',path:'process'}]}],['widgets/process',{descriptor:{clientScripts:'Context.data.title;'}}]]));
  assert.equal((await request(`/api/projects/${unsupported.id}/workspace/object-0`,{headers:{cookie}})).status,422);
  assert.equal((await request(endpoint+'/restore',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({revision:1,checkpoint:'../../state.json'})})).status,404);
});
test('sidecar TypeScript wins over descriptor source; opaque projects remain unsupported',async t=>{
  const {projects,workspaces}=await setup(t),bytes=await zip([['package.json',{code:'fixture'}],['widgets/manifest.json',{entities:[{kind:'WIDGET',code:'form',namespace:'fixture',path:'form'}]}],['widgets/form',{descriptor:{fields:[],clientScripts:'OLD',serverScripts:''}}],['widgets/form.client.ts','const n: number = 1;'],['untouched.bin',Buffer.from([1,2,3])]]);
  const p=await projects.create('local',bytes),state=await workspaces.read(p.id,'local','object-0');assert.equal(state.files['client.ts'],'const n: number = 1;');assert.equal(state.origins['client.ts'],'widgets/form.client.ts');
  await assert.rejects(workspaces.read(p.id,'other','object-0'),/Проект не найден/);
  const opaque=await projects.create('local',await zip([['package.json',{code:'paid'}],['data','opaque']]));await assert.rejects(workspaces.read(opaque.id,'local','object-0'),e=>e.status===422);
});
