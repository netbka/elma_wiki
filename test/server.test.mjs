import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { fixture } from './fixture.mjs';

const jsonHeaders = { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' };
function raw(base, route, options) {
  return new Promise((resolve, reject) => { const req = http.request(base + route, options, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); });
}
async function instance(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elma-wiki-test-'));
  const server = createServer({ directory, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('elma-wiki-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { base, directory, request: (route, options) => fetch(base + route, options) };
}
async function localLogin(request) {
  const response = await request('/auth/local', { method: 'POST', headers: jsonHeaders });
  assert.equal(response.status, 200); return response.headers.getSetCookie()[0].split(';')[0];
}
test('landing and synthetic showcase are public; all personal data require a session', async t => {
  const { request } = await instance(t);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/guide')).status, 200);
  const demo = await (await request('/p/showcase/data.json')).json();
  assert.equal(demo.servers.showcase.stats.entities, 6);
  assert.equal((await request('/api/portals')).status, 401);
  assert.equal((await request('/p/local/data.json')).status, 404);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/.local/data.json')).status, 404);
  assert.equal((await request('/p/showcase/api/import', { method: 'POST', headers: { ...jsonHeaders, 'Content-Type': 'application/octet-stream' }, body: await fixture() })).status, 403);
});
test('upload persists a sanitized index; invalid upload preserves the previous state', async t => {
  const { request, directory } = await instance(t), cookie = await localLogin(request);
  const portal = await (await request('/api/portals', { method: 'POST', headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify({ name: 'Учебный портал' }) })).json();
  const upload = buffer => request(`/p/${portal.id}/api/import?server=development`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'X-Elma-Wiki-Import': '1' }, body: buffer });
  const report = await (await upload(await fixture())).json(); assert.equal(report.entities, 1);
  assert.equal((await request(`/p/${portal.id}/data.json`)).status, 404);
  const data = await (await request(`/p/${portal.id}/data.json`, { headers: { Cookie: cookie } })).json();
  assert.equal(data.servers.development.entities.length, 1);
  assert.ok(!JSON.stringify(data).includes('TEST_SENTINEL_VALUE_NOT_A_REAL_SECRET'));
  assert.equal((await upload(Buffer.from('bad archive'))).status, 400);
  const persisted = await fs.readFile(path.join(directory, 'portals', portal.id, 'data.json'), 'utf8');
  assert.deepEqual(JSON.parse(persisted), data);
  assert.deepEqual(await fs.readdir(path.join(directory, 'portals', portal.id)), ['data.json']);
});
test('cross-origin writes, missing request headers and forged Host are rejected', async t => {
  const { request, base } = await instance(t);
  assert.equal((await request('/auth/local', { method: 'POST', headers: { ...jsonHeaders, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/auth/local', { method: 'POST' })).status, 403);
  assert.equal(await raw(base, '/api/session', { headers: { Host: 'evil.example' } }), 403);
  assert.equal((await request('/%ZZ')).status, 400);
});
test('OAuth state and PKCE, isolated owners, and token never appears in response/storage', async t => {
  let identity = 101, verifier;
  const fakeToken = 'TEST_OAUTH_TOKEN_NOT_REAL';
  const fetchImpl = async (url, options) => {
    if (url === 'https://github.com/login/oauth/access_token') { verifier = JSON.parse(options.body).code_verifier; return Response.json({ access_token: fakeToken }); }
    if (url === 'https://api.github.com/user') return Response.json({ id: identity, login: 'example-user-' + identity });
    throw Error('Unexpected outbound request');
  };
  const { request, directory } = await instance(t, { clientId: 'TEST_CLIENT_ID', clientSecret: 'TEST_CLIENT_SECRET', fetchImpl });
  async function login() {
    const start = await request('/auth/github', { redirect: 'manual' }), location = new URL(start.headers.get('location'));
    assert.ok(location.searchParams.get('code_challenge')); assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    const stateCookie = start.headers.getSetCookie()[0].split(';')[0];
    const callback = await request('/auth/github/callback?code=test-code&state=' + location.searchParams.get('state'), { redirect: 'manual', headers: { Cookie: stateCookie } });
    assert.equal(callback.status, 302); assert.ok(verifier);
    const cookies = callback.headers.getSetCookie(); return cookies.find(c => c.startsWith('elma_session=')).split(';')[0];
  }
  assert.equal((await request('/auth/github/callback?state=bad&code=x')).status, 400);
  const first = await login();
  const portal = await (await request('/api/portals', { method: 'POST', headers: { ...jsonHeaders, Cookie: first }, body: '{"name":"First"}' })).json();
  identity = 202; const second = await login();
  assert.deepEqual(await (await request('/api/portals', { headers: { Cookie: second } })).json(), []);
  assert.equal((await request(`/p/${portal.id}/data.json`, { headers: { Cookie: second } })).status, 404);
  const profile = await (await request('/api/session', { headers: { Cookie: first } })).json();
  assert.ok(!JSON.stringify(profile).includes(fakeToken));
  assert.ok(!(await fs.readFile(path.join(directory, 'portals.json'), 'utf8')).includes(fakeToken));
  assert.equal((await request('/auth/logout', { method: 'POST', headers: { ...jsonHeaders, Cookie: first } })).status, 200);
  assert.equal((await request('/api/portals', { headers: { Cookie: first } })).status, 401);
});
test('external service disables local login', async t => {
  const { base } = await instance(t, { baseUrl: 'https://wiki.example.com', allowLocal: false });
  assert.equal(await raw(base, '/auth/local', { method: 'POST', headers: { ...jsonHeaders, Host: 'wiki.example.com' } }), 400);
});
