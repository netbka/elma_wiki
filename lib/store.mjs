import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpret, updateEnvironment } from './e365.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultDataFile = path.join(root, '.local', 'data.json');
export async function readData(file = defaultDataFile) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return JSON.parse(await fs.readFile(path.join(root, 'dist', 'data.json'), 'utf8')); }
}
let queue = Promise.resolve();
export function importConfig(buffer, environment, file = defaultDataFile) {
  return saveImport(() => interpret(buffer, environment), environment, file);
}
export function saveImport(parse, environment, file = defaultDataFile) {
  const operation = queue.then(async () => {
    const imported = await parse(), data = updateEnvironment(await readData(file), environment, imported);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(temporary, file);
    const result = data.servers[environment].solutions.find(s => s.code === imported.solution.code);
    return { environment, code: result.code, status: result.status, entities: result.entities, modules: result.modules.length,
      fields: imported.entities.reduce((n, e) => n + e.fields.length, 0), functions: imported.entities.reduce((n, e) => n + e.functions.length, 0),
      unresolved: (result.dependencies || []).filter(d => d.status === 'unresolved').length,
      ambiguous: (result.dependencies || []).filter(d => d.status === 'ambiguous').length, warnings: result.warnings };
  });
  queue = operation.catch(() => {}); return operation;
}
