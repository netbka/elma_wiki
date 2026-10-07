import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultDataFile = path.join(root, '.local', 'data.json');
export async function readData(file = defaultDataFile) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return JSON.parse(await fs.readFile(path.join(root, 'dist', 'data.json'), 'utf8')); }
}
