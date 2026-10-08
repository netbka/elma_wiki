import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { bugReportStore, bugGitHub, bugLimits } from '../lib/bug-reports.mjs';
import { createServer } from '../server.mjs';

const actor = { id: 'local', login: 'local', provider: 'local' };
const other = { id: 'other', login: 'other@example.org', provider: 'email' };
const input = () => ({ id: crypto.randomUUID(), title: 'Synthetic bug', text: '<img src=x onerror=alert(1)>\nExpected a readable page.', kind: 'bug', publishConfirmed: true,
  context: { route: '/solutions', viewport: { width: 1440, height: 900, devicePixelRatio: 1 } }, attachments: [{ name: 'synthetic.png', mime: 'image/png', data: png.toString('base64') }] });
async function directory(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bugs-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const baseUrl = 'https://wiki.example.org';

test('durable shared report, exact attachments and actor attribution survive restart; no configuration never claims publication', async t => {
  const root = await directory(t), store = bugReportStore(root, { baseUrl });
  const report = await store.submit(input(), actor);
  assert.equal(report.status, 'unconfigured'); assert.equal(report.issue, null); assert.deepEqual(report.actor, actor);
  const restored = bugReportStore(root, { baseUrl });
  assert.equal((await restored.get(report.id, other)).title, report.title);
  const file = await restored.attachment(report.id, report.attachments[0].id, other);
  assert.deepEqual(file.bytes, png);
  await assert.rejects(restored.get(report.id, null), /authenticated actor/);
  await fs.writeFile(path.join(root, 'bug-reports', report.id, report.attachments[0].id + '.bin'), 'corrupt');
  await assert.rejects(restored.attachment(report.id, report.attachments[0].id, other), /Целостность/);
});

test('same operation/payload retries publish once; changed payload or actor cannot reuse it', async t => {
  const root = await directory(t); let calls = 0;
  const github = { repository: 'example/synthetic', upload: async () => 'https://github.com/user-attachments/assets/' + crypto.randomUUID(), publish: async () => { calls++; return { number: 85, url: 'https://github.com/example/synthetic/issues/85' }; } };
  const store = bugReportStore(root, { baseUrl, github }), value = input();
  const results = await Promise.all([store.submit(value, actor), store.submit(value, actor), store.retry(value.id, other)]);
  assert.equal(calls, 1); assert.ok(results.every(report => report.status === 'published'));
  await assert.rejects(store.submit({ ...value, text: 'changed' }, actor), /другим содержимым/);
  await assert.rejects(store.submit(value, other), /другим содержимым/);
});

test('partial attachment failure survives restart, keeps completed receipts and never creates an incomplete issue', async t => {
  const root = await directory(t); let uploads = 0, publications = 0, refused = true;
  const github = { repository: 'example/synthetic', upload: async () => {
    uploads++; if (uploads === 2 && refused) throw Error('synthetic lost upload response');
    return 'https://github.com/user-attachments/assets/' + crypto.randomUUID();
  }, publish: async report => {
    publications++; assert.ok(report.attachments.every(item => item.githubUrl)); return { number: 85, url: 'https://github.com/example/synthetic/issues/85' };
  } };
  const value = input(); value.attachments.push(value.attachments[0]);
  const first = await bugReportStore(root, { baseUrl, github }).submit(value, actor);
  assert.equal(first.status, 'attachment-failed'); assert.equal(publications, 0); assert.ok(first.attachments[0].githubUrl); assert.ok(!first.attachments[1].githubUrl);
  refused = false;
  const result = await bugReportStore(root, { baseUrl, github }).retry(value.id, other);
  assert.equal(result.status, 'published'); assert.equal(uploads, 3); assert.equal(publications, 1); assert.equal(result.attachments[0].githubUrl, first.attachments[0].githubUrl);
});

test('ambiguous publication survives restart and reconciles without redispatch', async t => {
  const root = await directory(t); let calls = 0, recoverCalls = 0, found = false;
  const github = { repository: 'example/synthetic', upload: async () => 'https://github.com/user-attachments/assets/' + crypto.randomUUID(), publish: async () => { calls++; throw Error('synthetic lost response'); },
    recover: async () => { recoverCalls++; return found ? { number: 85, url: 'https://github.com/example/synthetic/issues/85' } : null; } };
  const value = input(), first = await bugReportStore(root, { baseUrl, github }).submit(value, actor);
  assert.equal(first.status, 'unknown');
  assert.equal((await bugReportStore(root, { baseUrl }).retry(value.id, actor)).status, 'unknown', 'temporarily removing credentials cannot make an ambiguous issue safe to redispatch');
  const store = bugReportStore(root, { baseUrl, github });
  assert.equal((await store.submit(value, actor)).status, 'unknown'); assert.equal(calls, 1);
  found = true; assert.equal((await store.retry(value.id, other)).status, 'published'); assert.equal(calls, 1); assert.equal(recoverCalls, 2);
});

test('known GitHub refusal permits explicit retry; a new configured repository cannot repurpose an existing dispatch', async t => {
  const root = await directory(t), github = { repository: 'example/synthetic', upload: async () => 'https://github.com/user-attachments/assets/' + crypto.randomUUID(), publish: async () => { throw Object.assign(Error('synthetic HTTP refusal'), { unknown: false }); } };
  const value = input(), result = await bugReportStore(root, { baseUrl, github }).submit(value, actor);
  assert.equal(result.status, 'failed');
  const changed = bugReportStore(root, { baseUrl, github: { repository: 'example/other', publish: async () => assert.fail('must not dispatch') } });
  await assert.rejects(changed.retry(value.id, actor), /Получатель/);
  github.publish = async () => ({ number: 1, url: 'https://github.com/example/synthetic/issues/1' });
  assert.equal((await bugReportStore(root, { baseUrl, github }).retry(value.id, actor)).status, 'published');
});

test('five attachments allowed; six, oversized, forged actor, invalid media and unsafe context/paths are rejected', async t => {
  const store = bugReportStore(await directory(t), { baseUrl });
  const five = input(); five.attachments = Array.from({ length: 5 }, () => input().attachments[0]);
  assert.equal((await store.submit(five, actor)).attachments.length, 5);
  for (const change of [
    value => value.attachments = Array.from({ length: 6 }, () => value.attachments[0]),
    value => value.attachments[0].data = Buffer.alloc(bugLimits.attachmentBytes + 1).toString('base64'),
    value => value.actor = other,
    value => value.id = '../outside',
    value => value.attachments[0].name = '../file.txt',
    value => value.attachments[0].mime = 'image/svg+xml',
    value => value.attachments[0].mime = 'image/jpeg',
    value => value.context.route = '/login?token=secret',
    value => value.context.viewport.width = -1,
    value => value.publishConfirmed = false,
  ]) { const value = input(); change(value); await assert.rejects(store.submit(value, actor)); }
});

test('GitHub adapter uploads exact bytes to native assets and publishes their links without actor identity', async () => {
  const calls = [], asset = 'https://github.com/user-attachments/assets/' + crypto.randomUUID();
  const adapter = bugGitHub({ repository: 'example/synthetic', token: 'synthetic-token', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.startsWith('https://uploads.github.com/') ? { url: asset } : options.method === 'POST' ? { number: 85 } : { id: 123 }), { status: 200 });
  } });
  const value = input(); value.actor = other;
  const item = { id: crypto.randomUUID(), name: 'synthetic.png', mime: 'image/png' };
  item.githubUrl = await adapter.upload(item, png); value.attachments = [item];
  const receipt = await adapter.publish(value, baseUrl);
  assert.equal(receipt.url, 'https://github.com/example/synthetic/issues/85');
  assert.deepEqual(calls[1].options.body, png);
  assert.equal(new URL(calls[1].url).searchParams.get('repository_id'), '123');
  const body = JSON.parse(calls[2].options.body);
  assert.ok(body.body.includes(asset)); assert.ok(!body.body.includes(other.login));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  await assert.rejects(adapter.publish({ ...value, attachments: [{ ...item, githubUrl: null }] }, baseUrl), /Upload all/);
});

