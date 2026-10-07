import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectStore } from '../lib/projects.mjs';
const store = projectStore(fileURLToPath(new URL('../.local',import.meta.url)));
const files = process.argv.slice(2);
if (!files.length) { console.error('npm run import -- ./solution.e365 [./another.e365]'); process.exitCode=1; }
for (const file of files) {
  try { const p = await store.create('local',await fs.readFile(file),path.basename(file)); console.log(JSON.stringify({id:p.id,coverage:p.coverage,entities:p.entities})); }
  catch(e) { console.error(e.code ? 'Файл недоступен' : e.message); process.exitCode=1; break; }
}
