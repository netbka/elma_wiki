import test from 'node:test';
import assert from 'node:assert/strict';
import { projectProcess, relatedForm } from '../web/visual/model.js';
import { visualSource } from '../web/visual/fixtures.js';
import { snapshotVisual, sourceAnchorIndex } from '../lib/solution-visual.mjs';
import { zip } from './fixture.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
export const visualArchive = source => zip([
  ['package.json',{code:'synthetic_visual',type:'SOLUTION'}],
  ['processor/manifest.json',{entities:[{code:'approval',namespace:'synthetic',kind:'PROCESS',path:'approval.json'}]}],
  ['processor/approval.json',source||visualSource]
]);
test('source geometry, explicit task/form links and unknown behavior remain separate',()=>{
  const p=projectProcess(visualSource,'processor/approval.json');
  assert.deepEqual(p.nodes.find(n=>n.id==='review').position,{x:180,y:70,width:130,height:70});
  assert.deepEqual(p.edges[1].points,visualSource.process.transitions.approve.path);
  assert.equal(relatedForm(p,'review').form.code,'approval');
  assert.equal(relatedForm(p,'revise').form.tree.children[0].fields[0].required,true);
  assert.equal(relatedForm(p,'start').status,'unknown');
  assert.equal(p.edges.every(e=>e.behavior==='unknown'),true);
  assert.equal(p.evidence.nativeObservation,'absent');
  assert.equal(p.forms[0].tree.children[2].supported,false);
  assert.equal(JSON.stringify(p).includes('<img'),false);
  assert.equal(JSON.stringify(p).includes('Never executed'),false);
});
test('missing/duplicate identities, unknown shapes and invalid geometry never invent a relationship or path',()=>{
  const raw=structuredClone(visualSource);
  raw.forms.push(raw.forms[0]);raw.process.items.review.type='unknown';raw.process.items.revise.x=Infinity;
  raw.process.transitions.return.path[0].x='10';
  raw.process.transitions.approve.type='unknown-edge';
  const p=projectProcess(raw,'processor/approval.json');
  assert.equal(relatedForm(p,'review').status,'ambiguous');
  assert.equal(p.nodes.find(n=>n.id==='review').supported,false);
  assert.equal(p.nodes.find(n=>n.id==='revise').position,null);
  assert.equal(p.edges.find(e=>e.id==='return').supported,false);
  assert.equal(p.edges.find(e=>e.id==='approve').supported,false);
  raw.process.items.duplicate={...raw.process.items.start};
  assert.equal(relatedForm(projectProcess(raw,'processor/approval.json'),'start').status,'ambiguous');
});
test('all duplicated node, lane and transition identities remain unsupported without choosing the first occurrence',()=>{
  const raw=structuredClone(visualSource);
  raw.process.items.duplicate={...raw.process.items.review,name:'Duplicate review',x:330};
  raw.process.lanes.duplicate={...raw.process.lanes.review,name:'Duplicate lane',y:250};
  raw.process.transitions.duplicate={...raw.process.transitions.approve,name:'Duplicate transition'};
  const p=projectProcess(raw,'fixture');
  assert.equal(p.nodes.filter(n=>n.id==='review').every(n=>!n.supported),true);
  assert.equal(p.lanes.filter(n=>n.id==='review').every(n=>!n.supported),true);
  assert.equal(p.edges.filter(e=>e.id==='approve').every(e=>!e.supported),true);
  assert.equal(relatedForm(p,'review').status,'ambiguous');
  assert.equal(p.issues.filter(i=>i.reason.includes('идентичность')).length,6);
  const edgesOnly=structuredClone(visualSource);
  edgesOnly.process.transitions.duplicate={...edgesOnly.process.transitions.approve};
  const independent=projectProcess(edgesOnly,'fixture');
  assert.equal(independent.nodes.every(n=>n.supported),true);
  assert.equal(independent.edges.filter(e=>e.id==='approve').every(e=>!e.supported),true);
});

