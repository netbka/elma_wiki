import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { analyze, readWorkspace, addStringField } from '../extensions/e365-workbench/core.mjs';

const exec = promisify(execFile);
const root = new URL('../examples/e365/', import.meta.url).pathname;
const files = await readWorkspace(root);
const appPath = 'appViews/entities/example_module/requests.json', formPath = 'widgets/entities/example_module.requests/edit_form';
const app = JSON.parse(files.find(f => f.path === appPath).text), form = JSON.parse(files.find(f => f.path === formPath).text);
const input = () => ({ app: structuredClone(app), form: structuredClone(form), sourceCode: 'title', code: 'integration_note', name: 'Комментарий интеграции' });
const rows = f => f.descriptor.template.content['[content]'];

test('extensionless JSON, nested bindings, Context and ViewContext resolve distinctly', () => {
  const result = analyze(files);
  assert.equal(result.entities.length, 3); assert.deepEqual(result.diagnostics, []);
  assert.equal(result.usages.find(u => u.kind === 'form').owner, appPath);
  assert.equal(result.usages.find(u => u.field === 'ready').owner, formPath);
  assert.equal(result.usages.find(u => u.kind === 'script' && u.field === 'title').owner, appPath);
});
test('missing local fields are errors, absent providers are warnings', () => {
  const changed = files.map(f => f.path === formPath ? { ...f, text: f.text.replace('"title"', '"missing"') } : f);
  assert.ok(analyze(changed).diagnostics.some(d => d.severity === 'error' && d.token === 'missing'));
  const unresolved = analyze(files.filter(f => f.path !== appPath));
  assert.ok(unresolved.diagnostics.some(d => d.severity === 'warning'));
  assert.ok(!unresolved.diagnostics.some(d => d.severity === 'error'));
});
test('provider with same name in another package is not mistaken for local owner', () => {
  const result = analyze(files.map(f => ({ ...f, path: `${f.path === appPath ? 'other/' : 'first/'}${f.path}` })));
  assert.ok(result.diagnostics.some(d => d.severity === 'warning'));
  assert.ok(result.usages.filter(u => u.kind === 'form').every(u => !u.owner));
});
test('invalid JSON and duplicate fields produce actionable diagnostics', () => {
  assert.equal(analyze([{ path: appPath, text: '{' }]).diagnostics[0].severity, 'error');
  const duplicate = structuredClone(app); duplicate.fields.push(duplicate.fields[0]);
  assert.ok(analyze([{ path: appPath, text: JSON.stringify(duplicate) }]).diagnostics.some(d => d.token === 'title'));
});
test('recipe preserves original JSON, unknown surroundings and separate required flags', () => {
  const i = input(); i.app.unknown = { version: 12 }; i.form.descriptor.unknown = ['keep'];
  const before = structuredClone(i), result = addStringField(i);
  assert.deepEqual(i, before); assert.deepEqual(result.app.unknown, i.app.unknown); assert.deepEqual(result.form.descriptor.unknown, ['keep']);
  assert.equal(result.app.fields.at(-1).code, 'integration_note');
  assert.equal(rows(result.form)[1].values.required, false);
  assert.equal(rows(result.form)[0].values.required, true);
  assert.deepEqual(rows(result.form)[1].values.control.path, ['item', 'integration_note']);
  assert.notEqual(rows(result.form)[1].id, rows(result.form)[0].id);
  assert.equal(result.importReady, false);
});
test('recipe rejects duplicated or unsafe fields and malformed identifiers', () => {
  for (const code of ['title', '__system', 'a.b', 'MixedCase']) assert.throws(() => addStringField({ ...input(), code }));
  for (const prop of [{ defaultValue: 'unsafe' }, { formula: 'x' }, { type: 'NUMBER' }, { readonly: true }, { array: true }]) {
    const i = input(); Object.assign(i.app.fields[0], prop); assert.throws(() => addStringField(i));
  }
});
test('recipe rejects wrong owner, ambiguous rows, and copied events', () => {
  const wrong = input(); wrong.form.dataCode = 'other'; assert.throws(() => addStringField(wrong));
  const duplicate = input(); rows(duplicate.form).push(structuredClone(rows(duplicate.form)[0])); assert.throws(() => addStringField(duplicate));
  const event = input(); rows(event.form)[0].values.onChangeValue = { name: 'doSomething' }; assert.throws(() => addStringField(event));
});
test('candidate bindings pass structural checks without becoming an import-ready package', () => {
  const candidate = addStringField(input());
  const result = analyze([{ path: appPath, text: JSON.stringify(candidate.app) }, { path: formPath, text: JSON.stringify(candidate.form) }]);
  assert.deepEqual(result.diagnostics, []); assert.equal(result.usages.length, 2);
});
test('CLI writes candidates exclusively and leaves input files unchanged', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-recipe-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const out = path.join(directory, 'candidate'), a = path.join(root, appPath), f = path.join(root, formPath);
  const before = await Promise.all([fs.readFile(a, 'utf8'), fs.readFile(f, 'utf8')]);
  const args = ['tools/workbench.mjs', 'add-field', a, f, 'title', 'integration_note', 'Комментарий интеграции', out];
  await exec(process.execPath, args);
  const review = JSON.parse(await fs.readFile(path.join(out, 'review.json'), 'utf8')); assert.equal(review.importReady, false);
  await assert.rejects(exec(process.execPath, args));
  assert.deepEqual(await Promise.all([fs.readFile(a, 'utf8'), fs.readFile(f, 'utf8')]), before);
});
test('CLI check fails on broken structural links', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-check-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(root, directory, { recursive: true });
  const file = path.join(directory, formPath); await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('"title"', '"missing"'));
  await assert.rejects(exec(process.execPath, ['tools/workbench.mjs', 'check', directory]), error => error.code === 1 && error.stdout.includes('missing'));
});
test('reader does not traverse symlinks or unrelated configuration files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-read-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'widgets/entities/demo'), { recursive: true });
  await fs.writeFile(path.join(directory, 'config.json'), '{"secret":"excluded"}');
  await fs.symlink(path.join(root, formPath), path.join(directory, 'widgets/entities/demo/link'));
  assert.deepEqual(await readWorkspace(directory), []);
});
