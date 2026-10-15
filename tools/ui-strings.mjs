#!/usr/bin/env node
// UX-00 label lint (docs/plans/intuitive-solution-ui-2026-10-15.md).
// Lists every Cyrillic string literal in the product renderers and compares it
// with the shared label map (web/managed/labels.js) and the committed baseline
// of legacy inline strings. A string that is in neither fails the check, so no
// new product text can appear outside the label map. The baseline may only
// shrink: `--update` rewrites it from the current sources after a migration.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const baselinePath = resolve(root, 'test/fixtures/ui-strings-baseline.json');
export const labelsPath = resolve(root, 'web/managed/labels.js');
// Product renderers and ViewModels covered by the plan. Fixtures hold synthetic
// data, not product text, and stay out of scope.
export const rendererFiles = [
  'web/managed/render.js', 'web/managed/about.js', 'web/managed/model.js', 'web/managed/page.js', 'web/managed/acquisition.js',
  'web/managed/change-base.js', 'web/managed/merge.js', 'web/managed/composer.js', 'web/managed/dependencies.js',
  'web/managed/delivery-client.js', 'web/visual/render.js', 'web/visual/model.js',
  'web/feedback/render.js', 'web/feedback/page.js', 'web/feedback/capture.js', 'web/explanations/render.js'
];
const cyrillic = /[Ѐ-ӿ]/;

// Minimal JS tokenizer: returns the static text of every string literal and of
// every static segment of a template literal. Comments and regular expressions
// are skipped so prose in comments is not counted as product text.
export function stringLiterals(source) {
  const out = []; let i = 0; const n = source.length;
  const push = text => { const value = text.replace(/\\(.)/g, '$1').trim(); if (value) out.push(value); };
  while (i < n) {
    const ch = source[i], next = source[i + 1];
    if (ch === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && next === '*') { i = source.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (ch === '\'' || ch === '"') {
      let j = i + 1, text = '';
      while (j < n && source[j] !== ch) { if (source[j] === '\\') { text += source[j] + source[j + 1]; j += 2; } else text += source[j++]; }
      push(text); i = j + 1; continue;
    }
    if (ch === '`') {
      let j = i + 1, text = '', depth = 0;
      while (j < n) {
        if (depth === 0 && source[j] === '`') break;
        if (depth === 0 && source[j] === '$' && source[j + 1] === '{') { push(text); text = ''; depth = 1; j += 2; continue; }
        if (depth > 0) { if (source[j] === '{') depth++; else if (source[j] === '}') depth--; j++; continue; }
        if (source[j] === '\\') { text += source[j] + source[j + 1]; j += 2; } else text += source[j++];
      }
      push(text); i = j + 1; continue;
    }
    i++;
  }
  return out;
}

export function scanRenderers(files = rendererFiles) {
  const result = {};
  for (const file of files) {
    const values = new Set(stringLiterals(readFileSync(resolve(root, file), 'utf8')).filter(text => cyrillic.test(text)));
    result[file] = [...values].sort((a, b) => a.localeCompare(b, 'ru'));
  }
  return result;
}

export async function labelValues() {
  const module = await import(pathToFileURL(labelsPath).href);
  const values = new Set();
  const walk = value => { if (typeof value === 'string') values.add(value.trim()); else if (value && typeof value === 'object') Object.values(value).forEach(walk); };
  for (const [name, value] of Object.entries(module)) if (name !== 'default' && typeof value !== 'function') walk(value);
  return values;
}

export function readBaseline() {
  try { return JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { return {}; }
}

// Fails on: a Cyrillic literal outside labels.js that is neither in the label map
// nor in the baseline; a baseline file that lists strings no longer present
// (it must be regenerated so it only shrinks); a label value that looks like a
// technical key (GUID, double underscore, machine prefix).
export async function checkStrings() {
  const scanned = scanRenderers(), labels = await labelValues(), baseline = readBaseline(), problems = [];
  const technical = /[0-9a-f]{8}-[0-9a-f]{4}-|__|^_[a-z]/i;
  for (const value of labels) if (technical.test(value)) problems.push(`label map contains a technical key as text: ${value}`);
  for (const [file, values] of Object.entries(scanned)) {
    if (file === relative(root, labelsPath).replace(/\\/g, '/')) continue;
    const known = new Set(baseline[file] || []);
    for (const value of values) if (!labels.has(value) && !known.has(value)) problems.push(`${file}: product text outside the label map: ${JSON.stringify(value)}`);
    for (const value of known) if (!values.includes(value)) problems.push(`${file}: baseline lists a string that no longer exists (run tools/ui-strings.mjs --update): ${JSON.stringify(value)}`);
    for (const value of known) if (labels.has(value)) problems.push(`${file}: baseline still lists a string that moved into the label map (run tools/ui-strings.mjs --update): ${JSON.stringify(value)}`);
  }
  return { problems, scanned, labels, baseline };
}

async function main() {
  const mode = process.argv[2] || '--check';
  if (mode === '--update') {
    const scanned = scanRenderers(), labels = await labelValues(), out = {};
    for (const [file, values] of Object.entries(scanned)) {
      if (file === relative(root, labelsPath).replace(/\\/g, '/')) continue;
      const rest = values.filter(value => !labels.has(value)); if (rest.length) out[file] = rest;
    }
    writeFileSync(baselinePath, JSON.stringify(out, null, 2) + '\n');
    console.log(`baseline written: ${Object.values(out).reduce((n, rows) => n + rows.length, 0)} legacy strings in ${Object.keys(out).length} files`);
    return;
  }
  if (mode === '--list') { for (const [file, values] of Object.entries(scanRenderers())) console.log(file, values.length); return; }
  const { problems, scanned, labels, baseline } = await checkStrings();
  const legacy = Object.values(baseline).reduce((n, rows) => n + rows.length, 0);
  console.log(`label map: ${labels.size} strings; legacy inline strings: ${legacy}; renderer files: ${Object.keys(scanned).length}`);
  if (problems.length) { for (const line of problems) console.error(line); process.exit(1); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
