import fs from 'node:fs/promises';
import { importConfig } from '../lib/store.mjs';
const args = process.argv.slice(2), position = args.indexOf('--server');
const environment = position >= 0 ? args.splice(position, 2)[1] : 'local';
if (!args.length || !environment) { console.error('npm run import -- --server local путь/решение.e365 [ещё.e365]'); process.exitCode = 1; }
else for (const file of args) {
  try { const result = await importConfig(await fs.readFile(file), environment); console.log(JSON.stringify(result)); }
  catch (error) { console.error(`Разбор не завершён: ${error.code ? 'файл недоступен' : error.message}`); process.exitCode = 1; break; }
}
