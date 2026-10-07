import { build } from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir(new URL('../web/assets/',import.meta.url),{recursive:true});
await build({entryPoints:{workspace:'web/workspace-entry.js','editor.worker':'node_modules/monaco-editor/esm/vs/editor/editor.worker.js','ts.worker':'node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js'},bundle:true,format:'iife',outdir:'web/assets',loader:{'.ttf':'file'},minify:true,legalComments:'external'});
await fs.copyFile('node_modules/monaco-editor/LICENSE','web/assets/MONACO-LICENSE.txt');
console.log('Локальные редактор и workers собраны.');
