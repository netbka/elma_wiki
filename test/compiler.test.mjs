import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileScript,typescriptVersion } from '../lib/widget-compiler.mjs';
import { buildDtsRequest } from '../lib/widget-context.mjs';
import { projectStore } from '../lib/projects.mjs';
import { workspaceStore } from '../lib/workspaces.mjs';
import { installSyntheticProfile } from './compiler-fixture.mjs';
import { zip } from './fixture.mjs';

async function context(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'e365-compiler-test-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('e365-compiler-test-'));await fs.rm(directory,{recursive:true,force:true});});
  const projects=projectStore(directory),workspaces=workspaceStore(projects);
  const own=[{code:'localTitle',type:'STRING'},{code:'secret',type:'STRING',view:{hidden:true}},{code:'click',type:'EVENT'}],bound=[{code:'appTitle',type:'STRING'}];
  const bytes=await zip([['package.json',{code:'synthetic'}],['widgets/manifest.json',{entities:[{code:'form',namespace:'synthetic.records',kind:'WIDGET',path:'form'}]}],['widgets/form',{dataNamespace:'synthetic',dataCode:'records',descriptor:{dataFieldCode:'item',fields:own,clientScripts:'async function open() { Context.data.appTitle; ViewContext.data.localTitle; await Server.rpc.check(); }',serverScripts:'async function check(): Promise<void> { Context.data.appTitle; ViewContext.data.localTitle; }'}}],['appViews/manifest.json',{entities:[{code:'records',namespace:'synthetic',kind:'APPLICATION',path:'records'}]}],['appViews/records',{fields:bound}]]);
  const project=await projects.create('local',bytes);
  return {directory,projects,workspaces,project,bound,own};
}
test('platform compiler preserves worker wrapping and declaration quirks with pinned TS',()=>{
  assert.equal(typescriptVersion,'5.9.3');
  const server=compileScript({source:'/* comment */ async function check(a: string): Promise<void> { }',runtime:'server',dts:''});
  assert.equal(server.scripts,'async function check(a) { }\n');assert.deepEqual(server.fnDeclarations,[{name:'check',parameters:[{name:'[object Object]',type:'[object Object]'}],type:'[object Object]'}]);
  const client=compileScript({source:'async function open(): Promise<void> {}',runtime:'client',dts:''});assert.equal(client.ok,true);assert.match(client.scripts,/System\.register/);assert.match(client.scripts,/default_1\(Context, ViewContext, Server, System\)/);
  const failed=compileScript({source:'function f(x) { return x; }',runtime:'server',dts:''});assert.equal(failed.ok,false);assert.equal(failed.errors[0].code,7006);assert.equal(failed.scripts,undefined);
});
test('DTS contract distinguishes bound app Context from ViewContext and filters side-specific fields',()=>{
  const raw={namespace:'synthetic.records',descriptor:{dataFieldCode:'item',fields:[{code:'viewField',type:'STRING'},{code:'hidden',type:'STRING',view:{hidden:true}},{code:'event',type:'EVENT'}]}};
  const client=buildDtsRequest(raw,'client',[{code:'appField',type:'STRING'}],['check']);
  assert.deepEqual(client.fields.map(f=>f.code),['appField']);assert.deepEqual(client.extraContexts[0].fields.map(f=>f.code),['viewField','event']);assert.deepEqual(client.serverRPC.functions,[{name:'check'}]);
  const server=buildDtsRequest(raw,'server',[{code:'appField',type:'STRING'}]);assert.equal(server.allowServer,false);assert.equal(server.serverRPC,undefined);assert.deepEqual(server.extraContexts[0].fields.map(f=>f.code),['viewField']);
});
test('offline compiler uses only the project SDK and invalidates evidence when profile, RPC or snapshot changes',async t=>{
  const c=await context(t),{directory,projects,workspaces,project,bound}=c;
  let state=await workspaces.read(project.id,'local','object-0');assert.equal(state.capabilities.elmaCompiler,false);assert.match(state.types.client,/"appTitle"/);assert.match(state.types.client,/"localTitle"/);assert.ok(!state.types.server.includes('"click"'));
  const {root,profile}=await installSyntheticProfile({...c,boundFields:bound});
  state=await workspaces.read(project.id,'local','object-0');assert.equal(state.capabilities.elmaCompiler,true);assert.equal(state.types.mode,'platform-sdk');
  state=await workspaces.check(project.id,'local','object-0',{revision:state.revision});assert.equal(state.check.elmaCompiler,'passed',JSON.stringify(state.check));assert.equal(state.check.compilerProfile.host,'https://target.example');
  const dts=Object.keys(profile.entries)[0];await fs.appendFile(path.join(root,dts+'.d.ts'),'// modified');
  state=await workspaces.read(project.id,'local','object-0');assert.equal(state.capabilities.elmaCompiler,false);assert.equal(state.check,null);
  await installSyntheticProfile({...c,boundFields:bound});
  state=await workspaces.save(project.id,'local','object-0',{revision:state.revision,files:{...state.files,'client.ts':'async function open() { ViewContext.data.appTitle; }'}});
  state=await workspaces.check(project.id,'local','object-0',{revision:state.revision});assert.equal(state.check.elmaCompiler,'failed');assert.ok(state.check.diagnostics.some(d=>d.category==='elma-compiler' && d.file==='client.ts' && d.startLineNumber===1));
  state=await workspaces.save(project.id,'local','object-0',{revision:state.revision,files:{...state.files,'server.ts':state.files['server.ts']+'\nasync function newRPC(): Promise<void> {}'}});assert.equal(state.capabilities.elmaCompiler,false);assert.equal(state.check,null);
  await fs.writeFile(path.join(root,'profile.json'),JSON.stringify({...profile,sourceChecksum:'0'.repeat(64)}));assert.equal((await workspaces.read(project.id,'local','object-0')).capabilities.elmaCompiler,false);
  await assert.rejects(workspaces.read(project.id,'another-owner','object-0'),/Проект не найден/);
});
test('compiler cannot read referenced filesystem files or accept missing SDK inputs',()=>{
  const result=compileScript({source:'/// <reference path="../../server.mjs" />\nimport fs from "node:fs";\nContext.data.title;',runtime:'client',dts:'declare const Context: {data:{title:string}};'});
  assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.code===2307 || e.code===6053));
});
