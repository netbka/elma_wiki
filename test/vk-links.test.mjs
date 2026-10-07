import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vkLoginLinks, VK_LINK_TTL } from '../lib/vk-login-links.mjs';
import { createVkLoginBot } from '../lib/vk-login-bot.mjs';
import { createServer } from '../server.mjs';

const env = { VK_LOGIN_BOT_POLL: '1', VK_BOT_AUTH_TOKEN: 'SYNTHETIC_PRIVATE_SECRET', VK_API_BASE: 'https://vk.example.org/bot/v1', PORTAL_EMAIL_DOMAIN: 'example.org' };
test('link lasts exactly seven days, survives restart and rejects tampering, wrong origin and foreign identity', () => {
  let clock = 1000000;
  const options = { secret: env.VK_BOT_AUTH_TOKEN, baseUrl: 'https://wiki.example.org', domain: env.PORTAL_EMAIL_DOMAIN, now: () => clock };
  const links = vkLoginLinks(options), token = new URL(links.issue('Person@example.org')).searchParams.get('token');
  assert.equal(vkLoginLinks(options).verify(token), 'person@example.org');
  assert.equal(links.verify(token + 'x'), null);
  assert.equal(links.verify(token + '.extra'), null);
  assert.equal(vkLoginLinks({ ...options, baseUrl: 'https://elsewhere.example.org' }).verify(token), null);
  assert.equal(vkLoginLinks({ ...options, secret: 'different' }).verify(token), null);
  assert.throws(() => links.issue('person@attacker.org'));
  clock += VK_LINK_TTL - 1; assert.equal(links.verify(token), 'person@example.org');
  clock++; assert.equal(links.verify(token), null);
});
test('private bot reply uses verified sender, ignores groups/foreign/spoofed chat, checkpoints only after successful send', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const event = { eventId: 42, type: 'newMessage', payload: { chat: { type: 'private', chatId: 'person@example.org' }, from: { userId: 'person@example.org' }, text: 'other@example.org' } };
  const calls = []; let fail = true;
  const bot = createVkLoginBot({ env, directory, issueLink: email => 'https://wiki.example.org/' + email, fetchImpl: async url => {
    calls.push(url);
    if (url.pathname.endsWith('/events/get')) return Response.json({ events: [event] });
    if (fail) throw Error('secret');
    return Response.json({ ok: true });
  } });
  assert.equal(createVkLoginBot({ env: { ...env, VK_LOGIN_BOT_POLL: '0' }, directory }), null);
  for (const payload of [ { ...event.payload, chat: { type: 'group', chatId: 'person@example.org' } }, { ...event.payload, from: { userId: 'foreign@attacker.org' } }, { ...event.payload, chat: { type: 'private', chatId: 'other@example.org' } } ]) await bot.handle({ ...event, payload });
  assert.equal(calls.length, 0);
  const run = bot.run(); t.after(() => bot.stop());
  while (!bot.status.error) await new Promise(r => setTimeout(r, 10));
  await assert.rejects(fs.readFile(path.join(directory, 'vk-login-cursor.json')), { code: 'ENOENT' });
  fail = false;
  while (!bot.status.lastSuccess) await new Promise(r => setTimeout(r, 10));
  bot.stop(); await run;
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'vk-login-cursor.json'))).lastEventId, 42);
  const sent = calls.findLast(u => u.pathname.endsWith('/messages/sendText'));
  assert.equal(sent.searchParams.get('chatId'), 'person@example.org');
  assert.ok(sent.searchParams.get('text').includes('https://wiki.example.org/person@example.org'));
  assert.equal(JSON.parse(sent.searchParams.get('inlineKeyboardMarkup'))[0][0].url, 'https://wiki.example.org/person@example.org');
  let restored;
  const again = createVkLoginBot({ env, directory, issueLink: () => '', fetchImpl: async url => { restored = url.searchParams.get('lastEventId'); again.stop(); return Response.json({ ok: true, events: [] }); } });
  await again.run(); assert.equal(restored, '42');
});
test('clicking a bot link signs in directly for a week and preserves VK project owner', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-links-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let clock = 1000000;
  const sendVk = Object.assign(async () => {}, { domain: env.PORTAL_EMAIL_DOMAIN, linkSecret: env.VK_BOT_AUTH_TOKEN, botUrl: 'https://teams.vk.com/profile/synthetic' });
  const server = createServer({ directory, sendEmail: undefined, sendVk, now: () => clock });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  // createServer's default origin remains its configured origin, even on an ephemeral test port.
  const link = vkLoginLinks({ secret: env.VK_BOT_AUTH_TOKEN, baseUrl: 'http://127.0.0.1:43171', domain: env.PORTAL_EMAIL_DOMAIN, now: () => clock }).issue('person@example.org');
  const click = () => fetch(base + new URL(link).pathname + new URL(link).search, { redirect: 'manual' });
  const response = await click(); assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/solutions');
  assert.match(response.headers.get('set-cookie'), /Max-Age=604800/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const session = await (await fetch(base + '/api/session', { headers: { cookie } })).json();
  assert.equal(session.user.provider, 'vk-teams'); assert.equal(session.user.login, 'person@example.org');
  assert.equal((await click()).status, 303); // Reusable for the requested week.
  clock += VK_LINK_TTL;
  assert.equal((await click()).headers.get('location'), '/login?expired=1');
  assert.equal((await fetch(base + '/api/projects', { headers: { cookie } })).status, 401);
});
