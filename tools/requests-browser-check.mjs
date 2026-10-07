import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.mjs';
import { requestCoordinator } from '../lib/request-coordinator.mjs';
import { Store } from '../services/request-bot/store.mjs';
import { Coordinator } from '../services/request-bot/core.mjs';
import { createApp } from '../services/request-bot/server.mjs';

const key = 'synthetic-portal-key-'.repeat(3), store = new Store(':memory:');
const cfg = { projects: { wiki: { repository: 'example/synthetic', taskKind: 'wiki_code' } }, bindings: [],
  portal: { tokenEnv: 'PORTAL_KEY', bindings: [{ owner: 'local', projects: ['wiki'] }] },
  workers: [{ id: 'synthetic-agent', kinds: ['triage', 'implement'], projects: ['wiki'] }] };
const core = new Coordinator(store, cfg), coordinator = createApp(core, { github: {} }, { PORTAL_KEY: key });
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + server.address().port; };
const queue = await listen(coordinator), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-request-browser-'));
const wiki = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined,
  requests: requestCoordinator({ url: queue, token: key }) }), base = await listen(wiki);
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  assert.equal((await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  await page.goto(base + '/requests');
  await page.getByLabel('Что нужно сделать').fill('Synthetic portal change <img src=x onerror=alert(1)>');
  let dropped = false;
  await page.route('**/api/requests', async route => {
    if (!dropped && route.request().method() === 'POST') { dropped = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: 'Отправить задание' }).click();
  await page.getByRole('button', { name: 'Повторить отправку' }).waitFor();
  assert.equal(await page.getByLabel('Что нужно сделать').isDisabled(), true);
  assert.equal(store.all('SELECT * FROM requests').length, 1);
  await page.getByRole('button', { name: 'Повторить отправку' }).click();
  await page.getByRole('heading', { name: 'Задание принято, ожидает разбора' }).waitFor();
  assert.equal(store.all('SELECT * FROM requests').length, 1);
  assert.equal(await page.locator('img').count(), 0, 'request text is never interpreted as HTML');
  const id = store.all('SELECT id FROM requests')[0].id;
  let job = core.claim(cfg.workers[0]);
  core.complete(cfg.workers[0], job.id, job.leaseToken, { type: 'needs_input', questions: ['Какой текст показать?'] });
  await page.getByRole('button', { name: 'Обновить состояние' }).click();
  await page.getByLabel('Ваше уточнение').fill('Synthetic answer');
  await page.getByRole('button', { name: 'Отправить уточнение' }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Задание принято, ожидает разбора' }).waitFor();
  job = core.claim(cfg.workers[0]);
  core.complete(cfg.workers[0], job.id, job.leaseToken, { type: 'specification', summary: 'Synthetic task', criteria: ['Visible message'], scope: ['Portal text'] });
  await page.getByRole('button', { name: 'Обновить состояние' }).click();
  await page.getByRole('heading', { name: 'Согласуйте задание' }).waitFor();
  const approve = page.getByRole('button', { name: 'Согласовать задание', exact: true }); assert.equal(await approve.isDisabled(), true);
  // Another tab revises the specification while this tab still shows the old version.
  core.s.tx(() => core.revise(core.s.request(id), 'local', 'Synthetic change from another tab'));
  await page.getByLabel('Согласовать разработку по этому заданию').check(); await approve.click();
  await page.getByRole('alert').filter({ hasText: 'изменилось' }).waitFor();
  assert.equal(await approve.isDisabled(), true);
  assert.equal(store.all("SELECT * FROM jobs WHERE kind='implement'").length, 0);
  await page.getByRole('button', { name: 'Обновить состояние' }).click();
  await page.getByRole('heading', { name: 'Задание принято, ожидает разбора' }).waitFor();
  job = core.claim(cfg.workers[0]);
  core.complete(cfg.workers[0], job.id, job.leaseToken, { type: 'specification', summary: 'Revised synthetic task', criteria: ['Visible message'], scope: ['Portal text'] });
  await page.getByRole('button', { name: 'Обновить состояние' }).click();
  await page.getByRole('heading', { name: 'Согласуйте задание' }).waitFor();
  await page.getByLabel('Согласовать разработку по этому заданию').focus(); await page.keyboard.press('Space');
  await approve.click(); await page.getByRole('heading', { name: 'Разработка в очереди' }).waitFor();
  assert.equal(core.claim(cfg.workers[0]).kind, 'implement');
  await page.getByRole('button', { name: 'Обновить состояние' }).click();
  await page.getByRole('heading', { name: 'Идёт разработка' }).waitFor();
  await fs.mkdir('qa', { recursive: true });
  await page.screenshot({ path: 'qa/requests-working-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Отменить задание' }).click();
  await page.getByRole('heading', { name: 'Задание отменено' }).waitFor();
  assert.equal(store.request(id).state, 'CANCELLED');
  // Fixtures use the same production renderer; no mocked alternative markup.
  const fixtureStates = ['unconfigured', 'error', 'BLOCKED', 'PR_READY', 'AWAITING_APPROVAL', 'loading', 'empty'];
  for (const state of fixtureStates) {
    await page.evaluate(async state => { const { mountRequests } = await import('/requests/render.js'), { requestFixture } = await import('/requests/fixtures.js'); document.querySelector('#request-root').replaceChildren(mountRequests(requestFixture(state), { refresh: async () => {} })); }, state);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), state + ' must reflow');
  }
  await page.screenshot({ path: 'qa/requests-empty-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.style.zoom = '2');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% zoom');
  assert.deepEqual(errors, []);
  await fs.writeFile('qa/requests-browser-evidence.json', JSON.stringify({ synthetic: true, lifecycle: true, keyboard: true, staleApproval: true, lostAcknowledgement: true, noDuplicate: true, escapedText: true, fixtureStates, viewports: [1440, 390], zoom: '200%', errors }, null, 2));
  console.log('Portal request browser: real session/queue lifecycle, lost-response retry, clarification, approval, worker claim, cancellation, text safety, fixture states, keyboard, mobile and zoom passed.');
} finally {
  if (browser) await browser.close();
  for (const server of [wiki, coordinator]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  store.close(); assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('portal-request-browser-')); await fs.rm(directory, { recursive: true, force: true });
}
