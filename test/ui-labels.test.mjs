import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as labelsModule from '../web/managed/labels.js';
import { isTechnicalKey, displayLabel, actions, tabs, nouns, changeKinds, classificationLabels } from '../web/managed/labels.js';
import { labels, elementLabels, elementKinds } from '../web/managed/model.js';
import { checkStrings, stringLiterals, baselinePath } from '../tools/ui-strings.mjs';

test('no product text appears outside the label map except the committed, shrinking legacy baseline', async () => {
  const { problems, labels: values } = await checkStrings();
  assert.deepEqual(problems, []);
  assert.ok(values.size >= 100, 'label map holds the vocabulary of plan §7');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  // A baseline entry may equal a label value: that is a hard-coded duplicate the
  // renderer has not imported yet, and only an import removes it from the baseline.
  const inline = new Set(Object.values(baseline).flat());
  assert.ok(['Архив'].every(text => inline.has(text) && values.has(text)), 'label-equal inline duplicates stay in the baseline until imported');
});

test('the string scanner reads quotes, templates and escapes, and skips comments', () => {
  const source = "const a = 'Решение'; // 'Комментарий'\n/* \"Блок\" */ const b = `Загрузил ${who} · ${n} шт`; const c = \"Экран \\\"1\\\"\"; const d = `${x}`;";
  assert.deepEqual(stringLiterals(source), ['Решение', 'Загрузил', '·', 'шт', 'Экран "1"']);
  assert.deepEqual(stringLiterals("const s = 'строка\\nдва';"), ['строка\nдва']);
});

test('literals inside interpolations, nested templates and braces are scanned', () => {
  const source = "el('p', `${ok ? 'Новый текст' : \"Другой\"} и ${list.map(x => `пункт ${x.name || 'без имени'}`).join({ sep: '; ' }.sep)} конец`); const z = 'после';";
  assert.deepEqual(stringLiterals(source), ['p', 'Новый текст', 'Другой', 'и', 'пункт', 'без имени', ';', 'конец', 'после']);
});

test('label values are plain words: no technical keys, no parentheses, no trailing punctuation on buttons', () => {
  const walk = (value, path) => {
    if (typeof value === 'string') {
      assert.equal(isTechnicalKey(value), false, `${path} looks technical: ${value}`);
      assert.doesNotMatch(value, /[()]/, `${path} contains parentheses: ${value}`);
    } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  for (const [name, value] of Object.entries(labelsModule)) if (typeof value !== 'function') walk(value, name);
  for (const text of Object.values(actions)) assert.doesNotMatch(text, /[.!?]$/, `button ends with punctuation: ${text}`);
});

test('plan §7 decisions are the recorded strings and rejected alternatives are absent', () => {
  assert.equal(actions.loadSolution, 'Загрузить решение');
  assert.equal(actions.requestFixes, 'Запросить доработку');
  assert.equal(nouns.base, 'Основа');
  assert.equal(tabs.about, 'О решении');
  assert.deepEqual(Object.values(changeKinds), ['Изменён', 'Добавлен', 'Удалён', 'Без изменений', 'Конфликт']);
  const all = JSON.stringify(labelsModule);
  for (const rejected of ['Ревью', 'Деплой', 'Релиз', 'Baseline', 'Workspace', 'Нужны изменения']) assert.equal(all.includes(rejected), false, `rejected label present: ${rejected}`);
});

test('existing classification wording is unchanged and still reachable through model.js', () => {
  assert.equal(labels, classificationLabels);
  assert.equal(labels.conflict, 'Нужен выбор версии');
  assert.equal(elementLabels['element-added'], 'Добавлен');
  assert.equal(elementKinds.node, 'Шаг');
});

test('technical keys are detected and the business name wins as the primary label', () => {
  for (const key of ['019f3cd7-16b4-7f0a-abd9-79db51153a17', '_sep_1f40a8cc-fb2f-4a53-a1e7-402338dafa55', 'form_01a11b42-6c2a-7767-b10f-fdb60bdc6139', 'additional_docs@__directory', '__default', '']) assert.equal(isTechnicalKey(key), true, key);
  for (const key of ['contracts', 'approval_process', 'Согласование']) assert.equal(isTechnicalKey(key), false, key);
  assert.deepEqual(displayLabel({ name: 'Согласование', key: 'approval_process' }), { text: 'Согласование', secondary: 'approval_process', technical: false });
  assert.deepEqual(displayLabel({ name: '  ', key: '__default' }), { text: '__default', secondary: '', technical: true });
  assert.deepEqual(displayLabel({ name: 'contracts', key: 'contracts' }), { text: 'contracts', secondary: '', technical: false });
  assert.deepEqual(displayLabel(), { text: '', secondary: '', technical: true });
});
