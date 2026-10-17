import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { visualSource } from '../web/visual/fixtures.js';
import { zip } from '../test/fixture.mjs';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'solution-visual-browser-'));
const server=createServer({directory,allowLocal:true,sendEmail:undefined,sendVk:undefined});let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  assert.equal((await context.request.post(base+'/auth/local',{headers:{'X-Elma-Wiki-Request':'1'}})).status(),200);
  const raw=structuredClone(visualSource);raw.process.items.review.name='Согласовать <img src=x onerror=alert(1)>';
  const archive=await zip([['package.json',{code:'synthetic_visual',type:'SOLUTION'}],['processor/manifest.json',{entities:[{code:'approval',namespace:'synthetic',kind:'PROCESS',path:'approval.json'}]}],['processor/approval.json',raw]]);
  const uploaded=await context.request.post(base+'/api/solutions/uploads?sharedConfirmed=true',{headers:{'X-Elma-Wiki-Request':'1','Content-Type':'application/octet-stream'},data:archive});
  assert.equal(uploaded.status(),201);const project=await uploaded.json();
  const created=await context.request.post(base+'/api/solutions',{headers:{'X-Elma-Wiki-Request':'1'},data:{name:'Synthetic visual',baselineOwner:'Vendor',sharedConfirmed:true,snapshot:{projectId:project.id,snapshotId:project.currentSnapshotId,scope:'full',scopeConfirmed:true}}});
  assert.equal(created.status(),201);const state=await created.json();
  // The pulled version edits one step, so the review carries process parts and the diagram can highlight them (UX-03b).
  const edited=structuredClone(raw);edited.process.items.review.condition='edited after the baseline';
  const archiveEdited=await zip([['package.json',{code:'synthetic_visual',type:'SOLUTION'}],['processor/manifest.json',{entities:[{code:'approval',namespace:'synthetic',kind:'PROCESS',path:'approval.json'}]}],['processor/approval.json',edited]]);
  const next=await context.request.post(base+'/api/solutions/uploads?sharedConfirmed=true',{headers:{'X-Elma-Wiki-Request':'1','Content-Type':'application/octet-stream'},data:archiveEdited});
  assert.equal(next.status(),201);const update=await next.json();
  const prepared=await context.request.post(`${base}/api/solutions/${state.id}/prepare`,{headers:{'X-Elma-Wiki-Request':'1'},data:{kind:'reconciliation',expectedRevision:state.revision,baselineOwner:'Vendor',sameSourceConfirmed:true,snapshot:{projectId:update.id,snapshotId:update.currentSnapshotId,scope:'full',scopeConfirmed:true}}});
  assert.equal(prepared.status(),201);const review=await prepared.json();
  await page.goto(`${base}/solutions?id=${state.id}&view=review&artifact=${review.artifactId}`);
  await page.getByText('Посмотреть процесс и форму',{exact:true}).click();
  await page.locator('.solution-visual svg').waitFor();
  await page.locator('svg [role=button]').filter({hasText:'Согласовать'}).focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Согласование',exact:true}).waitFor();
  assert.equal(await page.locator('img').count(),0);
  assert.equal(await page.getByText('Не поддерживается: synthetic-unknown-control',{exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Согласовать',exact:true}).isDisabled(),true,'exported actions never execute');
  await page.getByRole('button',{name:'Посмотреть переход: Согласовать',exact:true}).click();
  await page.locator('.visual-form').getByRole('heading',{name:'Готово',exact:true}).waitFor();
  await page.locator('svg [data-node=review]').click();
  await page.locator('.visual-form').getByRole('button',{name:'Посмотреть переход: Вернуть',exact:true}).click();
  await page.getByRole('heading',{name:'Причина возврата',exact:true}).waitFor();
  assert.equal(await page.locator('.visual-form label').filter({hasText:'Комментарий'}).getByRole('textbox').isDisabled(),true);
  await page.locator('.visual-form').getByRole('button',{name:'Посмотреть переход: Повторное рассмотрение'}).click();
  await page.getByRole('heading',{name:'Согласование',exact:true}).waitFor();
  await page.getByRole('button',{name:'Проверить путь по экспорту',exact:true}).click();
  await page.getByLabel(/^Документ/).fill('Учебный договор');
  await page.getByRole('button',{name:'Проверить переход: Согласовать',exact:true}).click();
  await page.locator('.visual-form').getByRole('heading',{name:'Готово',exact:true}).waitFor();
  await page.locator('svg [data-node=review]').click();
  assert.equal(await page.getByLabel(/^Документ/).inputValue(),'Учебный договор','local fixture values survive branch exploration');
  const pathStatus=page.locator('.visual-scenario [role=status]');
  assert.ok(!(await pathStatus.textContent()).includes(' → '),'manual selection starts a new path instead of fabricating an edge from the end node');
  await page.locator('svg [data-node=review]').focus();await page.keyboard.press('Enter');
  assert.ok(!(await pathStatus.textContent()).includes(' → '),'keyboard inspection does not append an unverified transition');
  await page.getByRole('button',{name:'Проверить переход: Вернуть',exact:true}).click();
  assert.match(await pathStatus.textContent(),/ → Исправить\./,'only checked source transitions extend the path');
  await page.getByRole('button',{name:'Проверить переход: Повторное рассмотрение',exact:true}).click();
  await page.getByText('По экспорту требуется: Комментарий. Введённые значения сохранены.',{exact:true}).waitFor();
  await fs.mkdir('qa',{recursive:true});await page.screenshot({path:'qa/solution-visual-missing-comment.png',fullPage:true});
  await page.getByLabel(/^Комментарий ·/).fill('Исправьте срок договора');
  await page.getByRole('button',{name:'Проверить переход: Повторное рассмотрение',exact:true}).click();
  await page.getByRole('heading',{name:'Согласование',exact:true}).waitFor();
  assert.match(await pathStatus.textContent(),/ → Исправить → Согласовать/,'a checked return transition retains the connected path');
  await page.locator('svg [data-node=review]').click();
  for(let i=0;i<99;i++)await page.getByRole('button',{name:i%2===0?'Проверить переход: Вернуть':'Проверить переход: Повторное рассмотрение',exact:true}).click();
  const boundedPath=await pathStatus.textContent();
  assert.equal(boundedPath.split(' → ').length,100);
  await page.getByRole('button',{name:'Проверить переход: Повторное рассмотрение',exact:true}).click();
  await page.getByText('Достигнут предел проверки: 100 шагов. Выберите шаг, чтобы начать новый путь. Введённые значения сохранены.',{exact:true}).waitFor();
  assert.equal(await pathStatus.textContent(),boundedPath,'the bounded history is retained instead of silently cleared');
  assert.equal(await page.getByLabel(/^Комментарий ·/).inputValue(),'Исправьте срок договора');
  await page.locator('svg [data-node=review]').click();
  assert.ok(!(await pathStatus.textContent()).includes(' → '));
  assert.equal(await page.getByLabel(/^Документ/).inputValue(),'Учебный договор');
  await page.getByRole('button',{name:'Завершить проверку пути',exact:true}).click();
  assert.equal(await page.getByLabel(/^Документ/).isDisabled(),true);
  await page.getByText('Комментарий к выбранному шагу: review',{exact:true}).waitFor();
  await page.getByLabel('Комментарий к изменению',{exact:true}).fill('Проверка Wiki: возврат требует комментарий; native ELMA не наблюдалась.');
  await page.getByRole('button',{name:'Комментарий',exact:true}).click();
  await page.getByText('Шаг: review',{exact:true}).waitFor();
  // UX-03b "Открыть схему": the changed process row opens the captured diagram with its changed steps highlighted.
  await page.getByRole('button',{name:'Открыть схему',exact:true}).first().click();
  await page.locator('.visual-changed-legend').waitFor();
  assert.match(await page.locator('.visual-changed-legend').textContent(),/^Изменённые шаги выделены: /);
  assert.ok(await page.locator('svg [data-changed=true]').count()>0,'changed steps are highlighted on the diagram');
  assert.equal(await page.locator('svg [data-node=review]').getAttribute('data-changed'),'true','the edited step is highlighted');
  const discussed=await (await context.request.get(`${base}/api/solutions/${state.id}/artifacts/${review.artifactId}/review`)).json();
  assert.equal(discussed.discussion.findings[0].sourceAnchor.nodeId,'review');
  assert.equal(discussed.discussion.findings[0].actor.provider,'local');
  // "Открыть схему" already opened the diagram on this render; only open it when it is closed.
  const visualDetails=page.locator('details').filter({has:page.getByText('Посмотреть процесс и форму',{exact:true})});
  if(!(await visualDetails.evaluate(node=>node.open)))await visualDetails.locator('summary').click();
  await page.locator('.solution-visual svg').waitFor();
  await page.locator('svg [data-node=review]').click();
  await fs.mkdir('qa',{recursive:true});await page.screenshot({path:'qa/solution-visual-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'qa/solution-visual-mobile.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  for(const state of ['happy','return','missing-comment']){
    await page.evaluate(async state=>{
      const {mountSnapshotVisual}=await import('/visual/render.js');const {visualFixture}=await import('/visual/fixtures.js');
      document.querySelector('#managed-root').replaceChildren(mountSnapshotVisual(visualFixture(state)));
    },state);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),state);
    if(state==='missing-comment')await page.getByText('По экспорту требуется: Комментарий. Введённые значения сохранены.',{exact:true}).waitFor();
    await page.screenshot({path:`qa/solution-visual-story-${state}.png`,fullPage:true});
  }
  await page.evaluate(async()=>{
    const {mountSnapshotVisual}=await import('/visual/render.js');
    const {visualFixture}=await import('/visual/fixtures.js');
    document.querySelector('#managed-root').replaceChildren(mountSnapshotVisual(visualFixture('duplicate')));
  });
  assert.equal(await page.getByRole('button',{name:'Согласовать · Не поддерживается',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Повторное согласование · Не поддерживается',exact:true}).count(),1);
  await page.getByRole('button',{name:'Согласовать · Не поддерживается',exact:true}).click();
  assert.equal(await page.getByText('Связь неоднозначна: повторяется код узла или формы.',{exact:true}).count(),1);
  assert.equal(await page.locator('.visual-form input').count(),0,'duplicate node identity cannot select the first form');
  assert.equal(await page.locator('.visual-form button:enabled').count(),0,'ambiguous branches cannot be followed');
  await page.screenshot({path:'qa/solution-visual-duplicate.png',fullPage:true});
  await page.evaluate(async()=>{
    const {mountSnapshotVisual}=await import('/visual/render.js');
    const {visualFixture}=await import('/visual/fixtures.js');
    document.querySelector('#managed-root').replaceChildren(mountSnapshotVisual(visualFixture('unknown')));
  });
  assert.equal(await page.getByText('Область процесса не поддерживается: Согласующий',{exact:true}).count(),1,
    'a lane with invalid geometry stays visible as unsupported source evidence');
  // D3: the existing synthetic source story uses the production form renderer.
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(async()=>{
    document.documentElement.style.zoom='1';
    const {mountSnapshotVisual}=await import('/visual/render.js'),{visualFixture}=await import('/visual/fixtures.js');
    document.querySelector('#managed-root').replaceChildren(mountSnapshotVisual(visualFixture('source',{layout:true})));
  });
  await page.locator('svg [data-node=review]').click();
  const form=page.locator('.visual-form');
  assert.ok(await form.locator('[data-region="[content]"]').count()>0);
  assert.equal(await form.locator('[data-region="[footer]"]').count(),1);
  await form.getByRole('tab',{name:'Основное',exact:true}).waitFor();
  assert.equal(await form.getByRole('tab',{name:'Основное',exact:true}).getAttribute('aria-selected'),'true');
  await form.getByRole('tab',{name:'Основное',exact:true}).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await form.getByRole('tab',{name:'Дополнительно',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await form.getByText('Не поддерживается: synthetic-unknown-control',{exact:true}).isVisible(),true);
  await page.keyboard.press('Home');
  assert.equal(await form.getByRole('tab',{name:'Основное',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');
  assert.equal(await form.getByLabel(/^Участник/).isDisabled(),true,'native control binding is not simulated as a primitive');
  assert.equal(await form.getByRole('button',{name:'Согласовать',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Проверить путь по экспорту',exact:true}).click();
  assert.equal(await form.getByLabel(/^Документ/).isEnabled(),true);
  assert.equal(await form.getByLabel(/^Номер/).isDisabled(),true,'declared read-only remains read-only during the bounded path check');
  const columns=form.locator('[data-descriptor=row]>.visual-form-region>.visual-region-content>[data-descriptor=column]');
  assert.equal(await columns.count(),2);
  const left=await columns.nth(0).boundingBox(),right=await columns.nth(1).boundingBox();
  assert.ok(right.x>left.x&&Math.abs(left.y-right.y)<2,'source row/columns stay horizontal at desktop width');
  const group=form.locator('details.visual-form-group');await group.locator(':scope>summary').click();
  assert.equal(await form.getByLabel(/^Документ/).isVisible(),false);await group.locator(':scope>summary').click();
  await form.getByText('Исходные декларации',{exact:true}).click();
  await form.locator('.visual-form-evidence > details').filter({has:page.locator('.visual-source-bindings')}).first().locator(':scope>summary').click();
  await form.locator('.visual-source-bindings').first().locator(':scope>summary').click();
  assert.ok((await form.textContent()).includes('context → participant'),'source path remains inspectable without evaluation');
  await page.screenshot({path:'qa/solution-form-source-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const narrowLeft=await columns.nth(0).boundingBox(),narrowRight=await columns.nth(1).boundingBox();
  assert.ok(narrowRight.y>narrowLeft.y,'source columns reflow at narrow widths');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'qa/solution-form-source-mobile.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // The same exported tree renderer can render a widget template independently.
  await page.evaluate(async()=>{
    const {mountFormVisual}=await import('/visual/render.js'),{projectForm}=await import('/visual/model.js');
    const raw={descriptor:'groupbox',values:{title:'<img src=x onerror=alert(1)>',__styles:'position:fixed;inset:0',__hidden:true},content:{'[sidebar]':[
      {descriptor:'dynamic-form',values:{fields:[{code:'test',name:'Synthetic readonly',type:'string',__readOnly:true}]}},
      {descriptor:'button',values:{label:'Synthetic inert',onClick:{script:'globalThis.__D3_EXECUTED=true'}}},
      {descriptor:'synthetic-opaque-control',values:{html:'<script>globalThis.__D3_EXECUTED=true</script>'}}
    ]}};
    document.querySelector('#managed-root').replaceChildren(mountFormVisual(projectForm(raw,'widgets/synthetic.json#/descriptor/template'),{simulation:true}));
  });
  assert.equal(await page.locator('.solution-form img,.solution-form script').count(),0);
  assert.equal(await page.getByLabel(/^Synthetic readonly/).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Synthetic inert',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>globalThis.__D3_EXECUTED),undefined);
  assert.equal(await page.locator('.solution-form [style]').count(),0,'uploaded styling is never installed');
  assert.ok((await page.locator('.solution-form').textContent()).includes('Скрытие: да по экспорту'),'source hidden state remains inspectable in review');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  await fs.writeFile('qa/solution-visual-browser-evidence.json',JSON.stringify({synthetic:true,api:true,sourceGeometry:true,explicitForm:true,branches:'view-only and bounded Wiki simulation',happy:true,returnWithComment:true,missingComment:true,attributedStepFinding:true,keyboard:true,mobile:true,zoom:true,sourceRegions:true,sourceColumns:true,groupCollapse:true,keyboardTabs:true,declaredReadOnly:true,sourceBindings:true,standaloneWidgetRenderer:true,importedActionsExecuted:false,nativeObservation:false}));
  console.log('Solution visual: shared artifact API, geometry, explicit form, happy/return/missing-comment Wiki checks, attributed step discussion, inert controls, XSS, keyboard, mobile and zoom passed.');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});
}
