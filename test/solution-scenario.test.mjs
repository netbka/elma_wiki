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

test('retained action and path bindings on supported forms keep scenario behavior unknown without blocking navigation', () => {
  // Remove the existing opaque descriptor so it cannot mask a missing binding check.
  const raw=structuredClone(visualSource);
  raw.forms[0].content['[content]']=[raw.forms[0].content['[content]'][0]];
  const known=projectProcess(raw,'synthetic-process');
  assert.equal(scenarioFields(known,'review').unknown,false);
  for(const [descriptor,key,value] of [
    ['dynamic-form','onChangeValue',{script:'PRIVATE_ACTION_BODY'}],
    ['item-form-complex-popup','action',{script:'PRIVATE_ACTION_BODY'}],
    ['dynamic-form','onClick',{path:['actions','submit']}],
    ['item-form-complex-popup','form',{path:['context','form']}],
    ['item-form-complex-popup','label',{path:['context','caption']}]
  ]){
    const bound=structuredClone(raw),target=descriptor==='dynamic-form'?bound.forms[0].content['[content]'][0]:bound.forms[0];
    target.values??={};target.values[key]=value;
    const process=projectProcess(bound,'synthetic-process'),{fields,unknown}=scenarioFields(process,'review');
    assert.equal(unknown,true,descriptor+'/'+key);
    assert.equal(JSON.stringify(process).includes('PRIVATE_ACTION_BODY'),false);
    const projected=descriptor==='dynamic-form'?process.forms[0].tree.children[0]:process.forms[0].tree;
    const reference=projected.bindings.find(binding=>binding.name===key);
    assert.equal(reference.evaluation,'unknown');
    if(value.path)assert.deepEqual(reference.path,value.path);
    const checked=checkScenarioStep(process,'review',{[fields[0].pointer]:'Synthetic value'},'approve');
    assert.equal(checked.allowed,true,'ordinary supported navigation remains available');
    assert.equal(checked.unknown,true);assert.equal(checked.nativeObservation,'absent');
    assert.equal(checkScenarioStep(process,'review',{},'approve').allowed,false,'declared required fields still block missing input');
  }
});
