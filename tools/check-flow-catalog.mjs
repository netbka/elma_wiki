import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { flows } from '../web/flows/catalog.js';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('storybook/review-manifest.json', root), 'utf8'));
const ids = new Set();
for (const filename of await fs.readdir(new URL('storybook/stories/', root))) {
  if (!filename.endsWith('.stories.js')) continue;
  const module = await import(new URL('storybook/stories/' + filename, root));
  for (const name of Object.keys(module).filter(name => name !== 'default')) ids.add(module.default.id + '--' + name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
}
assert.equal(new Set(flows.map(flow => flow.id)).size, flows.length, 'Unique journey ids');
for (const flow of flows) {
  const entry = manifest.capabilities[flow.id];
  assert.ok(entry, `Missing manifest entry: ${flow.id}`);
  assert.equal(entry.kind, flow.kind);
  assert.ok(entry.storyIds.length > 0);
  entry.storyIds.forEach(id => assert.ok(ids.has(id), `Story not found: ${id}`));
  assert.deepEqual(entry.requiredVisibleStates, flow.states.map(state => state.id));
  assert.equal(new Set(flow.states.map(state => state.id)).size, flow.states.length);
  const reachable = new Set([flow.initial]);
  for (let changed = true; changed;) {
    changed = false;
    for (const state of flow.states.filter(state => reachable.has(state.id))) {
      assert.equal(new Set(state.actions.map(action => action.id)).size, state.actions.length);
      for (const action of state.actions) {
        assert.ok(flow.states.some(next => next.id === action.to), `Unknown destination: ${flow.id}/${action.to}`);
        if (!reachable.has(action.to)) { reachable.add(action.to); changed = true; }
      }
    }
  }
  assert.equal(reachable.size, flow.states.length, `Unreachable state: ${flow.id}`);
  for (const source of flow.sources) await fs.access(new URL(source, root));
}
for (const [capability, entry] of Object.entries(manifest.capabilities)) {
  assert.ok(entry.storyIds.length || entry.exclusionReason, `Unexplained coverage gap: ${capability}`);
}
console.log(`Catalog: ${flows.length} complete journeys, ${ids.size} stories; sources, states, branches and coverage valid.`);
