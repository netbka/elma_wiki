import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { inventoryLegacyRecords } from '../tools/legacy-inventory.mjs';

test('inventory preserves legacy originals and shared-access policy without inferring lifecycle scope or rollout', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-legacy-inventory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const id = crypto.randomUUID(), broken = crypto.randomUUID(), portal = crypto.randomUUID();
  const folder = path.join(root, 'projects', id); await fs.mkdir(folder, { recursive: true });
  const metadata = JSON.stringify({ id, owner: 'private-owner', checksum: 'a'.repeat(64), filename: 'SYNTHETIC_PRIVATE_NAME', token: 'SYNTHETIC_SECRET_SENTINEL',
    source: { connectionId: 'synthetic-source', solutionRef: 'synthetic-solution', token: 'SYNTHETIC_SECRET_SENTINEL' },
    uploadedBy: { id: 'synthetic-actor', provider: 'local', token: 'SYNTHETIC_SECRET_SENTINEL' } });
  await fs.writeFile(path.join(folder, 'project.json'), metadata); await fs.writeFile(path.join(folder, 'original.e365'), 'untouched');
  await fs.mkdir(path.join(root, 'projects', broken)); await fs.writeFile(path.join(root, 'projects', broken, 'project.json'), '{bad');
  await fs.writeFile(path.join(root, 'portals.json'), JSON.stringify([{ id: portal, owner: 'private-owner' }]));
  await fs.mkdir(path.join(root, 'shared-solutions', 'projects', crypto.randomUUID()), { recursive: true });
  await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC_ENV_SENTINEL');
  const result = await inventoryLegacyRecords(root);
  assert.equal(result.records.length, 2); assert.equal(result.unreadableRecords.length, 1);
  assert.equal(result.schema,2); assert.equal(result.contentAccessPolicy,'shared-authenticated');
  assert.ok(result.records.every(r => !r.lifecycleAssociation.copied && r.lifecycleAssociation.intendedSolution === null));
  assert.equal(result.migrationExecuted, false); assert.equal(result.deployedStorageVerified, false);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET_SENTINEL'));
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_ENV_SENTINEL'));
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_NAME'));
  assert.equal(await fs.readFile(path.join(folder, 'project.json'), 'utf8'), metadata);
  assert.equal(await fs.readFile(path.join(folder, 'original.e365'), 'utf8'), 'untouched');
  await assert.rejects(inventoryLegacyRecords(path.join(root, 'missing')), { code: 'ENOENT' });
});
