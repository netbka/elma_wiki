import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { comparisons as text } from '../web/managed/labels.js';
import { createServer } from '../server.mjs';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { inventoryOf } from '../lib/delivery.mjs';
import { zip } from '../test/fixture.mjs';

// The harness imports the production renderer and its Storybook fixtures. It
// serves repository assets only; it has no ELMA connection or write adapter.
const root = path.resolve(import.meta.dirname, '..');
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/web/managed/styles.css"><main class="managed-content"></main><script type="module">
import { mountSourceComparisons, mountInstalledComparison } from '/web/managed/comparisons.js';
import { comparisonFixture } from '/web/managed/comparison-fixtures.js';
const mode = new URLSearchParams(location.search).get('mode') || 'compared';
const fixture = comparisonFixture(mode); window.calls = [];
const act = fixture.client.installedAction; fixture.client.installedAction = (...args) => { window.calls.push(args); return act(...args); };
document.querySelector('main').append(mountSourceComparisons({ history: fixture.sourceHistory }), mountInstalledComparison(fixture));
</script>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  if (!/^\/web\/[a-zA-Z0-9_./-]+\.(js|css)$/.test(url.pathname) || url.pathname.includes('..')) { res.writeHead(404).end(); return; }
  try { const bytes = await fs.readFile(path.join(root, url.pathname)); res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const mode of ['compared', 'first-capture', 'source-ambiguous', 'unknown-base', 'drifted', 'unresolved-outcome', 'reconciled', 'stale', 'observation-failed', 'load-error', 'response-lost']) {
    await page.goto(`${base}/?mode=${mode}`);
    const panel = page.getByRole('region', { name: text.installedTitle });
    await panel.getByRole('button', { name: text.refresh, exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('section[aria-label] button')?.disabled);
    assert.equal(await page.evaluate(() => window.calls.length), 0, 'loading history never reads the Target');
    if (['drifted', 'unresolved-outcome', 'observation-failed', 'reconciled'].includes(mode)) await panel.getByText(text.installedStates[mode], { exact: true }).waitFor();
    if (mode === 'stale') { await panel.getByText(text.stale, { exact: true }).waitFor(); assert.equal(await panel.getByText('widgets/contract.json', { exact: true }).count(), 0); }
    if (mode === 'load-error') { await panel.getByText(text.loadError, { exact: true }).waitFor(); assert.equal(await panel.getByRole('button', { name: text.compareInstalled, exact: true }).isDisabled(), true); }
    if (mode === 'response-lost') {
      await panel.getByRole('button', { name: text.compareInstalled, exact: true }).click();
      await panel.getByText(text.responseUnknown, { exact: true }).waitFor();
      assert.equal(await panel.getByRole('button', { name: text.compareInstalled, exact: true }).isDisabled(), true);
      await panel.getByRole('button', { name: text.refresh, exact: true }).click();
      await page.waitForFunction(() => !document.querySelectorAll('section')[1].querySelectorAll('button')[1].disabled);
      assert.equal(await page.evaluate(() => window.calls.length), 1, 'history recovery never replays an action');
    }
    if (mode === 'compared') {
      await panel.getByText('widgets/contract.json', { exact: true }).waitFor();
      const reconcile = panel.getByRole('button', { name: text.reconcileInstalled, exact: true }); await reconcile.focus(); await page.keyboard.press('Enter');
      await panel.getByText(text.installedStates.reconciled, { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.calls[0][1]), { action: 'reconcileInstalled', revision: 2, connectionId: 'preset-dev2' });
      assert.equal(await panel.getByText('widgets/contract.json', { exact: true }).count(), 0);
    }
  }
  await page.goto(base);
  await page.getByText('widgets/contract.json', { exact: true }).waitFor();
  await fs.mkdir(path.join(root, 'qa'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'qa/d2-comparisons-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal page overflow');
  await page.screenshot({ path: path.join(root, 'qa/d2-comparisons-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await integratedJourney(browser);
  console.log('D2 comparison browser: 11 states, exact action binding, keyboard, response recovery, desktop and 390px passed. Synthetic only.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

async function integratedJourney(browser) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-d2-browser-'));
  const service = createServer({ directory, allowLocal: true, syntheticDelivery: true, sendEmail: undefined, sendVk: undefined });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const actor = { id: 'synthetic-author', login: 'author@example.org', provider: 'local' };
    const solutions = solutionStore(directory);
    const bytes = async value => zip([['package.json', { code: 'synthetic_d2', type: 'SOLUTION' }],
      ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'synthetic', kind: 'WIDGET', path: 'form.json' }] }],
      ['widgets/form.json', { descriptor: { clientScripts: value } }]]);
    const source = { connectionId: 'synthetic-dev', solutionRef: 'synthetic_d2' };
    const first = await solutions.uploads.createSource(SOLUTION_CATALOG, await bytes('first'), source, actor);
    const snapshot = project => ({ projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'full', scopeConfirmed: true });
    let state = await solutions.managed.create(SOLUTION_CATALOG, { name: 'Synthetic D2', baselineOwner: 'Team', snapshot: snapshot(first) }, actor);
    const candidateBytes = await bytes('second');
    const second = await solutions.uploads.createSource(SOLUTION_CATALOG, candidateBytes, source, actor);
    const full = await solutions.managed.prepare(state.id, SOLUTION_CATALOG, { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(second), sameSourceConfirmed: true }, actor);
    state = await solutions.managed.accept(state.id, SOLUTION_CATALOG, full.artifactId, { expectedRevision: full.revision, reviewedDigest: full.artifactDigest }, actor);
    let release = await solutions.handoffs.create(state.id, { expectedRevision: state.revision, title: 'Synthetic D2', intent: 'Synthetic comparison', targetIntent: 'Test only' }, actor);
    const change = async input => { release = await solutions.handoffs.change(state.id, release.id, { revision: release.revision, ...input }, actor); };
    await change({ action: 'details', title: release.title, intent: release.intent, targetIntent: release.targetIntent, limitations: 'Synthetic only', notes: '' });
    for (const row of release.changes) await change({ action: 'review', path: row.path, decision: 'accepted', reason: 'Synthetic review' });
    await change({ action: 'freeze' }); await change({ action: 'approve', reason: 'Synthetic approval' });
    const auth = await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } }); assert.equal(auth.status(), 200);
    const connection = await context.request.post(base + '/api/connections', { headers: { 'X-Elma-Wiki-Request': '1' }, data: {
      name: 'Synthetic DEV2', role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { identity: { host: 'dev2.example.invalid' }, inventory: await inventoryOf(candidateBytes) }
    } }); assert.equal(connection.status(), 201);
    const page = await context.newPage(), errors = [], actions = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/delivery')) actions.push(request.postDataJSON().action); });
    await page.goto(`${base}/solutions?id=${state.id}&view=changes`);
    await page.getByRole('heading', { name: text.sourceTitle, exact: true }).waitFor();
    assert.equal(await page.getByLabel(text.capture, { exact: true }).locator('option').count(), 2);
    await page.getByLabel(text.capture, { exact: true }).selectOption('0'); await page.getByText(text.sourceStates['first-capture'], { exact: true }).waitFor();
    await page.getByLabel(text.capture, { exact: true }).selectOption('1'); await page.getByText(text.changed, { exact: true }).waitFor();
    await page.goto(`${base}/solutions?id=${state.id}&view=handoff&handoff=${release.id}`);
    const panel = page.getByRole('region', { name: text.installedTitle });
    await panel.getByRole('button', { name: text.compareInstalled, exact: true }).click();
    await panel.getByText(text.installedStates['unknown-base'], { exact: true }).waitFor();
    await panel.getByRole('button', { name: text.reconcileInstalled, exact: true }).click();
    await panel.getByText(text.installedStates.reconciled, { exact: true }).waitFor();
    await panel.getByRole('button', { name: text.compareInstalled, exact: true }).click();
    await panel.getByText(text.installedStates.compared, { exact: true }).waitFor();
    assert.deepEqual(actions, ['compareInstalled', 'reconcileInstalled', 'compareInstalled']);
    await page.reload(); await page.getByRole('region', { name: text.installedTitle }).getByText(text.installedStates.compared, { exact: true }).waitFor();
    await panel.screenshot({ path: path.join(root, 'qa/d2-comparisons-integrated-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.screenshot({ path: path.join(root, 'qa/d2-comparisons-integrated-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('D2 combined HTTP/UI journey: real synthetic capture history, approved candidate, unknown -> reconciled -> compared, reload; no delivery dispatch.');
  } finally { await context.close(); await new Promise(resolve => service.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
}
