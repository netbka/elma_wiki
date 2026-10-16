import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fiveSecondTests, labelGroups, cardSortCards, cardSortCategories, itemVerdict, participantsPerItem, minimumCorrect } from '../web/flows/design-validation.js';
import { flowById } from '../web/flows/catalog.js';
import { startFlow, transition } from '../web/flows/model.js';
import { managedFixture } from '../web/managed/fixtures.js';
import { reviewSummary, decisionChoices, solutionNextAction, lifecycleSteps } from '../web/managed/model.js';
import { actions, facts } from '../web/managed/labels.js';

const root = new URL('../', import.meta.url);
const read = path => fs.readFile(new URL(path, root), 'utf8');
const cards = labelGroups.flatMap(group => group.cards);

test('UX-09 label deck covers every label of plan section 7', async () => {
  const plan = await read('docs/plans/intuitive-solution-ui-2026-10-15.md');
  const section = plan.slice(plan.indexOf('## 7. Vocabulary and labels'), plan.indexOf('Buttons allowed per page'));
  const planLabels = section.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| Concept') && !line.startsWith('| ---')).map(line => line.split('|')[2].trim());
  assert.ok(planLabels.length >= 25, 'section 7 table was parsed');
  const deck = new Set(cards.map(item => item.label));
  for (const label of planLabels) assert.ok(deck.has(label) || label.split(' / ').every(part => deck.has(part)), `label missing from the UX-09 deck: ${label}`);
  assert.equal(new Set(cards.map(item => item.id)).size, cards.length, 'card ids are unique');
  for (const item of cards) assert.ok(item.correct.trim(), `expected reading for ${item.id}`);
});

test('five-second tests open existing synthetic stories listed in the review manifest', async () => {
  const manifest = JSON.parse(await read('storybook/review-manifest.json'));
  const stories = await import(new URL('storybook/stories/ManagedWorkspace.stories.js', root));
  const ids = new Set(Object.keys(stories).filter(name => name !== 'default').map(name => stories.default.id + '--' + name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()));
  for (const item of fiveSecondTests) {
    assert.ok(ids.has(item.storyId), `story exists: ${item.storyId}`);
    assert.ok(manifest.capabilities['managed-workspace'].storyIds.includes(item.storyId), `manifest lists ${item.storyId}`);
    assert.ok(item.question.endsWith('?') && item.correct && item.hypothesis && item.ifWrong, `complete test ${item.id}`);
  }
  assert.ok(manifest.capabilities['design-validation'].storyIds.length > 0);
});

test('expected five-second answers match what the production projections show on those fixtures', () => {
  const by = id => fiveSecondTests.find(item => item.id === id);
  const mixed = managedFixture('summary-mixed').review;
  assert.ok(by('review-summary').correct.startsWith(reviewSummary(mixed).line), 'summary line as rendered');
  assert.equal(decisionChoices(mixed)[0].disabled, true, 'mixed review: acceptance waits for the conflict');
  const none = managedFixture('summary-no-changes').review;
  assert.equal(reviewSummary(none).noDifference, true);
  assert.match(by('review-no-changes').correct, new RegExp(facts.noDifference));
  const open = managedFixture('decision').review, choices = decisionChoices(open);
  assert.deepEqual(choices.map(choice => choice.id), ['accept', 'request-fixes', 'comment']);
  assert.equal(choices[0].disabled, true);
  for (const label of [actions.accept, actions.requestFixes, actions.commentOnly]) assert.match(by('decision').correct, new RegExp(label));
  const built = managedFixture('lifecycle-build'), next = solutionNextAction(built.workspace, built), stepper = lifecycleSteps(built.workspace, next, built.composed);
  assert.equal(next.label, actions.buildConfiguration);
  assert.match(by('stepper').correct, new RegExp(stepper.find(item => item.current).label));
  assert.equal(stepper.at(-1).state, 'unavailable');
  assert.match(by('stepper').correct, new RegExp(stepper.at(-1).label));
  assert.match(managedFixture('about-saved').about.purpose.saved.text, /^Командировки сотрудников/);
});

test('card sort places every card in one of the five tabs', () => {
  const categories = new Set(cardSortCategories.map(item => item.id));
  assert.equal(categories.size, 5);
  for (const item of cardSortCards) assert.ok(categories.has(item.category), item.id);
  for (const category of categories) assert.ok(cardSortCards.some(item => item.category === category), `cards for ${category}`);
});

test('fewer than two of three correct readings replaces the item', () => {
  assert.equal(participantsPerItem, 3); assert.equal(minimumCorrect, 2);
  assert.equal(itemVerdict([true, true, true]), 'keep');
  assert.equal(itemVerdict([true, false, true]), 'keep');
  assert.equal(itemVerdict([true, false, false]), 'replace');
  assert.equal(itemVerdict([false, false, false]), 'replace');
  assert.equal(itemVerdict([true, true]), 'incomplete');
  assert.throws(() => itemVerdict([true, true, true, false]), /ровно три/);
  assert.throws(() => itemVerdict(['верно', true, true]), /верно или неверно/);
});

test('design-validation journey walks every test and keeps #59/#41 separate', () => {
  const flow = flowById('design-validation');
  assert.equal(flow.kind, 'review-tool');
  let session = startFlow(flow);
  session = transition(flow, session, 'start');
  for (let index = 1; index < fiveSecondTests.length; index++) session = transition(flow, session, 'next');
  assert.equal(session.current, 'five-second-' + fiveSecondTests.at(-1).id);
  session = transition(flow, session, 'labels');
  for (let index = 1; index < labelGroups.length; index++) session = transition(flow, session, 'next');
  session = transition(flow, session, 'sort');
  assert.equal(session.current, 'card-sort');
  session = transition(flow, transition(flow, transition(flow, session, 'decide'), 'replace'), 'retest');
  assert.equal(session.current, 'decide', 'a replaced label is tested again');
  assert.equal(transition(flow, session, 'keep').current, 'done');
  for (const item of fiveSecondTests) assert.match(flow.states.find(state => state.id === 'five-second-' + item.id).explanation, new RegExp(item.storyId));
  for (const item of cards) assert.ok(flow.states.some(state => state.explanation.includes(`«${item.label}»`)), `card shown: ${item.id}`);
  assert.match(flow.rules[0], /не #59 или #41/);
  assert.match(flow.states.at(-1).evidence, /Не доказательство #59\/#41/);
});
