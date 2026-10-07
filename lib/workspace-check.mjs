import ts from 'typescript';
import { Worker } from 'node:worker_threads';

const identifier = name => typeof name === 'string' && /^[A-Za-z_$][\w$]*$/.test(name);
export function serverFunctions(source = '') {
  const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.ES2022, true);
  return tree.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && identifier(n.name.text)).map(n => n.name.text);
}
export function rpcDeclarations(source = '') {
  const tree = ts.createSourceFile('server.ts',source,ts.ScriptTarget.ES2022,true);
  return tree.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && identifier(n.name.text)).map(n => {
    const params = n.parameters.map((p,i) => `${p.dotDotDotToken ? '...' : ''}${ts.isIdentifier(p.name) ? p.name.text : 'arg'+i}${p.questionToken || p.initializer ? '?' : ''}: ${p.type ? p.type.getText(tree) : p.dotDotDotToken ? 'unknown[]' : 'unknown'}`).join(', ');
    return `export declare function ${n.name.text}(${params}): ${n.type ? n.type.getText(tree) : 'unknown'};`;
  }).join('\n');
}
export function generateTypes(raw, files) {
  const fields = Array.isArray(raw.descriptor?.fields) ? raw.descriptor.fields : [];
  const types = {STRING:'string',BOOLEAN:'boolean',NUMBER:'number',INTEGER:'number',FLOAT:'number'};
  const members = fields.filter(f => f && identifier(f.code)).map(f => {const type=types[String(f.type).toUpperCase()] || 'unknown';return `  ${JSON.stringify(f.code)}: ${f.array ? '(' + type + ')[]' : type};`;}).join('\n');
  const rpc = [...new Set(serverFunctions(files['server.ts']))].map(name => `  ${JSON.stringify(name)}: (...args: Parameters<typeof import('./server').${name}>) => Promise<Awaited<ReturnType<typeof import('./server').${name}>>>;`).join('\n');
  const context = `interface WidgetData {\n${members}\n}\ndeclare const Context: { data: WidgetData };\n`;
  return {client:context + `declare const ViewContext: { data: WidgetData };\ndeclare const Server: { rpc: {\n${rpc}\n} };\n`,server:context,rpc:rpcDeclarations(files['server.ts'])};
}
let running = false;
export async function checkSources(raw, files) {
  if (running) throw Object.assign(Error('Проверка занята. Повторите запрос после завершения.'), {status:429});
  running = true;
  const types = generateTypes(raw,files);
  try {
    return await new Promise((resolve,reject) => {
      const worker = new Worker(new URL('./workspace-check-worker.mjs',import.meta.url), {workerData:{files,types},resourceLimits:{maxOldGenerationSizeMb:192}});
      let finished = false;
      const finish = (error,value) => { if (finished) return; finished=true; clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => finish(Error('Проверка превысила лимит времени')),15000);
      worker.once('message',value => value.error ? finish(Error('Проверка TypeScript недоступна')) : finish(null,value));
      worker.once('error',() => finish(Error('Проверка превысила лимит ресурсов')));
      worker.once('exit',code => { if (!finished) finish(Error('Проверка TypeScript прервана')); });
    });
  } finally { running=false; }
}
