import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

test('public publishing entry points stay disabled', async () => {
  const root = new URL('../', import.meta.url);
  const config = JSON.parse(await fs.readFile(new URL('vercel.json', root), 'utf8'));
  assert.equal(config.git.deploymentEnabled, false);
  assert.equal(config.outputDirectory, undefined);
  const command = /^node -e "([^"]+)"$/.exec(config.buildCommand);
  assert.ok(command);
  const result = spawnSync(process.execPath, ['-e', command[1]], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Public deployment is disabled/);
  const pkg = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.private, true);
  assert.ok(!Object.keys(pkg.scripts).some(key => key.endsWith(':public')));
  for (const file of ['tools/build-public.mjs', 'tools/public-preview.mjs', 'web/public-landing.html', 'lib/public-site.mjs'])
    await assert.rejects(fs.access(new URL(file, root)), { code: 'ENOENT' });
});
