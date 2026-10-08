import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { createVkSender, normalizeVkLogin } from '../lib/vk-teams.mjs';
import { configuration, inspectConfiguration } from '../lib/service-config.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AUTH_TTL } from '../lib/auth.mjs';
import { fixture } from './fixture.mjs';

const env={VK_BOT_AUTH_TOKEN:'SYNTHETIC_SECRET',VK_API_BASE:'https://vk.example.org/bot/v1',PORTAL_EMAIL_DOMAIN:'example.org',VK_BOT_AUTH_NAME:'@login_bot'};
async function instance(t, options={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wiki-vk-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let clock=1000000; const messages=[];
  const sendVk=Object.assign(async m=>messages.push(m),{domain:'example.org',botUrl:'https://teams.vk.com/profile/login_bot'});
  const server=createServer({directory,allowLocal:false,sendEmail:undefined,sendVk,now:()=>clock,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Elma-Wiki-Request':'1',...extra},body:JSON.stringify(body)});
  const get=(route,cookie='')=>fetch(base+route,{headers:{cookie}});
  return {base,post,get,messages,advance:ms=>clock+=ms};
}
test('VK login needs no mail, binds recipient, consumes code and isolates provider owners',async t=>{
  const a=await instance(t);
  const info=await (await a.get('/api/session')).json();
  assert.equal(info.emailConfigured,false); assert.equal(info.vkConfigured,true); assert.ok(!JSON.stringify(info).includes(env.VK_BOT_AUTH_TOKEN));
  const sent=await a.post('/auth/vk/request',{login:' Person '}); assert.equal(sent.status,200);
  const {key,email}=a.messages[0]; assert.equal(email,'person@example.org'); assert.ok(!(await sent.text()).includes(key));
  assert.equal((await a.post('/auth/vk/verify',{login:'other',key})).status,400);
  assert.equal((await a.post('/auth/email/verify',{email,key})).status,503);
  const response=await a.post('/auth/vk/verify',{login:'PERSON@EXAMPLE.ORG',key}); assert.equal(response.status,200);
  const cookie=response.headers.getSetCookie()[0]; assert.match(cookie,/HttpOnly; SameSite=Lax/);
  const session=await (await a.get('/api/session',cookie.split(';')[0])).json(); assert.equal(session.user.provider,'vk-teams'); assert.match(session.user.id,/^vk:/);
  assert.equal((await a.post('/auth/vk/verify',{login:'person',key})).status,400);
  assert.equal((await a.get('/api/projects')).status,401); assert.equal((await a.get('/api/projects',cookie.split(';')[0])).status,200);
  a.advance(60000); await a.post('/auth/vk/request',{login:'person'});
  const again=await a.post('/auth/vk/verify',{login:'person',key:a.messages.at(-1).key});
  assert.equal((await (await a.get('/api/session',again.headers.getSetCookie()[0].split(';')[0])).json()).user.id,session.user.id);
  a.advance(AUTH_TTL); assert.equal((await (await a.get('/api/session',again.headers.getSetCookie()[0].split(';')[0])).json()).user,null);
});
test('VK authenticated users share projects and original bytes with distinct upload attribution',async t=>{
  const a=await instance(t);
  async function login(user) {
    await a.post('/auth/vk/request',{login:user});
    const response=await a.post('/auth/vk/verify',{login:user,key:a.messages.at(-1).key});
    return response.headers.getSetCookie()[0].split(';')[0];
  }
  const first=await login('first'),second=await login('second');
  const uploaded=await fetch(a.base+'/api/projects?filename=synthetic.e365',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Elma-Wiki-Request':'1',cookie:first},body:await fixture()});
  assert.equal(uploaded.status,201); const project=await uploaded.json();
  assert.equal((await a.get('/api/projects/'+project.id+'/original',first)).status,200);
  const original = await a.get('/api/projects/'+project.id+'/original',second);
  assert.equal(original.status,200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()),await fixture());
  assert.equal((await (await a.get('/api/projects',second)).json())[0].id,project.id);
  assert.equal(project.uploadedBy.login,'first@example.org');
});
test('VK expiry, five guesses, replacement, rate limit, CSRF and safe delivery errors',async t=>{
  const a=await instance(t); await a.post('/auth/vk/request',{login:'person'}); const old=a.messages[0].key;
  assert.equal((await a.post('/auth/vk/request',{login:'person'})).status,429);
  assert.equal((await a.post('/auth/vk/request',{login:'foreign@elsewhere.org'})).status,400);
  assert.equal((await a.post('/auth/vk/request',{login:'person'},{Origin:'https://attacker.example'})).status,403);
  a.advance(60000); await a.post('/auth/vk/request',{login:'person'});
  assert.equal((await a.post('/auth/vk/verify',{login:'person',key:old})).status,400);
  for(let i=0;i<4;i++) assert.equal((await a.post('/auth/vk/verify',{login:'person',key:'wrong'})).status,400);
  assert.equal((await a.post('/auth/vk/verify',{login:'person',key:a.messages.at(-1).key})).status,400);
  a.advance(60000); await a.post('/auth/vk/request',{login:'person'}); a.advance(600000);
  assert.equal((await a.post('/auth/vk/verify',{login:'person',key:a.messages.at(-1).key})).status,400);
  const b=await instance(t,{sendVk:Object.assign(async()=>{throw Error(env.VK_BOT_AUTH_TOKEN);},{domain:'example.org'})});
  const failed=await b.post('/auth/vk/request',{login:'person'}); assert.equal(failed.status,503); assert.ok(!(await failed.text()).includes(env.VK_BOT_AUTH_TOKEN));
  assert.equal((await b.post('/auth/vk/verify',{login:'person',key:old})).status,400);
  const c=await instance(t,{sendVk:undefined}); assert.equal((await c.post('/auth/vk/request',{login:'person'})).status,503);
});
test('VK adapter uses SvoiBot sendText contract, rejects unsuccessful delivery and redirects',async()=>{
  let seen;
  const send=createVkSender(env,async(url,opts)=>{seen={url,opts};return Response.json({ok:true});});
  await send({email:'person@example.org',key:'SYNTHETIC-CODE',baseUrl:'https://wiki.example.org'});
  assert.equal(seen.url.pathname,'/bot/v1/messages/sendText'); assert.equal(seen.url.searchParams.get('chatId'),'person@example.org');
  assert.equal(seen.url.searchParams.get('token'),env.VK_BOT_AUTH_TOKEN); assert.match(seen.url.searchParams.get('text'),/https:\/\/wiki.example.org/); assert.equal(seen.opts.redirect,'error');
  for(const result of [{ok:false},{}]) await assert.rejects(createVkSender(env,async()=>Response.json(result))({email:'person@example.org',key:'x',baseUrl:'https://wiki.example.org'}));
  assert.equal(createVkSender({}),undefined); assert.throws(()=>createVkSender({...env,VK_API_BASE:'http://vk.example.org'}));
  assert.throws(()=>normalizeVkLogin('person@attacker.example','example.org'));
});
test('external configuration and doctor accept VK without SMTP and do not reveal secrets',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wiki-vk-test-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const values=configuration({baseUrl:'https://wiki.example.org',container:true,vkBotToken:env.VK_BOT_AUTH_TOKEN,vkApiBase:env.VK_API_BASE,vkDomain:env.PORTAL_EMAIL_DOMAIN});
  assert.equal(values.EMAIL_FROM,''); assert.equal(values.DISABLE_LOCAL_LOGIN,'1');
  const report=await inspectConfiguration(root,{filename:'.env.production',environment:values}); assert.equal(report.ready,true); assert.equal(report.vkConfigured,true); assert.equal(report.emailConfigured,false); assert.ok(!JSON.stringify(report).includes(env.VK_BOT_AUTH_TOKEN));
  const broken=await inspectConfiguration(root,{filename:'.env.production',environment:{...values,VK_BOT_AUTH_TOKEN:''}}); assert.equal(broken.ready,false);
});
