import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { planManagedComponentMerge, resolveManagedMerge, managedResolutionStatus, PART_MERGE_CHOICE } from '../lib/managed-workspace.mjs';
import { prepareMaterializationRequest } from '../lib/native-materialization.mjs';
import { projectStore } from '../lib/projects.mjs';
import { zip } from './fixture.mjs';

// Synthetic B/A/C process fixtures (MR-02, B2): A and C are prepared against the
// same declared full base B; A is accepted first, then C is planned.
const owner = 'synthetic-owner', actor = { id: 'declaring-actor', login: 'synthetic@example.org', provider: 'local' };
const process = () => ({
  process: {
    items: [{ id: 'start', name: 'Start' }, { id: 'review', name: 'Review', condition: 'base' }, { id: 'end', name: 'End' }],
    transitions: [{ id: 't1', source: 'start', target: 'review' }, { id: 't2', source: 'review', target: 'end' }],
    lanes: [{ id: 'lane', name: 'Lane' }]
  },
  context: [{ code: 'amount', type: 'FLOAT' }, { code: 'comment', type: 'STRING' }]
});
const edit = change => { const raw = process(); change(raw); return raw; };
const node = (raw, id) => raw.process.items.find(row => row.id === id);
const archive = (raw, { widget = 0, text } = {}) => zip([
  ['package.json', { code: 'synthetic_merge', type: 'SOLUTION' }],
  ['processor/manifest.json', { entities: [{ code: 'approval', namespace: 'synthetic', kind: 'PROCESS', path: 'approval.json' }] }],
  ['processor/approval.json', text ?? raw],
  ['widgets/manifest.json', { entities: [{ code: 'limit', namespace: 'synthetic', kind: 'WIDGET', path: 'limit.json' }] }],
  ['widgets/limit.json', { descriptor: { clientScripts: `const value = ${widget};` } }]
]);
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-merge-parts-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const upload = async (raw, scope, options) => {
    const project = await projects.create(owner, await archive(raw, options));
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  const state = await store.create(owner, { name: 'Synthetic part merge', baselineOwner: 'Base', snapshot: await upload(process(), 'full') }, actor);
  const base = { artifactId: state.baselineId, revision: 0, confirmed: true };
  const prepare = async (raw, team, options, extra = { base }) => store.prepare(state.id, owner, { kind: 'change',
    snapshot: await upload(raw, 'partial', options), expectedRevision: state.revision, team, taskRef: 'SYNTHETIC-' + team,
    sameSourceConfirmed: true, ...extra }, actor);
  const accept = review => store.accept(state.id, owner, review.artifactId, { expectedRevision: review.revision,
    reviewedDigest: review.artifactDigest, reviewedBoundaryKeys: review.rows.filter(row => row.boundaryCrossing).map(row => row.key) }, actor);
  // Plans the two-team case: A (accepted) and C (pending) edited the same base.
  const plan = async (a, c, options = {}) => {
    const first = await prepare(a, 'A', options.a), second = await prepare(c, 'C', options.c, options.extra);
    const current = await accept(first), incoming = await store.artifact(state.id, owner, second.artifactId);
    return { current, incoming, plan: planManagedComponentMerge(current, incoming), second };
  };
  return { store, state, plan };
}
const processRow = plan => plan.rows.find(row => row.kind === 'PROCESS');
const parts = row => Object.fromEntries(row.parts.rows.map(part => [part.id, [part.classification, part.status, part.proposal]]));
const id = (kind, code) => JSON.stringify([kind, code]);
const resolver = { id: 'resolver', login: 'reviewer@example.org', provider: 'local' };
const resolve = (plan, decisions, partDecisions) => resolveManagedMerge(plan, { decisions, partDecisions, reason: 'Synthetic review', actor: resolver });

