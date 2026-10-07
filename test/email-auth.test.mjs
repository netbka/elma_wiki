import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { AUTH_TTL } from '../lib/auth.mjs';
import { loginEmail, emailSettings, createEmailSender } from '../lib/email.mjs';

async function instance(t, options={}) {
  let clock=Date.UTC(2026,0,1); const messages=[];
  const server=createServer({allowLocal:false,sendEmail:async message=>messages.push(message),now:()=>clock,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Elma-Wiki-Request':'1',...extra},body:JSON.stringify(body)});
  return {messages,request,advance:ms=>clock+=ms,get:(route,cookie)=>fetch(base+route,{headers:{cookie:cookie||''}})};
}
const email='person@example.org';
test('email key is single use, normalized owner stable; session lasts exactly 72h',async t=>{
  const a=await instance(t);
  const sent=await a.request('/auth/email/request',{email:'Person@Example.org'});
  assert.equal(sent.status,200); assert.ok(!(await sent.text()).includes(a.messages[0].key));
  const login=await a.request('/auth/email/verify',{email,key:a.messages[0].key.toLowerCase()}); assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie()[0];assert.match(cookie,/Max-Age=259200/);assert.match(cookie,/HttpOnly; SameSite=Lax/);
  const session=await (await a.get('/api/session',cookie.split(';')[0])).json();assert.equal(session.user.provider,'email');assert.equal(session.user.login,email);
  assert.equal((await a.request('/auth/email/verify',{email,key:a.messages[0].key})).status,400);
  a.advance(AUTH_TTL-1);assert.equal((await (await a.get('/api/session',cookie.split(';')[0])).json()).user.id,session.user.id);
  a.advance(1);assert.equal((await (await a.get('/api/session',cookie.split(';')[0])).json()).user,null);
  await a.request('/auth/email/request',{email});const again=await a.request('/auth/email/verify',{email,key:a.messages.at(-1).key});
  assert.equal((await (await a.get('/api/session',again.headers.getSetCookie()[0].split(';')[0])).json()).user.id,session.user.id);
});
test('expiry, replacement, recipient binding and five failed attempts',async t=>{
  const a=await instance(t);
  await a.request('/auth/email/request',{email});const old=a.messages[0].key;
  assert.equal((await a.request('/auth/email/verify',{email:'other@example.org',key:old})).status,400);
  a.advance(60000);await a.request('/auth/email/request',{email});
  assert.equal((await a.request('/auth/email/verify',{email,key:old})).status,400);
  for(let i=0;i<4;i++) assert.equal((await a.request('/auth/email/verify',{email,key:'wrong'})).status,400);
  assert.equal((await a.request('/auth/email/verify',{email,key:a.messages.at(-1).key})).status,400);
  a.advance(60000);await a.request('/auth/email/request',{email});a.advance(AUTH_TTL);
  assert.equal((await a.request('/auth/email/verify',{email,key:a.messages.at(-1).key})).status,400);
});
test('send limits and CSRF, invalid email, unavailable sender and safe delivery errors',async t=>{
  const a=await instance(t);
  assert.equal((await a.request('/auth/email/request',{email:'bad\r\nBcc: attacker@example.org'})).status,400);
  assert.equal((await a.request('/auth/email/request',{email},{Origin:'https://attacker.example'})).status,403);
  await a.request('/auth/email/request',{email});assert.equal((await a.request('/auth/email/request',{email})).status,429);assert.equal(a.messages.length,1);
  const b=await instance(t,{sendEmail:undefined});assert.equal((await b.request('/auth/email/request',{email})).status,503);
  const c=await instance(t,{sendEmail:async()=>{throw Error('PRIVATE_PASSWORD');}});
  const failed=await c.request('/auth/email/request',{email});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('PRIVATE_PASSWORD'));
  assert.equal((await c.request('/auth/email/verify',{email,key:'1234'})).status,400);
});
test('email HTML escapes content, has text alternative, and SMTP uses its own settings',()=>{
  const mail=loginEmail({key:'<script>',expires:Date.UTC(2026,0,4),baseUrl:'https://wiki.example.org'});
  assert.match(mail.html,/lang="ru"/);assert.match(mail.html,/&lt;script&gt;/);assert.match(mail.text,/72 часа/);assert.match(mail.html,/https:\/\/wiki.example.org\/login/);
  const settings=emailSettings({EMAIL_FROM:'sender@example.org',EMAIL_CRED_KEY:'synthetic',IMAP_URL:'imap.mail.ru',IMAP_PORT:'993'});
  assert.equal(settings.port,465);assert.equal(settings.host,'smtp.mail.ru');assert.equal(settings.secure,true);
  assert.equal(createEmailSender({}),undefined);
  assert.throws(()=>emailSettings({SMTP_PORT:'993x'}));assert.throws(()=>emailSettings({EMAIL_FROM:'invalid'}));
});
