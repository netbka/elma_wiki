import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elma-flow-keyboard-'));
const server = createServer({ directory, allowLocal: true, sendEmail: undefined });
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/flows`);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'Opening a flow does not steal focus');
  async function activate(selector) {
    await page.locator(selector).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.flow-stage h2').evaluate(node => node === document.activeElement), true, 'New step heading receives focus');
  }
  await activate('[data-action="upload"]');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'parse', 'Tab continues at the new step actions');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.flow-stage h2').evaluate(node => node === document.activeElement), true, 'Terminal step receives focus');
  assert.equal(await page.locator('.flow-actions button').count(), 0);
  await activate('.flow-shell > button');
  await activate('[data-action="invalid"]');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'retry');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.flow-stage h2').evaluate(node => node === document.activeElement), true, 'Retry restores focus to the first step');
  // Storybook mounts the same renderer directly, without the catalog shell.
  await page.evaluate(async () => {
    const { mountFlow } = await import('/flows/render.js');
    const { flowById } = await import('/flows/catalog.js');
    document.body.replaceChildren(mountFlow({ flow: flowById('upload') }));
  });
  await activate('[data-action="upload"]');
  assert.deepEqual(errors, []);
  console.log('Workflow keyboard: initial focus, transition, Tab, terminal, restart, retry and standalone renderer passed.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('elma-flow-keyboard-'));
  await fs.rm(directory, { recursive: true, force: true });
}
