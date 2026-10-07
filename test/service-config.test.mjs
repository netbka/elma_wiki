import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configuration,saveConfiguration,inspectConfiguration } from '../lib/service-config.mjs';
import { createServer } from '../server.mjs';
import { checkHealth } from '../lib/healthcheck.mjs';
const sentinel='SYNTHETIC_SECRET_NEVER_REAL';
async function workspace(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'e365-setup-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('e365-setup-test-'));await fs.rm(root,{recursive:true,force:true});});return root;
}
test('configuration rejects unsafe origins, HTTP production and incomplete email credentials',()=>{
  const local=configuration({baseUrl:'http://127.0.0.1:43171'});assert.equal(local.HOST,'127.0.0.1');assert.equal(local.DISABLE_LOCAL_LOGIN,'1');
  const external=configuration({baseUrl:'https://wiki.example.org',emailFrom:'sender@example.org',emailCredKey:sentinel,container:true});assert.equal(external.HOST,'0.0.0.0');assert.equal(external.DISABLE_LOCAL_LOGIN,'1');
  for(const baseUrl of ['http://wiki.example.org','https://user:password@wiki.example.org','https://wiki.example.org/path','https://wiki.example.org/?query=1','file:///'])assert.throws(()=>configuration({baseUrl,emailFrom:'sender@example.org',emailCredKey:sentinel}));
  assert.throws(()=>configuration({baseUrl:'http://127.0.0.1:43171',container:true}),/HTTPS/);
  assert.throws(()=>configuration({baseUrl:'http://127.0.0.1:43171',emailFrom:'sender@example.org'}),/оба/);
  assert.throws(()=>configuration({baseUrl:'https://wiki.example.org',emailFrom:'sender@example.org',emailCredKey:'bad\nPORT=1'}));
});
test('setup never overwrites existing credentials; doctor only returns safe status and counts',async t=>{
  const root=await workspace(t),values=configuration({baseUrl:'https://wiki.example.org',emailFrom:'sender@example.org',emailCredKey:sentinel,container:true});
  await saveConfiguration(root,'.env.production',values);
  await assert.rejects(saveConfiguration(root,'.env.production',{...values,EMAIL_CRED_KEY:'changed'}),e=>e.code==='EEXIST');
  const report=await inspectConfiguration(root,{filename:'.env.production'});assert.equal(report.ready,true);assert.equal(report.emailConfigured,true);assert.ok(!JSON.stringify(report).includes(sentinel));assert.ok(!JSON.stringify(report).includes('wiki.example.org'));
  assert.ok((await fs.readFile(path.join(root,'.env.production'),'utf8')).includes(sentinel));
  assert.deepEqual(await fs.readdir(path.join(root,'.local')),[]);
  const broken=await inspectConfiguration(root,{filename:'.env.production',environment:{DISABLE_LOCAL_LOGIN:'0'}});assert.equal(broken.ready,false);
  await assert.rejects(saveConfiguration(root,'../outside.env',values));
});
test('production cannot be ready without HTTPS and email; existing Docker volume name is preserved',async t=>{
  const root=await workspace(t);assert.equal((await inspectConfiguration(root,{filename:'.env.production'})).ready,false);
  const compose=await fs.readFile(new URL('../compose.yaml',import.meta.url),'utf8');assert.match(compose,/wiki-data:\/app\/\.local/);assert.match(compose,/volumes:\s+wiki-data:/);
});
test('all private env variants are ignored by Git, example stays trackable',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
  const {stdout}=await run('git',['check-ignore','--no-index','.env','.env.production','.env.staging','credentials.env'],{cwd:root});
  assert.deepEqual(stdout.trim().split(/\r?\n/),['.env','.env.production','.env.staging','credentials.env']);
  const ignore=await fs.readFile(new URL('../.gitignore',import.meta.url),'utf8');assert.ok(ignore.includes('!.env.example'));
  const dockerIgnore=await fs.readFile(new URL('../.dockerignore',import.meta.url),'utf8');assert.ok(dockerIgnore.includes('.env.*'));
});
test('container healthcheck sends the configured HTTPS Host to the loopback backend',async t=>{
  const root=await workspace(t),server=createServer({directory:root,baseUrl:'https://wiki.example.org',allowLocal:false,clientId:'',emailCredKey:''});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const port=server.address().port;
    assert.equal(await checkHealth({port,host:'wiki.example.org'}),true);
    assert.equal(await checkHealth({port,host:'other.example.org'}),false);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
