import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { visualSource } from '../web/visual/fixtures.js';
import { zip } from '../test/fixture.mjs';

const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wiki-explanations-browser-'));
const server=createServer({directory,allowLocal:true,sendEmail:undefined,sendVk:undefined,bugPublisher:null});
let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const post=async(route,input)=>{
    const response=await context.request.post(base+route,{headers:{'X-Elma-Wiki-Request':'1'},data:input});
    const value=await response.json();assert.equal(response.status(),200,JSON.stringify(value));return value;
  };
  await post('/auth/local',{});
  const bytes=await zip([
    ['package.json',{code:'synthetic_explanation',type:'SOLUTION'}],
    ['processor/manifest.json',{entities:[{code:'approval',namespace:'synthetic.processes',name:'Учебное согласование',path:'approval.json',kind:'PROCESS'}]}],
    ['processor/approval.json',visualSource]
  ]);
  const uploaded=await context.request.post(base+'/api/solutions/uploads?filename=synthetic.e365',{headers:{'X-Elma-Wiki-Request':'1','Content-Type':'application/octet-stream'},data:bytes});
  assert.equal(uploaded.status(),201);const project=await uploaded.json();
  const created=await context.request.post(base+'/api/solutions',{headers:{'X-Elma-Wiki-Request':'1'},data:{name:'Учебное решение',baselineOwner:'Vendor',snapshot:{projectId:project.id,snapshotId:project.currentSnapshotId,scope:'full',scopeConfirmed:true}}});
  assert.equal(created.status(),201);const state=await created.json();
  const url=base+'/solutions?id='+state.id+'&view=solution';
  await page.goto(url);
  const solution=page.locator('.solution-explanation').first();
  await solution.getByRole('button',{name:'Объяснить решение',exact:true}).click();
  await solution.getByLabel('Текст объяснения').waitFor();
  assert.match(await solution.getByLabel('Текст объяснения').inputValue(),/принятое|Принятое/);
  await solution.getByLabel('Текст объяснения').fill('Проверенное описание решения');
  await solution.getByRole('button',{name:'Сохранить объяснение',exact:true}).click();
  await solution.getByText('Проверенное описание решения',{exact:true}).first().waitFor();
  await solution.getByText('Источники объяснения',{exact:true}).first().click();
  await solution.getByRole('button',{name:'approval',exact:true}).click();
  await page.getByRole('heading',{name:'Учебное согласование',exact:true}).waitFor();
  await page.getByRole('button',{name:'Посмотреть процесс: approval',exact:true}).click();
  await page.locator('.solution-visual svg').waitFor();
  const processPanel=page.locator('.solution-visual > div .solution-explanation').first();
  await page.getByRole('button',{name:'Объяснить этот процесс',exact:true}).click();
  await processPanel.getByLabel('Текст объяснения').waitFor();
  assert.match(await processPanel.getByLabel('Текст объяснения').inputValue(),/Повторное рассмотрение/);
  await processPanel.getByText('Источники объяснения',{exact:true}).click();
  await processPanel.getByRole('button',{name:'Исправить',exact:true}).first().click();
  await page.locator('.visual-form').getByRole('heading',{name:'Исправить',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Исправить');
  await page.locator('svg [data-node=review]').focus();await page.keyboard.press('Enter');
  const step=page.locator('.visual-form .solution-explanation');
  await step.getByRole('button',{name:'Объяснить этот шаг',exact:true}).click();
  await step.getByLabel('Текст объяснения').waitFor();
  const human='Человек уточнил правило возврата. <img src=x onerror=alert(1)>';
  await step.getByLabel('Текст объяснения').fill(human);
  await step.getByRole('button',{name:'Подготовить новое объяснение',exact:true}).click();
  await step.getByRole('button',{name:'Оставить мой текст',exact:true}).waitFor();
  assert.equal(await step.getByLabel('Текст объяснения').inputValue(),human);
  await step.getByRole('button',{name:'Оставить мой текст',exact:true}).click();
  // Navigating away and back keeps the unsaved editor attached to its source.
  await page.locator('svg [data-node=revise]').click();await page.locator('svg [data-node=review]').click();
  assert.equal(await step.getByLabel('Текст объяснения').inputValue(),human);
  await step.getByRole('button',{name:'Сохранить объяснение',exact:true}).click();
  await step.getByText(human,{exact:true}).first().waitFor();
  assert.equal(await step.locator('img,script').count(),0);
  await fs.mkdir('qa',{recursive:true});await step.screenshot({path:'qa/solution-explanations-saved-step.png'});
  await page.reload();await page.getByRole('button',{name:'Посмотреть процесс: approval',exact:true}).click();
  await page.locator('svg [data-node=review]').click();await step.getByRole('button',{name:'Объяснить этот шаг',exact:true}).click();
  await step.getByText(human,{exact:true}).first().waitFor();
  await step.getByRole('button',{name:'Изменить объяснение',exact:true}).click();
  await step.getByLabel('Текст объяснения').fill('Мой несохранённый текст');
  const target={scope:'step',artifactId:state.baselineId,source:'processor/approval.json',nodeId:'review'};
  const endpoint='/api/solutions/'+state.id+'/explanations';
  const current=await (await context.request.get(base+endpoint+'?'+new URLSearchParams(target))).json();
  await post(endpoint,{...target,text:'Правка другого пользователя',expectedRevision:current.expectedRevision,expectedVersion:current.version,expectedFingerprint:current.fingerprint});
  await step.getByRole('button',{name:'Сохранить объяснение',exact:true}).click();
  await step.getByText(/Сохранение заблокировано до обновления/).waitFor();
  assert.equal(await step.getByLabel('Текст объяснения').inputValue(),'Мой несохранённый текст');
  assert.equal(await step.getByRole('button',{name:'Сохранить объяснение',exact:true}).isDisabled(),true);
  await step.getByRole('button',{name:'Обновить сохранённое объяснение',exact:true}).click();
  await step.getByText('Правка другого пользователя',{exact:true}).first().waitFor();
  assert.equal(await step.getByLabel('Текст объяснения').inputValue(),'Мой несохранённый текст');
  // The server commits, but the browser loses the response. Refresh reconciles
  // the committed result without replaying the write or erasing the editor.
  await page.route('**/api/solutions/*/explanations',async route=>{
    if(route.request().method()==='POST'){await route.fetch();await route.abort();}else await route.continue();
  });
  await step.getByRole('button',{name:'Сохранить объяснение',exact:true}).click();
  await step.getByText(/Сохранение заблокировано до обновления/).waitFor();
  await page.unroute('**/api/solutions/*/explanations');
  const beforeRefresh=await (await context.request.get(base+endpoint+'?'+new URLSearchParams(target))).json();
  await step.getByRole('button',{name:'Обновить сохранённое объяснение',exact:true}).click();
  await step.getByText('Мой несохранённый текст',{exact:true}).first().waitFor();
  const afterRefresh=await (await context.request.get(base+endpoint+'?'+new URLSearchParams(target))).json();
  assert.equal(beforeRefresh.version,afterRefresh.version);
  await fs.mkdir('qa',{recursive:true});await page.screenshot({path:'qa/solution-explanations-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'qa/solution-explanations-mobile.png',fullPage:true});
  await page.evaluate(()=>document.documentElement.style.zoom='2');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  for(const name of ['ready','draft','saved','stale','loading','error','conflict','historical','regenerated']){
    await page.evaluate(async name=>{
      const {mountExplanation}=await import('/explanations/render.js');
      const {explanationFixture,explanationFixtureActions}=await import('/explanations/fixtures.js');
      document.querySelector('#managed-root').replaceChildren(mountExplanation(explanationFixture(name),explanationFixtureActions()));
    },name);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name);
    if(name==='historical')assert.equal(await page.getByRole('button',{name:'Изменить объяснение',exact:true}).isDisabled(),true);
  }
  await page.evaluate(async()=>{
    const {mountManagedWorkspace}=await import('/managed/render.js');
    const {explanationSolutionFixture,explanationSolutionActions}=await import('/explanations/fixtures.js');
    document.querySelector('#managed-root').replaceChildren(mountManagedWorkspace(explanationSolutionFixture(),explanationSolutionActions()));
  });
  await page.getByRole('button',{name:'Посмотреть процесс: approval',exact:true}).click();
  await page.locator('svg [data-node=review]').click();
  await page.getByRole('button',{name:'Объяснить этот шаг',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить объяснение',exact:true}).click();
  await page.getByText(/Объяснение сохранено:/).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  await fs.writeFile('qa/solution-explanations-browser-evidence.json',JSON.stringify({synthetic:true,solution:true,process:true,step:true,persistence:true,sourceNavigation:true,regenerationPreservesEdits:true,concurrency:true,lostResponse:true,keyboard:true,mobile:true,zoom:true,storybookStates:10,externalAI:false,nativeObservation:false}));
  console.log('Solution explanations: actual API/UI generation, source navigation, edit/save/reload, draft retention, conflict, lost response, keyboard, mobile/zoom and 10 shared Storybook states passed.');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});
}