test('independent part edits merge by explicit choice and record rename and impact findings', async t => {
  const { plan: setupPlan } = await setup(t);
  const { plan, current, incoming } = await setupPlan(edit(raw => { node(raw, 'review').condition = 'team-a'; raw.context[0].type = 'MONEY'; }),
    edit(raw => { node(raw, 'end').name = 'Finish'; raw.process.items.push({ id: 'notify', name: 'Notify' });
      raw.process.transitions.push({ id: 't3', source: 'review', target: 'notify' }); }));
  const row = processRow(plan);
  // The component stays a whole-component conflict: part merge is never automatic.
  assert.equal(row.classification, 'divergent'); assert.equal(row.status, 'resolution-required'); assert.equal(row.proposal, null);
  assert.equal(plan.status, 'resolution-required'); assert.equal(plan.ancestryVerified, false); assert.equal(plan.automaticMergeEnabled, false);
  assert.equal(row.parts.method, 'process-element-three-way'); assert.equal(row.parts.status, 'clear'); assert.deepEqual(row.parts.blockers, []);
  assert.deepEqual(parts(row), {
    [id('lane', 'lane')]: ['unchanged', 'clear', 'keep-current'],
    [id('node', 'end')]: ['incoming-only', 'clear', 'take-incoming'],
    [id('node', 'notify')]: ['addition-incoming', 'clear', 'take-incoming'],
    [id('node', 'review')]: ['current-only', 'clear', 'keep-current'],
    [id('node', 'start')]: ['unchanged', 'clear', 'keep-current'],
    [id('transition', 't1')]: ['unchanged', 'clear', 'keep-current'],
    [id('transition', 't2')]: ['unchanged', 'clear', 'keep-current'],
    [id('transition', 't3')]: ['addition-incoming', 'clear', 'take-incoming'],
    [id('variable', 'amount')]: ['current-only', 'clear', 'keep-current'],
    [id('variable', 'comment')]: ['unchanged', 'clear', 'keep-current'],
    'order:/context': ['unchanged', 'clear', 'keep-current'],
    'order:/process/items': ['unchanged', 'clear', 'keep-current'],
    'order:/process/transitions': ['unchanged', 'clear', 'keep-current'],
    residual: ['unchanged', 'clear', 'keep-current'] });
  // Rename of a display name keeps identity and is reported; impact is recorded, not proven.
  const types = row.parts.findings.map(finding => [finding.type, finding.dependency ?? finding.input ?? null]);
  assert.deepEqual(types.sort(), [['behaviour-combined', null], ['dependency-impact', 'variable'], ['renamed', 'incoming']]);
  assert.deepEqual(row.parts.findings.find(finding => finding.type === 'renamed'), { type: 'renamed', severity: 'review', id: id('node', 'end'), input: 'incoming', from: 'End', to: 'Finish' });
  assert.deepEqual(row.parts.findings.find(finding => finding.type === 'dependency-impact'), { type: 'dependency-impact', severity: 'review',
    dependency: 'variable', input: 'current', parts: [id('variable', 'amount')], affected: [id('node', 'end'), id('node', 'notify'), id('transition', 't3')] });

  const widget = plan.rows.find(item => item.kind === 'WIDGET');
  const resolution = resolve(plan, { [row.key]: PART_MERGE_CHOICE });
  const merged = resolution.result.find(item => item.key === row.key);
  assert.equal(merged.source, 'merged-parts'); assert.equal(merged.choice, PART_MERGE_CHOICE); assert.match(merged.digest, /^[0-9a-f]{64}$/);
  assert.notEqual(merged.digest, row.current.digest); assert.notEqual(merged.digest, row.incoming.digest);
  assert.equal(merged.baseDigest, row.base.digest); assert.equal(merged.incomingArtifactId, row.incoming.artifactId);
  assert.deepEqual(Object.fromEntries(merged.parts.filter(part => part.source !== 'current').map(part => [part.id, part.source])),
    { [id('node', 'end')]: 'incoming', [id('node', 'notify')]: 'incoming', [id('transition', 't3')]: 'incoming' });
  assert.ok(merged.findings.some(finding => finding.type === 'behaviour-combined'));
  assert.deepEqual(resolution.decisions, [{ key: row.key, classification: 'divergent', choice: PART_MERGE_CHOICE, parts: [] }]);
  assert.equal(resolution.result.find(item => item.key === widget.key).source, 'current');
  assert.equal(managedResolutionStatus(resolution, plan), 'current');
  for (const flag of ['ancestryVerified', 'automaticMergeEnabled', 'acceptanceEnabled', 'buildEnabled', 'materialized']) assert.equal(resolution[flag], false);
  // A part-merged component has no physical source yet: materialization refuses it.
  const request = await prepareMaterializationRequest({ state: current, artifact: incoming, resolution });
  assert.equal(request.status, 'blocked');
  assert.ok(request.blockers.some(blocker => blocker.reason === 'unlocatable-component-source' && blocker.key === row.key));
  // The same component may still be resolved as a whole.
  assert.equal(resolve(plan, { [row.key]: 'keep-current' }).result.find(item => item.key === row.key).source, 'current');
});

