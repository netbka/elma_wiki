import fs from 'node:fs/promises';
import path from 'node:path';
import { analyze, readWorkspace, addStringField } from '../extensions/e365-workbench/core.mjs';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'check' && args.length === 1) {
    const index = analyze(await readWorkspace(path.resolve(args[0])));
    console.log(JSON.stringify({ entities: index.entities.length, usages: index.usages, diagnostics: index.diagnostics }, null, 2));
    if (index.diagnostics.some(d => d.severity === 'error')) process.exitCode = 1;
  } else if (command === 'add-field' && args.length === 6) {
    const [appPath, formPath, sourceCode, code, name, out] = args;
    const app = JSON.parse(await fs.readFile(appPath, 'utf8')), form = JSON.parse(await fs.readFile(formPath, 'utf8'));
    const candidate = addStringField({ app, form, sourceCode, code, name });
    // Exclusive directory creation prevents accidental overwrite and aliasing.
    await fs.mkdir(out, { recursive: false });
    await fs.writeFile(path.join(out, 'app.candidate.json'), JSON.stringify(candidate.app, null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(out, 'form.candidate.json'), JSON.stringify(candidate.form, null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(out, 'review.json'), JSON.stringify({ status: candidate.status, importReady: false, message: 'Черновик: проверьте history, типы, события и зависимости. Импорт поля/формы не испытан.' }, null, 2) + '\n', { flag: 'wx' });
    console.log(`Черновик создан: ${out}. Не готовый пакет импорта.`);
  } else throw Error('Usage: node tools/workbench.mjs check <export> | add-field <app.json> <form> <source_code> <new_code> <name> <new-directory>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