test('complete GitHub recovery rejects duplicate markers on later pages, incomplete lists and malformed receipts', async () => {
  const id = crypto.randomUUID(), marker = `<!-- wiki-bug:${id} -->\n`, rows = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, body: 'other' })); rows[0] = { number: 85, body: marker };
  const client = pages => bugGitHub({ repository: 'example/synthetic', token: 'synthetic-token', fetchImpl: async url => new Response(JSON.stringify(pages[Number(new URL(url).searchParams.get('page')) - 1]), { status: 200 }) });
  await assert.rejects(client([rows, [{ number: 86, body: marker }]]).recover(id), /неоднозначные/);
  await assert.rejects(client([rows, rows.map(row => ({ ...row, body: 'other' })), rows.map(row => ({ ...row, body: 'other' }))]).recover(id), /неполон/);
  await assert.rejects(client([[{ number: -1, body: marker }]]).recover(id), /номер/);
  assert.equal((await client([rows, []]).recover(id)).number, 85);
  assert.equal(await client([[{ number: 99, body: 'Copied marker ' + marker }]]).recover(id), null);
});

test('HTTP enforces authentication, same-origin guards, session actor and private attachment access', async t => {
  const root = await directory(t), server = createServer({ directory: root, allowLocal: true, sendEmail: undefined, sendVk: undefined, requests: null, bugPublisher: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/api/bug-reports')).status, 401);
  const login = await fetch(base + '/auth/local', { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const options = value => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, body: JSON.stringify(value) });
  const denied = options(input()); denied.headers.Origin = 'https://other.example';
  assert.equal((await fetch(base + '/api/bug-reports', denied)).status, 403);
  const value = input(), response = await fetch(base + '/api/bug-reports', options(value));
  assert.equal(response.status, 201); const report = await response.json(); assert.equal(report.actor.id, 'local');
  const url = `${base}/api/bug-reports/${report.id}/attachments/${report.attachments[0].id}`;
  assert.equal((await fetch(url)).status, 401);
  const attachment = await fetch(url, { headers: { Cookie: cookie } });
  assert.match(attachment.headers.get('content-disposition'), /^attachment;/); assert.equal(attachment.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), png);
  const page = await fetch(base + '/solutions', { headers: { Cookie: cookie } }); assert.ok((await page.text()).includes('/feedback/page.js'));
  const secret = options({ ...input(), performedBy: other }); assert.equal((await fetch(base + '/api/bug-reports', secret)).status, 400);
});
