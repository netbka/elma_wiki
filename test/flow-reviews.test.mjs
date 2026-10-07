import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { flowReviewStore } from '../lib/flow-reviews.mjs';
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elma-flow-review-'));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('elma-flow-review-')); await fs.rm(directory, { recursive: true, force: true }); });
  let revision = 'revision-one';
  const file = path.join(directory, 'reviews.json');
  return { file, store: flowReviewStore(file, { revision: () => revision }), change: value => { revision = value; } };
}
const finding = overrides => ({ flowId: 'investigation', revision: 'revision-one', type: 'comment', author: 'Рецензент', text: 'Нужно объяснить влияние на права', stepId: 'observe', phase: 'rules', severity: 'must', category: 'rights', ...overrides });
test('comments, replies, rejection, resolution and approval persist across restart', async t => {
  const { file, store } = await setup(t);
  let result = await store.append(finding({ type: 'reject' })); const id = result.findings[0].id;
  assert.equal(result.status, 'rejected');
  await assert.rejects(store.append(finding({ type: 'approve' })), /Сначала устраните/);
  result = await store.append(finding({ type: 'reply', parentId: id, text: 'Проверим права всех ролей' })); assert.equal(result.findings[0].replies.length, 1);
  result = await store.append(finding({ type: 'resolve', parentId: id, text: 'Правило доступа добавлено и проверено' })); assert.equal(result.findings[0].status, 'resolved');
  result = await store.append(finding({ type: 'approve', text: 'Сценарий понятен' })); assert.equal(result.status, 'approved');
  const restarted = flowReviewStore(file, { revision: 'revision-one' }); assert.equal((await restarted.get('investigation')).status, 'approved');
  result = await restarted.append(finding({ type: 'reopen', parentId: id, text: 'Проверка показала пропущенную роль' })); assert.equal(result.status, 'rejected');
});
test('new version never inherits acceptance; old decisions remain in history', async t => {
  const { store, change } = await setup(t);
  await store.append(finding({ type: 'approve' })); change('revision-two');
  const result = await store.get('investigation'); assert.equal(result.status, 'pending'); assert.equal(result.findings.length, 0); assert.equal(result.history.length, 1);
  await assert.rejects(store.append(finding()), error => error.statusCode === 409);
  await store.append(finding({ revision: 'revision-two', type: 'approve' })); assert.equal((await store.get('investigation')).status, 'approved');
});
test('serialized writes keep every finding and block acceptance under concurrency', async t => {
  const { store } = await setup(t);
  await Promise.all(Array.from({ length: 12 }, (_, n) => store.append(finding({ text: `Замечание ${n}` }))));
  assert.equal((await store.get('investigation')).findings.length, 12);
  await assert.rejects(store.append(finding({ type: 'approve' })), /Сначала устраните/);
});
test('invalid or cross-version references cannot mutate findings', async t => {
  const { store, change } = await setup(t);
  const result = await store.append(finding()); const id = result.findings[0].id;
  for (const input of [finding({ flowId: '../anything' }), finding({ stepId: 'invented' }), finding({ phase: 'invented' }), finding({ severity: 'invented' }), finding({ text: '' }), finding({ author: '' }), finding({ text: 'x'.repeat(4001) })]) await assert.rejects(store.append(input));
  change('revision-two');
  await assert.rejects(store.append(finding({ revision: 'revision-two', type: 'resolve', parentId: id })), /не найдено/);
});
test('a new finding invalidates a prior approval even when nonblocking', async t => {
  const { store } = await setup(t);
  await store.append(finding({ type: 'approve' }));
  const result = await store.append(finding({ severity: 'should' })); assert.equal(result.status, 'pending'); assert.equal(result.blocking, 0);
});
test('review validation uses refreshed catalog instead of stale startup states', async t => {
  const { file } = await setup(t);
  let current = { id: 'new-flow', initial: 'initial', states: [{ id: 'initial' }] };
  const store = flowReviewStore(file, { revision: 'one', getFlow: async id => id === current.id ? current : undefined });
  assert.equal((await store.get('new-flow')).status, 'pending');
  current = { ...current, states: [...current.states, { id: 'new-state' }] };
  const result = await store.append(finding({ flowId: 'new-flow', revision: 'one', stepId: 'new-state' }));
  assert.equal(result.findings[0].stepId, 'new-state');
});
