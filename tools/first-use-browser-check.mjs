import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { fixture } from '../test/fixture.mjs';
import { buildPublicSite } from './build-public.mjs';
import { createStaticPreview } from './public-preview.mjs';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'first-use-browser-'));
const server=createServer({directory,allowLocal:true,sendEmail:undefined,sendVk:undefined});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser,publicServer,storybook;
try {
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('qa',{recursive:true});
  const headers={'X-Elma-Wiki-Request':'1'};
  assert.equal((await context.request.post(base+'/auth/local',{headers})).status(),200);
  const response=await context.request.post(base+'/api/projects',{headers:{...headers,'Content-Type':'application/octet-stream'},data:await fixture({secret:'<script>globalThis.executed=true</script>'})});
  assert.equal(response.status(),201);const project=await response.json(),viewer=base+'/p/'+project.id+'/';
  await page.goto(viewer+'#/task/field');await page.getByRole('link',{name:'Как исследовать поле и контекст',exact:true}).waitFor();
  await page.locator('#search').fill('title');await page.locator('.search-hit').first().focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Найденное поле: title',exact:true}).waitFor();
  assert.match(await page.locator('#matched-source').textContent(),/descriptor\/fields\/0/);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'matched-source');
  await page.getByRole('button',{name:'Посмотреть исходный текст',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#preview').textContent.includes('globalThis.executed'));
  assert.equal(await page.evaluate(()=>globalThis.executed),undefined);
  await page.getByRole('link',{name:'← К результатам поиска',exact:true}).click();assert.equal(await page.locator('#search').inputValue(),'title');
  await page.locator('#search').fill('onOpen');await page.getByRole('link',{name:'Функция: onOpen',exact:true}).click();
  await page.getByRole('heading',{name:'Найденная функция: onOpen',exact:true}).waitFor();assert.match(await page.locator('#matched-source').textContent(),/clientScripts/);
  await page.goto(base+'/p/showcase/#/objects');await page.locator('.entity-row').first().click();
  await page.getByRole('heading',{name:'Доступен просмотр',exact:true}).waitFor();await page.getByRole('link',{name:'Открыть отчёт разбора',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Открыть редактор скриптов',exact:true}).count(),0);
  await page.goto(viewer+'#/article/from-designer-to-review');await page.getByRole('heading',{name:'Раньше и сейчас',exact:true}).waitFor();
  await page.getByRole('link',{name:'Исследовать поле и контекст →',exact:true}).click();await page.getByRole('heading',{name:'Поля и переменные',exact:true}).waitFor();

  await buildPublicSite();publicServer=createStaticPreview();await new Promise(resolve=>publicServer.listen(0,'127.0.0.1',resolve));
  const publicBase='http://127.0.0.1:'+publicServer.address().port,publicRequests=[];
  const publicPage=await context.newPage();publicPage.on('pageerror',e=>errors.push(e.message));publicPage.on('request',r=>publicRequests.push({url:r.url(),type:r.resourceType()}));
  for(const width of [1440,390]) {
    await publicPage.setViewportSize({width,height:900});await publicPage.goto(publicBase+'/learn/find-field/');
    const search=publicPage.locator('.object-search');await search.getByLabel('Поиск поля или функции', {exact:true}).waitFor();
    assert.equal(await search.locator('.entity-row').count(),2);
    await search.getByRole('link',{name:'Поле: title · Тема обращения',exact:true}).focus();await publicPage.keyboard.press('Enter');
    await search.getByRole('heading',{name:'Найденное поле: title',exact:true}).waitFor();assert.match(await search.locator('#matched-source').textContent(),/requests.json/);
    await search.getByRole('link',{name:'Поле: title · Название категории',exact:true}).click();assert.match(await search.locator('#matched-source').textContent(),/categories.json/);
    await search.getByLabel('Поиск поля или функции',{exact:true}).fill('not-found');assert.equal(await search.locator('.entity-row').count(),0);
    await search.getByText(/не доказывает отсутствие/).waitFor();
    await search.getByLabel('Поиск поля или функции',{exact:true}).fill('<img onerror=alert(1)>');assert.equal(await search.locator('img').count(),0);
    await search.getByLabel('Поиск поля или функции',{exact:true}).fill('title');await search.getByRole('link',{name:'Поле: title · Тема обращения',exact:true}).click();
    assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await publicPage.screenshot({path:'qa/public-field-explore-'+width+'.png',fullPage:true});
  }
  assert.ok(publicRequests.every(r=>r.url.startsWith(publicBase)&&!['fetch','xhr','websocket'].includes(r.type)),'Public exploration uses only synthetic static files');

  const root=path.resolve('storybook/storybook-static');
  storybook=http.createServer(async(req,res)=>{try {const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end();}});
  await new Promise(resolve=>storybook.listen(0,'127.0.0.1',resolve));
  for(const state of ['fields','functions','empty','selected','ambiguous']) {
    await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:'+storybook.address().port+'/iframe.html?id=object-search--'+state+'&viewMode=story');
    await page.locator('main').waitFor();
    if(state==='fields'||state==='functions'){await page.locator('.search-hit').first().click();await page.locator('#matched-source').waitFor();}
    if(state==='ambiguous')await page.getByRole('heading',{name:'Точное совпадение не установлено',exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'qa/public-search-story-'+state+'.png',fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('First use: exact private field/function source, retained query/focus, inert source, inspect-only explanation, before/current lesson, real static synthetic search/selection, 390px keyboard/reflow and shared stories passed.');
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));if(publicServer)await new Promise(resolve=>publicServer.close(resolve));if(storybook)await new Promise(resolve=>storybook.close(resolve));
  await fs.rm(directory,{recursive:true,force:true});
}
