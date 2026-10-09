import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from './fixture.mjs';
import { parseProject } from '../lib/project-parser.mjs';
import { parseManagedArtifact, createManagedWorkspace, previewReconciliation } from '../lib/managed-workspace.mjs';
import { snapshotVisual } from '../lib/solution-visual.mjs';
const pack = (service, records, files, extra = []) => zip([['package.json',{code:'native_fixture',type:'SOLUTION'}],
  [service+'/manifest.json',{Service:service,number:1,entities:records}],...files.map(([p,b])=>[service+'/'+p,b]),...extra]);
const record=(code,kind,path,resources=null)=>({code,namespace:'synthetic',kind,path,resources});
test('observed empty native service manifests do not invent unknown components',async()=>{
  const a=await parseManagedArtifact(await pack('babysitter',[],[]),{scope:'full'});
  assert.deepEqual(a.ambiguities,[]);assert.equal(a.components.length,0);
  const unknown=await parseManagedArtifact(await pack('future_service',[],[]),{scope:'full'});
  assert.ok(unknown.ambiguities.some(x=>x.reason==='unknown'));
});
test('kind distinguishes native permission and process components while exact duplicate identities remain blocked',async()=>{
  const rows=[record('app','permissionSettings','settings.json'),record('app','pagePermissions','page.json')];
  const bytes=await pack('permissionsSettings',rows,[['settings.json',{Code:'app',settings:{}}],['page.json',{Code:'app',permissions:{}}]]);
  const a=await parseManagedArtifact(bytes,{scope:'full'});assert.equal(a.components.length,2);assert.deepEqual(a.ambiguities,[]);
  assert.notEqual(a.components[0].key,a.components[1].key);
  const duplicate=await parseManagedArtifact(await pack('permissionsSettings',[rows[0],{...rows[0],path:'other.json'}],[['settings.json',{}],['other.json',{}]]),{scope:'full'});
  assert.ok(duplicate.ambiguities.some(x=>x.reason==='duplicate-identity'));
  const state=createManagedWorkspace(a,{name:'Native',baselineOwner:'Owner'});
  const legacy={...state,artifacts:state.artifacts.map(x=>({...x,identityVersion:1}))};
  await assert.rejects(async()=>previewReconciliation(legacy,await parseManagedArtifact(bytes,{scope:'full'})),/identity profile/);
});
test('localization singleton preserves null payload and declared translation bytes',async()=>{
  const r=record('','localization','translations.json',[{path:'ru.po',kind:'localization'}]);
  const bytes=await pack('localizer',[r],[['translations.json','null'],['ru.po','msgid "synthetic"\nmsgstr "пример"']]);
  const parsed=await parseProject(bytes);assert.equal(parsed.files.get('localizer/translations.json').toString(),'null');
  const a=await parseManagedArtifact(bytes,{scope:'full'});assert.deepEqual(a.ambiguities,[]);assert.equal(a.components.length,1);
  assert.ok(a.components[0].evidence.some(x=>x.source==='localizer/ru.po'));
  const changed=await parseManagedArtifact(await pack('localizer',[r],[['translations.json','null'],['ru.po','changed']]),{scope:'full'});
  assert.notEqual(a.components[0].digest,changed.components[0].digest);
  const missing=await parseManagedArtifact(await pack('localizer',[r],[['translations.json','null']]),{scope:'full'});
  assert.throws(()=>createManagedWorkspace(missing,{name:'Missing',baselineOwner:'Owner'}),/Ambiguous/);
});
test('unknown kinds, malformed entities, unsafe resource paths and undeclared bytes stay blocked',async()=>{
  for(const [r,body,extra]of [[record('app','future','a.json'),{},[]],[record('app','page','a.json'),'bad-json',[]],
    [record('app','page','a.json',[{path:'../escape'}]),{},[]],[record('app','page','a.json'),{},[['pages/unowned.bin',Buffer.from([1])]]]]){
    const a=await parseManagedArtifact(await pack('pages',[r],[['a.json',body]],extra),{scope:'full'});
    assert.throws(()=>createManagedWorkspace(a,{name:'Blocked',baselineOwner:'Owner'}),/Ambiguous/);
  }
});
test('typed native process visual anchors match captured component identity',async()=>{
  const r=record('approval','template','approval.json',[]),body={process:{items:{start:{id:'start',type:'start'}},transitions:[],lanes:[]},context:[]};
  const bytes=await pack('processor',[r],[['approval.json',body]]);
  const a=await parseManagedArtifact(bytes,{scope:'full'}),v=await snapshotVisual(bytes,a.id);
  assert.equal(JSON.stringify(v.processes[0].object),a.components[0].key);
});