test('the same part edited differently needs an explicit part choice', async t => {
  const { plan: setupPlan } = await setup(t);
  const { plan } = await setupPlan(edit(raw => { node(raw, 'review').condition = 'team-a'; }),
    edit(raw => { node(raw, 'review').condition = 'team-c'; raw.context[1].type = 'TEXT'; }));
  const row = processRow(plan), review = id('node', 'review');
  assert.equal(row.parts.status, 'resolution-required');
  assert.deepEqual(parts(row)[review], ['divergent', 'resolution-required', null]);
  assert.deepEqual(parts(row)[id('variable', 'comment')], ['incoming-only', 'clear', 'take-incoming']);
  assert.throws(() => resolve(plan, { [row.key]: PART_MERGE_CHOICE }), error => error.statusCode === 422 && /every conflicting part/.test(error.message));
  assert.throws(() => resolve(plan, { [row.key]: PART_MERGE_CHOICE }, { [row.key]: { [review]: 'remove' } }), error => error.statusCode === 422);
  assert.throws(() => resolve(plan, { [row.key]: PART_MERGE_CHOICE }, { [row.key]: { [review]: 'take-incoming', [id('node', 'start')]: 'keep-current' } }),
    error => error.statusCode === 409);
  assert.throws(() => resolve(plan, { [row.key]: 'keep-current' }, { [row.key]: { [review]: 'take-incoming' } }), error => error.statusCode === 409);
  const resolution = resolve(plan, { [row.key]: PART_MERGE_CHOICE }, { [row.key]: { [review]: 'take-incoming' } });
  const merged = resolution.result.find(item => item.key === row.key);
  assert.deepEqual(merged.parts.find(part => part.id === review), { id: review, classification: 'divergent', choice: 'take-incoming', decided: true,
    source: 'incoming', digest: row.parts.rows.find(part => part.id === review).incoming.digest });
  assert.deepEqual(resolution.decisions[0].parts, [{ id: review, classification: 'divergent', choice: 'take-incoming' }]);
  const kept = resolve(plan, { [row.key]: PART_MERGE_CHOICE }, { [row.key]: { [review]: 'keep-current' } });
  assert.notEqual(kept.resultDigest, resolution.resultDigest);
});

test('a possibly renamed part ID blocks part merge but keeps the whole-component choice', async t => {
  const { plan: setupPlan } = await setup(t);
  // C replaces node "review" by "review2" with the same name: a possible native ID change.
  const renamed = (await setupPlan(edit(raw => { raw.context[0].type = 'MONEY'; }), edit(raw => {
    node(raw, 'review').id = 'review2'; raw.process.transitions[0].target = 'review2'; raw.process.transitions[1].source = 'review2'; }))).plan;
  const row = processRow(renamed);
  assert.equal(row.status, 'resolution-required'); assert.equal(row.parts.status, 'blocked');
  assert.ok(row.parts.blockers.some(blocker => blocker.reason === 'rename-uncertain'));
  assert.deepEqual(row.parts.rows.filter(part => part.status === 'blocked').map(part => part.id), [id('node', 'review'), id('node', 'review2')]);
  assert.throws(() => resolve(renamed, { [row.key]: PART_MERGE_CHOICE }), error => error.statusCode === 422 && /unblocked stable part/.test(error.message));
  assert.equal(resolve(renamed, { [row.key]: 'take-incoming' }).result.find(item => item.key === row.key).source, 'incoming');
});

test('duplicate part IDs block part merge', async t => {
  const { plan: setupPlan } = await setup(t);
  const duplicate = (await setupPlan(edit(raw => { node(raw, 'review').condition = 'team-a'; }),
    edit(raw => { raw.process.items.push({ id: 'end', name: 'Second end' }); }))).plan;
  const row = processRow(duplicate);
  assert.equal(row.parts.status, 'blocked'); assert.deepEqual(row.parts.rows, []);
  assert.deepEqual(row.parts.blockers.map(blocker => [blocker.reason, blocker.input, blocker.id]), [['duplicate-part-identity', 'incoming', id('node', 'end')]]);
  assert.throws(() => resolve(duplicate, { [row.key]: PART_MERGE_CHOICE }), error => error.statusCode === 422);
});

