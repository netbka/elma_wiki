import test from 'node:test';
import assert from 'node:assert/strict';
import { objectSearchModel, renderObjectResults, resolveSourceMatch, renderSourceMatch, inspectOnlyReason } from '../dist/object-search.js';
const entity = {id:'one',name:'Requests',service:'widgets',kind:'WIDGET',namespace:'a',code:'form',coverage:'structural',archivePath:'widgets/form.json',fields:[{code:'title',name:'Subject',origin:'descriptor.fields',source:'widgets/form.json#/descriptor/fields/0'}],functionSources:[{name:'onOpen',side:'client',path:'widgets/form.json.client.ts'}]};
test('qualified field/function hits link to their precise definition without confusing the containing object',()=>{
  const other=structuredClone(entity);other.id='two';other.namespace='b';other.fields[0].source='widgets/other.json#/fields/0';
  const rows=objectSearchModel([entity,other],'TITLE');assert.equal(rows.length,2);assert.equal(rows[0].matches[0].source,entity.fields[0].source);
  const html=renderObjectResults(rows);assert.match(html,/search-hit/);assert.match(html,/match=/);assert.match(html,/widgets\/other/);
  assert.equal(objectSearchModel([entity],'onOpen')[0].matches[0].side,'client');
  const selection=resolveSourceMatch(entity,JSON.stringify(['function','onOpen','client','widgets/form.json.client.ts']));
  assert.equal(selection.state,'selected');assert.match(renderSourceMatch(selection),/widgets\/form.json.client.ts/);
  assert.equal(objectSearchModel([entity],'absent').length,0);assert.equal(objectSearchModel([entity],'').length,1);
});
test('missing/repeated references stay unknown or ambiguous, never selecting a first source',()=>{
  const reference=JSON.stringify(['field','title','','widgets/form.json#/descriptor/fields/0']);
  const repeated=structuredClone(entity);repeated.fields.push({...entity.fields[0]});
  assert.equal(resolveSourceMatch(repeated,reference).state,'ambiguous');
  assert.equal(resolveSourceMatch(entity,'bad').state,'unknown');assert.equal(resolveSourceMatch(entity,null).state,'unknown');
  assert.match(renderSourceMatch({state:'ambiguous'}),/не выбираются автоматически/);
  assert.deepEqual(objectSearchModel(null,'title'),[]);
});
test('customer labels, source references and result IDs are escaped and remain inert',()=>{
  const malicious=structuredClone(entity);malicious.id='" onmouseover="alert(1)';malicious.name='<img src=x>';malicious.fields[0].code='<script>alert(1)</script>';
  const rows=objectSearchModel([malicious],'script'),html=renderObjectResults(rows);assert.doesNotMatch(html,/<script|<img/);assert.match(html,/&lt;script/);
  const selection=resolveSourceMatch(malicious,JSON.stringify(['field',malicious.fields[0].code,'',malicious.fields[0].source]));
  assert.doesNotMatch(renderSourceMatch(selection),/<script/);
});
test('inspect-only cases explain the useful source/report path; private supported widget retains editor availability',()=>{
  assert.equal(inspectOnlyReason(entity,{privateProject:true}),null);
  for(const options of [{},{privateProject:true,legacy:true}])assert.equal(typeof inspectOnlyReason(entity,options),'string');
  assert.match(inspectOnlyReason({...entity,service:'processor'},{privateProject:true}),/исходный текст/);
  assert.match(inspectOnlyReason({...entity,coverage:'unknown'},{privateProject:true}),/не редактируются/);
});
