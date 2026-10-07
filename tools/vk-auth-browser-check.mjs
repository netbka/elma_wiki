import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-vk-browser-'));
const sendVk = Object.assign(async () => {}, { domain: 'example.org', botUrl: 'https://teams.vk.com/profile/synthetic_login_bot', linkSecret: 'SYNTHETIC_SECRET' });
const server = createServer({ directory, sendEmail: undefined, sendVk, allowLocal: false });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/login');
  await page.locator('#vk-bot-link').waitFor();
  assert.equal(await page.locator('#vk-bot-link').getAttribute('href'), sendVk.botUrl);
  assert.equal(await page.locator('input,form,button').count(), 0);
  assert.equal(await page.locator('main a').count(), 1);
  const link = vkLoginLinks({ secret: sendVk.linkSecret, domain: sendVk.domain, baseUrl: 'http://127.0.0.1:43171' }).issue('person@example.org');
  await page.goto(base + new URL(link).pathname + new URL(link).search);
  await page.waitForURL('**/dashboard'); await page.locator('#projects').waitFor();
  await page.locator('#logout').click(); await page.waitForURL(base + '/');
  await page.goto(base + '/auth/vk/link?token=invalid');
  await page.waitForURL('**/login?expired=1');
  await page.getByRole('status').filter({ hasText: 'истёк' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('Single bot button, no inputs, direct link sign-in, logout, expired-link retry and mobile: passed.');
} finally {
  if (browser) await browser.close(); await new Promise(r => server.close(r));
  await fs.rm(directory, { recursive: true, force: true });
}
