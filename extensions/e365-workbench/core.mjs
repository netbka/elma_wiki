import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Shared by CLI, recipes and extension. Never evaluate package code.
const own = (o, k) => o != null && Object.hasOwn(o, k);
const key = (ns, code) => JSON.stringify([ns, code]);
function walk(value, visit, pointer = '') {
  if (!value || typeof value !== 'object') return;
  visit(value, pointer);
  for (const [k, v] of Object.entries(value)) walk(v, visit, `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
}
export function analyze(files) {
  const entities = [], diagnostics = [], usages = [];
  for (const file of files) {
    const m = /^(.+\/)?(appViews|widgets|processor)\/entities\/([^/]+)\/(.+)$/.exec(file.path.replace(/\\/g, '/'));
    if (!m || /\.(ts|html|po|map)$/i.test(m[4])) continue;
    let json;
    try { json = JSON.parse(file.text.replace(/^\uFEFF/, '')); }
    catch { diagnostics.push({ path: file.path, severity: 'error', message: 'Некорректный JSON' }); continue; }
    if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
    const fields = m[2] === 'appViews' ? json.fields : m[2] === 'widgets' ? json.descriptor?.fields : json.context?.fields || json.context;
    const entity = { path: file.path, root: m[1] || '', service: m[2], namespace: json.namespace || m[3], code: json.code || m[4].replace(/\.json$/, '').split('/').at(-1), json, fields: Array.isArray(fields) ? fields : [] };
    entities.push(entity);
    const seen = new Set();
    for (const f of entity.fields) {
      if (!f || typeof f.code !== 'string') continue;
      if (seen.has(f.code)) diagnostics.push({ path: file.path, token: f.code, severity: 'error', message: `Повторный код поля: ${f.code}` });
      seen.add(f.code);
    }
  }
  const apps = new Map();
  for (const e of entities.filter(e => e.service === 'appViews')) {
    const k = key(e.namespace, e.code);
    if (!apps.has(k)) apps.set(k, []);
    apps.get(k).push(e);
  }
  for (const e of entities) {
    if (e.service !== 'widgets') continue;
    const matches = (apps.get(key(e.json.dataNamespace, e.json.dataCode)) || []).filter(a => a.root === e.root);
    const owner = matches.length === 1 ? matches[0] : null;
    walk(e.json.descriptor?.template, (node, pointer) => {
      const binding = node.values?.control?.path;
      if (!Array.isArray(binding) || binding.length !== 2 || binding[0] !== 'item' || typeof binding[1] !== 'string') return;
      usages.push({ path: e.path, pointer: `/descriptor/template${pointer}/values/control/path`, field: binding[1], owner: owner?.path, kind: 'form', confidence: 'structural' });
      if (owner && !owner.fields.some(f => f.code === binding[1])) diagnostics.push({ path: e.path, token: binding[1], severity: 'error', message: `Поле ${binding[1]} отсутствует в связанном приложении ${owner.code}` });
      else if (!owner) diagnostics.push({ path: e.path, token: binding[1], severity: 'warning', message: 'Приложение не разрешено однозначно в этом пакете; проверьте зависимости или контекст процесса' });
    });
    for (const script of files.filter(f => f.path === `${e.path}.client.ts` || f.path === `${e.path}.server.ts`)) {
      for (const m of script.text.matchAll(/\b(Context|ViewContext)\.data\.([A-Za-z_$][\w$]*)/g)) {
        usages.push({ path: script.path, field: m[2], owner: m[1] === 'ViewContext' ? e.path : owner?.path, kind: 'script', confidence: 'textual', offset: m.index, context: m[1] });
      }
    }
  }
  return { entities, usages, diagnostics };
}
export async function readWorkspace(root) {
  const files = []; let entries = 0, bytes = 0;
  async function read(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++entries > 25000) throw Error('Индекс ограничен 25 000 записями');
      if (entry.isSymbolicLink() || ['node_modules', '.git', '.local', '.cache', 'dist'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name), relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) { await read(absolute); continue; }
      if (!entry.isFile() || !/(?:^|\/)(?:appViews|widgets|processor)\/entities\//.test(relative) || /\.(?:html|po|map)$/i.test(entry.name)) continue;
      if (/\.[^./]+$/.test(entry.name) && !/\.(json|ts)$/.test(entry.name)) continue;
      const stat = await fs.stat(absolute);
      if (stat.size > 4 * 1024 * 1024 || (bytes += stat.size) > 64 * 1024 * 1024) throw Error('Лимит чтения: 4 МБ на файл, 64 МБ на индекс');
      files.push({ path: relative, text: await fs.readFile(absolute, 'utf8') });
    }
  }
  await read(root); return files;
}
export function addStringField({ app, form, sourceCode, code, name }) {
  if (!/^[a-z][a-z0-9_]*$/.test(code) || code.startsWith('__')) throw Error('Нужен несистемный код поля в snake_case');
  if (typeof name !== 'string' || !name.trim()) throw Error('Нужно название поля');
  if (!Array.isArray(app.fields) || !form.descriptor?.template || typeof form.descriptor.template !== 'object') throw Error('Неподдерживаемая структура');
  if (!app.namespace || !app.code || form.dataNamespace !== app.namespace || form.dataCode !== app.code) throw Error('Форма не связана с выбранным приложением');
  if (app.fields.some(f => f.code === code)) throw Error('Поле уже существует');
  const sources = app.fields.filter(f => f.code === sourceCode);
  if (sources.length !== 1) throw Error('Исходное поле неоднозначно или отсутствует');
  const source = sources[0];
  if (sourceCode.startsWith('__') || source.type !== 'STRING' || source.array || source.readonly || source.view?.hidden || Object.keys(source).some(k => !['code', 'type', 'required', 'readonly', 'array', 'view'].includes(k)) || Object.keys(source.view || {}).some(k => k !== 'name')) throw Error('Рецепт поддерживает только простое STRING-поле без формулы, defaultValue и дополнительных настроек');
  const rows = [], ids = new Set();
  walk(form.descriptor.template, node => {
    if (own(node, 'id')) {
      if (ids.has(node.id)) throw Error('Повторный id элемента формы');
      ids.add(node.id);
    }
    if (node.values?.control?.path?.[1] === code) throw Error('Привязка нового поля уже существует');
    if (node.descriptor === 'dynamic-form-row' && JSON.stringify(node.values?.control?.path) === JSON.stringify(['item', sourceCode])) rows.push(node);
  });
  if (rows.length !== 1) throw Error('Нужна одна простая строка формы');
  const row = rows[0];
  let parent;
  walk(form.descriptor.template, node => { if (Array.isArray(node) && node.includes(row)) parent = node; });
  if (!parent) throw Error('Строка должна находиться в массиве элементов');
  if (Object.keys(row).some(k => !['id', 'descriptor', 'values'].includes(k)) || Object.keys(row.values).some(k => !['control', 'required', 'showDisplayName'].includes(k)) || Object.keys(row.values.control).some(k => k !== 'path')) throw Error('Строка содержит неподдерживаемые настройки');
  const nextApp = structuredClone(app), nextForm = structuredClone(form), field = structuredClone(source), newRow = structuredClone(row);
  field.code = code; field.required = false; field.view = { name: name.trim() };
  do { newRow.id = randomUUID(); } while (ids.has(newRow.id));
  newRow.values.control.path = ['item', code]; newRow.values.required = false;
  nextApp.fields.push(field);
  let nextParent;
  walk(nextForm.descriptor.template, node => {
    if (Array.isArray(node) && node.some(n => JSON.stringify(n) === JSON.stringify(row))) nextParent = node;
  });
  nextParent.splice(parent.indexOf(row) + 1, 0, newRow);
  return { app: nextApp, form: nextForm, status: 'experimental', importReady: false };
}
