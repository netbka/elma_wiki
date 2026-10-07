import test from 'node:test';
import assert from 'node:assert/strict';
import { projectProcess, scenarioFields, checkScenarioStep } from '../web/visual/model.js';
import { visualSource } from '../web/visual/fixtures.js';

test('bounded scenario checks explicit required fields, preserves unknown behavior and distinguishes return without comment', () => {
  const process = projectProcess(visualSource, 'synthetic-process');
  const title = scenarioFields(process, 'review').fields[0], comment = scenarioFields(process, 'revise').fields[0];
  assert.equal(checkScenarioStep(process, 'review', { [title.pointer]: 'Contract' }, 'approve').allowed, true);
  const missing = checkScenarioStep(process, 'revise', { [comment.pointer]: '  ' }, 'repeat');
  assert.equal(missing.allowed, false); assert.equal(missing.missing[0].name, 'Комментарий');
  assert.equal(missing.evidence, 'simulated'); assert.equal(missing.nativeObservation, 'absent');
  assert.equal(checkScenarioStep(process, 'revise', { [comment.pointer]: 'Please correct the date' }, 'repeat').allowed, true);
  assert.equal(scenarioFields(process, 'review').unknown, true, 'an unknown descriptor is not silently validated');
  assert.equal(checkScenarioStep(process, 'review', { [title.pointer]: 'Contract' }, 'approve').unknown, true);
  assert.equal(checkScenarioStep(process, 'unknown', {}, 'approve').allowed, false);
});

test('ambiguous edges and script-bound fields cannot invent a scenario requirement or executable action', () => {
  const raw = structuredClone(visualSource);
  raw.process.transitions.duplicate = { ...raw.process.transitions.approve };
  raw.forms[0].content['[content]'][0].values.fields = 'Context.data.secret';
  const process = projectProcess(raw, 'synthetic-process');
  assert.equal(checkScenarioStep(process, 'review', {}, 'approve').allowed, false);
  assert.deepEqual(scenarioFields(process, 'review').fields, []);
  assert.equal(scenarioFields(process, 'review').unknown, true);
  assert.equal(JSON.stringify(process).includes('Context.data.secret'), false);
});
