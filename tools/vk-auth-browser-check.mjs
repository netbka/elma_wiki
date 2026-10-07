import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';

const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wiki-vk-browser-'));
const messages=[]; let fail=false;
const sendVk=Object.assign(async m=>{if(fail) throw Error('SYNTHETIC_PRIVATE_SECRET'); messages.push(m);},{domain:'example.org',botUrl:'https://teams.vk.com/profile/login_bot'});
const server=createServer({directory,sendEmail:undefined,sendVk,allowLocal:false});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
  const page=await browser.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/login');
  await page.locator('#vk-login-card').waitFor({state:'visible'});
  assert.equal(await page.locator('#email-login-card').isVisible(),false);
  assert.equal(await page.locator('#vk-bot-link').getAttribute('href'),sendVk.botUrl);
  await page.locator('#vk-login').fill('person');
  await page.locator('#send-vk').click();
  await page.getByRole('status').filter({hasText:'Код отправлен в VK Teams'}).waitFor();
  assert.equal(await page.locator('#send-vk').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'vk-key');
  await page.locator('#vk-key').fill('wrong'); await page.locator('#verify-vk').click();
  await page.getByRole('status').filter({hasText:'Неверный или просроченный код'}).waitFor();
  await page.locator('#vk-key').fill(messages[0].key); await page.locator('#verify-vk').click();
  await page.waitForURL('**/dashboard'); await page.locator('#projects').waitFor();
  await page.locator('#logout').click(); await page.waitForURL(base+'/');
  await page.goto(base+'/login'); await page.locator('#vk-login-card').waitFor({state:'visible'});
  fail=true; await page.locator('#vk-login').fill('other'); await page.locator('#send-vk').click();
  await page.getByRole('status').filter({hasText:'Откройте бота входа'}).waitFor();
  assert.equal(await page.locator('#send-vk').isEnabled(),true);
  assert.ok(!(await page.locator('body').innerText()).includes('SYNTHETIC_PRIVATE_SECRET'));
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('VK login UI: mail hidden, bot link, delivery, cooldown, invalid code retry, login, logout, failed delivery and mobile passed.');
} finally {
  if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('wiki-vk-browser-'));
  await fs.rm(directory,{recursive:true,force:true});
}