test('archive projection binds source anchors to immutable bytes and excludes all imported scripts',async()=>{
  const raw=structuredClone(visualSource);raw.scripts='throw Error("SECRET_EXECUTION_MARKER")';
  const bytes=await visualArchive(raw), first=await snapshotVisual(bytes,'artifact-one');
  assert.equal(first.processes.length,1);
  const anchor=first.processes[0].nodes[1].anchor;
  assert.equal(anchor.checksum,first.checksum);assert.equal(anchor.artifactId,'artifact-one');
  assert.equal(anchor.pointer,'processor/approval.json#/process/items/review');
  assert.equal(JSON.stringify(first).includes('SECRET_EXECUTION_MARKER'),false);
  raw.process.items.review.name='Changed';
  const second=await snapshotVisual(await visualArchive(raw),'artifact-two');
  assert.notEqual(second.checksum,first.checksum);
  assert.notEqual(second.processes[0].nodes[1].anchor.fingerprint,anchor.fingerprint);
});
test('deep and oversized source descriptors fail within bounded projection',()=>{
  const raw=structuredClone(visualSource);let parent=raw.forms[0];
  for(let i=0;i<22;i++){const child={descriptor:'row',content:{}};parent.content={'':[child]};parent=child;}
  assert.throws(()=>projectProcess(raw,'fixture'),/ограничения/);
});

test('step fingerprint changes for unrendered source settings without exposing their content',async()=>{
  const raw=structuredClone(visualSource);
  raw.process.items.review.settings.unrendered={script:'PRIVATE_SYNTHETIC_SETTING_A'};
  const before=await snapshotVisual(await visualArchive(raw),'before');
  raw.process.items.review.settings.unrendered.script='PRIVATE_SYNTHETIC_SETTING_B';
  const after=await snapshotVisual(await visualArchive(raw),'after');
  assert.notEqual(before.processes[0].nodes[1].anchor.fingerprint,after.processes[0].nodes[1].anchor.fingerprint);
  assert.equal(JSON.stringify(after).includes('PRIVATE_SYNTHETIC_SETTING'),false);
});

test('array positions without native IDs cannot become durable current step identities',async()=>{
  const raw=structuredClone(visualSource);
  raw.process.items=Object.values(raw.process.items).map(({id,...node})=>node);
  const index=await sourceAnchorIndex(await visualArchive(raw),'array');
  assert.equal(index.available,true);
  assert.equal(index.nodes.some(node=>node.supported),false);
});

test('explicit native IDs survive dictionary relocation without choosing positional identity',async()=>{
  const raw=structuredClone(visualSource);
  const before=await snapshotVisual(await visualArchive(raw),'before');
  raw.process.items.relocated=raw.process.items.review; delete raw.process.items.review;
  const after=await snapshotVisual(await visualArchive(raw),'after');
  const anchor=after.processes[0].nodes.find(node=>node.id==='review').anchor;
  assert.notEqual(anchor.pointer,before.processes[0].nodes[1].anchor.pointer);
  assert.equal(anchor.fingerprint,before.processes[0].nodes[1].anchor.fingerprint);
  assert.equal((await sourceAnchorIndex(await visualArchive(raw),'after')).nodes.find(node=>node.nodeId==='review').supported,true);
});
test('visual API authorizes the captured shared artifact, rejects private/absent identities and rechecks bytes',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'solution-visual-'));
  const server=createServer({directory,allowLocal:true,sendEmail:undefined,sendVk:undefined});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port, headers={'X-Elma-Wiki-Request':'1','Content-Type':'application/json'};
  const login=await fetch(base+'/auth/local',{method:'POST',headers});headers.cookie=login.headers.getSetCookie()[0].split(';')[0];
  const uploaded=await fetch(base+'/api/solutions/uploads?sharedConfirmed=true',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:await visualArchive()});
  assert.equal(uploaded.status,201);const project=await uploaded.json();
  const created=await fetch(base+'/api/solutions',{method:'POST',headers,body:JSON.stringify({name:'Synthetic visual',baselineOwner:'Vendor',sharedConfirmed:true,
    snapshot:{projectId:project.id,snapshotId:project.currentSnapshotId,scope:'full',scopeConfirmed:true}})});
  assert.equal(created.status,201);const state=await created.json(), artifact=state.artifacts[0].id;
  const route=`${base}/api/solutions/${state.id}/artifacts/${artifact}/visual`;
  assert.equal((await fetch(route)).status,404);
  const response=await fetch(route,{headers});assert.equal(response.status,200);
  const visual=await response.json();assert.equal(visual.processes.length,1);assert.equal(visual.artifactId,artifact);
  assert.equal((await fetch(route.replace(state.id,project.id),{headers})).status,404);
  assert.equal((await fetch(route.replace(artifact,project.id),{headers})).status,404);
  await fs.writeFile(path.join(directory,'shared-solutions','managed-workspaces',state.id,artifact+'.e365'),'tampered');
  assert.equal((await fetch(route,{headers})).status,409);
});
