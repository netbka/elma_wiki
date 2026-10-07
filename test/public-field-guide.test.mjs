import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_GUIDE_PATH, FIELD_GUIDE_TITLE, fieldGuideFixture,
  createFieldGuideModel, renderFieldGuide
} from '../web/public-field-guide.mjs';
import { renderPublicFiles } from '../lib/public-site.mjs';

test('lookup uses the qualified application and a real pointer into the teaching fixture', () => {
  const records = fieldGuideFixture(), before = JSON.stringify(records);
  records.reverse(); // A title field in Categories must not win.
  const model = createFieldGuideModel(records);
  assert.equal(model.state, 'ready');
  assert.equal(model.owner.code, 'requests');
  assert.equal(model.field.name, 'Тема обращения');
  assert.equal(model.pointer, '/fields/0');
  assert.deepEqual(JSON.parse(model.snippet), records[1].document.fields[0]);
  assert.equal(JSON.stringify(records.toReversed()), before);
  records[1].document.fields.reverse();
  assert.equal(createFieldGuideModel(records).pointer, '/fields/1');
});

test('missing, unknown and malformed field evidence never reports success', () => {
  for (const input of [null, {}, [], [null], fieldGuideFixture().slice(1)]) {
    assert.equal(createFieldGuideModel(input).state, 'unavailable');
  }
  for (const mutate of [
    record => { delete record.document; },
    record => { record.document.fields = {}; },
    record => { record.document.fields = []; },
    record => { delete record.sourcePath; },
    record => { delete record.document.fields[0].type; }
  ]) {
    const records = fieldGuideFixture();
    mutate(records[0]);
    const model = createFieldGuideModel(records), html = renderFieldGuide(model);
    assert.equal(model.state, 'unavailable');
    assert.doesNotMatch(html, /data-field-guide-result="ready"/);
    assert.match(html, /Не найдено в индексе не означает/);
    assert.match(html, /Не создавайте новое поле/);
  }
});

test('duplicate owners and duplicate field codes are ambiguous, not first-match success', () => {
  const duplicateOwner = fieldGuideFixture();
  duplicateOwner.push(structuredClone(duplicateOwner[0]));
  const duplicateField = fieldGuideFixture();
  duplicateField[0].document.fields.push(structuredClone(duplicateField[0].document.fields[0]));
  for (const input of [duplicateOwner, duplicateField]) {
    const model = createFieldGuideModel(input), html = renderFieldGuide(model);
    assert.equal(model.state, 'ambiguous');
    assert.match(html, /Источник неоднозначен/);
    assert.doesNotMatch(html, /data-field-guide-result="ready"/);
  }
});

test('fixture text and source paths are escaped, never executable markup or URLs', () => {
  const records = fieldGuideFixture(), attack = '<img src=x onerror="alert(1)"> & \'';
  records[0].name = attack;
  records[0].sourcePath = 'javascript:' + attack;
  records[0].document.fields[0].view.name = attack;
  const html = renderFieldGuide(createFieldGuideModel(records));
  assert.doesNotMatch(html, /<img|href="javascript:|<script/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /&amp;/);
});

test('walkthrough has a useful result, optional JSON, evidence limits and a Designer-first continuation', () => {
  const html = renderFieldGuide();
  assert.match(html, /data-field-guide="ready"/);
  assert.match(html, /data-field-guide-result="ready"/);
  assert.match(html, /Синтетический пример/);
  assert.match(html, /не пакет для импорта/);
  assert.match(html, /<details>[\s\S]*<summary>Посмотреть JSON/);
  assert.match(html, /<summary>Проверить ответ<\/summary>/);
  assert.match(html, /привычном Designer/);
  assert.doesNotMatch(html, /<form\b|<input\b|<iframe\b|<script\b|contenteditable=/i);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

const fs = await import('node:fs/promises');
const landing = await fs.readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const articles = ['package-map', 'relationship-recipe', 'script-roundtrip', 'file-update', 'field-form-recipe']
  .map(id => ({ id, title: id, lead: '', sections: [] }));

test('public Find a field and first-example CTA resolve to lookup, not experimental mutation', () => {
  const files = renderPublicFiles({ landing, articles, example: { entities: [] } });
  const home = files.get('index.html'), path = FIELD_GUIDE_PATH.slice(1) + 'index.html';
  const task = [...home.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)]
    .map(match => match[0]).find(html => html.includes('<h3>Найти поле</h3>'));
  assert.ok(task, 'The actual homepage must expose the field lookup task');
  assert.match(task, /href="\/learn\/find-field\/"/);
  assert.match(home, /href="\/learn\/find-field\/">Пройти учебный пример<\/a>/);
  assert.match(home, /href="\/articles\/script-roundtrip\/"/);
  assert.match(home, /href="\/articles\/file-update\/"/);
  assert.match(home, /href="\/articles\/">Читать руководства<\/a>/);
  assert.match(home, /href="\/examples\/">Пример<\/a>/);
  assert.ok(files.get(path).includes(`<h1>${FIELD_GUIDE_TITLE}</h1>`));
  assert.match(files.get(path), /data-field-guide-result="ready"/);
  assert.match(files.get('examples/index.html'), /href="\/learn\/find-field\/"/);
  // The tutorial's internal links resolve within the same public output.
  for (const [, href] of files.get(path).matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    const url = new URL(href, 'https://wiki.example.org' + FIELD_GUIDE_PATH);
    if (url.origin !== 'https://wiki.example.org') continue;
    const target = url.pathname.slice(1) + (url.pathname.endsWith('/') ? 'index.html' : '');
    assert.ok(files.has(target), href);
    if (url.hash) assert.ok(files.get(target).includes(`id="${url.hash.slice(1)}"`), href);
  }
  assert.doesNotMatch(files.get(path), /href="\/(?:api|auth|login|dashboard|p)\b/);
});

test('invalid view model state has a truthful fallback', () => {
  assert.match(renderFieldGuide(null), /data-field-guide="unavailable"/);
  assert.doesNotMatch(renderFieldGuide({ state: 'verified' }), /data-field-guide-result="ready"/);
});

test('Storybook registers the same renderer and all three evidence states', async () => {
  const fs = await import('node:fs/promises');
  const manifest = JSON.parse(await fs.readFile(new URL('../storybook/review-manifest.json', import.meta.url), 'utf8'));
  const stories = await import('../storybook/stories/PublicFieldGuide.stories.js');
  const entry = manifest.capabilities['public-field-lookup'];
  assert.deepEqual(entry.renderer, ['web/public-field-guide.mjs', 'dist/object-search.js']);
  assert.deepEqual(entry.requiredVisibleStates, ['ready', 'unavailable', 'ambiguous']);
  assert.deepEqual(entry.storyIds, ['Ready', 'Unavailable', 'Ambiguous']
    .map(name => `${stories.default.id}--${name.toLowerCase()}`));
  for (const name of ['Ready', 'Unavailable', 'Ambiguous']) assert.equal(typeof stories[name].render, 'function');
});

test('interactive source pointers keep the original field position when malformed rows are skipped', () => {
  const records=fieldGuideFixture();records[0].document.fields.unshift(null);
  const model=createFieldGuideModel(records);assert.equal(model.pointer,'/fields/1');
  assert.equal(model.exploration[0].fields.find(field=>field.code==='title').source,records[0].sourcePath+'#/fields/1');
});
