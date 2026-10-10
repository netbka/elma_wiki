// MR-02 / PLAN-01 P3 UI evidence: durable whole-component merge resolution in
// the existing Solution review, through the authenticated API and the single
// production/Storybook renderer. Synthetic archives only; no ELMA access.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { zip } from '../test/fixture.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-resolution-browser-'));
const start = port => new Promise(resolve => { const instance = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined }); instance.listen(port, '127.0.0.1', () => resolve(instance)); });
let server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const archive = entries => zip([
  ['package.json', { code: 'synthetic_solution', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
const evidence = { synthetic: true, explicitChoiceRequired: false, saved: false, restartVisible: false, competingWrite: false, draftRetained: false, acceptanceUnchanged: false, storybook: [] };
let browser, stories;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fs.mkdir('qa', { recursive: true });
  assert.equal((await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  const json = async (route, data) => {
    const response = await context.request[data ? 'post' : 'get'](base + route, { headers: { 'X-Elma-Wiki-Request': '1' }, ...(data ? { data } : {}) });
    assert.ok(response.ok(), await response.text()); return response.json();
  };
  const snapshot = async (entries, scope) => {
    const response = await context.request.post(base + '/api/solutions/uploads?sharedConfirmed=true', { headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, data: await archive(entries) });
    assert.equal(response.status(), 201); const project = await response.json();
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  const state = await json('/api/solutions', { name: 'Synthetic merge', baselineOwner: 'Vendor', snapshot: await snapshot([['limit', 0], ['contract', 0]], 'full') });
  const route = '/api/solutions/' + state.id, declared = { artifactId: state.baselineId, revision: 0, confirmed: true };
  const prepare = async (value, team) => json(route + '/prepare', { kind: 'change', snapshot: await snapshot([['limit', value]], 'partial'), expectedRevision: 0, team, taskRef: 'MERGE-' + team, sameSourceConfirmed: true, base: declared });
  const a = await prepare(1, 'A'), c = await prepare(2, 'C');
  await json(route + '/artifacts/' + a.artifactId + '/accept', { expectedRevision: 0, reviewedDigest: a.artifactDigest, reviewedBoundaryKeys: a.rows.filter(row => row.boundaryCrossing).map(row => row.key), expectedDiscussionRevision: 0 });
  const url = `${base}/solutions?id=${state.id}&view=review&artifact=${c.artifactId}`;
  await page.goto(url);
  const section = page.getByRole('region', { name: 'Совмещение с принятыми изменениями' });
  await section.waitFor();
  const save = section.getByRole('button', { name: 'Сохранить решение' }), choice = section.getByLabel(/limit:/), reason = section.getByLabel('Причина решения');
  assert.equal(await choice.inputValue(), ''); assert.equal(await save.isDisabled(), true);
  await choice.selectOption('take-incoming'); assert.equal(await save.isDisabled(), true);
  evidence.explicitChoiceRequired = true;
  await reason.fill('Лимит согласован в синтетической задаче');
  await save.click();
  await section.getByText('Сохранённое решение №1').waitFor();
  await section.getByText('Действует для текущих версий').waitFor();
  await section.getByText('limit: Взять версию из этого изменения').waitFor();
  evidence.saved = true;
  assert.equal(await page.getByRole('button', { name: 'Принять изменение' }).count(), 0, 'a stale change still cannot be accepted');
  assert.equal((await json(route)).revision, 1); evidence.acceptanceUnchanged = true;

  // Restart: a new server process reads the committed resolution.
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }); server = await start(Number(new URL(base).port));
  assert.equal((await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  await page.reload(); await section.getByText('Сохранённое решение №1').waitFor(); evidence.restartVisible = true;

  // A competing resolution saved elsewhere makes this tab's submit fail without losing the typed reason.
  const merge = await json(route + '/artifacts/' + c.artifactId + '/merge');
  await section.getByLabel(/limit:/).selectOption('keep-current');
  await section.getByLabel('Причина решения').fill('Черновик в этой вкладке');
  await json(route + '/artifacts/' + c.artifactId + '/merge', { expectedRevision: 1, planDigest: merge.plan.planDigest, expectedResolutionId: merge.head.id,
    decisions: { [merge.plan.rows.find(row => row.status === 'resolution-required').key]: 'keep-current' }, reason: 'Другая вкладка' });
  await section.getByRole('button', { name: 'Сохранить новое решение' }).click();
  await page.getByText('Another resolution was saved; refresh before resolving').waitFor();
  assert.equal(await section.getByLabel('Причина решения').inputValue(), 'Черновик в этой вкладке'); evidence.draftRetained = true;
  const stored = await json(route + '/artifacts/' + c.artifactId + '/merge');
  assert.equal(stored.history.length, 2); assert.equal(stored.head.reason, 'Другая вкладка'); evidence.competingWrite = true;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'live ' + width);
    await page.screenshot({ path: `qa/merge-resolution-live-${width}.png`, fullPage: true });
  }

  const storyRoot = path.resolve('storybook/storybook-static'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  stories = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname, file = path.resolve(storyRoot, '.' + pathname);
      if (!file.startsWith(storyRoot + path.sep)) { res.writeHead(404); res.end(); return; }
      const bytes = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => stories.listen(0, '127.0.0.1', resolve));
  for (const mode of ['merge-required', 'merge-resolved', 'merge-stale', 'merge-blocked']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${stories.address().port}/iframe.html?id=managed-workspace--${mode}&viewMode=story`);
    const story = page.getByRole('region', { name: 'Совмещение с принятыми изменениями' }); await story.waitFor();
    if (mode === 'merge-required') assert.equal(await story.getByLabel('Причина решения').count(), 1);
    if (mode === 'merge-resolved') await story.getByText('Действует для текущих версий').waitFor();
    if (mode === 'merge-stale') await story.getByText(/Устарело/).waitFor();
    if (mode === 'merge-blocked') { await story.getByText(/заблокировано/).waitFor(); assert.equal(await story.locator('select').count(), 0); }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), mode + ' ' + width);
      await page.screenshot({ path: `qa/merge-resolution-story-${mode}-${width}.png`, fullPage: true });
    }
    evidence.storybook.push(mode);
  }
  assert.deepEqual(errors, []);
  console.log('Merge resolution: explicit choice, attributed save, restart, competing write with retained draft, unchanged acceptance gate and 4 Storybook states passed.');
} finally {
  await fs.mkdir('qa', { recursive: true }); await fs.writeFile('qa/merge-resolution-browser-evidence.json', JSON.stringify(evidence, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(() => resolve()));
  if (stories) await new Promise(resolve => stories.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
