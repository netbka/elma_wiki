import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { fixture } from '../test/fixture.mjs';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'e365-workspace-browser-'));
const server=createServer({directory,allowLocal:true,clientId:'',clientSecret:''});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome'});
  const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  const request=context.request,headers={'X-Elma-Wiki-Request':'1'};
  await request.post(base+'/auth/local',{headers});const bytes=await fixture();
  const created=await request.post(base+'/api/projects?filename=synthetic.e365',{headers:{...headers,'Content-Type':'application/octet-stream'},data:bytes});assert.equal(created.status(),201);
  const p=await created.json(),endpoint=base+`/api/projects/${p.id}/workspace/object-0`;
  await page.goto(base+`/p/${p.id}/#/object/object-0`);await page.getByRole('link',{name:'Открыть редактор скриптов'}).click();
  await page.waitForFunction(()=>window.__workspace || document.getElementById('save-state')?.textContent==='Редактор недоступен');
  assert.equal(await page.locator('#error').textContent(),'');const initial=await page.evaluate(()=>window.__workspace.getState());
  // Completion is supplied by Monaco's real TypeScript worker, not a hardcoded list.
  const completions=await page.evaluate(async()=>{
    const w=window.__workspace;w.setValue('client.ts','Context.data.');const model=w.getModel('client.ts');
    const worker=await (await w.typescript.getTypeScriptWorker())(model.uri);
    return (await worker.getCompletionsAtPosition(model.uri.toString(),model.getValue().length))?.entries.map(e=>e.name);
  });assert.ok(completions.includes('title'),JSON.stringify(completions));
  const hover=await page.evaluate(async()=>{
    const w=window.__workspace;w.setValue('client.ts','Context.data.title');const model=w.getModel('client.ts');
    const worker=await (await w.typescript.getTypeScriptWorker())(model.uri);
    return (await worker.getQuickInfoAtPosition(model.uri.toString(),model.getValue().length-1))?.displayParts.map(p=>p.text).join('');
  });assert.match(hover,/title.*: string/);
  const rpc=await page.evaluate(async()=>{
    const w=window.__workspace;w.setValue('client.ts','Server.rpc.');const model=w.getModel('client.ts');
    const worker=await (await w.typescript.getTypeScriptWorker())(model.uri);
    return (await worker.getCompletionsAtPosition(model.uri.toString(),model.getValue().length))?.entries.map(e=>e.name);
  });assert.ok(rpc.includes('check'),JSON.stringify(rpc));
  await page.evaluate(()=>window.__workspace.setValue('client.ts','const n: number = "wrong";\nContext.data.typo;\neval("1");'));
  await page.locator('#check').click();await page.waitForFunction(()=>window.__workspace.getState().check?.typescript==='failed');
  assert.ok(await page.locator('#problems .problem-error').count());assert.ok(await page.locator('#problems .problem-warning').count());
  assert.ok(await page.evaluate(()=>window.__workspace.monaco.editor.getModelMarkers({owner:'workspace'}).some(m=>m.severity===8)));
  await page.evaluate(()=>window.__workspace.setValue('client.ts','function onOpen() { Context.data.title = "changed"; Server.rpc.check(); }'));
  await page.waitForFunction(()=>document.getElementById('save-state').textContent.startsWith('Сохранено'));
  await page.reload();await page.waitForFunction(()=>window.__workspace);assert.match(await page.evaluate(()=>window.__workspace.getValue('client.ts')),/changed/);
  await page.locator('#check').click();await page.waitForFunction(()=>window.__workspace.getState().check?.typescript==='passed');
  page.once('dialog',d=>d.accept('Исправленная проверка'));await page.locator('#checkpoint').click();await page.waitForFunction(()=>window.__workspace.getState().checkpoints.length===1);
  const checkpoint=await page.evaluate(()=>window.__workspace.getState().checkpoints[0].id);
  await page.evaluate(()=>window.__workspace.setValue('client.ts','const newer = 42;'));
  await page.evaluate(()=>window.__workspace.save());await page.locator('#changes').click();await page.locator('#diff:not([hidden])').waitFor();
  await page.locator('#restore-choice').selectOption(checkpoint);page.once('dialog',d=>d.accept());await page.locator('#restore').click();
  await page.waitForFunction(()=>window.__workspace.getValue('client.ts').includes('changed'));
  await page.locator('#restore-choice').selectOption('original');page.once('dialog',d=>d.accept());await page.locator('#restore').click();
  await page.waitForFunction(expected=>window.__workspace.getValue('client.ts')===expected,initial.files['client.ts']);
  const second=await context.newPage();await second.goto(page.url());await second.waitForFunction(()=>window.__workspace);
  await page.evaluate(()=>window.__workspace.setValue('client.ts','const firstTab = true;'));await page.evaluate(()=>window.__workspace.save());
  await second.evaluate(()=>window.__workspace.setValue('client.ts','const secondTab = true;'));
  await second.waitForFunction(()=>document.getElementById('save-state').textContent.startsWith('Конфликт'));assert.match(await second.evaluate(()=>window.__workspace.getValue('client.ts')),/secondTab/);
  await second.locator('#compare').click();await second.locator('#diff:not([hidden])').waitFor();await second.close();
  const original=await request.get(base+`/api/projects/${p.id}/original`);assert.deepEqual(await original.body(),bytes);
  await fs.mkdir('qa',{recursive:true});await page.screenshot({path:'qa/workspace-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith(base)),'Editor must load only local assets');
  console.log('Workspace browser: Monaco completion/RPC, diagnostics, lint, save/reload, diff, checkpoint/restore, conflicts, immutable original and local assets passed.');
} finally {
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('e365-workspace-browser-'));await fs.rm(directory,{recursive:true,force:true});
}
