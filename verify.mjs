import assert from 'node:assert/strict';
import fs from 'node:fs';
import { articles } from './dist/articles.js';
const data = JSON.parse(fs.readFileSync(new URL('./dist/data.json', import.meta.url), 'utf8'));
assert.equal(data.readOnly, true);
assert.ok(Object.values(data.servers).every(s => s.entities.length === 0 && s.solutions.length === 0), 'В репозитории допустим только пустой индекс');
assert.equal(new Set(articles.map(a => a.id)).size, articles.length);
for (const a of articles) { assert.ok(a.sections.length >= 3); assert.ok(a.title); }
for (const file of ['dist/app.js', 'dist/articles.js', 'dist/index.html', 'README.md', 'AGENTS.md']) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(!/\b192\.168\.\d+\.\d+\b|C:\\(?:Users|git)\\|gh[pousr]_[A-Za-z0-9]{20,}/.test(source), `Локальные адреса или credentials в ${file}`);
}
console.log(`${articles.length} универсальных статей; пустой индекс; внутренние сведения отсутствуют.`);
