import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { visualSource } from '../web/visual/fixtures.js';
import { zip } from './fixture.mjs';

export const explanationArchive = raw => zip([
  ['package.json',{code:'synthetic_explanation',type:'SOLUTION'}],
  ['processor/manifest.json',{entities:[{code:'approval',namespace:'synthetic.processes',name:'Учебное согласование',path:'approval.json',kind:'PROCESS'}]}],
  ['processor/approval.json',raw]
]);
const secret='SYNTHETIC_EXPLANATION_LOGIN_SECRET';
async function setup(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wiki-explanation-'));
  let server;
  const start=async()=>{
    server=createServer({directory,sendEmail:undefined,sendVk:Object.assign(async()=>{},{domain:'example.org',linkSecret:secret}),bugPublisher:null});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  };
  const close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  await start(); t.after(async()=>{await close();await fs.rm(directory,{recursive:true,force:true});});
  const request=(route,cookie,options={})=>fetch(`http://127.0.0.1:${server.address().port}${route}`,{...options,headers:{...(cookie?{cookie}:{}),...options.headers}});
  const json=async(response,status=200)=>{const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;};
  const post=(route,cookie,input,headers={})=>request(route,cookie,{method:'POST',headers:{'X-Elma-Wiki-Request':'1','Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  const login=async email=>{
    const link=new URL(vkLoginLinks({secret,domain:'example.org',baseUrl:'http://127.0.0.1:43171'}).issue(email));
    const response=await request(link.pathname+link.search,null,{redirect:'manual'});
    assert.equal(response.status,303);const cookie=response.headers.getSetCookie()[0].split(';')[0];
    return {cookie,user:(await json(await request('/api/session',cookie))).user};
  };
  const upload=async(cookie,raw=visualSource)=>json(await request('/api/solutions/uploads?filename=synthetic.e365',cookie,{method:'POST',headers:{'X-Elma-Wiki-Request':'1','Content-Type':'application/octet-stream'},body:await explanationArchive(raw)}),201);
  const ref=(project,scope)=>({projectId:project.id,snapshotId:project.currentSnapshotId,scope,scopeConfirmed:true});
  const create=async cookie=>json(await post('/api/solutions',cookie,{name:'Учебное решение',baselineOwner:'Vendor',snapshot:ref(await upload(cookie),'full')}),201);
  const save=(target,result,text=result.draft.text)=>({...target,text,expectedRevision:result.expectedRevision,expectedVersion:result.version,expectedFingerprint:result.fingerprint});
  return {directory,request,json,post,login,upload,ref,create,save,restart:async()=>{await close();await start();}};
}
const source='processor/approval.json';
const step=state=>({scope:'step',artifactId:state.baselineId,source,nodeId:'review'});
const url=(id,target)=>`/api/solutions/${id}/explanations?`+new URLSearchParams(target);

test('explanations use captured source, persist edited text and trusted actors across restart without changing review state',async t=>{
  const {request,json,post,login,create,save,restart}=await setup(t);
  let a=await login('alice@example.org'), b=await login('bob@example.org');
  const state=await create(a.cookie), route=`/api/solutions/${state.id}/explanations`, target=step(state);
  const result=await json(await request(url(state.id,target),b.cookie));
  assert.match(result.draft.text,/Согласовать/);assert.match(result.draft.text,/Вернуть → Исправить/);
  assert.match(result.draft.text,/Документ \(обязательное по экспорту\)/);assert.match(result.draft.text,/не установлены/);
  assert.ok(result.draft.sources.some(row=>row.pointer.includes('/forms/0')));
  assert.equal(result.draft.nativeObservation,'absent');assert.equal(result.version,0);
  const saved=await json(await post(route,b.cookie,save(target,result,'Проверенное человеком пояснение <script>never()</script>')));
  assert.equal(saved.version,1);assert.deepEqual(saved.saved.actor,b.user);assert.equal(saved.saved.sourceStatus,'current');
  const after=await json(await request('/api/solutions/'+state.id,a.cookie));
  assert.equal(after.revision,state.revision);assert.deepEqual(after.history,state.history);assert.deepEqual(after.pending,state.pending);
  assert.equal(after.audit.at(-1).action,'explanation-saved');
  await restart(); a=await login('alice@example.org');
  const restored=await json(await request(url(state.id,target),a.cookie));
  assert.equal(restored.saved.text,saved.saved.text);assert.deepEqual(restored.saved.actor,b.user);
  const changed=await json(await post(route,a.cookie,save(target,restored,'Дополненное объяснение')));
  assert.equal(changed.history.length,2);assert.deepEqual(changed.saved.actor,a.user);
  assert.equal(changed.history[1].text,saved.saved.text);
});

test('explanation writes reject forged identity, stale revisions, concurrent overwrite, archive and cross-root references',async t=>{
  const {request,json,post,login,create,save}=await setup(t);
  const a=await login('alice@example.org'), b=await login('bob@example.org'), state=await create(a.cookie);
  const route=`/api/solutions/${state.id}/explanations`, target=step(state), read=()=>request(url(state.id,target),a.cookie);
  const result=await json(await read());
  await json(await request(url(state.id,target),null),404);
  await json(await post(route,null,save(target,result)),404);
  await json(await post(route,a.cookie,{...save(target,result),actor:b.user}),400);
  await json(await post(route,a.cookie,save(target,result),{Origin:'https://untrusted.example'}),403);
  await json(await post(route,a.cookie,save(target,result),{'X-Elma-Wiki-Request':'0'}),403);
  await json(await post(route,a.cookie,{...save(target,result),expectedFingerprint:'forged'}),409);
  await json(await post(route,a.cookie,{...save(target,result),text:' '}),400);
  await json(await post(route,a.cookie,{...save(target,result),text:'x'.repeat(16001)}),400);
  const races=await Promise.all([post(route,a.cookie,save(target,result,'Alice')),post(route,b.cookie,save(target,result,'Bob'))]);
  assert.deepEqual(races.map(row=>row.status).sort(),[200,409]);
  await json(await request(url(state.id,{...target,artifactId:crypto.randomUUID()}),a.cookie),404);
  await json(await request(url(state.id,{...target,source:'../../private'}),a.cookie),422);
  await json(await request(url(state.id,{...target,nodeId:'missing'}),a.cookie),422);
  await json(await request(url(state.id,target)+'&nodeId=review',a.cookie),400);
  await json(await request(url(state.id,target),a.cookie,{method:'DELETE',headers:{'X-Elma-Wiki-Request':'1'}}),405);
  const fresh=await json(await read());
  await json(await post('/api/solutions/'+state.id+'/archive',a.cookie,{archived:true,expectedRevision:state.revision}));
  await json(await post(route,a.cookie,save(target,fresh)),409);
  const archived=await json(await read());assert.equal(archived.writable,false);assert.ok(archived.saved);
});

test('full dependency changes make saved steps stale; regeneration and reads keep human text and history intact',async t=>{
  const {request,json,post,login,upload,ref,create,save}=await setup(t);
  const a=await login('alice@example.org'), state=await create(a.cookie), route=`/api/solutions/${state.id}`;
  const target=step(state), result=await json(await request(url(state.id,target),a.cookie));
  await json(await post(route+'/explanations',a.cookie,save(target,result,'Сохраняем авторский текст')));
  const raw=structuredClone(visualSource);raw.forms[0].content['[content]'][0].values.fields[0].required=false;
  raw.process.transitions.return.hiddenCondition='SYNTHETIC_UNEXPOSED_EXPRESSION';
  const project=await upload(a.cookie,raw);
  const review=await json(await post(route+'/prepare',a.cookie,{kind:'change',snapshot:ref(project,'partial'),expectedRevision:state.revision,team:'Internal',taskRef:'Change form',sameSourceConfirmed:true}),201);
  const currentTarget={...target,artifactId:review.artifactId};
  const next=await json(await request(url(state.id,currentTarget),a.cookie));
  assert.equal(next.saved.sourceStatus,'stale');assert.equal(next.saved.text,'Сохраняем авторский текст');
  assert.notEqual(next.fingerprint,result.fingerprint);assert.ok(!next.draft.text.includes('SYNTHETIC_UNEXPOSED_EXPRESSION'));
  assert.equal(next.version,1);assert.equal(next.history.length,1);
  await json(await post(route+'/artifacts/'+review.artifactId+'/accept',a.cookie,{expectedRevision:state.revision,reviewedDigest:review.artifactDigest,reviewedBoundaryKeys:review.rows.filter(row=>row.boundaryCrossing).map(row=>row.key)}));
  const old=await json(await request(url(state.id,target),a.cookie));assert.equal(old.writable,false);
  await json(await post(route+'/explanations',a.cookie,save(target,old)),409);
  const accepted=await json(await request(url(state.id,currentTarget),a.cookie));
  await json(await post(route+'/explanations',a.cookie,save(currentTarget,accepted,'Исправленное объяснение')));
  const final=await json(await request(url(state.id,currentTarget),a.cookie));assert.equal(final.saved.sourceStatus,'current');assert.equal(final.history.length,2);
});

test('Solution explanations use accepted components, omit pending changes and reject corrupt captured bytes',async t=>{
  const {directory,request,json,post,login,upload,ref,create}=await setup(t);
  const a=await login('alice@example.org'), state=await create(a.cookie), route='/api/solutions/'+state.id;
  const solution=await json(await request(url(state.id,{scope:'solution'}),a.cookie));
  assert.match(solution.draft.text,/Учебное согласование/);assert.equal(solution.draft.sources[0].artifactId,state.baselineId);
  const raw=structuredClone(visualSource);raw.process.items.review.name='Новый шаг';
  const review=await json(await post(route+'/prepare',a.cookie,{kind:'change',snapshot:ref(await upload(a.cookie,raw),'partial'),expectedRevision:state.revision,team:'Internal',taskRef:'Pending',sameSourceConfirmed:true}),201);
  const pendingIgnored=await json(await request(url(state.id,{scope:'solution'}),a.cookie));assert.equal(solution.fingerprint,pendingIgnored.fingerprint);
  await json(await post(route+'/artifacts/'+review.artifactId+'/accept',a.cookie,{expectedRevision:state.revision,reviewedDigest:review.artifactDigest,reviewedBoundaryKeys:review.rows.filter(row=>row.boundaryCrossing).map(row=>row.key)}));
  const accepted=await json(await request(url(state.id,{scope:'solution'}),a.cookie));assert.notEqual(solution.fingerprint,accepted.fingerprint);
  assert.equal(accepted.draft.sources[0].artifactId,review.artifactId);
  await fs.appendFile(path.join(directory,'shared-solutions','managed-workspaces',state.id,state.baselineId+'.e365'),'corruption');
  await json(await request(url(state.id,{scope:'solution'}),a.cookie),409);
});

test('removed steps retain their explanation in the Solution catalogue; duplicate step identity cannot save to a guessed node',async t=>{
  const {request,json,post,login,upload,ref,create,save}=await setup(t);
  const a=await login('alice@example.org'), state=await create(a.cookie), route='/api/solutions/'+state.id;
  const target=step(state), result=await json(await request(url(state.id,target),a.cookie));
  await json(await post(route+'/explanations',a.cookie,save(target,result,'Историческое объяснение удаляемого шага')));
  const duplicate=structuredClone(visualSource);duplicate.process.items.other={...duplicate.process.items.review};
  const review=await json(await post(route+'/prepare',a.cookie,{kind:'change',snapshot:ref(await upload(a.cookie,duplicate),'partial'),expectedRevision:state.revision,team:'Internal',taskRef:'Ambiguous',sameSourceConfirmed:true}),201);
  await json(await request(url(state.id,{...target,artifactId:review.artifactId}),a.cookie),422);
  const removed=structuredClone(visualSource);delete removed.process.items.review;
  removed.process.transitions={};
  const full=await json(await post(route+'/prepare',a.cookie,{kind:'reconciliation',snapshot:ref(await upload(a.cookie,removed),'full'),expectedRevision:state.revision,baselineOwner:'Vendor',sameSourceConfirmed:true}),201);
  await json(await post(route+'/artifacts/'+full.artifactId+'/accept',a.cookie,{expectedRevision:state.revision,reviewedDigest:full.artifactDigest}));
  const catalogue=await json(await request(url(state.id,{scope:'solution'}),a.cookie));
  assert.equal(catalogue.related.length,1);assert.equal(catalogue.related[0].sourceStatus,'removed');
  assert.equal(catalogue.related[0].text,'Историческое объяснение удаляемого шага');
  assert.ok(catalogue.related[0].sources[0].componentKey);
});
