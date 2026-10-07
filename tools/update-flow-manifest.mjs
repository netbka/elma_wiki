import fs from 'node:fs/promises';
import { flows } from '../web/flows/catalog.js';
const file = new URL('../storybook/review-manifest.json', import.meta.url);
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
const stories = {
  upload: ['system--whole-system', 'system--upload', 'system--partial'],
  investigation: ['investigation--journey', 'investigation--unknown'],
  'feature-review': ['review--journey', 'review--rejected'],
  'source-target': ['target--journey', 'target--check-failed', 'target--unverified', 'target--mismatch'],
  approval: ['elma--approval', 'elma--rework'],
  correspondence: ['elma--correspondence', 'elma--cleared']
};
for (const flow of flows) manifest.capabilities[flow.id] = {
  entry: '/flows', kind: flow.kind,
  actions: [...new Set(flow.states.flatMap(state => state.actions.map(action => action.id)))],
  renderer: ['web/flows/render.js', 'web/flows/model.js'],
  catalog: 'web/flows/catalog.js', storyIds: stories[flow.id],
  requiredVisibleStates: flow.states.map(state => state.id), sources: flow.sources
};
manifest.capabilities['public-site'].exclusionReason = 'Production public renderer ещё не интегрирован в stories. tools/public-browser-check.mjs проверяет текущий публичный сайт; учебный workflow не заменяет эти проверки.';
manifest.capabilities['email-authentication'].exclusionReason = 'Production OTP renderer ещё не интегрирован в stories. tools/browser-check.mjs проверяет синтетическую доставку и настоящий login UI.';
manifest.capabilities['project-viewer'] = { entry: '/p/:id/', actions: ['search', 'preview', 'report', 'reparse'], renderer: ['dist/app.js'], storyIds: [], requiredVisibleStates: ['objects', 'source-preview', 'parse-report'], exclusionReason: 'Текущий viewer проверяется tools/browser-check.mjs. Storybook показывает общий путь загрузки, но не копирует интерфейс viewer.' };
manifest.version = 2;
await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
console.log('Workflow manifest updated from canonical catalog.');