test('a projection-invisible edit is unexplained', async t => {
  const { plan: setupPlan } = await setup(t);
  // Formatting-only bytes change the component digest but no part.
  const unexplained = (await setupPlan(edit(raw => { node(raw, 'review').condition = 'team-a'; }), null,
    { c: { text: JSON.stringify(process(), null, 2) } })).plan;
  assert.deepEqual(processRow(unexplained).parts.blockers, [{ reason: 'unexplained-change', input: 'incoming' }]);
});

test('a transition to a node removed by the other side blocks the part merge', async t => {
  const { plan: setupPlan } = await setup(t);
  const { plan } = await setupPlan(edit(raw => { raw.process.items.splice(2, 1); raw.process.transitions.splice(1, 1); }),
    edit(raw => { raw.process.transitions.push({ id: 't3', source: 'start', target: 'end' }); }));
  const row = processRow(plan);
  assert.equal(row.parts.status, 'blocked');
  assert.deepEqual(row.parts.blockers, [{ reason: 'dangling-transition', id: id('transition', 't3'), node: 'end' }]);
  assert.throws(() => resolve(plan, { [row.key]: PART_MERGE_CHOICE }), error => error.statusCode === 422);
});

test('reordered collections are a part of their own; competing orders conflict', async t => {
  // A reverses the variables, C appends one: the common order follows A.
  const reordered = processRow((await (await setup(t)).plan(edit(raw => { raw.context.reverse(); }),
    edit(raw => { raw.context.push({ code: 'extra', type: 'STRING' }); }))).plan);
  assert.equal(reordered.parts.status, 'clear');
  assert.deepEqual(parts(reordered)['order:/context'], ['current-only', 'clear', 'keep-current']);
  assert.deepEqual(parts(reordered)[id('variable', 'extra')], ['addition-incoming', 'clear', 'take-incoming']);
  const competing = processRow((await (await setup(t)).plan(edit(raw => { raw.process.items = [1, 0, 2].map(i => process().process.items[i]); }),
    edit(raw => { raw.process.items = [0, 2, 1].map(i => process().process.items[i]); }))).plan);
  assert.deepEqual(parts(competing)['order:/process/items'], ['divergent', 'resolution-required', null]);
  assert.deepEqual(competing.parts.rows.filter(part => part.status !== 'clear').map(part => part.id), ['order:/process/items']);
});

test('kinds without stable part IDs keep whole-component behaviour; unknown or forged ancestry stays unverified or blocked', async t => {
  const { plan: setupPlan } = await setup(t);
  const { plan, incoming, current } = await setupPlan(process(), process(), { a: { widget: 1 }, c: { widget: 2 } });
  const widget = plan.rows.find(row => row.kind === 'WIDGET');
  assert.equal(widget.classification, 'divergent'); assert.equal('parts' in widget, false);
  assert.throws(() => resolve(plan, { [widget.key]: PART_MERGE_CHOICE }), error => error.statusCode === 422);
  assert.equal(resolve(plan, { [widget.key]: 'take-incoming' }).result.find(row => row.key === widget.key).source, 'incoming');
  // A declared base or a pull sequence is not verified ancestry: nothing becomes automatic.
  const sequence = structuredClone(incoming); sequence.baseDeclaration.method = 'source-sequence'; sequence.baseDeclaration.ancestryVerified = true;
  const sequenced = planManagedComponentMerge(current, sequence);
  assert.equal(sequenced.ancestryVerified, false); assert.equal(sequenced.automaticMergeEnabled, false);
  assert.equal(sequenced.rows.find(row => row.kind === 'WIDGET').proposal, null);
});

test('an unknown base blocks before any component or part row exists', async t => {
  const { plan: setupPlan } = await setup(t);
  const { plan } = await setupPlan(edit(raw => { node(raw, 'review').condition = 'team-a'; }),
    edit(raw => { node(raw, 'end').name = 'Finish'; }), { extra: {} });
  assert.equal(plan.status, 'blocked'); assert.deepEqual(plan.rows, []);
  assert.deepEqual(plan.blockers, [{ reason: 'unknown-base', method: 'not-declared' }]);
  assert.throws(() => resolve(plan, {}), error => error.statusCode === 422);
});
