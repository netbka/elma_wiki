// Production page/controller with synthetic HTTP responses. No ELMA or live data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { solutionComposerFixture, availableBuild, verifiedEligibility, buildResponseFixtures, composedCandidateFixture } from '../web/managed/composer-fixtures.js';

const web = path.resolve('web'), workspace = solutionComposerFixture('build-ready').model.workspace;
const prefix = `/api/solutions/${workspace.id}`, input = { artifactId: workspace.history.at(-1).id, expectedRevision: workspace.revision };
const candidate = { ...composedCandidateFixture(), solutionId: workspace.id, evidenceBasis: 'native', pendingNativeEvidence: ['native-import-receipt'], deliverable: false };
let scenario, writes, heldBuild, heldFreeze, frozen;
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString('utf8')); };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    if (req.method === 'POST') {
      const body = await readBody(req); writes.push({ route, body, marker: req.headers['x-elma-wiki-request'] });
      if (route === `${prefix}/composed-build`) {
        heldBuild = () => {
          if (scenario === 'build-stale') { json(res, 409, buildResponseFixtures.stale.body); return; }
          if (scenario === 'build-malformed') { json(res, 201, { outcome: 'validated', manifest: { manifestDigest: 'bad' } }); return; }
          json(res, 201, buildResponseFixtures.validated);
        };
        return;
      }
      if (route === `${prefix}/composed`) {
        heldFreeze = () => {
          if (scenario === 'freeze-malformed') { json(res, 201, {}); return; }
          frozen = true; json(res, 201, { outcome: 'frozen', candidate });
        };
        return;
      }
      json(res, 404, {}); return;
    }
    if (route === prefix) { json(res, 200, workspace); return; }
    if (route === `${prefix}/composed`) { json(res, 200, frozen ? [candidate] : []); return; }
    if (route === `${prefix}/composed/${candidate.id}`) { json(res, 200, candidate); return; }
    if (route === `${prefix}/composed-eligibility`) { json(res, 200, verifiedEligibility); return; }
    if (route === '/api/delivery/capabilities') { json(res, 200, { composedBuild: availableBuild }); return; }
    if (route === '/solutions') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><div id="managed-root"></div><script type="module" src="/managed/page.js"></script>'); return;
    }
    const file = path.resolve(web, '.' + route);
    if (!file.startsWith(web + path.sep)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(await fs.readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});

let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  // Abort at the browser transport seam; a closed HTTP socket can trigger a
  // browser-level connection retry and would not model an application replay.
  await page.route('**/api/solutions/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const lostBuild = scenario === 'build-lost' && pathname === `${prefix}/composed-build`;
    const lostFreeze = scenario === 'freeze-lost' && pathname === `${prefix}/composed`;
    if (request.method() === 'POST' && (lostBuild || lostFreeze)) {
      writes.push({ route: pathname, body: request.postDataJSON(), marker: request.headers()['x-elma-wiki-request'] });
      const finish = () => { void route.abort('failed'); };
      if (lostBuild) heldBuild = finish; else heldFreeze = finish;
      return;
    }
    await route.continue();
  });
  const buildCard = () => page.locator('[aria-label="Новая сборка"]');
  const pending = async kind => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const operation = kind === 'build' ? heldBuild : heldFreeze;
      if (operation) return operation;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`No pending ${kind} request`);
  };
  for (const mode of ['success', 'build-stale', 'build-lost', 'build-malformed', 'freeze-lost', 'freeze-malformed']) {
    console.log(`Composer page scenario: ${mode}`);
    scenario = mode; writes = []; heldBuild = heldFreeze = null; frozen = false;
    await page.goto(`http://127.0.0.1:${server.address().port}/solutions?id=${workspace.id}&view=compose`);
    const start = buildCard().getByRole('button', { name: 'Собрать конфигурацию', exact: true });
    await start.waitFor(); assert.equal(await start.isEnabled(), true, mode);
    await start.click();
    // A second DOM activation during the pending request cannot issue another POST.
    await start.evaluate(button => button.click());
    const finishBuild = await pending('build');
    assert.equal(await start.isDisabled(), true);
    assert.deepEqual(writes, [{ route: `${prefix}/composed-build`, body: input, marker: '1' }]);
    finishBuild();
    if (mode.startsWith('build-')) {
      await buildCard().getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
      assert.equal(await buildCard().getByRole('button', { name: 'Собрать заново', exact: true }).isDisabled(), true, mode);
      assert.equal(await buildCard().getByRole('button', { name: 'Зафиксировать сборку', exact: true }).count(), 0, mode);
      assert.equal(writes.length, 1, 'no automatic replay'); continue;
    }
    const freeze = buildCard().getByRole('button', { name: 'Зафиксировать сборку', exact: true });
    await freeze.waitFor(); await freeze.click(); await freeze.evaluate(button => button.click());
    assert.equal(await freeze.isDisabled(), true);
    const finishFreeze = await pending('freeze');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], { route: `${prefix}/composed`, body: { ...input, manifestDigest: 'd'.repeat(64) }, marker: '1' });
    finishFreeze();
    if (mode === 'success') {
      await page.waitForURL(url => url.searchParams.get('candidate') === candidate.id);
      await page.getByRole('region', { name: 'Выбранная сборка', exact: true }).waitFor();
      assert.match(await page.locator('#managed-root').textContent(), /Нативная сборка: подтверждение установки/);
    } else {
      await buildCard().getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
      assert.equal(await buildCard().getByRole('button', { name: 'Собрать заново', exact: true }).isDisabled(), true, mode);
      assert.equal(writes.length, 2, 'unknown freeze is never replayed');
    }
  }
  assert.deepEqual(errors, []);
  console.log('Production composer page: exact build/freeze POSTs, pending double-submit guards, navigation, stale/malformed/lost responses and no replay passed (synthetic HTTP).');
} finally { await browser?.close(); server.closeAllConnections(); server.close(); }
